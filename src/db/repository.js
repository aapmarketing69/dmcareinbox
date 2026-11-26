import crypto from 'node:crypto';
import { decryptSecret, encryptSecret } from '../services/crypto.service.js';
import { hashPassword, isManagerRole, isSuperAdminRole } from '../services/auth.service.js';
import {
  LINE_REPLY_FREE_QUOTA,
  computeResponseMetrics,
  normalizeWorkspace,
  resolveDashboardRange,
} from './dashboard-utils.js';

export function createRepository(db, encryptionKey) {
  function getAgentChannelIds(agentId) {
    return db
      .prepare('SELECT channel_id FROM agent_channel_permissions WHERE agent_id = ? ORDER BY channel_id ASC')
      .all(agentId)
      .map((r) => r.channel_id);
  }

  return {
    // -------------------------------------------------------------------------
    // SaaS Multi-Tenant Workspaces (Tier 1 Super Admin)
    // -------------------------------------------------------------------------
    getWorkspaceById(id) {
      const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
      return normalizeWorkspace(row);
    },

    listWorkspacesWithStats() {
      const { monthStartIso } = resolveDashboardRange('month');
      const rows = db.prepare('SELECT * FROM workspaces ORDER BY (id = \'ws_default\') DESC, created_at DESC').all();
      return rows.map((row) => {
        const ws = normalizeWorkspace(row);
        const chCount = db.prepare('SELECT COUNT(*) AS cnt FROM channels WHERE workspace_id = ?').get(ws.id)?.cnt || 0;
        const agCount = db.prepare('SELECT COUNT(*) AS cnt FROM agents WHERE workspace_id = ?').get(ws.id)?.cnt || 0;
        const msgMonth = db.prepare(`
          SELECT COUNT(*) AS cnt
          FROM messages m
          JOIN channels c ON c.id = m.channel_id
          WHERE c.workspace_id = ? AND m.created_at >= ?
        `).get(ws.id, monthStartIso)?.cnt || 0;
        const aiMonth = db.prepare(`
          SELECT COUNT(*) AS cnt
          FROM campaign_submissions s
          JOIN campaigns camp ON camp.id = s.campaign_id
          WHERE camp.workspace_id = ? AND s.created_at >= ? AND s.ai_provider != 'manual-supervisor'
        `).get(ws.id, monthStartIso)?.cnt || 0;
        const owner = db.prepare(`
          SELECT id, display_name, email, role
          FROM agents
          WHERE workspace_id = ?
          ORDER BY (role = 'super_admin') DESC, (role = 'owner') DESC, (role = 'supervisor') DESC, id ASC
          LIMIT 1
        `).get(ws.id);

        return {
          ...ws,
          channel_count: Number(chCount),
          agent_count: Number(agCount),
          messages_this_month: Number(msgMonth),
          ai_checks_this_month: Number(aiMonth),
          owner_name: owner?.display_name || '-',
          owner_email: owner?.email || '-',
        };
      });
    },

    createWorkspaceWithOwner({
      name,
      slug = '',
      planCode = 'starter',
      maxChannels = 5,
      maxAgents = 5,
      aiEnabled = false,
      expiresAt = null,
      contactNotes = '',
      ownerName,
      ownerEmail,
      ownerPassword,
      mustChangePassword = true,
    }) {
      const cleanName = String(name || '').trim();
      const cleanEmail = String(ownerEmail || '').trim().toLowerCase();
      if (!cleanName || !ownerName || !cleanEmail || !ownerPassword) {
        const err = new Error('กรุณากรอกชื่อองค์กร ชื่อเจ้าของ อีเมล และรหัสผ่านให้ครบ');
        err.statusCode = 400;
        throw err;
      }

      const existingEmail = this.getAgentByEmailWithHash(cleanEmail);
      if (existingEmail) {
        const err = new Error('อีเมลนี้ถูกใช้งานในระบบแล้ว');
        err.statusCode = 409;
        throw err;
      }

      const rawSlug = (slug || cleanName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'client';
      const existingSlug = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(rawSlug);
      const finalSlug = existingSlug ? `${rawSlug}-${crypto.randomBytes(2).toString('hex')}` : rawSlug;

      const wsId = `ws_${crypto.randomBytes(5).toString('hex')}`;
      const ownerId = `agent_${crypto.randomBytes(4).toString('hex')}`;
      const nowIso = new Date().toISOString();
      const pwHash = hashPassword(ownerPassword);

      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`
          INSERT INTO workspaces (id, name, slug, plan_code, max_channels, max_agents, ai_enabled, is_active, expires_at, contact_notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `).run(
          wsId,
          cleanName,
          finalSlug,
          String(planCode || 'starter').toLowerCase(),
          Math.max(1, Number(maxChannels || 5)),
          Math.max(1, Number(maxAgents || 5)),
          aiEnabled ? 1 : 0,
          expiresAt ? String(expiresAt).trim() : null,
          String(contactNotes || '').trim(),
          nowIso
        );

        db.prepare(`
          INSERT INTO agents (id, workspace_id, display_name, email, password_hash, must_change_password, role, avatar_color, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 'owner', '#2563eb', 1)
        `).run(ownerId, wsId, String(ownerName).trim(), cleanEmail, pwHash, mustChangePassword ? 1 : 0);

        // Clean starter workspace: 2 helpful global quick replies + 1 empty starter campaign (ZERO dummy channels!)
        db.prepare(`
          INSERT INTO quick_replies (id, workspace_id, channel_id, shortcut, title, content_text)
          VALUES (?, ?, NULL, '/hello', 'ทักทายลูกค้า', 'สวัสดีครับ ยินดีให้บริการครับ สนใจสอบถามเรื่องไหนแจ้งได้เลยนะครับ')
        `).run(`qr_${crypto.randomBytes(5).toString('hex')}`, wsId);
        db.prepare(`
          INSERT INTO quick_replies (id, workspace_id, channel_id, shortcut, title, content_text)
          VALUES (?, ?, NULL, '/close', 'ขอบคุณลูกค้า', 'ขอบคุณที่ใช้บริการครับ หากมีข้อสงสัยเพิ่มเติมทักมาได้ตลอดเลยนะครับ')
        `).run(`qr_${crypto.randomBytes(5).toString('hex')}`, wsId);

        db.prepare(`
          INSERT INTO campaigns (id, workspace_id, name, channel_id, required_rules, reply_template, min_confidence, is_active, created_at)
          VALUES (?, ?, 'กิจกรรมแจกโค้ด Gift Voucher', NULL, 'ลูกค้าต้องส่งหลักฐานตามกติกาของร้านให้ครบถ้วน', 'ยินดีด้วยครับ! รหัส Gift Voucher ของคุณคือ: {{code}} (ใช้ได้ 1 ครั้ง)', 90, 1, ?)
        `).run(`camp_${crypto.randomBytes(5).toString('hex')}`, wsId, nowIso);

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      return {
        workspace: this.listWorkspacesWithStats().find((w) => w.id === wsId),
        owner: this.getAgentById(ownerId),
      };
    },

    updateWorkspace(id, { name, planCode, maxChannels, maxAgents, aiEnabled, isActive, expiresAt, extendDays, contactNotes }) {
      const existing = this.getWorkspaceById(id);
      if (!existing) return null;

      if (typeof name === 'string' && name.trim()) {
        db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name.trim(), id);
      }
      if (typeof planCode === 'string' && planCode.trim()) {
        db.prepare('UPDATE workspaces SET plan_code = ? WHERE id = ?').run(planCode.trim().toLowerCase(), id);
      }
      if (maxChannels !== undefined && maxChannels !== null) {
        db.prepare('UPDATE workspaces SET max_channels = ? WHERE id = ?').run(Math.max(1, Number(maxChannels)), id);
      }
      if (maxAgents !== undefined && maxAgents !== null) {
        db.prepare('UPDATE workspaces SET max_agents = ? WHERE id = ?').run(Math.max(1, Number(maxAgents)), id);
      }
      if (typeof aiEnabled === 'boolean') {
        db.prepare('UPDATE workspaces SET ai_enabled = ? WHERE id = ?').run(aiEnabled ? 1 : 0, id);
      }
      if (typeof isActive === 'boolean') {
        if (id === 'ws_default' && !isActive) {
          const err = new Error('ไม่สามารถระงับองค์กรหลักของระบบได้');
          err.statusCode = 400;
          throw err;
        }
        db.prepare('UPDATE workspaces SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
      }
      if (typeof contactNotes === 'string') {
        db.prepare('UPDATE workspaces SET contact_notes = ? WHERE id = ?').run(contactNotes.trim(), id);
      }
      if (extendDays !== undefined && Number(extendDays) > 0) {
        const baseMs = existing.expires_at && Date.parse(existing.expires_at) > Date.now()
          ? Date.parse(existing.expires_at)
          : Date.now();
        const nextIso = new Date(baseMs + Number(extendDays) * 86_400_000).toISOString();
        db.prepare('UPDATE workspaces SET expires_at = ?, is_active = 1 WHERE id = ?').run(nextIso, id);
      } else if (expiresAt !== undefined) {
        db.prepare('UPDATE workspaces SET expires_at = ? WHERE id = ?').run(
          expiresAt ? String(expiresAt).trim() : null,
          id
        );
      }
      return this.listWorkspacesWithStats().find((w) => w.id === id);
    },

    deleteWorkspace(id) {
      if (id === 'ws_default') {
        const err = new Error('ไม่สามารถลบองค์กรหลักของระบบได้');
        err.statusCode = 400;
        throw err;
      }
      const existing = this.getWorkspaceById(id);
      if (!existing) return null;
      const res = db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
      return res.changes > 0 ? { deleted: true, id, name: existing.name } : null;
    },

    resetWorkspaceOwnerPassword(workspaceId, customTempPassword = '') {
      const ws = this.getWorkspaceById(workspaceId);
      if (!ws) return null;
      const owner = db.prepare(`
        SELECT id, display_name, email, role
        FROM agents
        WHERE workspace_id = ?
        ORDER BY (role = 'owner') DESC, (role = 'supervisor') DESC, (role = 'admin') DESC, id ASC
        LIMIT 1
      `).get(workspaceId);
      if (!owner) {
        const err = new Error('ไม่พบบัญชี Owner ในองค์กรนี้');
        err.statusCode = 404;
        throw err;
      }
      const tempPassword = String(customTempPassword || '').trim() || `Dm${crypto.randomBytes(4).toString('hex')}`;
      const pwHash = hashPassword(tempPassword);
      db.prepare('UPDATE agents SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(pwHash, owner.id);
      return {
        workspaceId,
        ownerId: owner.id,
        ownerName: owner.display_name,
        ownerEmail: owner.email,
        tempPassword,
        mustChangePassword: true,
      };
    },

    listAgents(workspaceId = null) {
      const sql = workspaceId
        ? 'SELECT id, workspace_id, display_name, email, role, avatar_color, is_active, must_change_password, totp_enabled, last_login_at FROM agents WHERE workspace_id = ? ORDER BY id ASC'
        : 'SELECT id, workspace_id, display_name, email, role, avatar_color, is_active, must_change_password, totp_enabled, last_login_at FROM agents ORDER BY id ASC';
      const rows = workspaceId ? db.prepare(sql).all(workspaceId) : db.prepare(sql).all();
      return rows.map((a) => ({
        ...a,
        is_active: Boolean(a.is_active),
        must_change_password: Boolean(a.must_change_password),
        totp_enabled: Boolean(a.totp_enabled),
        is_super_admin: isSuperAdminRole(a.role),
        is_manager: isManagerRole(a.role),
        channel_ids: getAgentChannelIds(a.id),
      }));
    },

    getAgentById(id) {
      const a = db
        .prepare('SELECT id, workspace_id, display_name, email, role, avatar_color, is_active, must_change_password, totp_enabled, last_login_at FROM agents WHERE id = ?')
        .get(id);
      if (!a) return null;
      return {
        ...a,
        is_active: Boolean(a.is_active),
        must_change_password: Boolean(a.must_change_password),
        totp_enabled: Boolean(a.totp_enabled),
        is_super_admin: isSuperAdminRole(a.role),
        is_manager: isManagerRole(a.role),
        channel_ids: getAgentChannelIds(a.id),
      };
    },

    getAgentAuthSecretsById(id) {
      const row = db
        .prepare('SELECT id, email, password_hash, is_active, totp_enabled, totp_secret_encrypted, totp_recovery_hashes FROM agents WHERE id = ?')
        .get(id);
      if (!row) return null;
      return {
        ...row,
        is_active: Boolean(row.is_active),
        totp_enabled: Boolean(row.totp_enabled),
        totp_recovery_hashes: safeJsonParse(row.totp_recovery_hashes, []),
      };
    },

    enableAgentTotp(agentId, { secretEncrypted, recoveryHashes = [] }) {
      db.prepare(`
        UPDATE agents
        SET totp_enabled = 1, totp_secret_encrypted = ?, totp_recovery_hashes = ?
        WHERE id = ?
      `).run(secretEncrypted, JSON.stringify(recoveryHashes), agentId);
      return this.getAgentById(agentId);
    },

    disableAgentTotp(agentId) {
      db.prepare(`
        UPDATE agents
        SET totp_enabled = 0, totp_secret_encrypted = NULL, totp_recovery_hashes = '[]'
        WHERE id = ?
      `).run(agentId);
      return this.getAgentById(agentId);
    },

    updateAgentRecoveryHashes(agentId, recoveryHashes = []) {
      db.prepare('UPDATE agents SET totp_recovery_hashes = ? WHERE id = ?').run(
        JSON.stringify(recoveryHashes),
        agentId
      );
    },

    getAgentByEmailWithHash(email) {
      return db
        .prepare('SELECT * FROM agents WHERE LOWER(email) = LOWER(?)')
        .get(String(email || '').trim()) || null;
    },

    recordAgentLogin(agentId) {
      db.prepare('UPDATE agents SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), agentId);
    },

    createAgent({
      workspaceId = 'ws_default',
      displayName,
      email,
      password,
      role = 'agent',
      avatarColor = '#2563eb',
      channelIds = [],
    }) {
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
      const ws = this.getWorkspaceById(workspaceId);
      if (ws) {
        const currentAgents = db.prepare('SELECT COUNT(*) AS cnt FROM agents WHERE workspace_id = ?').get(workspaceId)?.cnt || 0;
        if (Number(currentAgents) >= ws.max_agents) {
          const err = new Error(`จำนวนแอดมินครบโควตาของแพ็กเกจแล้ว (${currentAgents}/${ws.max_agents} คน) กรุณาอัปเกรดแพ็กเกจ`);
          err.statusCode = 403;
          throw err;
        }
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
          INSERT INTO agents (id, workspace_id, display_name, email, password_hash, role, avatar_color, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(id, workspaceId, displayName.trim(), cleanEmail, pwHash, role, avatarColor || '#2563eb');

        if (Array.isArray(channelIds) && channelIds.length > 0) {
          const validCh = db.prepare('SELECT id FROM channels WHERE id = ? AND workspace_id = ?');
          const ins = db.prepare('INSERT OR IGNORE INTO agent_channel_permissions (agent_id, channel_id) VALUES (?, ?)');
          for (const chId of channelIds) {
            if (validCh.get(chId, workspaceId)) {
              ins.run(id, chId);
            }
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      return this.getAgentById(id);
    },

    updateAgent(agentId, { displayName, role, isActive, password, channelIds, resetTotp }, { workspaceId = null } = {}) {
      const existing = db.prepare('SELECT id, workspace_id, role FROM agents WHERE id = ?').get(agentId);
      if (!existing) return null;
      if (workspaceId && existing.workspace_id !== workspaceId) {
        const err = new Error('คุณไม่มีสิทธิ์แก้ไขบัญชีแอดมินนอกองค์กร');
        err.statusCode = 403;
        throw err;
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        if (typeof displayName === 'string' && displayName.trim()) {
          db.prepare('UPDATE agents SET display_name = ? WHERE id = ?').run(displayName.trim(), agentId);
        }
        if (role && ['owner', 'admin', 'supervisor', 'agent'].includes(role) && existing.role !== 'super_admin') {
          db.prepare('UPDATE agents SET role = ? WHERE id = ?').run(role, agentId);
        }
        if (typeof isActive === 'boolean') {
          db.prepare('UPDATE agents SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, agentId);
        }
        if (typeof password === 'string' && password.length > 0) {
          const pwHash = hashPassword(password);
          db.prepare('UPDATE agents SET password_hash = ? WHERE id = ?').run(pwHash, agentId);
        }
        if (resetTotp === true) {
          db.prepare("UPDATE agents SET totp_enabled = 0, totp_secret_encrypted = NULL, totp_recovery_hashes = '[]' WHERE id = ?").run(agentId);
        }
        if (Array.isArray(channelIds)) {
          db.prepare('DELETE FROM agent_channel_permissions WHERE agent_id = ?').run(agentId);
          const validCh = db.prepare('SELECT id FROM channels WHERE id = ? AND workspace_id = ?');
          const ins = db.prepare('INSERT OR IGNORE INTO agent_channel_permissions (agent_id, channel_id) VALUES (?, ?)');
          for (const chId of channelIds) {
            if (validCh.get(chId, existing.workspace_id)) {
              ins.run(agentId, chId);
            }
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
      db.prepare('UPDATE agents SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(pwHash, agentId);
    },

    listQuickReplies(channelId = null, workspaceId = null) {
      const where = [];
      const params = [];
      if (workspaceId) {
        where.push('qr.workspace_id = ?');
        params.push(workspaceId);
      }
      if (channelId) {
        where.push('(qr.channel_id IS NULL OR qr.channel_id = ?)');
        params.push(channelId);
      }
      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return db.prepare(`
        SELECT qr.id, qr.workspace_id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
        FROM quick_replies qr
        LEFT JOIN channels ch ON ch.id = qr.channel_id
        ${whereClause}
        ORDER BY (qr.channel_id IS NULL) ASC, ch.shop_code ASC, qr.shortcut ASC
      `).all(...params);
    },

    createQuickReply({ workspaceId = 'ws_default', channelId = null, shortcut, title, contentText, mediaUrl = null }) {
      const id = `qr_${crypto.randomBytes(5).toString('hex')}`;
      const normalizedShortcut = shortcut.startsWith('/') ? shortcut.trim() : `/${shortcut.trim()}`;
      db.prepare(`
        INSERT INTO quick_replies (id, workspace_id, channel_id, shortcut, title, content_text, media_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, workspaceId, channelId || null, normalizedShortcut, title.trim(), contentText.trim(), mediaUrl || null);

      return db.prepare(`
        SELECT qr.id, qr.workspace_id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
        FROM quick_replies qr
        LEFT JOIN channels ch ON ch.id = qr.channel_id
        WHERE qr.id = ?
      `).get(id);
    },

    updateQuickReply(id, { channelId = null, shortcut, title, contentText, mediaUrl = null }, { workspaceId = null } = {}) {
      const existing = db.prepare('SELECT id, workspace_id FROM quick_replies WHERE id = ?').get(id);
      if (!existing) return null;
      if (workspaceId && existing.workspace_id !== workspaceId) return null;

      const normalizedShortcut = shortcut.startsWith('/') ? shortcut.trim() : `/${shortcut.trim()}`;
      db.prepare(`
        UPDATE quick_replies
        SET channel_id = ?, shortcut = ?, title = ?, content_text = ?, media_url = ?
        WHERE id = ?
      `).run(channelId || null, normalizedShortcut, title.trim(), contentText.trim(), mediaUrl || null, id);

      return db.prepare(`
        SELECT qr.id, qr.workspace_id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
        FROM quick_replies qr
        LEFT JOIN channels ch ON ch.id = qr.channel_id
        WHERE qr.id = ?
      `).get(id);
    },

    deleteQuickReply(id, { workspaceId = null } = {}) {
      if (workspaceId) {
        const result = db.prepare('DELETE FROM quick_replies WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
        return result.changes > 0;
      }
      const result = db.prepare('DELETE FROM quick_replies WHERE id = ?').run(id);
      return result.changes > 0;
    },

    listCustomStickers(workspaceId = 'ws_default') {
      return db
        .prepare('SELECT * FROM custom_stickers WHERE workspace_id = ? ORDER BY created_at DESC')
        .all(workspaceId);
    },

    createCustomSticker({ workspaceId = 'ws_default', label = '', mediaUrl }) {
      const id = `stk_${crypto.randomBytes(5).toString('hex')}`;
      const nowIso = new Date().toISOString();
      db.prepare('INSERT INTO custom_stickers (id, workspace_id, label, media_url, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, workspaceId, String(label || '').trim(), mediaUrl, nowIso);
      return db.prepare('SELECT * FROM custom_stickers WHERE id = ?').get(id);
    },

    deleteCustomSticker(id, { workspaceId = null } = {}) {
      const res = workspaceId
        ? db.prepare('DELETE FROM custom_stickers WHERE id = ? AND workspace_id = ?').run(id, workspaceId)
        : db.prepare('DELETE FROM custom_stickers WHERE id = ?').run(id);
      return res.changes > 0;
    },

    listChannelsWithStats(allowedChannelIds = null, workspaceId = null) {
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return [];
      }
      const where = [];
      const params = [];
      if (workspaceId) {
        where.push('c.workspace_id = ?');
        params.push(workspaceId);
      }
      if (Array.isArray(allowedChannelIds)) {
        where.push(`c.id IN (${allowedChannelIds.map(() => '?').join(',')})`);
        params.push(...allowedChannelIds);
      }
      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const rows = db.prepare(`
        SELECT
          c.id,
          c.workspace_id,
          c.shop_code,
          c.name,
          c.platform,
          c.external_channel_id,
          c.access_token_enc,
          c.webhook_path_key,
          c.is_active,
          c.created_at,
          COALESCE(SUM(CASE WHEN conv.status != 'resolved' THEN conv.unread_count ELSE 0 END), 0) AS unread_count,
          COUNT(CASE WHEN conv.status != 'resolved' THEN 1 END) AS open_conversations,
          COUNT(conv.id) AS total_conversations
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
          unread_count: Number(row.unread_count || 0),
          open_conversations: Number(row.open_conversations || 0),
          total_conversations: Number(row.total_conversations || 0),
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

    createChannel({ workspaceId = 'ws_default', shopCode, name, platform, externalChannelId, accessToken, channelSecret }) {
      const ws = this.getWorkspaceById(workspaceId);
      if (ws) {
        const currentCount = db.prepare('SELECT COUNT(*) AS cnt FROM channels WHERE workspace_id = ?').get(workspaceId)?.cnt || 0;
        if (Number(currentCount) >= ws.max_channels) {
          const err = new Error(`จำนวนร้านค้าครบโควตาของแพ็กเกจแล้ว (${currentCount}/${ws.max_channels} ร้าน) กรุณาอัปเกรดแพ็กเกจ`);
          err.statusCode = 403;
          throw err;
        }
      }

      const id = `ch_${platform}_${shopCode}_${crypto.randomBytes(3).toString('hex')}`;
      const baseKey = String(shopCode).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'shop';
      const keyTaken = db.prepare('SELECT id FROM channels WHERE webhook_path_key = ?').get(baseKey);
      const webhookPathKey = keyTaken ? `${baseKey}_${crypto.randomBytes(2).toString('hex')}` : baseKey;

      const accessTokenEnc = encryptSecret(accessToken || `mock_${platform}_token_${shopCode}`, encryptionKey);
      const channelSecretEnc = channelSecret ? encryptSecret(channelSecret, encryptionKey) : null;

      db.prepare(`
        INSERT INTO channels (id, workspace_id, shop_code, name, platform, external_channel_id, access_token_enc, channel_secret_enc, webhook_path_key, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(id, workspaceId, shopCode.trim(), name.trim(), platform, String(externalChannelId).trim(), accessTokenEnc, channelSecretEnc, webhookPathKey);

      return this.listChannelsWithStats(null, workspaceId).find((c) => c.id === id);
    },

    updateChannel(id, { name, externalChannelId, accessToken, channelSecret, isActive }, { workspaceId = null } = {}) {
      const existing = this.getChannelById(id);
      if (!existing) return null;
      if (workspaceId && existing.workspace_id !== workspaceId) {
        const err = new Error('คุณไม่มีสิทธิ์แก้ไขร้านค้านอกองค์กร');
        err.statusCode = 403;
        throw err;
      }

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
      return this.listChannelsWithStats(null, existing.workspace_id).find((c) => c.id === id);
    },

    deleteChannel(id, { workspaceId = null } = {}) {
      const existing = this.getChannelById(id);
      if (!existing) return null;
      if (workspaceId && existing.workspace_id !== workspaceId) {
        const err = new Error('คุณไม่มีสิทธิ์ลบร้านค้านอกองค์กร');
        err.statusCode = 403;
        throw err;
      }
      const res = db.prepare('DELETE FROM channels WHERE id = ?').run(id);
      return res.changes > 0 ? { deleted: true, id, workspaceId: existing.workspace_id, name: existing.name } : null;
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

    markConversationRead(conversationId, agentId = null) {
      const nowIso = new Date().toISOString();
      if (agentId) {
        db.prepare('UPDATE conversations SET unread_count = 0, last_read_by_agent_id = ?, last_read_at = ? WHERE id = ?')
          .run(agentId, nowIso, conversationId);
      } else {
        db.prepare('UPDATE conversations SET unread_count = 0, last_read_at = ? WHERE id = ?')
          .run(nowIso, conversationId);
      }
      return this.getConversationSummaryById(conversationId);
    },

    markAgentMessagesReadByCustomer({ conversationId, upToIso }) {
      if (!conversationId || !upToIso) return 0;
      const res = db.prepare(`
        UPDATE messages
        SET delivery_status = 'read'
        WHERE conversation_id = ?
          AND sender_type = 'agent'
          AND delivery_status != 'read'
          AND created_at <= ?
      `).run(conversationId, upToIso);
      return Number(res.changes || 0);
    },

    findLatestConversationByCustomerExternalId(channelId, externalUserId) {
      const row = db.prepare(`
        SELECT conv.id
        FROM conversations conv
        JOIN customers cust ON cust.id = conv.customer_id
        WHERE conv.channel_id = ? AND cust.external_user_id = ?
        ORDER BY conv.last_message_at DESC
        LIMIT 1
      `).get(channelId, String(externalUserId));
      return row ? this.getConversationSummaryById(row.id) : null;
    },

    updateConversationMeta(conversationId, { status, assignedAgentId, tags, notes, isReplied, customerName, agentId = null }) {
      const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
      if (!conv) return null;

      if (status && ['open', 'pending', 'resolved'].includes(status)) {
        db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(status, conversationId);
      }
      if (typeof isReplied === 'boolean') {
        const nowIso = new Date().toISOString();
        if (isReplied) {
          db.prepare(`
            UPDATE conversations
            SET is_replied = 1,
                unread_count = 0,
                last_replied_at = ?,
                last_read_by_agent_id = COALESCE(?, last_read_by_agent_id),
                last_read_at = ?
            WHERE id = ?
          `).run(nowIso, agentId, nowIso, conversationId);
        } else {
          db.prepare('UPDATE conversations SET is_replied = 0 WHERE id = ?').run(conversationId);
        }
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
      if (typeof customerName === 'string' && customerName.trim()) {
        db.prepare('UPDATE customers SET display_name = ? WHERE id = ?').run(
          customerName.trim().slice(0, 120),
          conv.customer_id
        );
      }

      return this.getConversationSummaryById(conversationId);
    },

    listConversations({ platform, channelId, status, box, q, allowedChannelIds = null, workspaceId = null } = {}) {
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return [];
      }
      const where = [];
      const params = [];

      if (workspaceId) {
        where.push('ch.workspace_id = ?');
        params.push(workspaceId);
      }
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
          ch.workspace_id,
          ch.shop_code,
          ch.name AS channel_name,
          ch.platform,
          ch.external_channel_id,
          cust.display_name AS customer_name,
          cust.external_user_id AS customer_external_id,
          cust.tags AS customer_tags,
          cust.notes AS customer_notes,
          ag.display_name AS assigned_agent_name,
          ag.avatar_color AS assigned_agent_color,
          rag.display_name AS last_read_by_agent_name
        FROM conversations conv
        JOIN channels ch ON ch.id = conv.channel_id
        JOIN customers cust ON cust.id = conv.customer_id
        LEFT JOIN agents ag ON ag.id = conv.assigned_agent_id
        LEFT JOIN agents rag ON rag.id = conv.last_read_by_agent_id
        ${whereClause}
        ORDER BY conv.last_message_at DESC
        LIMIT 100
      `).all(...params);

      return rows.map(formatConversationSummary);
    },

    getConversationCounts({ platform, channelId, q, allowedChannelIds = null, workspaceId = null } = {}) {
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return { all: 0, unreplied: 0, pending: 0, replied: 0, resolved: 0 };
      }
      const where = [];
      const params = [];

      if (workspaceId) {
        where.push('ch.workspace_id = ?');
        params.push(workspaceId);
      }
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
          ch.workspace_id,
          ch.shop_code,
          ch.name AS channel_name,
          ch.platform,
          ch.external_channel_id,
          cust.display_name AS customer_name,
          cust.external_user_id AS customer_external_id,
          cust.tags AS customer_tags,
          cust.notes AS customer_notes,
          ag.display_name AS assigned_agent_name,
          ag.avatar_color AS assigned_agent_color,
          rag.display_name AS last_read_by_agent_name
        FROM conversations conv
        JOIN channels ch ON ch.id = conv.channel_id
        JOIN customers cust ON cust.id = conv.customer_id
        LEFT JOIN agents ag ON ag.id = conv.assigned_agent_id
        LEFT JOIN agents rag ON rag.id = conv.last_read_by_agent_id
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
    listCampaignsWithStats(workspaceId = null) {
      const whereClause = workspaceId ? 'WHERE c.workspace_id = ?' : '';
      const params = workspaceId ? [workspaceId] : [];
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
        ${whereClause}
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `).all(...params);

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

    createCampaign({ workspaceId = 'ws_default', name, channelId = null, requiredRules, replyTemplate, minConfidence = 90 }) {
      const id = `camp_${crypto.randomBytes(5).toString('hex')}`;
      db.prepare(`
        INSERT INTO campaigns (id, workspace_id, name, channel_id, required_rules, reply_template, min_confidence, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        id,
        workspaceId,
        name.trim(),
        channelId || null,
        requiredRules.trim(),
        replyTemplate.trim(),
        Math.max(50, Math.min(100, Number(minConfidence || 90)))
      );
      return this.listCampaignsWithStats(workspaceId).find((c) => c.id === id);
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

    // -------------------------------------------------------------------------
    // Dashboards (Tier 2 Workspace Owner/Supervisor & Tier 1 Super Admin)
    // -------------------------------------------------------------------------
    getWorkspaceDashboard(workspaceId = 'ws_default', { range = '30d' } = {}) {
      const { range: normalizedRange, startIso, monthStartIso } = resolveDashboardRange(range);
      const workspace = this.getWorkspaceById(workspaceId);

      const convCounts = this.getConversationCounts({ workspaceId });
      const msgTotals = db.prepare(`
        SELECT
          SUM(CASE WHEN m.sender_type = 'customer' THEN 1 ELSE 0 END) AS inbound_messages,
          SUM(CASE WHEN m.sender_type = 'agent' THEN 1 ELSE 0 END) AS outbound_messages,
          SUM(CASE WHEN m.sender_type = 'customer' AND c.platform = 'line' THEN 1 ELSE 0 END) AS line_inbound,
          SUM(CASE WHEN m.sender_type = 'customer' AND c.platform = 'facebook' THEN 1 ELSE 0 END) AS fb_inbound
        FROM messages m
        JOIN channels c ON c.id = m.channel_id
        WHERE c.workspace_id = ? AND m.created_at >= ?
      `).get(workspaceId, startIso);

      const msgRowsForSla = db.prepare(`
        SELECT m.conversation_id, m.sender_type, m.sender_agent_id, m.created_at
        FROM messages m
        JOIN channels c ON c.id = m.channel_id
        WHERE c.workspace_id = ? AND m.created_at >= ?
        ORDER BY m.conversation_id ASC, m.created_at ASC
      `).all(workspaceId, startIso);
      const sla = computeResponseMetrics(msgRowsForSla);

      const channelRows = db.prepare(`
        SELECT
          c.id,
          c.shop_code,
          c.name,
          c.platform,
          c.is_active,
          (SELECT COUNT(*) FROM conversations cv WHERE cv.channel_id = c.id AND cv.status != 'resolved') AS open_conversations,
          (SELECT COALESCE(SUM(CASE WHEN cv.status != 'resolved' THEN cv.unread_count ELSE 0 END), 0) FROM conversations cv WHERE cv.channel_id = c.id) AS unread_count,
          (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id AND m.sender_type = 'customer' AND m.created_at >= ?) AS inbound_count,
          (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id AND m.sender_type = 'agent' AND m.created_at >= ?) AS outbound_count,
          (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id AND m.delivery_method = 'line_reply' AND m.created_at >= ?) AS line_reply_month,
          (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id AND m.delivery_method = 'line_push' AND m.created_at >= ?) AS line_push_month,
          (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id AND m.delivery_method IN ('fb_standard', 'fb_human_agent') AND m.created_at >= ?) AS fb_outbound_month
        FROM channels c
        WHERE c.workspace_id = ?
        ORDER BY c.platform DESC, c.shop_code ASC
      `).all(startIso, startIso, monthStartIso, monthStartIso, monthStartIso, workspaceId);

      const agentRows = db.prepare(`
        SELECT
          a.id,
          a.display_name,
          a.email,
          a.role,
          a.is_active,
          a.last_login_at,
          (SELECT COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.workspace_id = a.workspace_id AND m.sender_agent_id = a.id AND m.created_at >= ?) AS messages_sent,
          (SELECT COUNT(*) FROM conversations cv JOIN channels c ON c.id = cv.channel_id WHERE c.workspace_id = a.workspace_id AND cv.assigned_agent_id = a.id AND cv.status = 'resolved') AS resolved_conversations
        FROM agents a
        WHERE a.workspace_id = ?
        ORDER BY messages_sent DESC, a.id ASC
      `).all(startIso, workspaceId);

      const voucherRow = db.prepare(`
        SELECT
          COUNT(v.id) AS total_vouchers,
          SUM(CASE WHEN v.status = 'available' THEN 1 ELSE 0 END) AS available_vouchers,
          SUM(CASE WHEN v.status = 'claimed' THEN 1 ELSE 0 END) AS claimed_vouchers
        FROM vouchers v
        JOIN campaigns camp ON camp.id = v.campaign_id
        WHERE camp.workspace_id = ?
      `).get(workspaceId);

      const subRow = db.prepare(`
        SELECT
          COUNT(s.id) AS total_checks,
          SUM(CASE WHEN s.ai_verdict = 'pass' THEN 1 ELSE 0 END) AS pass_count,
          SUM(CASE WHEN s.ai_verdict = 'fraud' THEN 1 ELSE 0 END) AS fraud_blocked_count
        FROM campaign_submissions s
        JOIN campaigns camp ON camp.id = s.campaign_id
        WHERE camp.workspace_id = ? AND s.created_at >= ?
      `).get(workspaceId, startIso);

      return {
        range: normalizedRange,
        workspace: {
          ...workspace,
          channels_used: channelRows.length,
          agents_used: agentRows.length,
        },
        summary: {
          ...convCounts,
          inboundMessages: Number(msgTotals?.inbound_messages || 0),
          outboundMessages: Number(msgTotals?.outbound_messages || 0),
          lineInbound: Number(msgTotals?.line_inbound || 0),
          fbInbound: Number(msgTotals?.fb_inbound || 0),
          avgResponseMinutes: sla.avgResponseMinutes,
          measuredReplies: sla.measuredReplies,
        },
        channels: channelRows.map((c) => ({
          id: c.id,
          shop_code: c.shop_code,
          name: c.name,
          platform: c.platform,
          is_active: Boolean(c.is_active),
          open_conversations: Number(c.open_conversations || 0),
          unread_count: Number(c.unread_count || 0),
          inbound_count: Number(c.inbound_count || 0),
          outbound_count: Number(c.outbound_count || 0),
          line_reply_month: Number(c.line_reply_month || 0),
          line_reply_quota: LINE_REPLY_FREE_QUOTA,
          line_push_month: Number(c.line_push_month || 0),
          fb_outbound_month: Number(c.fb_outbound_month || 0),
        })),
        agents: agentRows.map((a) => ({
          id: a.id,
          display_name: a.display_name,
          email: a.email,
          role: a.role,
          is_active: Boolean(a.is_active),
          last_login_at: a.last_login_at,
          messages_sent: Number(a.messages_sent || 0),
          resolved_conversations: Number(a.resolved_conversations || 0),
          avg_response_minutes: sla.byAgent.has(a.id) ? sla.byAgent.get(a.id) : null,
        })),
        vouchers: {
          totalVouchers: Number(voucherRow?.total_vouchers || 0),
          availableVouchers: Number(voucherRow?.available_vouchers || 0),
          claimedVouchers: Number(voucherRow?.claimed_vouchers || 0),
          aiChecksCount: Number(subRow?.total_checks || 0),
          aiPassCount: Number(subRow?.pass_count || 0),
          fraudBlockedCount: Number(subRow?.fraud_blocked_count || 0),
        },
      };
    },

    getSuperAdminDashboard() {
      const workspaces = this.listWorkspacesWithStats();
      const now = Date.now();
      const sevenDaysMs = 7 * 86_400_000;

      let activeWorkspaces = 0;
      let expiringSoonWorkspaces = 0;
      let totalChannels = 0;
      let totalAgents = 0;
      let messagesThisMonth = 0;
      let aiChecksThisMonth = 0;

      for (const ws of workspaces) {
        if (ws.is_active && !ws.is_expired) activeWorkspaces += 1;
        if (ws.is_active && ws.expires_at) {
          const expMs = Date.parse(ws.expires_at);
          if (expMs >= now && expMs - now <= sevenDaysMs) {
            expiringSoonWorkspaces += 1;
          }
        }
        totalChannels += ws.channel_count;
        totalAgents += ws.agent_count;
        messagesThisMonth += ws.messages_this_month;
        aiChecksThisMonth += ws.ai_checks_this_month;
      }

      return {
        summary: {
          totalWorkspaces: workspaces.length,
          activeWorkspaces,
          expiringSoonWorkspaces,
          totalChannels,
          totalAgents,
          messagesThisMonth,
          aiChecksThisMonth,
        },
        workspaces,
      };
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
    workspace_id: row.workspace_id || 'ws_default',
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
    last_read_by_agent_id: row.last_read_by_agent_id || null,
    last_read_by_agent_name: row.last_read_by_agent_name || null,
    last_read_at: row.last_read_at || null,
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
