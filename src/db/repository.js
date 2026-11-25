import crypto from 'node:crypto';
import { decryptSecret, encryptSecret } from '../services/crypto.service.js';
import { hashPassword, isManagerRole } from '../services/auth.service.js';

export function createRepository(db, encryptionKey) {
  function getAgentChannelIds(agentId) {
    return db
      .prepare('SELECT channel_id FROM agent_channel_permissions WHERE agent_id = ? ORDER BY channel_id ASC')
      .all(agentId)
      .map((r) => r.channel_id);
  }

  return {
    listAgents() {
      return db
        .prepare('SELECT id, display_name, email, role, avatar_color, is_active, last_login_at FROM agents ORDER BY id ASC')
        .all()
        .map((a) => ({
          ...a,
          is_active: Boolean(a.is_active),
          is_manager: isManagerRole(a.role),
          channel_ids: getAgentChannelIds(a.id),
        }));
    },

    getAgentById(id) {
      const a = db
        .prepare('SELECT id, display_name, email, role, avatar_color, is_active, last_login_at FROM agents WHERE id = ?')
        .get(id);
      if (!a) return null;
      return {
        ...a,
        is_active: Boolean(a.is_active),
        is_manager: isManagerRole(a.role),
        channel_ids: getAgentChannelIds(a.id),
      };
    },

    getAgentByEmailWithHash(email) {
      return db
        .prepare('SELECT * FROM agents WHERE LOWER(email) = LOWER(?)')
        .get(String(email || '').trim()) || null;
    },

    recordAgentLogin(agentId) {
      db.prepare('UPDATE agents SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), agentId);
    },

    createAgent({ displayName, email, password, role = 'agent', avatarColor = '#2563eb', channelIds = [] }) {
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!displayName || !cleanEmail || !password) {
        const err = new Error('กรุณากรอกชื่อ อีเมล และรหัสผ่านให้ครบ');
        err.statusCode = 400;
        throw err;
      }
      if (!['owner', 'admin', 'supervisor', 'agent'].includes(role)) {
        const err = new Error('บทบาทไม่ถูกต้อง');
        err.statusCode = 400;
        throw err;
      }
      const existing = this.getAgentByEmailWithHash(cleanEmail);
      if (existing) {
        const err = new Error('อีเมลนี้ถูกใช้งานแล้ว');
        err.statusCode = 409;
        throw err;
      }

      const id = `agent_${crypto.randomBytes(4).toString('hex')}`;
      const pwHash = hashPassword(password);

      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`
          INSERT INTO agents (id, display_name, email, password_hash, role, avatar_color, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `).run(id, displayName.trim(), cleanEmail, pwHash, role, avatarColor || '#2563eb');

        if (Array.isArray(channelIds) && channelIds.length > 0) {
          const ins = db.prepare('INSERT OR IGNORE INTO agent_channel_permissions (agent_id, channel_id) VALUES (?, ?)');
          for (const chId of channelIds) {
            ins.run(id, chId);
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      return this.getAgentById(id);
    },

    updateAgent(agentId, { displayName, role, isActive, password, channelIds }) {
      const existing = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId);
      if (!existing) return null;

      db.exec('BEGIN IMMEDIATE');
      try {
        if (typeof displayName === 'string' && displayName.trim()) {
          db.prepare('UPDATE agents SET display_name = ? WHERE id = ?').run(displayName.trim(), agentId);
        }
        if (role && ['owner', 'admin', 'supervisor', 'agent'].includes(role)) {
          db.prepare('UPDATE agents SET role = ? WHERE id = ?').run(role, agentId);
        }
        if (typeof isActive === 'boolean') {
          db.prepare('UPDATE agents SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, agentId);
        }
        if (typeof password === 'string' && password.length > 0) {
          const pwHash = hashPassword(password);
          db.prepare('UPDATE agents SET password_hash = ? WHERE id = ?').run(pwHash, agentId);
        }
        if (Array.isArray(channelIds)) {
          db.prepare('DELETE FROM agent_channel_permissions WHERE agent_id = ?').run(agentId);
          const ins = db.prepare('INSERT OR IGNORE INTO agent_channel_permissions (agent_id, channel_id) VALUES (?, ?)');
          for (const chId of channelIds) {
            ins.run(agentId, chId);
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      return this.getAgentById(agentId);
    },

    updateAgentPassword(agentId, newPassword) {
      const pwHash = hashPassword(newPassword);
      db.prepare('UPDATE agents SET password_hash = ? WHERE id = ?').run(pwHash, agentId);
    },

    listQuickReplies(channelId = null) {
      if (channelId) {
        return db.prepare(`
          SELECT qr.id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
          FROM quick_replies qr
          LEFT JOIN channels ch ON ch.id = qr.channel_id
          WHERE qr.channel_id IS NULL OR qr.channel_id = ?
          ORDER BY (qr.channel_id IS NULL) ASC, qr.shortcut ASC
        `).all(channelId);
      }
      return db.prepare(`
        SELECT qr.id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
        FROM quick_replies qr
        LEFT JOIN channels ch ON ch.id = qr.channel_id
        ORDER BY (qr.channel_id IS NULL) ASC, ch.shop_code ASC, qr.shortcut ASC
      `).all();
    },

    createQuickReply({ channelId = null, shortcut, title, contentText, mediaUrl = null }) {
      const id = `qr_${crypto.randomBytes(5).toString('hex')}`;
      const normalizedShortcut = shortcut.startsWith('/') ? shortcut.trim() : `/${shortcut.trim()}`;
      db.prepare(`
        INSERT INTO quick_replies (id, channel_id, shortcut, title, content_text, media_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, channelId || null, normalizedShortcut, title.trim(), contentText.trim(), mediaUrl || null);

      return db.prepare(`
        SELECT qr.id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
        FROM quick_replies qr
        LEFT JOIN channels ch ON ch.id = qr.channel_id
        WHERE qr.id = ?
      `).get(id);
    },

    updateQuickReply(id, { channelId = null, shortcut, title, contentText, mediaUrl = null }) {
      const existing = db.prepare('SELECT id FROM quick_replies WHERE id = ?').get(id);
      if (!existing) return null;

      const normalizedShortcut = shortcut.startsWith('/') ? shortcut.trim() : `/${shortcut.trim()}`;
      db.prepare(`
        UPDATE quick_replies
        SET channel_id = ?, shortcut = ?, title = ?, content_text = ?, media_url = ?
        WHERE id = ?
      `).run(channelId || null, normalizedShortcut, title.trim(), contentText.trim(), mediaUrl || null, id);

      return db.prepare(`
        SELECT qr.id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
        FROM quick_replies qr
        LEFT JOIN channels ch ON ch.id = qr.channel_id
        WHERE qr.id = ?
      `).get(id);
    },

    deleteQuickReply(id) {
      const result = db.prepare('DELETE FROM quick_replies WHERE id = ?').run(id);
      return result.changes > 0;
    },

    listChannelsWithStats(allowedChannelIds = null) {
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return [];
      }
      const whereClause = Array.isArray(allowedChannelIds)
        ? `WHERE c.id IN (${allowedChannelIds.map(() => '?').join(',')})`
        : '';
      const params = Array.isArray(allowedChannelIds) ? allowedChannelIds : [];

      const rows = db.prepare(`
        SELECT
          c.id,
          c.shop_code,
          c.name,
          c.platform,
          c.external_channel_id,
          c.access_token_enc,
          c.webhook_path_key,
          c.is_active,
          c.created_at,
          COALESCE(SUM(CASE WHEN conv.status != 'resolved' THEN conv.unread_count ELSE 0 END), 0) AS unread_count,
          COUNT(CASE WHEN conv.status != 'resolved' THEN 1 END) AS open_conversations
        FROM channels c
        LEFT JOIN conversations conv ON conv.channel_id = c.id
        ${whereClause}
        GROUP BY c.id
        ORDER BY c.platform DESC, c.shop_code ASC
      `).all(...params);

      return rows.map((row) => {
        let hasRealToken = false;
        try {
          const dec = decryptSecret(row.access_token_enc, encryptionKey);
          hasRealToken = Boolean(dec && !dec.startsWith('mock_'));
        } catch {
          hasRealToken = false;
        }
        const { access_token_enc: _hidden, ...safeRow } = row;
        return {
          ...safeRow,
          is_active: Boolean(row.is_active),
          has_real_token: hasRealToken,
          webhook_url: row.platform === 'line' ? `/webhooks/line/${row.webhook_path_key}` : '/webhooks/facebook',
        };
      });
    },

    getChannelById(id) {
      return db.prepare('SELECT * FROM channels WHERE id = ?').get(id) || null;
    },

    getChannelByWebhookKey(platform, webhookKey) {
      return db
        .prepare('SELECT * FROM channels WHERE platform = ? AND webhook_path_key = ?')
        .get(platform, webhookKey) || null;
    },

    getChannelByExternalId(platform, externalChannelId) {
      return db
        .prepare('SELECT * FROM channels WHERE platform = ? AND external_channel_id = ?')
        .get(platform, String(externalChannelId)) || null;
    },

    createChannel({ shopCode, name, platform, externalChannelId, accessToken, channelSecret }) {
      const id = `ch_${platform}_${shopCode}_${crypto.randomBytes(3).toString('hex')}`;
      const webhookPathKey = shopCode.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const accessTokenEnc = encryptSecret(accessToken || `mock_${platform}_token_${shopCode}`, encryptionKey);
      const channelSecretEnc = channelSecret ? encryptSecret(channelSecret, encryptionKey) : null;

      db.prepare(`
        INSERT INTO channels (id, shop_code, name, platform, external_channel_id, access_token_enc, channel_secret_enc, webhook_path_key, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(id, shopCode, name, platform, String(externalChannelId), accessTokenEnc, channelSecretEnc, webhookPathKey);

      return this.listChannelsWithStats().find((c) => c.id === id);
    },

    updateChannel(id, { name, externalChannelId, accessToken, channelSecret, isActive }) {
      const existing = this.getChannelById(id);
      if (!existing) return null;

      if (typeof name === 'string' && name.trim()) {
        db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(name.trim(), id);
      }
      if (externalChannelId) {
        db.prepare('UPDATE channels SET external_channel_id = ? WHERE id = ?').run(String(externalChannelId).trim(), id);
      }
      if (typeof accessToken === 'string' && accessToken.trim()) {
        db.prepare('UPDATE channels SET access_token_enc = ? WHERE id = ?').run(
          encryptSecret(accessToken.trim(), encryptionKey),
          id
        );
      }
      if (typeof channelSecret === 'string' && channelSecret.trim()) {
        db.prepare('UPDATE channels SET channel_secret_enc = ? WHERE id = ?').run(
          encryptSecret(channelSecret.trim(), encryptionKey),
          id
        );
      }
      if (typeof isActive === 'boolean') {
        db.prepare('UPDATE channels SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
      }
      return this.listChannelsWithStats().find((c) => c.id === id);
    },

    findCustomer(channelId, externalUserId) {
      const row = db
        .prepare('SELECT * FROM customers WHERE channel_id = ? AND external_user_id = ?')
        .get(channelId, String(externalUserId));
      return row ? normalizeCustomer(row) : null;
    },

    upsertCustomer({ channelId, externalUserId, displayName, avatarUrl = null }) {
      const existing = db
        .prepare('SELECT * FROM customers WHERE channel_id = ? AND external_user_id = ?')
        .get(channelId, String(externalUserId));

      if (existing) {
        if (displayName && existing.display_name.startsWith('ลูกค้า ')) {
          db.prepare('UPDATE customers SET display_name = ? WHERE id = ?').run(displayName, existing.id);
          existing.display_name = displayName;
        }
        if (avatarUrl && !existing.avatar_url) {
          db.prepare('UPDATE customers SET avatar_url = ? WHERE id = ?').run(avatarUrl, existing.id);
          existing.avatar_url = avatarUrl;
        }
        return normalizeCustomer(existing);
      }

      const id = `cust_${crypto.randomBytes(6).toString('hex')}`;
      const fallbackName = displayName || `ลูกค้า ${String(externalUserId).slice(-6)}`;
      db.prepare(`
        INSERT INTO customers (id, channel_id, external_user_id, display_name, avatar_url, tags, notes)
        VALUES (?, ?, ?, ?, ?, '[]', '')
      `).run(id, channelId, String(externalUserId), fallbackName, avatarUrl);

      return normalizeCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
    },

    findOrCreateConversation({ channelId, customerId, preview, timestampIso, replyToken, replyExpiresAt }) {
      let conv = db
        .prepare('SELECT * FROM conversations WHERE channel_id = ? AND customer_id = ? ORDER BY last_message_at DESC LIMIT 1')
        .get(channelId, customerId);

      if (!conv) {
        const id = `conv_${crypto.randomBytes(6).toString('hex')}`;
        db.prepare(`
          INSERT INTO conversations (
            id, channel_id, customer_id, status, unread_count,
            last_message_preview, last_message_at, last_customer_msg_at,
            line_reply_token, line_reply_expires_at
          ) VALUES (?, ?, ?, 'open', 1, ?, ?, ?, ?, ?)
        `).run(
          id, channelId, customerId, preview, timestampIso, timestampIso,
          replyToken || null, replyExpiresAt || null
        );
        return this.getConversationSummaryById(id);
      }

      db.prepare(`
        UPDATE conversations
        SET
          status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
          is_replied = 0,
          unread_count = unread_count + 1,
          last_message_preview = ?,
          last_message_at = ?,
          last_customer_msg_at = ?,
          line_reply_token = COALESCE(?, line_reply_token),
          line_reply_expires_at = COALESCE(?, line_reply_expires_at)
        WHERE id = ?
      `).run(preview, timestampIso, timestampIso, replyToken || null, replyExpiresAt || null, conv.id);

      return this.getConversationSummaryById(conv.id);
    },

    findMessageByPlatformId(channelId, platformMessageId) {
      if (!platformMessageId) return null;
      return db
        .prepare('SELECT * FROM messages WHERE channel_id = ? AND platform_message_id = ?')
        .get(channelId, String(platformMessageId)) || null;
    },

    insertMessage({
      conversationId,
      channelId,
      platformMessageId = null,
      senderType,
      senderAgentId = null,
      messageType = 'text',
      contentText = '',
      mediaUrl = null,
      deliveryStatus = 'sent',
      deliveryMethod = null,
      rawPayload = null,
      createdAt = new Date().toISOString(),
    }) {
      const id = `msg_${crypto.randomBytes(6).toString('hex')}`;
      db.prepare(`
        INSERT INTO messages (
          id, conversation_id, channel_id, platform_message_id,
          sender_type, sender_agent_id, message_type, content_text,
          media_url, delivery_status, delivery_method, raw_payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        conversationId,
        channelId,
        platformMessageId ? String(platformMessageId) : null,
        senderType,
        senderAgentId,
        messageType,
        contentText,
        mediaUrl,
        deliveryStatus,
        deliveryMethod,
        rawPayload ? JSON.stringify(rawPayload) : null,
        createdAt
      );

      return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    },

    updateConversationAfterAgentReply({ conversationId, preview, timestampIso, clearReplyToken = false }) {
      if (clearReplyToken) {
        db.prepare(`
          UPDATE conversations
          SET last_message_preview = ?, last_message_at = ?, unread_count = 0,
              is_replied = 1, last_replied_at = ?,
              line_reply_token = NULL, line_reply_expires_at = NULL
          WHERE id = ?
        `).run(preview, timestampIso, timestampIso, conversationId);
      } else {
        db.prepare(`
          UPDATE conversations
          SET last_message_preview = ?, last_message_at = ?, unread_count = 0,
              is_replied = 1, last_replied_at = ?
          WHERE id = ?
        `).run(preview, timestampIso, timestampIso, conversationId);
      }
      return this.getConversationSummaryById(conversationId);
    },

    markConversationRead(conversationId) {
      db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(conversationId);
      return this.getConversationSummaryById(conversationId);
    },

    updateConversationMeta(conversationId, { status, assignedAgentId, tags, notes }) {
      const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
      if (!conv) return null;

      if (status && ['open', 'pending', 'resolved'].includes(status)) {
        db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(status, conversationId);
      }
      if (assignedAgentId !== undefined) {
        db.prepare('UPDATE conversations SET assigned_agent_id = ? WHERE id = ?').run(
          assignedAgentId || null,
          conversationId
        );
      }
      if (Array.isArray(tags)) {
        db.prepare('UPDATE customers SET tags = ? WHERE id = ?').run(JSON.stringify(tags), conv.customer_id);
      }
      if (typeof notes === 'string') {
        db.prepare('UPDATE customers SET notes = ? WHERE id = ?').run(notes, conv.customer_id);
      }

      return this.getConversationSummaryById(conversationId);
    },

    listConversations({ platform, channelId, status, box, q, allowedChannelIds = null } = {}) {
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return [];
      }
      const where = [];
      const params = [];

      if (Array.isArray(allowedChannelIds)) {
        where.push(`conv.channel_id IN (${allowedChannelIds.map(() => '?').join(',')})`);
        params.push(...allowedChannelIds);
      }
      if (platform && platform !== 'all') {
        where.push('ch.platform = ?');
        params.push(platform);
      }
      if (channelId && channelId !== 'all') {
        where.push('conv.channel_id = ?');
        params.push(channelId);
      }
      if (box && box !== 'all') {
        if (box === 'unreplied') {
          where.push("conv.status = 'open' AND conv.is_replied = 0");
        } else if (box === 'pending') {
          where.push("conv.status = 'pending'");
        } else if (box === 'replied') {
          where.push("conv.status = 'open' AND conv.is_replied = 1");
        } else if (box === 'resolved') {
          where.push("conv.status = 'resolved'");
        }
      } else if (status && status !== 'all') {
        where.push('conv.status = ?');
        params.push(status);
      }
      if (q && q.trim()) {
        where.push('(cust.display_name LIKE ? OR conv.last_message_preview LIKE ? OR ch.shop_code LIKE ?)');
        const like = `%${q.trim()}%`;
        params.push(like, like, like);
      }

      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = db.prepare(`
        SELECT
          conv.*,
          ch.shop_code,
          ch.name AS channel_name,
          ch.platform,
          ch.external_channel_id,
          cust.display_name AS customer_name,
          cust.external_user_id AS customer_external_id,
          cust.tags AS customer_tags,
          cust.notes AS customer_notes,
          ag.display_name AS assigned_agent_name,
          ag.avatar_color AS assigned_agent_color
        FROM conversations conv
        JOIN channels ch ON ch.id = conv.channel_id
        JOIN customers cust ON cust.id = conv.customer_id
        LEFT JOIN agents ag ON ag.id = conv.assigned_agent_id
        ${whereClause}
        ORDER BY conv.last_message_at DESC
        LIMIT 100
      `).all(...params);

      return rows.map(formatConversationSummary);
    },

    getConversationCounts({ platform, channelId, q, allowedChannelIds = null } = {}) {
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return { all: 0, unreplied: 0, pending: 0, replied: 0, resolved: 0 };
      }
      const where = [];
      const params = [];

      if (Array.isArray(allowedChannelIds)) {
        where.push(`conv.channel_id IN (${allowedChannelIds.map(() => '?').join(',')})`);
        params.push(...allowedChannelIds);
      }
      if (platform && platform !== 'all') {
        where.push('ch.platform = ?');
        params.push(platform);
      }
      if (channelId && channelId !== 'all') {
        where.push('conv.channel_id = ?');
        params.push(channelId);
      }
      if (q && q.trim()) {
        where.push('(cust.display_name LIKE ? OR conv.last_message_preview LIKE ? OR ch.shop_code LIKE ?)');
        const like = `%${q.trim()}%`;
        params.push(like, like, like);
      }

      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const row = db.prepare(`
        SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN conv.status = 'open' AND conv.is_replied = 0 THEN 1 ELSE 0 END) AS unreplied_count,
          SUM(CASE WHEN conv.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN conv.status = 'open' AND conv.is_replied = 1 THEN 1 ELSE 0 END) AS replied_count,
          SUM(CASE WHEN conv.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count
        FROM conversations conv
        JOIN channels ch ON ch.id = conv.channel_id
        JOIN customers cust ON cust.id = conv.customer_id
        ${whereClause}
      `).get(...params);

      return {
        all: Number(row?.total_count || 0),
        unreplied: Number(row?.unreplied_count || 0),
        pending: Number(row?.pending_count || 0),
        replied: Number(row?.replied_count || 0),
        resolved: Number(row?.resolved_count || 0),
      };
    },

    getConversationSummaryById(id) {
      const row = db.prepare(`
        SELECT
          conv.*,
          ch.shop_code,
          ch.name AS channel_name,
          ch.platform,
          ch.external_channel_id,
          cust.display_name AS customer_name,
          cust.external_user_id AS customer_external_id,
          cust.tags AS customer_tags,
          cust.notes AS customer_notes,
          ag.display_name AS assigned_agent_name,
          ag.avatar_color AS assigned_agent_color
        FROM conversations conv
        JOIN channels ch ON ch.id = conv.channel_id
        JOIN customers cust ON cust.id = conv.customer_id
        LEFT JOIN agents ag ON ag.id = conv.assigned_agent_id
        WHERE conv.id = ?
      `).get(id);

      return row ? formatConversationSummary(row) : null;
    },

    getConversationMessages(conversationId) {
      return db.prepare(`
        SELECT
          m.*,
          ag.display_name AS sender_agent_name
        FROM messages m
        LEFT JOIN agents ag ON ag.id = m.sender_agent_id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
      `).all(conversationId);
    },

    logWebhookEvent({ platform, channelId = null, status = 'processed', errorMessage = null, payload }) {
      db.prepare(`
        INSERT INTO webhook_events (platform, channel_id, status, error_message, payload)
        VALUES (?, ?, ?, ?, ?)
      `).run(platform, channelId, status, errorMessage, typeof payload === 'string' ? payload : JSON.stringify(payload));
    },

    cleanupOldWebhookEvents(retentionDays = 14) {
      const days = Math.max(1, Number(retentionDays || 14));
      const res = db
        .prepare(`DELETE FROM webhook_events WHERE datetime(received_at) < datetime('now', ?)`)
        .run(`-${days} days`);
      return Number(res.changes || 0);
    },

    // -------------------------------------------------------------------------
    // Campaigns, Gift Vouchers (1 code / 1 time) & AI Evidence Submissions
    // -------------------------------------------------------------------------
    listCampaignsWithStats() {
      const rows = db.prepare(`
        SELECT
          c.*,
          ch.shop_code,
          ch.platform,
          COUNT(v.id) AS total_vouchers,
          SUM(CASE WHEN v.status = 'available' THEN 1 ELSE 0 END) AS available_vouchers,
          SUM(CASE WHEN v.status = 'claimed' THEN 1 ELSE 0 END) AS claimed_vouchers
        FROM campaigns c
        LEFT JOIN channels ch ON ch.id = c.channel_id
        LEFT JOIN vouchers v ON v.campaign_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `).all();

      return rows.map((r) => ({
        ...r,
        is_active: Boolean(r.is_active),
        total_vouchers: Number(r.total_vouchers || 0),
        available_vouchers: Number(r.available_vouchers || 0),
        claimed_vouchers: Number(r.claimed_vouchers || 0),
      }));
    },

    getCampaignById(id) {
      return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) || null;
    },

    createCampaign({ name, channelId = null, requiredRules, replyTemplate, minConfidence = 90 }) {
      const id = `camp_${crypto.randomBytes(5).toString('hex')}`;
      db.prepare(`
        INSERT INTO campaigns (id, name, channel_id, required_rules, reply_template, min_confidence, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(
        id,
        name.trim(),
        channelId || null,
        requiredRules.trim(),
        replyTemplate.trim(),
        Math.max(50, Math.min(100, Number(minConfidence || 90)))
      );
      return this.listCampaignsWithStats().find((c) => c.id === id);
    },

    importVouchers(campaignId, rows) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO vouchers (id, campaign_id, code, reward_value, expires_at, status)
        VALUES (?, ?, ?, ?, ?, 'available')
      `);
      let inserted = 0;
      let skipped = 0;

      db.exec('BEGIN IMMEDIATE');
      try {
        for (const r of rows) {
          const code = String(r.code || '').trim();
          if (!code) continue;
          const res = stmt.run(
            `vch_${crypto.randomBytes(6).toString('hex')}`,
            campaignId,
            code,
            String(r.rewardValue || ''),
            String(r.expiresAt || '')
          );
          if (res.changes > 0) inserted += 1;
          else skipped += 1;
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return { inserted, skipped };
    },

    listVouchers(campaignId) {
      return db.prepare(`
        SELECT
          v.*,
          cust.display_name AS customer_name,
          ch.platform,
          ch.shop_code,
          ag.display_name AS agent_name,
          sub.ai_confidence,
          sub.extracted_fb_name
        FROM vouchers v
        LEFT JOIN customers cust ON cust.id = v.claimed_by_customer_id
        LEFT JOIN conversations conv ON conv.id = v.claimed_conversation_id
        LEFT JOIN channels ch ON ch.id = conv.channel_id
        LEFT JOIN agents ag ON ag.id = v.claimed_by_agent_id
        LEFT JOIN campaign_submissions sub ON sub.id = v.claimed_submission_id
        WHERE v.campaign_id = ?
        ORDER BY (v.status = 'claimed') DESC, v.claimed_at DESC, v.rowid ASC
      `).all(campaignId);
    },

    findCustomerClaimInCampaign(campaignId, customerId) {
      return db.prepare(`
        SELECT v.id, v.code, v.reward_value, v.claimed_at
        FROM vouchers v
        WHERE v.campaign_id = ? AND v.claimed_by_customer_id = ? AND v.status = 'claimed'
        LIMIT 1
      `).get(campaignId, customerId) || null;
    },

    findDuplicateSubmissionImages(campaignId, hashes, excludeCustomerId) {
      if (!Array.isArray(hashes) || hashes.length === 0) return [];
      const hashSet = new Set(hashes);
      const rows = db.prepare(`
        SELECT s.id, s.customer_id, s.conversation_id, s.image_hashes, s.status,
               cust.display_name AS customer_name, ch.platform, ch.shop_code
        FROM campaign_submissions s
        JOIN customers cust ON cust.id = s.customer_id
        JOIN channels ch ON ch.id = s.channel_id
        WHERE s.campaign_id = ? AND s.customer_id != ? AND s.status != 'rejected'
      `).all(campaignId, excludeCustomerId);

      const matches = [];
      for (const row of rows) {
        const storedHashes = safeJsonParse(row.image_hashes, []);
        if (storedHashes.some((h) => hashSet.has(h))) {
          matches.push(row);
        }
      }
      return matches;
    },

    findDuplicateFbNameClaim(campaignId, fbName, excludeCustomerId) {
      if (!fbName || !String(fbName).trim()) return null;
      return db.prepare(`
        SELECT s.id, s.voucher_code, ch.shop_code, ch.platform, cust.display_name AS customer_name
        FROM campaign_submissions s
        JOIN channels ch ON ch.id = s.channel_id
        JOIN customers cust ON cust.id = s.customer_id
        WHERE s.campaign_id = ?
          AND s.status = 'approved'
          AND s.customer_id != ?
          AND LOWER(TRIM(s.extracted_fb_name)) = LOWER(TRIM(?))
        LIMIT 1
      `).get(campaignId, excludeCustomerId, String(fbName)) || null;
    },

    createSubmission({
      campaignId,
      conversationId,
      customerId,
      channelId,
      imageUrls,
      imageHashes,
      extractedFbName = null,
      aiConfidence,
      aiVerdict,
      aiProvider,
      aiSummary,
      aiChecklist,
      fraudFlags,
    }) {
      const id = `sub_${crypto.randomBytes(6).toString('hex')}`;
      const nowIso = new Date().toISOString();
      db.prepare(`
        INSERT INTO campaign_submissions (
          id, campaign_id, conversation_id, customer_id, channel_id,
          image_urls, image_hashes, extracted_fb_name,
          ai_confidence, ai_verdict, ai_provider, ai_summary,
          ai_checklist, fraud_flags, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        id,
        campaignId,
        conversationId,
        customerId,
        channelId,
        JSON.stringify(imageUrls || []),
        JSON.stringify(imageHashes || []),
        extractedFbName || null,
        Number(aiConfidence || 0),
        aiVerdict,
        aiProvider || 'mock',
        aiSummary || '',
        JSON.stringify(aiChecklist || []),
        JSON.stringify(fraudFlags || []),
        nowIso
      );
      return this.getSubmissionById(id);
    },

    getSubmissionById(id) {
      const row = db.prepare(`
        SELECT s.*, c.name AS campaign_name, c.min_confidence, c.reply_template, ag.display_name AS reviewed_by_agent_name
        FROM campaign_submissions s
        JOIN campaigns c ON c.id = s.campaign_id
        LEFT JOIN agents ag ON ag.id = s.reviewed_by_agent_id
        WHERE s.id = ?
      `).get(id);
      return row ? formatSubmission(row) : null;
    },

    listConversationSubmissions(conversationId) {
      const rows = db.prepare(`
        SELECT s.*, c.name AS campaign_name, c.min_confidence, c.reply_template, ag.display_name AS reviewed_by_agent_name
        FROM campaign_submissions s
        JOIN campaigns c ON c.id = s.campaign_id
        LEFT JOIN agents ag ON ag.id = s.reviewed_by_agent_id
        WHERE s.conversation_id = ?
        ORDER BY s.created_at DESC
        LIMIT 20
      `).all(conversationId);
      return rows.map(formatSubmission);
    },

    /**
     * Atomically claims 1 available voucher (1 code / 1 time) and marks the submission approved.
     * Enforces >= min_confidence and zero fraud flags unless supervisor explicitly overrides.
     */
    claimVoucherAtomic({ submissionId, agentId, allowOverride = false }) {
      const nowIso = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const subRow = db.prepare(`
          SELECT s.*, c.min_confidence, c.reply_template
          FROM campaign_submissions s
          JOIN campaigns c ON c.id = s.campaign_id
          WHERE s.id = ?
        `).get(submissionId);

        if (!subRow) {
          const err = new Error('ไม่พบรายการตรวจหลักฐานนี้');
          err.statusCode = 404;
          throw err;
        }
        if (subRow.status === 'approved' && subRow.voucher_code) {
          const err = new Error(`รายการนี้ได้อนุมัติและแจกโค้ดไปแล้ว (${subRow.voucher_code})`);
          err.statusCode = 409;
          throw err;
        }

        const fraudFlags = safeJsonParse(subRow.fraud_flags, []);
        if (fraudFlags.length > 0) {
          const err = new Error('ไม่สามารถแจกโค้ดได้ เนื่องจากพบความเสี่ยง Fraud / รูปซ้ำ / รับสิทธิ์ซ้ำ');
          err.statusCode = 422;
          throw err;
        }

        const minConf = Number(subRow.min_confidence || 90);
        if (!allowOverride && (subRow.ai_verdict !== 'pass' || Number(subRow.ai_confidence) < minConf)) {
          const err = new Error(`คะแนนความน่าเชื่อถือ (${subRow.ai_confidence}%) ต่ำกว่าเกณฑ์ ${minConf}%`);
          err.statusCode = 422;
          throw err;
        }

        // Enforce 1 customer / 1 voucher per campaign
        const existingClaim = db.prepare(`
          SELECT code FROM vouchers
          WHERE campaign_id = ? AND claimed_by_customer_id = ? AND status = 'claimed'
          LIMIT 1
        `).get(subRow.campaign_id, subRow.customer_id);
        if (existingClaim) {
          const err = new Error(`ลูกค้ารายนี้เคยรับโค้ดในกิจกรรมนี้ไปแล้ว (${existingClaim.code})`);
          err.statusCode = 409;
          throw err;
        }

        // Atomically claim exactly 1 unused voucher (1 code / 1 time)
        const nextVoucher = db.prepare(`
          SELECT id, code, reward_value, expires_at
          FROM vouchers
          WHERE campaign_id = ? AND status = 'available'
          ORDER BY rowid ASC
          LIMIT 1
        `).get(subRow.campaign_id);

        if (!nextVoucher) {
          const err = new Error('โค้ด Gift Voucher ในคลังหมดแล้ว กรุณานำเข้าไฟล์ .xls เพิ่ม');
          err.statusCode = 409;
          throw err;
        }

        const claimRes = db.prepare(`
          UPDATE vouchers
          SET status = 'claimed',
              claimed_by_customer_id = ?,
              claimed_conversation_id = ?,
              claimed_submission_id = ?,
              claimed_by_agent_id = ?,
              claimed_at = ?
          WHERE id = ? AND status = 'available'
        `).run(subRow.customer_id, subRow.conversation_id, subRow.id, agentId, nowIso, nextVoucher.id);

        if (claimRes.changes !== 1) {
          const err = new Error('เกิดการแย่งดึงโค้ดพร้อมกัน กรุณากดใหม่อีกครั้ง');
          err.statusCode = 409;
          throw err;
        }

        db.prepare(`
          UPDATE campaign_submissions
          SET status = 'approved',
              voucher_id = ?,
              voucher_code = ?,
              reviewed_by_agent_id = ?,
              reviewed_at = ?
          WHERE id = ?
        `).run(nextVoucher.id, nextVoucher.code, agentId, nowIso, subRow.id);

        // Add 'รับโค้ดแล้ว' tag to customer
        const custRow = db.prepare('SELECT tags FROM customers WHERE id = ?').get(subRow.customer_id);
        const tags = safeJsonParse(custRow?.tags, []);
        if (!tags.includes('รับโค้ดแล้ว')) {
          tags.push('รับโค้ดแล้ว');
          db.prepare('UPDATE customers SET tags = ? WHERE id = ?').run(JSON.stringify(tags), subRow.customer_id);
        }

        db.exec('COMMIT');

        return {
          voucher: nextVoucher,
          submission: this.getSubmissionById(subRow.id),
          replyTemplate: subRow.reply_template,
        };
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    rejectSubmission({ submissionId, agentId }) {
      const nowIso = new Date().toISOString();
      const res = db.prepare(`
        UPDATE campaign_submissions
        SET status = 'rejected', reviewed_by_agent_id = ?, reviewed_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(agentId, nowIso, submissionId);
      if (res.changes === 0) return null;
      return this.getSubmissionById(submissionId);
    },
  };
}

export function formatSubmission(row) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    min_confidence: Number(row.min_confidence || 90),
    conversation_id: row.conversation_id,
    customer_id: row.customer_id,
    channel_id: row.channel_id,
    image_urls: safeJsonParse(row.image_urls, []),
    image_hashes: safeJsonParse(row.image_hashes, []),
    extracted_fb_name: row.extracted_fb_name || null,
    ai_confidence: Number(row.ai_confidence || 0),
    ai_verdict: row.ai_verdict,
    ai_provider: row.ai_provider,
    ai_summary: row.ai_summary || '',
    ai_checklist: safeJsonParse(row.ai_checklist, []),
    fraud_flags: safeJsonParse(row.fraud_flags, []),
    status: row.status,
    voucher_id: row.voucher_id || null,
    voucher_code: row.voucher_code || null,
    reviewed_by_agent_id: row.reviewed_by_agent_id || null,
    reviewed_by_agent_name: row.reviewed_by_agent_name || null,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at || null,
  };
}

export function normalizeCustomer(row) {
  return {
    ...row,
    tags: safeJsonParse(row.tags, []),
  };
}

export function formatConversationSummary(row) {
  const now = Date.now();
  const replyExpiresMs = row.line_reply_expires_at ? Date.parse(row.line_reply_expires_at) : 0;
  const lineReplyRemainingSec = row.line_reply_token && replyExpiresMs > now
    ? Math.max(0, Math.floor((replyExpiresMs - now) / 1000))
    : 0;

  const lastCustMs = row.last_customer_msg_at ? Date.parse(row.last_customer_msg_at) : 0;
  const hoursSinceCustomerMsg = lastCustMs ? (now - lastCustMs) / 3_600_000 : null;

  let policyHint = null;
  if (row.platform === 'line') {
    policyHint = lineReplyRemainingSec > 0
      ? { mode: 'line_reply', free: true, remainingSec: lineReplyRemainingSec, label: `LINE Reply ฟรี (${lineReplyRemainingSec}s)` }
      : { mode: 'line_push', free: false, remainingSec: 0, label: 'LINE Push (นับโควตา)' };
  } else if (row.platform === 'facebook') {
    if (hoursSinceCustomerMsg === null || hoursSinceCustomerMsg <= 24) {
      const hoursLeft = hoursSinceCustomerMsg === null ? 24 : Math.max(0, 24 - hoursSinceCustomerMsg);
      policyHint = { mode: 'fb_standard', free: true, hoursLeft: Number(hoursLeft.toFixed(1)), label: `FB 24h Window (เหลือ ${hoursLeft.toFixed(1)} ชม.)` };
    } else if (hoursSinceCustomerMsg <= 168) {
      policyHint = { mode: 'fb_human_agent', free: true, hoursLeft: 0, label: 'FB เกิน 24 ชม. (ใช้ Human Agent Tag)' };
    } else {
      policyHint = { mode: 'fb_expired', free: false, hoursLeft: 0, label: 'FB เกิน 7 วัน (ไม่สามารถส่งข้อความได้)' };
    }
  }

  return {
    id: row.id,
    channel_id: row.channel_id,
    shop_code: row.shop_code,
    channel_name: row.channel_name,
    platform: row.platform,
    external_channel_id: row.external_channel_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_external_id: row.customer_external_id,
    customer_tags: safeJsonParse(row.customer_tags, []),
    customer_notes: row.customer_notes || '',
    status: row.status,
    is_replied: Boolean(row.is_replied),
    last_replied_at: row.last_replied_at || null,
    assigned_agent_id: row.assigned_agent_id,
    assigned_agent_name: row.assigned_agent_name || null,
    assigned_agent_color: row.assigned_agent_color || null,
    unread_count: row.unread_count,
    last_message_preview: row.last_message_preview,
    last_message_at: row.last_message_at,
    last_customer_msg_at: row.last_customer_msg_at,
    line_reply_token: row.line_reply_token,
    line_reply_expires_at: row.line_reply_expires_at,
    policy: policyHint,
  };
}

export function safeJsonParse(val, fallback) {
  if (val !== null && typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}
