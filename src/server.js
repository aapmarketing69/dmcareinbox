import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { getConfig, ROOT_DIR } from './config.js';
import { createDatabase } from './db/index.js';
import { createSseHub } from './realtime/sse.hub.js';
import { createChatService } from './services/chat.service.js';
import { createPresenceService } from './services/presence.service.js';
import { createUploadService } from './services/upload.service.js';
import { parseVoucherUpload, buildSpreadsheetXls, buildSampleVouchersXls } from './services/xls.service.js';
import { verifyEvidenceBundle, createManualEvidenceSubmission } from './services/fraud-ai.service.js';
import {
  SESSION_COOKIE_NAME,
  LEGACY_SESSION_COOKIE_NAME,
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  createSessionToken,
  parseCookies,
  verifyPassword,
  verifySessionToken,
} from './services/auth.service.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function readRawBody(req, maxBytes = 1_048_576) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

export async function createApp({ dbPath, uploadsDir, pgPool = null, fetchImpl = fetch, configOverride = {} } = {}) {
  const config = { ...getConfig(), ...configOverride };
  const database = await createDatabase({ config, dbPath, pgPool });
  const { repo, db, engine: dbEngine } = database;
  const sseHub = createSseHub();
  const presenceService = createPresenceService();

  const r2Config = config.r2AccountId
    ? {
        accountId: config.r2AccountId,
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
        bucket: config.r2Bucket,
        publicUrl: config.r2PublicUrl,
      }
    : null;
  const uploadService = createUploadService(uploadsDir || path.join(ROOT_DIR, 'data', 'uploads'), {
    r2Config,
    fetchImpl,
  });
  const chatService = createChatService({ repo, sseHub, config, uploadService, fetchImpl });
  const publicDir = path.join(ROOT_DIR, 'public');

  // Lightweight 14-day webhook_events retention cleanup (prevents DB bloat at 500K+ msgs/mo)
  const runWebhookCleanup = () => {
    Promise.resolve(repo.cleanupOldWebhookEvents?.(14)).catch(() => {});
  };
  runWebhookCleanup();
  const cleanupTimer = setInterval(runWebhookCleanup, 12 * 60 * 60 * 1000);
  cleanupTimer.unref?.();

  const handleRequest = async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method || 'GET';

      // --- Health Check (Public — used by Railway / Docker healthcheck) ---
      if (method === 'GET' && pathname === '/health') {
        return sendJson(res, 200, {
          status: 'ok',
          brandName: config.brandName,
          environment: config.isProduction ? 'production' : 'development',
          dbEngine,
          storageProvider: uploadService.storageProvider,
          sseClients: sseHub.getClientCount(),
        });
      }

      // --- Public Image Serving (Local Disk fallback when Cloudflare R2 is not configured) ---
      const uploadMatch = pathname.match(/^\/uploads\/([a-zA-Z0-9._-]+)$/);
      if (method === 'GET' && uploadMatch) {
        const file = uploadService.resolveUpload(uploadMatch[1]);
        if (!file) return sendJson(res, 404, { error: 'Image not found' });
        res.writeHead(200, {
          'Content-Type': file.mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        return fs.createReadStream(file.fullPath).pipe(res);
      }

      // --- Public Webhooks (Protected by HMAC Signature / Verify Token) ---
      const lineMatch = pathname.match(/^\/webhooks\/line\/([a-zA-Z0-9_-]+)$/);
      if (method === 'POST' && lineMatch) {
        const rawBody = await readRawBody(req);
        const parsedBody = JSON.parse(rawBody.toString('utf8') || '{}');
        const result = await chatService.handleLineWebhook({
          channelKey: lineMatch[1],
          rawBody,
          signature: req.headers['x-line-signature'],
          parsedBody,
        });
        return sendJson(res, 200, { status: 'ok', ...result });
      }

      if (method === 'GET' && pathname === '/webhooks/facebook') {
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');
        if (mode === 'subscribe' && token === config.fbVerifyToken && challenge) {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(challenge);
        }
        return sendJson(res, 403, { error: 'Facebook webhook verification failed' });
      }

      if (method === 'POST' && pathname === '/webhooks/facebook') {
        const rawBody = await readRawBody(req);
        const parsedBody = JSON.parse(rawBody.toString('utf8') || '{}');
        const result = await chatService.handleFacebookWebhook({
          rawBody,
          signature: req.headers['x-hub-signature-256'],
          parsedBody,
        });
        return sendJson(res, 200, { status: 'ok', ...result });
      }

      // --- Static Files for Admin Inbox & Login UI (Public) ---
      if (method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/webhooks/')) {
        const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const resolved = path.resolve(publicDir, relPath);
        if (!resolved.startsWith(publicDir) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
          return sendJson(res, 404, { error: 'Not found' });
        }
        const ext = path.extname(resolved);
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        return fs.createReadStream(resolved).pipe(res);
      }

      // --- Session Resolution Helper ---
      const isHttps =
        req.headers['x-forwarded-proto'] === 'https' ||
        String(config.publicBaseUrl || '').startsWith('https://');
      const cookies = parseCookies(req.headers.cookie);
      const rawSessionToken = cookies[SESSION_COOKIE_NAME] || cookies[LEGACY_SESSION_COOKIE_NAME];
      const sessionPayload = verifySessionToken(rawSessionToken, config);
      let authUser = sessionPayload ? await repo.getAgentById(sessionPayload.sub) : null;
      if (authUser && !authUser.is_active) {
        authUser = null;
      }

      // --- Public Auth Endpoints ---
      if (method === 'GET' && pathname === '/api/auth/me') {
        return sendJson(res, 200, {
          authenticated: Boolean(authUser),
          user: authUser,
          isProduction: config.isProduction,
          brandName: config.brandName,
        });
      }

      if (method === 'POST' && pathname === '/api/auth/login') {
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (!email || !password) {
          return sendJson(res, 400, { error: 'กรุณากรอกอีเมลและรหัสผ่าน' });
        }
        const rawAgent = await repo.getAgentByEmailWithHash(email);
        if (!rawAgent || !verifyPassword(password, rawAgent.password_hash)) {
          return sendJson(res, 401, { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
        }
        if (!rawAgent.is_active) {
          return sendJson(res, 403, { error: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
        }
        await repo.recordAgentLogin(rawAgent.id);
        const safeUser = await repo.getAgentById(rawAgent.id);
        const token = createSessionToken(safeUser, config);
        return sendJson(
          res,
          200,
          { authenticated: true, user: safeUser },
          { 'Set-Cookie': buildSessionCookieHeader(token, { secure: isHttps }) }
        );
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        return sendJson(
          res,
          200,
          { ok: true },
          { 'Set-Cookie': buildClearSessionCookieHeader({ secure: isHttps }) }
        );
      }

      // =========================================================================
      // AUTHENTICATION GUARD — Every /api/* route below requires a valid session
      // =========================================================================
      if (!authUser) {
        return sendJson(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
      }

      const allowedChannelIds = authUser.is_manager ? null : authUser.channel_ids;
      const assertManager = () => {
        if (!authUser.is_manager) {
          const err = new Error('ต้องใช้สิทธิ์ Supervisor/Admin เท่านั้น');
          err.statusCode = 403;
          throw err;
        }
      };
      const assertCanAccessChannel = (channelId) => {
        if (allowedChannelIds !== null && !allowedChannelIds.includes(channelId)) {
          const err = new Error('คุณไม่มีสิทธิ์เข้าถึงร้านค้านี้');
          err.statusCode = 403;
          throw err;
        }
      };

      // --- Authenticated Auth & Team Management Routes ---
      if (method === 'POST' && pathname === '/api/auth/change-password') {
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        const rawAgent = await repo.getAgentByEmailWithHash(authUser.email);
        if (!verifyPassword(body.currentPassword || '', rawAgent.password_hash)) {
          return sendJson(res, 400, { error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
        }
        await repo.updateAgentPassword(authUser.id, body.newPassword);
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'GET' && pathname === '/api/agents') {
        assertManager();
        return sendJson(res, 200, { agents: await repo.listAgents() });
      }

      if (method === 'POST' && pathname === '/api/agents') {
        assertManager();
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        const created = await repo.createAgent({
          displayName: body.displayName,
          email: body.email,
          password: body.password,
          role: body.role || 'agent',
          avatarColor: body.avatarColor || '#2563eb',
          channelIds: Array.isArray(body.channelIds) ? body.channelIds : [],
        });
        return sendJson(res, 201, { agent: created });
      }

      const agentItemMatch = pathname.match(/^\/api\/agents\/([a-zA-Z0-9_-]+)$/);
      if (method === 'PATCH' && agentItemMatch) {
        assertManager();
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        if (agentItemMatch[1] === authUser.id && body.isActive === false) {
          return sendJson(res, 400, { error: 'ไม่สามารถระงับบัญชีของตัวเองได้' });
        }
        const updated = await repo.updateAgent(agentItemMatch[1], {
          displayName: body.displayName,
          role: body.role,
          isActive: body.isActive,
          password: body.password,
          channelIds: body.channelIds,
        });
        if (!updated) return sendJson(res, 404, { error: 'ไม่พบบัญชีแอดมินนี้' });
        return sendJson(res, 200, { agent: updated });
      }

      // --- Real-time SSE Stream (Authenticated) ---
      if (method === 'GET' && pathname === '/api/events') {
        const clientId = url.searchParams.get('clientId');
        return sseHub.addClient(req, res, {
          onDisconnect: () => {
            if (clientId && presenceService.removeClient(clientId)) {
              sseHub.broadcast('presence:updated', { presence: presenceService.getSnapshot() });
            }
          },
        });
      }

      // --- Collision Detection / Presence ---
      if (method === 'POST' && pathname === '/api/presence') {
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        const snapshot = presenceService.setPresence({
          clientId: body.clientId,
          agentId: authUser.id,
          agentName: authUser.display_name,
          avatarColor: authUser.avatar_color,
          conversationId: body.conversationId || null,
          isTyping: Boolean(body.isTyping),
        });
        sseHub.broadcast('presence:updated', { presence: snapshot });
        return sendJson(res, 200, { presence: snapshot });
      }

      // --- Image Upload (Authenticated — stores to Cloudflare R2 or Local Disk) ---
      if (method === 'POST' && pathname === '/api/uploads') {
        const body = JSON.parse((await readRawBody(req, 8 * 1024 * 1024)).toString('utf8') || '{}');
        const saved = await uploadService.saveBase64Image(body);
        return sendJson(res, 201, saved);
      }

      // --- REST API: Bootstrap metadata ---
      if (method === 'GET' && pathname === '/api/bootstrap') {
        return sendJson(res, 200, {
          user: authUser,
          brandName: config.brandName,
          isProduction: config.isProduction,
          dbEngine,
          storageProvider: uploadService.storageProvider,
          channels: await repo.listChannelsWithStats(allowedChannelIds),
          agents: await repo.listAgents(),
          quickReplies: await repo.listQuickReplies(),
          campaigns: await repo.listCampaignsWithStats(),
          presence: presenceService.getSnapshot(),
          liveDeliveryEnabled: config.liveDeliveryEnabled,
          publicBaseUrl: config.publicBaseUrl || '',
          geminiEnabled: Boolean(config.geminiApiKey),
        });
      }

      // --- REST API: Campaigns & Gift Voucher (.xls Import/Export & AI Verification) ---
      if (method === 'GET' && pathname === '/api/campaigns') {
        return sendJson(res, 200, { campaigns: await repo.listCampaignsWithStats() });
      }

      if (method === 'GET' && pathname === '/api/campaigns/sample-vouchers.xls') {
        const xml = buildSampleVouchersXls();
        res.writeHead(200, {
          'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
          'Content-Disposition': 'attachment; filename="sample-gift-vouchers.xls"',
          'Cache-Control': 'no-cache',
        });
        return res.end(xml);
      }

      if (method === 'POST' && pathname === '/api/campaigns') {
        assertManager();
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        if (!body.name || !body.requiredRules || !body.replyTemplate) {
          return sendJson(res, 400, { error: 'Missing required fields: name, requiredRules, replyTemplate' });
        }
        const created = await repo.createCampaign(body);
        sseHub.broadcast('campaigns:updated', { campaigns: await repo.listCampaignsWithStats() });
        return sendJson(res, 201, { campaign: created });
      }

      const campVouchersMatch = pathname.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/vouchers$/);
      if (method === 'GET' && campVouchersMatch) {
        const campaign = await repo.getCampaignById(campVouchersMatch[1]);
        if (!campaign) return sendJson(res, 404, { error: 'Campaign not found' });
        const allCampaigns = await repo.listCampaignsWithStats();
        return sendJson(res, 200, {
          campaign: allCampaigns.find((c) => c.id === campaign.id),
          vouchers: await repo.listVouchers(campaign.id),
        });
      }

      const campImportMatch = pathname.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/vouchers\/import$/);
      if (method === 'POST' && campImportMatch) {
        assertManager();
        const campaign = await repo.getCampaignById(campImportMatch[1]);
        if (!campaign) return sendJson(res, 404, { error: 'Campaign not found' });
        const body = JSON.parse((await readRawBody(req, 8 * 1024 * 1024)).toString('utf8') || '{}');
        const buffer = body.fileBase64 ? Buffer.from(body.fileBase64, 'base64') : null;
        const parsed = parseVoucherUpload({
          filename: body.filename || 'vouchers.xls',
          buffer,
          rawText: body.rawText || '',
        });
        if (parsed.rows.length === 0) {
          return sendJson(res, 400, { error: 'ไม่พบรหัสโค้ดในไฟล์ที่อัปโหลด กรุณาตรวจสอบไฟล์ .xls / .xlsx / .csv' });
        }
        const stats = await repo.importVouchers(campaign.id, parsed.rows);
        const campaigns = await repo.listCampaignsWithStats();
        sseHub.broadcast('campaigns:updated', { campaigns });
        return sendJson(res, 201, {
          format: parsed.format,
          parsedCount: parsed.rows.length,
          ...stats,
          campaign: campaigns.find((c) => c.id === campaign.id),
        });
      }

      const campExportMatch = pathname.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/vouchers\/export\.xls$/);
      if (method === 'GET' && campExportMatch) {
        const campaign = await repo.getCampaignById(campExportMatch[1]);
        if (!campaign) return sendJson(res, 404, { error: 'Campaign not found' });
        const vouchers = await repo.listVouchers(campaign.id);
        const xml = buildSpreadsheetXls({
          sheetName: 'VoucherReport',
          headers: [
            'Code',
            'มูลค่า',
            'วันหมดอายุ',
            'สถานะ',
            'ลูกค้าที่รับ',
            'แพลตฟอร์ม',
            'ร้าน',
            'ชื่อ FB ในหลักฐาน',
            'คะแนน AI (%)',
            'ผู้อนุมัติ',
            'เวลาที่แจก',
          ],
          rows: vouchers.map((v) => [
            v.code,
            v.reward_value || '',
            v.expires_at || '',
            v.status === 'claimed' ? 'แจกแล้ว (1/1)' : 'พร้อมแจก',
            v.customer_name || '',
            v.platform ? v.platform.toUpperCase() : '',
            v.shop_code || '',
            v.extracted_fb_name || '',
            v.ai_confidence != null ? String(v.ai_confidence) : '',
            v.agent_name || '',
            v.claimed_at || '',
          ]),
        });
        res.writeHead(200, {
          'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
          'Content-Disposition': `attachment; filename="vouchers-${campaign.id}.xls"`,
          'Cache-Control': 'no-cache',
        });
        return res.end(xml);
      }

      const convSubMatch = pathname.match(/^\/api\/conversations\/([a-zA-Z0-9_-]+)\/submissions$/);
      if (method === 'GET' && convSubMatch) {
        const conv = await repo.getConversationSummaryById(convSubMatch[1]);
        if (!conv) return sendJson(res, 404, { error: 'Conversation not found' });
        assertCanAccessChannel(conv.channel_id);
        return sendJson(res, 200, { submissions: await repo.listConversationSubmissions(conv.id) });
      }

      const convVerifyMatch = pathname.match(/^\/api\/conversations\/([a-zA-Z0-9_-]+)\/verify-evidence$/);
      if (method === 'POST' && convVerifyMatch) {
        const conv = await repo.getConversationSummaryById(convVerifyMatch[1]);
        if (!conv) return sendJson(res, 404, { error: 'Conversation not found' });
        assertCanAccessChannel(conv.channel_id);
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        const campaign = await repo.getCampaignById(body.campaignId);
        if (!campaign) return sendJson(res, 404, { error: 'Campaign not found' });

        let imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.filter(Boolean) : [];
        if (imageUrls.length === 0) {
          const msgs = await repo.getConversationMessages(conv.id);
          imageUrls = msgs
            .filter((m) => m.sender_type === 'customer' && m.media_url)
            .map((m) => m.media_url);
        }

        let submission;
        if (body.manualFallback) {
          assertManager();
          submission = await createManualEvidenceSubmission({
            campaign,
            conversation: conv,
            imageUrls,
            repo,
            uploadService,
            fetchImpl,
          });
        } else {
          submission = await verifyEvidenceBundle({
            campaign,
            conversation: conv,
            imageUrls,
            repo,
            uploadService,
            config,
            fetchImpl,
            mockScenario: body.mockScenario || 'auto',
          });
        }

        sseHub.broadcast('submission:updated', { conversationId: conv.id, submission });
        return sendJson(res, 201, { submission });
      }

      const subApproveMatch = pathname.match(/^\/api\/submissions\/([a-zA-Z0-9_-]+)\/approve$/);
      if (method === 'POST' && subApproveMatch) {
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        const subCheck = await repo.getSubmissionById(subApproveMatch[1]);
        if (subCheck) assertCanAccessChannel(subCheck.channel_id);
        const agentId = authUser.id;
        const claimed = await repo.claimVoucherAtomic({
          submissionId: subApproveMatch[1],
          agentId,
          allowOverride: Boolean(body.allowOverride && authUser.is_manager),
        });

        const messageText = String(claimed.replyTemplate || 'รหัส Gift Voucher ของคุณคือ: {{code}}')
          .replace(/\{\{\s*code\s*\}\}/gi, claimed.voucher.code)
          .replace(/\{\{\s*value\s*\}\}/gi, claimed.voucher.reward_value || '');

        const replyResult = await chatService.sendAgentReply({
          conversationId: claimed.submission.conversation_id,
          text: messageText,
          agentId,
        });

        sseHub.broadcast('campaigns:updated', { campaigns: await repo.listCampaignsWithStats() });
        sseHub.broadcast('submission:updated', {
          conversationId: claimed.submission.conversation_id,
          submission: claimed.submission,
        });

        return sendJson(res, 200, {
          voucher: claimed.voucher,
          submission: claimed.submission,
          reply: replyResult,
        });
      }

      const subRejectMatch = pathname.match(/^\/api\/submissions\/([a-zA-Z0-9_-]+)\/reject$/);
      if (method === 'POST' && subRejectMatch) {
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        const subCheck = await repo.getSubmissionById(subRejectMatch[1]);
        if (subCheck) assertCanAccessChannel(subCheck.channel_id);
        const agentId = authUser.id;
        const rejected = await repo.rejectSubmission({
          submissionId: subRejectMatch[1],
          agentId,
        });
        if (!rejected) return sendJson(res, 404, { error: 'Submission not found or already reviewed' });

        if (body.escalate) {
          const updatedConv = await repo.updateConversationMeta(rejected.conversation_id, { status: 'pending' });
          sseHub.broadcast('conversation:updated', {
            conversation: updatedConv,
            channels: await repo.listChannelsWithStats(),
          });
        } else if (body.notifyText) {
          await chatService.sendAgentReply({
            conversationId: rejected.conversation_id,
            text: body.notifyText,
            agentId,
          });
        }

        sseHub.broadcast('submission:updated', {
          conversationId: rejected.conversation_id,
          submission: rejected,
        });
        return sendJson(res, 200, { submission: rejected });
      }

      // --- REST API: Quick Replies (Global & Per-Shop) ---
      if (method === 'GET' && pathname === '/api/quick-replies') {
        const channelId = url.searchParams.get('channelId') || null;
        return sendJson(res, 200, { quickReplies: await repo.listQuickReplies(channelId) });
      }

      if (method === 'POST' && pathname === '/api/quick-replies') {
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        if (!body.shortcut || !body.title || (!body.contentText && !body.mediaUrl)) {
          return sendJson(res, 400, { error: 'Missing required fields: shortcut, title, contentText' });
        }
        const created = await repo.createQuickReply({
          channelId: body.channelId || null,
          shortcut: body.shortcut,
          title: body.title,
          contentText: body.contentText || '',
          mediaUrl: body.mediaUrl || null,
        });
        sseHub.broadcast('quickReplies:updated', { quickReplies: await repo.listQuickReplies() });
        return sendJson(res, 201, { quickReply: created });
      }

      const qrItemMatch = pathname.match(/^\/api\/quick-replies\/([a-zA-Z0-9_-]+)$/);
      if (method === 'PATCH' && qrItemMatch) {
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        if (!body.shortcut || !body.title || (!body.contentText && !body.mediaUrl)) {
          return sendJson(res, 400, { error: 'Missing required fields: shortcut, title, contentText' });
        }
        const updated = await repo.updateQuickReply(qrItemMatch[1], {
          channelId: body.channelId || null,
          shortcut: body.shortcut,
          title: body.title,
          contentText: body.contentText || '',
          mediaUrl: body.mediaUrl || null,
        });
        if (!updated) return sendJson(res, 404, { error: 'Quick reply not found' });
        sseHub.broadcast('quickReplies:updated', { quickReplies: await repo.listQuickReplies() });
        return sendJson(res, 200, { quickReply: updated });
      }

      if (method === 'DELETE' && qrItemMatch) {
        const deleted = await repo.deleteQuickReply(qrItemMatch[1]);
        if (!deleted) return sendJson(res, 404, { error: 'Quick reply not found' });
        sseHub.broadcast('quickReplies:updated', { quickReplies: await repo.listQuickReplies() });
        return sendJson(res, 200, { deleted: true });
      }

      // --- REST API: Channels ---
      if (method === 'GET' && pathname === '/api/channels') {
        return sendJson(res, 200, { channels: await repo.listChannelsWithStats(allowedChannelIds) });
      }

      if (method === 'POST' && pathname === '/api/channels') {
        assertManager();
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        if (!body.shopCode || !body.name || !['line', 'facebook'].includes(body.platform) || !body.externalChannelId) {
          return sendJson(res, 400, { error: 'Missing required fields: shopCode, name, platform, externalChannelId' });
        }
        const created = await repo.createChannel(body);
        sseHub.broadcast('channels:updated', { channels: await repo.listChannelsWithStats() });
        return sendJson(res, 201, { channel: created });
      }

      const channelItemMatch = pathname.match(/^\/api\/channels\/([a-zA-Z0-9_-]+)$/);
      if (method === 'PATCH' && channelItemMatch) {
        assertManager();
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        const updated = await repo.updateChannel(channelItemMatch[1], body);
        if (!updated) return sendJson(res, 404, { error: 'Channel not found' });
        sseHub.broadcast('channels:updated', { channels: await repo.listChannelsWithStats() });
        return sendJson(res, 200, { channel: updated });
      }

      // --- REST API: Conversations ---
      if (method === 'GET' && pathname === '/api/conversations') {
        const reqChannelId = url.searchParams.get('channelId');
        if (reqChannelId && reqChannelId !== 'all') {
          assertCanAccessChannel(reqChannelId);
        }
        const filters = {
          platform: url.searchParams.get('platform'),
          channelId: reqChannelId,
          status: url.searchParams.get('status'),
          box: url.searchParams.get('box'),
          q: url.searchParams.get('q'),
          allowedChannelIds,
        };
        const conversations = await repo.listConversations(filters);
        const counts = await repo.getConversationCounts(filters);
        return sendJson(res, 200, { conversations, counts });
      }

      const convMsgMatch = pathname.match(/^\/api\/conversations\/([a-zA-Z0-9_-]+)\/messages$/);
      if (method === 'GET' && convMsgMatch) {
        const conv = await repo.getConversationSummaryById(convMsgMatch[1]);
        if (!conv) return sendJson(res, 404, { error: 'Conversation not found' });
        assertCanAccessChannel(conv.channel_id);
        const messages = await repo.getConversationMessages(conv.id);
        return sendJson(res, 200, { conversation: conv, messages });
      }

      if (method === 'POST' && convMsgMatch) {
        const conv = await repo.getConversationSummaryById(convMsgMatch[1]);
        if (!conv) return sendJson(res, 404, { error: 'Conversation not found' });
        assertCanAccessChannel(conv.channel_id);
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        const result = await chatService.sendAgentReply({
          conversationId: convMsgMatch[1],
          text: body.text,
          agentId: authUser.id,
          messageType: body.messageType || (body.mediaUrl ? 'image' : 'text'),
          mediaUrl: body.mediaUrl || null,
        });
        return sendJson(res, 201, result);
      }

      const convReadMatch = pathname.match(/^\/api\/conversations\/([a-zA-Z0-9_-]+)\/read$/);
      if (method === 'POST' && convReadMatch) {
        const existing = await repo.getConversationSummaryById(convReadMatch[1]);
        if (!existing) return sendJson(res, 404, { error: 'Conversation not found' });
        assertCanAccessChannel(existing.channel_id);
        const updated = await repo.markConversationRead(convReadMatch[1]);
        sseHub.broadcast('conversation:updated', {
          conversation: updated,
          channels: await repo.listChannelsWithStats(),
        });
        return sendJson(res, 200, { conversation: updated });
      }

      const convMetaMatch = pathname.match(/^\/api\/conversations\/([a-zA-Z0-9_-]+)$/);
      if (method === 'PATCH' && convMetaMatch) {
        const existing = await repo.getConversationSummaryById(convMetaMatch[1]);
        if (!existing) return sendJson(res, 404, { error: 'Conversation not found' });
        assertCanAccessChannel(existing.channel_id);
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        const updated = await repo.updateConversationMeta(convMetaMatch[1], {
          status: body.status,
          assignedAgentId: body.assignedAgentId,
          tags: body.tags,
          notes: body.notes,
        });
        sseHub.broadcast('conversation:updated', {
          conversation: updated,
          channels: await repo.listChannelsWithStats(),
        });
        return sendJson(res, 200, { conversation: updated });
      }

      // --- REST API: Simulator (Development / Pilot only — disabled in Production) ---
      if (method === 'POST' && pathname === '/api/simulator/inbound') {
        if (config.isProduction) {
          return sendJson(res, 403, { error: 'โหมดจำลองลูกค้า (Simulator) ถูกปิดใช้งานใน Production' });
        }
        const body = JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
        if (body.channelId) assertCanAccessChannel(body.channelId);
        const result = await chatService.simulateInbound(body);
        return sendJson(res, 201, { status: 'simulated', ...result });
      }

      return sendJson(res, 404, { error: `Route not found: ${method} ${pathname}` });
    } catch (err) {
      const status = err.statusCode || (err instanceof SyntaxError ? 400 : 500);
      if (status >= 500) {
        console.error('[Server Error]', err);
      }
      return sendJson(res, status, { error: err.message || 'Internal Server Error' });
    }
  };

  const server = http.createServer(handleRequest);

  /**
   * In-process HTTP request injector for fast, port-free integration testing.
   */
  function inject({ method = 'GET', url = '/', headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
      const normalizedHeaders = {};
      for (const [k, v] of Object.entries(headers)) {
        normalizedHeaders[k.toLowerCase()] = v;
      }

      const bodyBuf = body === null || body === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');

      const req = Readable.from(bodyBuf.length ? [bodyBuf] : []);
      req.method = method;
      req.url = url;
      req.headers = { host: 'localhost', ...normalizedHeaders };

      const chunks = [];
      let statusCode = 200;
      let responseHeaders = {};

      const res = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          callback();
        },
      });

      res.writeHead = (code, hdrs = {}) => {
        statusCode = code;
        responseHeaders = { ...responseHeaders, ...hdrs };
        return res;
      };

      res.on('finish', () => {
        const raw = Buffer.concat(chunks);
        const text = raw.toString('utf8');
        resolve({
          status: statusCode,
          headers: responseHeaders,
          body: raw,
          text: () => text,
          json: () => JSON.parse(text),
        });
      });

      Promise.resolve(handleRequest(req, res)).catch(reject);
    });
  }

  return {
    server,
    handleRequest,
    inject,
    db,
    dbEngine,
    repo,
    sseHub,
    uploadService,
    config,
    async close() {
      clearInterval(cleanupTimer);
      sseHub.closeAll();
      await database.close();
      if (!server.listening) return;
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// Start server directly when run as entry script
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp()
    .then((app) => {
      app.server.listen(app.config.port, app.config.host, () => {
        console.log(`${app.config.brandName} Inbox running at http://${app.config.host}:${app.config.port}`);
        console.log(`  - Environment   : ${app.config.isProduction ? 'PRODUCTION' : 'development'}`);
        console.log(`  - Database      : ${app.dbEngine.toUpperCase()}`);
        console.log(`  - Media Storage : ${app.uploadService.storageProvider}`);
        console.log(`  - LINE Webhooks : POST /webhooks/line/a1 .. /webhooks/line/a5`);
        console.log(`  - FB Webhook    : GET/POST /webhooks/facebook (handles pages b1..b5)`);
        console.log(`  - Live Delivery : ${app.config.liveDeliveryEnabled ? 'ON' : 'OFF (Mock Mode)'}`);
      });

      const shutdown = async () => {
        app.server.closeAllConnections?.();
        await app.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('[Fatal Startup Error]', err);
      process.exit(1);
    });
}
