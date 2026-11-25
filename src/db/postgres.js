import crypto from 'node:crypto';
import { decryptSecret, encryptSecret } from '../services/crypto.service.js';
import { hashPassword, isManagerRole } from '../services/auth.service.js';
import {
  formatConversationSummary,
  formatSubmission,
  normalizeCustomer,
  safeJsonParse,
} from './repository.js';

const PG_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'agent',
    avatar_color TEXT NOT NULL DEFAULT '#2563eb',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    shop_code TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('line', 'facebook')),
    external_channel_id TEXT NOT NULL,
    access_token_enc TEXT NOT NULL,
    channel_secret_enc TEXT,
    webhook_path_key TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (platform, external_channel_id)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_channel_permissions (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_id, channel_id)
  )`,
  `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    external_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (channel_id, external_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved')),
    is_replied INTEGER NOT NULL DEFAULT 0,
    last_replied_at TEXT,
    assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message_preview TEXT NOT NULL DEFAULT '',
    last_message_at TEXT NOT NULL,
    last_customer_msg_at TEXT,
    line_reply_token TEXT,
    line_reply_expires_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conv_inbox ON conversations(status, last_message_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_conv_channel_customer ON conversations(channel_id, customer_id)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    platform_message_id TEXT,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'agent', 'bot', 'system')),
    sender_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    content_text TEXT NOT NULL DEFAULT '',
    media_url TEXT,
    delivery_status TEXT NOT NULL DEFAULT 'sent',
    delivery_method TEXT,
    raw_payload TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (channel_id, platform_message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at ASC)`,
  `CREATE TABLE IF NOT EXISTS quick_replies (
    id TEXT PRIMARY KEY,
    channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
    shortcut TEXT NOT NULL,
    title TEXT NOT NULL,
    content_text TEXT NOT NULL,
    media_url TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS webhook_events (
    id BIGSERIAL PRIMARY KEY,
    platform TEXT NOT NULL,
    channel_id TEXT,
    status TEXT NOT NULL DEFAULT 'processed',
    error_message TEXT,
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_events_received ON webhook_events(received_at)`,
  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
    required_rules TEXT NOT NULL,
    reply_template TEXT NOT NULL,
    min_confidence INTEGER NOT NULL DEFAULT 90,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vouchers (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    reward_value TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'claimed')),
    claimed_by_customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    claimed_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    claimed_submission_id TEXT,
    claimed_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    claimed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (campaign_id, code)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vouchers_campaign_status ON vouchers(campaign_id, status)`,
  `CREATE TABLE IF NOT EXISTS campaign_submissions (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    image_urls TEXT NOT NULL DEFAULT '[]',
    image_hashes TEXT NOT NULL DEFAULT '[]',
    extracted_fb_name TEXT,
    ai_confidence INTEGER NOT NULL DEFAULT 0,
    ai_verdict TEXT NOT NULL CHECK (ai_verdict IN ('pass', 'needs_review', 'fraud')),
    ai_provider TEXT NOT NULL DEFAULT 'mock',
    ai_summary TEXT NOT NULL DEFAULT '',
    ai_checklist TEXT NOT NULL DEFAULT '[]',
    fraud_flags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    voucher_id TEXT REFERENCES vouchers(id) ON DELETE SET NULL,
    voucher_code TEXT,
    reviewed_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_submissions_conv ON campaign_submissions(conversation_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_submissions_camp ON campaign_submissions(campaign_id, status)`,
];

export async function initPgDb(
  pool,
  {
    encryptionKey,
    adminEmail = 'may@shop.local',
    adminPassword = 'admin1234',
    adminName = 'แอดมินเมย์',
    isProduction = false,
  } = {}
) {
  for (const stmt of PG_SCHEMA_STATEMENTS) {
    await pool.query(stmt);
  }

  const nowIso = new Date().toISOString();

  // Seed initial channels & supervisor if database is empty
  const chCountRes = await pool.query('SELECT COUNT(*)::int AS cnt FROM channels');
  const chCount = Number(chCountRes.rows[0]?.cnt || 0);

  if (chCount === 0) {
    await pool.query(
      `INSERT INTO agents (id, display_name, email, password_hash, role, avatar_color, is_active)
       VALUES ($1, $2, $3, $4, 'supervisor', '#2563eb', 1)
       ON CONFLICT (id) DO NOTHING`,
      ['agent_1', adminName, String(adminEmail).trim().toLowerCase(), hashPassword(adminPassword)]
    );

    if (!isProduction) {
      await pool.query(
        `INSERT INTO agents (id, display_name, email, password_hash, role, avatar_color, is_active)
         VALUES ($1, $2, $3, $4, 'agent', '#059669', 1)
         ON CONFLICT (id) DO NOTHING`,
        ['agent_2', 'แอดมินต้น', 'ton@shop.local', hashPassword('agent1234')]
      );
      await pool.query(
        `INSERT INTO agents (id, display_name, email, password_hash, role, avatar_color, is_active)
         VALUES ($1, $2, $3, $4, 'agent', '#7c3aed', 1)
         ON CONFLICT (id) DO NOTHING`,
        ['agent_3', 'แอดมินฟ้า', 'fah@shop.local', hashPassword('agent1234')]
      );
    }

    const lineShops = [
      { code: 'a1', name: 'ร้าน a1 (แฟชั่น)', extId: '2000000001' },
      { code: 'a2', name: 'ร้าน a2 (รองเท้า)', extId: '2000000002' },
      { code: 'a3', name: 'ร้าน a3 (กระเป๋า)', extId: '2000000003' },
      { code: 'a4', name: 'ร้าน a4 (เครื่องสำอาง)', extId: '2000000004' },
      { code: 'a5', name: 'ร้าน a5 (ของแต่งบ้าน)', extId: '2000000005' },
    ];
    for (const shop of lineShops) {
      await pool.query(
        `INSERT INTO channels (id, shop_code, name, platform, external_channel_id, access_token_enc, channel_secret_enc, webhook_path_key, is_active, created_at)
         VALUES ($1, $2, $3, 'line', $4, $5, $6, $7, 1, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          `ch_line_${shop.code}`,
          shop.code,
          shop.name,
          shop.extId,
          encryptSecret(`mock_line_access_token_${shop.code}`, encryptionKey),
          encryptSecret(`mock_line_secret_${shop.code}`, encryptionKey),
          shop.code,
          nowIso,
        ]
      );
    }

    const fbShops = [
      { code: 'b1', name: 'เพจ b1 (แฟชั่น)', pageId: '100000000001' },
      { code: 'b2', name: 'เพจ b2 (รองเท้า)', pageId: '100000000002' },
      { code: 'b3', name: 'เพจ b3 (กระเป๋า)', pageId: '100000000003' },
      { code: 'b4', name: 'เพจ b4 (เครื่องสำอาง)', pageId: '100000000004' },
      { code: 'b5', name: 'เพจ b5 (ของแต่งบ้าน)', pageId: '100000000005' },
    ];
    for (const shop of fbShops) {
      await pool.query(
        `INSERT INTO channels (id, shop_code, name, platform, external_channel_id, access_token_enc, channel_secret_enc, webhook_path_key, is_active, created_at)
         VALUES ($1, $2, $3, 'facebook', $4, $5, NULL, $6, 1, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          `ch_fb_${shop.code}`,
          shop.code,
          shop.name,
          shop.pageId,
          encryptSecret(`mock_fb_page_token_${shop.code}`, encryptionKey),
          shop.code,
          nowIso,
        ]
      );
    }

    // Starter global quick replies
    const starterQRs = [
      ['qr_1', '/hello', 'ทักทายลูกค้า', 'สวัสดีครับ ยินดีให้บริการครับ สนใจสินค้าตัวไหนสอบถามได้เลยนะครับ'],
      ['qr_2', '/bank', 'ส่งเลขบัญชีโอนเงิน', 'สามารถโอนชำระได้ที่ ธ.กสิกรไทย 123-4-56789-0 บจก. DmCare โอนแล้วส่งสลิปได้เลยครับ'],
      ['qr_3', '/ship', 'แจ้งรอบจัดส่ง', 'ทางร้านตัดรอบจัดส่งเวลา 14:00 น. ทุกวันจันทร์–เสาร์ และแจ้งเลขพัสดุช่วงเย็นครับ'],
      ['qr_4', '/close', 'ปิดการขาย', 'ขอบคุณที่อุดหนุนครับ หากได้รับสินค้าแล้วมีข้อสงสัยทักมาได้ตลอดเลยนะครับ'],
    ];
    for (const [id, shortcut, title, contentText] of starterQRs) {
      await pool.query(
        `INSERT INTO quick_replies (id, channel_id, shortcut, title, content_text)
         VALUES ($1, NULL, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [id, shortcut, title, contentText]
      );
    }
  }

  // Ensure default campaign seeded once
  const campMeta = await pool.query(`SELECT value FROM app_meta WHERE key = 'campaign_seeded'`);
  if (campMeta.rows.length === 0) {
    const campId = 'camp_like_share_1212';
    await pool.query(
      `INSERT INTO campaigns (id, name, channel_id, required_rules, reply_template, min_confidence, is_active, created_at)
       VALUES ($1, $2, NULL, $3, $4, 90, 1, $5)
       ON CONFLICT (id) DO NOTHING`,
      [
        campId,
        'กิจกรรมกดไลก์เพจ + แชร์เปิดสาธารณะ (แจก Gift Voucher)',
        'ลูกค้าต้องกดไลก์/ติดตามเพจ และแชร์โพสต์กิจกรรมโดยเปิดสถานะเป็นสาธารณะ (ไอคอนลูกโลก 🌐)',
        'ยินดีด้วยครับ! หลักฐานกิจกรรมครบถ้วนแล้ว 🎁\nรหัส Gift Voucher ของคุณคือ: {{code}}\n(สามารถใช้สิทธิ์ได้ 1 ครั้งเท่านั้น)',
        nowIso,
      ]
    );
    if (!isProduction) {
      for (let i = 1; i <= 10; i++) {
        const num = String(i).padStart(3, '0');
        await pool.query(
          `INSERT INTO vouchers (id, campaign_id, code, reward_value, expires_at, status, created_at)
           VALUES ($1, $2, $3, '100 บาท', '2026-12-31', 'available', $4)
           ON CONFLICT (campaign_id, code) DO NOTHING`,
          [`vch_seed_${num}`, campId, `GV1212-A${num}`, nowIso]
        );
      }
    }
    await pool.query(
      `INSERT INTO app_meta (key, value) VALUES ('campaign_seeded', '1')
       ON CONFLICT (key) DO UPDATE SET value = '1'`
    );
  }
}

export function createPgRepository(pool, encryptionKey) {
  async function getAgentChannelIds(agentId) {
    const res = await pool.query(
      'SELECT channel_id FROM agent_channel_permissions WHERE agent_id = $1 ORDER BY channel_id ASC',
      [agentId]
    );
    return res.rows.map((r) => r.channel_id);
  }

  return {
    async listAgents() {
      const res = await pool.query(
        'SELECT id, display_name, email, role, avatar_color, is_active, last_login_at FROM agents ORDER BY id ASC'
      );
      const permsRes = await pool.query(
        'SELECT agent_id, channel_id FROM agent_channel_permissions ORDER BY channel_id ASC'
      );
      const permMap = new Map();
      for (const p of permsRes.rows) {
        if (!permMap.has(p.agent_id)) permMap.set(p.agent_id, []);
        permMap.get(p.agent_id).push(p.channel_id);
      }
      return res.rows.map((a) => ({
        ...a,
        is_active: Boolean(a.is_active),
        is_manager: isManagerRole(a.role),
        channel_ids: permMap.get(a.id) || [],
      }));
    },

    async getAgentById(id) {
      const res = await pool.query(
        'SELECT id, display_name, email, role, avatar_color, is_active, last_login_at FROM agents WHERE id = $1',
        [id]
      );
      const a = res.rows[0];
      if (!a) return null;
      return {
        ...a,
        is_active: Boolean(a.is_active),
        is_manager: isManagerRole(a.role),
        channel_ids: await getAgentChannelIds(a.id),
      };
    },

    async getAgentByEmailWithHash(email) {
      const res = await pool.query(
        'SELECT * FROM agents WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [String(email || '').trim()]
      );
      return res.rows[0] || null;
    },

    async recordAgentLogin(agentId) {
      await pool.query('UPDATE agents SET last_login_at = $1 WHERE id = $2', [
        new Date().toISOString(),
        agentId,
      ]);
    },

    async createAgent({ displayName, email, password, role = 'agent', avatarColor = '#2563eb', channelIds = [] }) {
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
      const existing = await this.getAgentByEmailWithHash(cleanEmail);
      if (existing) {
        const err = new Error('อีเมลนี้ถูกใช้งานแล้ว');
        err.statusCode = 409;
        throw err;
      }

      const id = `agent_${crypto.randomBytes(4).toString('hex')}`;
      const pwHash = hashPassword(password);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO agents (id, display_name, email, password_hash, role, avatar_color, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, 1)`,
          [id, displayName.trim(), cleanEmail, pwHash, role, avatarColor || '#2563eb']
        );
        if (Array.isArray(channelIds) && channelIds.length > 0) {
          for (const chId of channelIds) {
            await client.query(
              `INSERT INTO agent_channel_permissions (agent_id, channel_id)
               VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [id, chId]
            );
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return this.getAgentById(id);
    },

    async updateAgent(agentId, { displayName, role, isActive, password, channelIds }) {
      const existing = await pool.query('SELECT id FROM agents WHERE id = $1', [agentId]);
      if (existing.rows.length === 0) return null;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (typeof displayName === 'string' && displayName.trim()) {
          await client.query('UPDATE agents SET display_name = $1 WHERE id = $2', [displayName.trim(), agentId]);
        }
        if (role && ['owner', 'admin', 'supervisor', 'agent'].includes(role)) {
          await client.query('UPDATE agents SET role = $1 WHERE id = $2', [role, agentId]);
        }
        if (typeof isActive === 'boolean') {
          await client.query('UPDATE agents SET is_active = $1 WHERE id = $2', [isActive ? 1 : 0, agentId]);
        }
        if (typeof password === 'string' && password.length > 0) {
          await client.query('UPDATE agents SET password_hash = $1 WHERE id = $2', [hashPassword(password), agentId]);
        }
        if (Array.isArray(channelIds)) {
          await client.query('DELETE FROM agent_channel_permissions WHERE agent_id = $1', [agentId]);
          for (const chId of channelIds) {
            await client.query(
              `INSERT INTO agent_channel_permissions (agent_id, channel_id)
               VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [agentId, chId]
            );
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return this.getAgentById(agentId);
    },

    async updateAgentPassword(agentId, newPassword) {
      await pool.query('UPDATE agents SET password_hash = $1 WHERE id = $2', [
        hashPassword(newPassword),
        agentId,
      ]);
    },

    async listQuickReplies(channelId = null) {
      if (channelId) {
        const res = await pool.query(
          `SELECT qr.id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
           FROM quick_replies qr
           LEFT JOIN channels ch ON ch.id = qr.channel_id
           WHERE qr.channel_id IS NULL OR qr.channel_id = $1
           ORDER BY (qr.channel_id IS NULL) ASC, qr.shortcut ASC`,
          [channelId]
        );
        return res.rows;
      }
      const res = await pool.query(
        `SELECT qr.id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
         FROM quick_replies qr
         LEFT JOIN channels ch ON ch.id = qr.channel_id
         ORDER BY (qr.channel_id IS NULL) ASC, ch.shop_code ASC, qr.shortcut ASC`
      );
      return res.rows;
    },

    async createQuickReply({ channelId = null, shortcut, title, contentText, mediaUrl = null }) {
      const id = `qr_${crypto.randomBytes(5).toString('hex')}`;
      const normalizedShortcut = shortcut.startsWith('/') ? shortcut.trim() : `/${shortcut.trim()}`;
      await pool.query(
        `INSERT INTO quick_replies (id, channel_id, shortcut, title, content_text, media_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, channelId || null, normalizedShortcut, title.trim(), contentText.trim(), mediaUrl || null]
      );
      const res = await pool.query(
        `SELECT qr.id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
         FROM quick_replies qr
         LEFT JOIN channels ch ON ch.id = qr.channel_id
         WHERE qr.id = $1`,
        [id]
      );
      return res.rows[0] || null;
    },

    async updateQuickReply(id, { channelId = null, shortcut, title, contentText, mediaUrl = null }) {
      const existing = await pool.query('SELECT id FROM quick_replies WHERE id = $1', [id]);
      if (existing.rows.length === 0) return null;
      const normalizedShortcut = shortcut.startsWith('/') ? shortcut.trim() : `/${shortcut.trim()}`;
      await pool.query(
        `UPDATE quick_replies
         SET channel_id = $1, shortcut = $2, title = $3, content_text = $4, media_url = $5
         WHERE id = $6`,
        [channelId || null, normalizedShortcut, title.trim(), contentText.trim(), mediaUrl || null, id]
      );
      const res = await pool.query(
        `SELECT qr.id, qr.channel_id, qr.shortcut, qr.title, qr.content_text, qr.media_url, ch.shop_code, ch.platform
         FROM quick_replies qr
         LEFT JOIN channels ch ON ch.id = qr.channel_id
         WHERE qr.id = $1`,
        [id]
      );
      return res.rows[0] || null;
    },

    async deleteQuickReply(id) {
      const res = await pool.query('DELETE FROM quick_replies WHERE id = $1', [id]);
      return (res.rowCount || 0) > 0;
    },

    async listChannelsWithStats(allowedChannelIds = null) {
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return [];
      }
      const params = [];
      let whereClause = '';
      if (Array.isArray(allowedChannelIds)) {
        const placeholders = allowedChannelIds.map((_, i) => `$${i + 1}`).join(',');
        whereClause = `WHERE c.id IN (${placeholders})`;
        params.push(...allowedChannelIds);
      }

      const res = await pool.query(
        `SELECT
          c.id,
          c.shop_code,
          c.name,
          c.platform,
          c.external_channel_id,
          c.access_token_enc,
          c.webhook_path_key,
          c.is_active,
          c.created_at,
          COALESCE(SUM(CASE WHEN conv.status != 'resolved' THEN conv.unread_count ELSE 0 END), 0)::int AS unread_count,
          COUNT(CASE WHEN conv.status != 'resolved' THEN 1 END)::int AS open_conversations
         FROM channels c
         LEFT JOIN conversations conv ON conv.channel_id = c.id
         ${whereClause}
         GROUP BY c.id
         ORDER BY c.platform DESC, c.shop_code ASC`,
        params
      );

      return res.rows.map((row) => {
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
          is_active: Boolean(row.is_active),
          has_real_token: hasRealToken,
          webhook_url: row.platform === 'line' ? `/webhooks/line/${row.webhook_path_key}` : '/webhooks/facebook',
        };
      });
    },

    async getChannelById(id) {
      const res = await pool.query('SELECT * FROM channels WHERE id = $1', [id]);
      return res.rows[0] || null;
    },

    async getChannelByWebhookKey(platform, webhookKey) {
      const res = await pool.query(
        'SELECT * FROM channels WHERE platform = $1 AND webhook_path_key = $2',
        [platform, webhookKey]
      );
      return res.rows[0] || null;
    },

    async getChannelByExternalId(platform, externalChannelId) {
      const res = await pool.query(
        'SELECT * FROM channels WHERE platform = $1 AND external_channel_id = $2',
        [platform, String(externalChannelId)]
      );
      return res.rows[0] || null;
    },

    async createChannel({ shopCode, name, platform, externalChannelId, accessToken, channelSecret }) {
      const id = `ch_${platform}_${shopCode}_${crypto.randomBytes(3).toString('hex')}`;
      const webhookPathKey = shopCode.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const accessTokenEnc = encryptSecret(accessToken || `mock_${platform}_token_${shopCode}`, encryptionKey);
      const channelSecretEnc = channelSecret ? encryptSecret(channelSecret, encryptionKey) : null;

      await pool.query(
        `INSERT INTO channels (id, shop_code, name, platform, external_channel_id, access_token_enc, channel_secret_enc, webhook_path_key, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)`,
        [id, shopCode, name, platform, String(externalChannelId), accessTokenEnc, channelSecretEnc, webhookPathKey, new Date().toISOString()]
      );

      const list = await this.listChannelsWithStats();
      return list.find((c) => c.id === id) || null;
    },

    async updateChannel(id, { name, externalChannelId, accessToken, channelSecret, isActive }) {
      const existing = await this.getChannelById(id);
      if (!existing) return null;

      if (typeof name === 'string' && name.trim()) {
        await pool.query('UPDATE channels SET name = $1 WHERE id = $2', [name.trim(), id]);
      }
      if (externalChannelId) {
        await pool.query('UPDATE channels SET external_channel_id = $1 WHERE id = $2', [
          String(externalChannelId).trim(),
          id,
        ]);
      }
      if (typeof accessToken === 'string' && accessToken.trim()) {
        await pool.query('UPDATE channels SET access_token_enc = $1 WHERE id = $2', [
          encryptSecret(accessToken.trim(), encryptionKey),
          id,
        ]);
      }
      if (typeof channelSecret === 'string' && channelSecret.trim()) {
        await pool.query('UPDATE channels SET channel_secret_enc = $1 WHERE id = $2', [
          encryptSecret(channelSecret.trim(), encryptionKey),
          id,
        ]);
      }
      if (typeof isActive === 'boolean') {
        await pool.query('UPDATE channels SET is_active = $1 WHERE id = $2', [isActive ? 1 : 0, id]);
      }
      const list = await this.listChannelsWithStats();
      return list.find((c) => c.id === id) || null;
    },

    async findCustomer(channelId, externalUserId) {
      const res = await pool.query(
        'SELECT * FROM customers WHERE channel_id = $1 AND external_user_id = $2',
        [channelId, String(externalUserId)]
      );
      return res.rows[0] ? normalizeCustomer(res.rows[0]) : null;
    },

    async upsertCustomer({ channelId, externalUserId, displayName, avatarUrl = null }) {
      const res = await pool.query(
        'SELECT * FROM customers WHERE channel_id = $1 AND external_user_id = $2',
        [channelId, String(externalUserId)]
      );
      const existing = res.rows[0];
      if (existing) {
        if (displayName && existing.display_name.startsWith('ลูกค้า ')) {
          await pool.query('UPDATE customers SET display_name = $1 WHERE id = $2', [displayName, existing.id]);
          existing.display_name = displayName;
        }
        if (avatarUrl && !existing.avatar_url) {
          await pool.query('UPDATE customers SET avatar_url = $1 WHERE id = $2', [avatarUrl, existing.id]);
          existing.avatar_url = avatarUrl;
        }
        return normalizeCustomer(existing);
      }

      const id = `cust_${crypto.randomBytes(6).toString('hex')}`;
      const fallbackName = displayName || `ลูกค้า ${String(externalUserId).slice(-6)}`;
      await pool.query(
        `INSERT INTO customers (id, channel_id, external_user_id, display_name, avatar_url, tags, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, '[]', '', $6)`,
        [id, channelId, String(externalUserId), fallbackName, avatarUrl, new Date().toISOString()]
      );
      const inserted = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
      return normalizeCustomer(inserted.rows[0]);
    },

    async findOrCreateConversation({ channelId, customerId, preview, timestampIso, replyToken, replyExpiresAt }) {
      const res = await pool.query(
        'SELECT * FROM conversations WHERE channel_id = $1 AND customer_id = $2 ORDER BY last_message_at DESC LIMIT 1',
        [channelId, customerId]
      );
      const conv = res.rows[0];

      if (!conv) {
        const id = `conv_${crypto.randomBytes(6).toString('hex')}`;
        await pool.query(
          `INSERT INTO conversations (
            id, channel_id, customer_id, status, unread_count,
            last_message_preview, last_message_at, last_customer_msg_at,
            line_reply_token, line_reply_expires_at, created_at
          ) VALUES ($1, $2, $3, 'open', 1, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            channelId,
            customerId,
            preview,
            timestampIso,
            timestampIso,
            replyToken || null,
            replyExpiresAt || null,
            new Date().toISOString(),
          ]
        );
        return this.getConversationSummaryById(id);
      }

      await pool.query(
        `UPDATE conversations
         SET
           status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
           is_replied = 0,
           unread_count = unread_count + 1,
           last_message_preview = $1,
           last_message_at = $2,
           last_customer_msg_at = $3,
           line_reply_token = COALESCE($4, line_reply_token),
           line_reply_expires_at = COALESCE($5, line_reply_expires_at)
         WHERE id = $6`,
        [preview, timestampIso, timestampIso, replyToken || null, replyExpiresAt || null, conv.id]
      );
      return this.getConversationSummaryById(conv.id);
    },

    async findMessageByPlatformId(channelId, platformMessageId) {
      if (!platformMessageId) return null;
      const res = await pool.query(
        'SELECT * FROM messages WHERE channel_id = $1 AND platform_message_id = $2',
        [channelId, String(platformMessageId)]
      );
      return res.rows[0] || null;
    },

    async insertMessage({
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
      await pool.query(
        `INSERT INTO messages (
          id, conversation_id, channel_id, platform_message_id,
          sender_type, sender_agent_id, message_type, content_text,
          media_url, delivery_status, delivery_method, raw_payload, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
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
          createdAt,
        ]
      );
      const res = await pool.query('SELECT * FROM messages WHERE id = $1', [id]);
      return res.rows[0] || null;
    },

    async updateConversationAfterAgentReply({ conversationId, preview, timestampIso, clearReplyToken = false }) {
      if (clearReplyToken) {
        await pool.query(
          `UPDATE conversations
           SET last_message_preview = $1, last_message_at = $2, unread_count = 0,
               is_replied = 1, last_replied_at = $3,
               line_reply_token = NULL, line_reply_expires_at = NULL
           WHERE id = $4`,
          [preview, timestampIso, timestampIso, conversationId]
        );
      } else {
        await pool.query(
          `UPDATE conversations
           SET last_message_preview = $1, last_message_at = $2, unread_count = 0,
               is_replied = 1, last_replied_at = $3
           WHERE id = $4`,
          [preview, timestampIso, timestampIso, conversationId]
        );
      }
      return this.getConversationSummaryById(conversationId);
    },

    async markConversationRead(conversationId) {
      await pool.query('UPDATE conversations SET unread_count = 0 WHERE id = $1', [conversationId]);
      return this.getConversationSummaryById(conversationId);
    },

    async updateConversationMeta(conversationId, { status, assignedAgentId, tags, notes }) {
      const convRes = await pool.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);
      const conv = convRes.rows[0];
      if (!conv) return null;

      if (status && ['open', 'pending', 'resolved'].includes(status)) {
        await pool.query('UPDATE conversations SET status = $1 WHERE id = $2', [status, conversationId]);
      }
      if (assignedAgentId !== undefined) {
        await pool.query('UPDATE conversations SET assigned_agent_id = $1 WHERE id = $2', [
          assignedAgentId || null,
          conversationId,
        ]);
      }
      if (Array.isArray(tags)) {
        await pool.query('UPDATE customers SET tags = $1 WHERE id = $2', [
          JSON.stringify(tags),
          conv.customer_id,
        ]);
      }
      if (typeof notes === 'string') {
        await pool.query('UPDATE customers SET notes = $1 WHERE id = $2', [notes, conv.customer_id]);
      }
      return this.getConversationSummaryById(conversationId);
    },

    async listConversations({ platform, channelId, status, box, q, allowedChannelIds = null } = {}) {
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) return [];
      const where = [];
      const params = [];
      const nextParam = (val) => {
        params.push(val);
        return `$${params.length}`;
      };

      if (Array.isArray(allowedChannelIds)) {
        const ph = allowedChannelIds.map((cid) => nextParam(cid)).join(',');
        where.push(`conv.channel_id IN (${ph})`);
      }
      if (platform && platform !== 'all') {
        where.push(`ch.platform = ${nextParam(platform)}`);
      }
      if (channelId && channelId !== 'all') {
        where.push(`conv.channel_id = ${nextParam(channelId)}`);
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
        where.push(`conv.status = ${nextParam(status)}`);
      }
      if (q && q.trim()) {
        const like = `%${q.trim()}%`;
        const p1 = nextParam(like);
        const p2 = nextParam(like);
        const p3 = nextParam(like);
        where.push(`(cust.display_name ILIKE ${p1} OR conv.last_message_preview ILIKE ${p2} OR ch.shop_code ILIKE ${p3})`);
      }

      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const res = await pool.query(
        `SELECT
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
         LIMIT 100`,
        params
      );
      return res.rows.map(formatConversationSummary);
    },

    async getConversationCounts({ platform, channelId, q, allowedChannelIds = null } = {}) {
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return { all: 0, unreplied: 0, pending: 0, replied: 0, resolved: 0 };
      }
      const where = [];
      const params = [];
      const nextParam = (val) => {
        params.push(val);
        return `$${params.length}`;
      };

      if (Array.isArray(allowedChannelIds)) {
        const ph = allowedChannelIds.map((cid) => nextParam(cid)).join(',');
        where.push(`conv.channel_id IN (${ph})`);
      }
      if (platform && platform !== 'all') {
        where.push(`ch.platform = ${nextParam(platform)}`);
      }
      if (channelId && channelId !== 'all') {
        where.push(`conv.channel_id = ${nextParam(channelId)}`);
      }
      if (q && q.trim()) {
        const like = `%${q.trim()}%`;
        const p1 = nextParam(like);
        const p2 = nextParam(like);
        const p3 = nextParam(like);
        where.push(`(cust.display_name ILIKE ${p1} OR conv.last_message_preview ILIKE ${p2} OR ch.shop_code ILIKE ${p3})`);
      }

      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const res = await pool.query(
        `SELECT
          COUNT(*)::int AS total_count,
          COALESCE(SUM(CASE WHEN conv.status = 'open' AND conv.is_replied = 0 THEN 1 ELSE 0 END), 0)::int AS unreplied_count,
          COALESCE(SUM(CASE WHEN conv.status = 'pending' THEN 1 ELSE 0 END), 0)::int AS pending_count,
          COALESCE(SUM(CASE WHEN conv.status = 'open' AND conv.is_replied = 1 THEN 1 ELSE 0 END), 0)::int AS replied_count,
          COALESCE(SUM(CASE WHEN conv.status = 'resolved' THEN 1 ELSE 0 END), 0)::int AS resolved_count
         FROM conversations conv
         JOIN channels ch ON ch.id = conv.channel_id
         JOIN customers cust ON cust.id = conv.customer_id
         ${whereClause}`,
        params
      );
      const row = res.rows[0];
      return {
        all: Number(row?.total_count || 0),
        unreplied: Number(row?.unreplied_count || 0),
        pending: Number(row?.pending_count || 0),
        replied: Number(row?.replied_count || 0),
        resolved: Number(row?.resolved_count || 0),
      };
    },

    async getConversationSummaryById(id) {
      const res = await pool.query(
        `SELECT
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
         WHERE conv.id = $1`,
        [id]
      );
      return res.rows[0] ? formatConversationSummary(res.rows[0]) : null;
    },

    async getConversationMessages(conversationId) {
      const res = await pool.query(
        `SELECT m.*, ag.display_name AS sender_agent_name
         FROM messages m
         LEFT JOIN agents ag ON ag.id = m.sender_agent_id
         WHERE m.conversation_id = $1
         ORDER BY m.created_at ASC`,
        [conversationId]
      );
      return res.rows;
    },

    async logWebhookEvent({ platform, channelId = null, status = 'processed', errorMessage = null, payload }) {
      await pool.query(
        `INSERT INTO webhook_events (platform, channel_id, status, error_message, payload, received_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          platform,
          channelId,
          status,
          errorMessage,
          typeof payload === 'string' ? payload : JSON.stringify(payload),
          new Date().toISOString(),
        ]
      );
    },

    async cleanupOldWebhookEvents(retentionDays = 14) {
      const days = Math.max(1, Number(retentionDays || 14));
      const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();
      const res = await pool.query('DELETE FROM webhook_events WHERE received_at < $1', [cutoffIso]);
      return Number(res.rowCount || 0);
    },

    async listCampaignsWithStats() {
      const res = await pool.query(
        `SELECT
          c.*,
          ch.shop_code,
          ch.platform,
          COUNT(v.id)::int AS total_vouchers,
          COALESCE(SUM(CASE WHEN v.status = 'available' THEN 1 ELSE 0 END), 0)::int AS available_vouchers,
          COALESCE(SUM(CASE WHEN v.status = 'claimed' THEN 1 ELSE 0 END), 0)::int AS claimed_vouchers
         FROM campaigns c
         LEFT JOIN channels ch ON ch.id = c.channel_id
         LEFT JOIN vouchers v ON v.campaign_id = c.id
         GROUP BY c.id, ch.shop_code, ch.platform
         ORDER BY c.created_at DESC`
      );
      return res.rows.map((r) => ({
        ...r,
        is_active: Boolean(r.is_active),
        total_vouchers: Number(r.total_vouchers || 0),
        available_vouchers: Number(r.available_vouchers || 0),
        claimed_vouchers: Number(r.claimed_vouchers || 0),
      }));
    },

    async getCampaignById(id) {
      const res = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
      return res.rows[0] || null;
    },

    async createCampaign({ name, channelId = null, requiredRules, replyTemplate, minConfidence = 90 }) {
      const id = `camp_${crypto.randomBytes(5).toString('hex')}`;
      await pool.query(
        `INSERT INTO campaigns (id, name, channel_id, required_rules, reply_template, min_confidence, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7)`,
        [
          id,
          name.trim(),
          channelId || null,
          requiredRules.trim(),
          replyTemplate.trim(),
          Math.max(50, Math.min(100, Number(minConfidence || 90))),
          new Date().toISOString(),
        ]
      );
      const list = await this.listCampaignsWithStats();
      return list.find((c) => c.id === id) || null;
    },

    async importVouchers(campaignId, rows) {
      let inserted = 0;
      let skipped = 0;
      const nowIso = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const r of rows) {
          const code = String(r.code || '').trim();
          if (!code) continue;
          const res = await client.query(
            `INSERT INTO vouchers (id, campaign_id, code, reward_value, expires_at, status, created_at)
             VALUES ($1, $2, $3, $4, $5, 'available', $6)
             ON CONFLICT (campaign_id, code) DO NOTHING`,
            [
              `vch_${crypto.randomBytes(6).toString('hex')}`,
              campaignId,
              code,
              String(r.rewardValue || ''),
              String(r.expiresAt || ''),
              nowIso,
            ]
          );
          if ((res.rowCount || 0) > 0) inserted += 1;
          else skipped += 1;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return { inserted, skipped };
    },

    async listVouchers(campaignId) {
      const res = await pool.query(
        `SELECT
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
         WHERE v.campaign_id = $1
         ORDER BY (v.status = 'claimed') DESC, v.claimed_at DESC NULLS LAST, v.created_at ASC, v.id ASC`,
        [campaignId]
      );
      return res.rows;
    },

    async findCustomerClaimInCampaign(campaignId, customerId) {
      const res = await pool.query(
        `SELECT v.id, v.code, v.reward_value, v.claimed_at
         FROM vouchers v
         WHERE v.campaign_id = $1 AND v.claimed_by_customer_id = $2 AND v.status = 'claimed'
         LIMIT 1`,
        [campaignId, customerId]
      );
      return res.rows[0] || null;
    },

    async findDuplicateSubmissionImages(campaignId, hashes, excludeCustomerId) {
      if (!Array.isArray(hashes) || hashes.length === 0) return [];
      const hashSet = new Set(hashes);
      const res = await pool.query(
        `SELECT s.id, s.customer_id, s.conversation_id, s.image_hashes, s.status,
                cust.display_name AS customer_name, ch.platform, ch.shop_code
         FROM campaign_submissions s
         JOIN customers cust ON cust.id = s.customer_id
         JOIN channels ch ON ch.id = s.channel_id
         WHERE s.campaign_id = $1 AND s.customer_id != $2 AND s.status != 'rejected'`,
        [campaignId, excludeCustomerId]
      );
      const matches = [];
      for (const row of res.rows) {
        const storedHashes = safeJsonParse(row.image_hashes, []);
        if (storedHashes.some((h) => hashSet.has(h))) {
          matches.push(row);
        }
      }
      return matches;
    },

    async findDuplicateFbNameClaim(campaignId, fbName, excludeCustomerId) {
      if (!fbName || !String(fbName).trim()) return null;
      const res = await pool.query(
        `SELECT s.id, s.voucher_code, ch.shop_code, ch.platform, cust.display_name AS customer_name
         FROM campaign_submissions s
         JOIN channels ch ON ch.id = s.channel_id
         JOIN customers cust ON cust.id = s.customer_id
         WHERE s.campaign_id = $1
           AND s.status = 'approved'
           AND s.customer_id != $2
           AND LOWER(TRIM(s.extracted_fb_name)) = LOWER(TRIM($3))
         LIMIT 1`,
        [campaignId, excludeCustomerId, String(fbName)]
      );
      return res.rows[0] || null;
    },

    async createSubmission({
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
      await pool.query(
        `INSERT INTO campaign_submissions (
          id, campaign_id, conversation_id, customer_id, channel_id,
          image_urls, image_hashes, extracted_fb_name,
          ai_confidence, ai_verdict, ai_provider, ai_summary,
          ai_checklist, fraud_flags, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', $15)`,
        [
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
          nowIso,
        ]
      );
      return this.getSubmissionById(id);
    },

    async getSubmissionById(id) {
      const res = await pool.query(
        `SELECT s.*, c.name AS campaign_name, c.min_confidence, c.reply_template, ag.display_name AS reviewed_by_agent_name
         FROM campaign_submissions s
         JOIN campaigns c ON c.id = s.campaign_id
         LEFT JOIN agents ag ON ag.id = s.reviewed_by_agent_id
         WHERE s.id = $1`,
        [id]
      );
      return res.rows[0] ? formatSubmission(res.rows[0]) : null;
    },

    async listConversationSubmissions(conversationId) {
      const res = await pool.query(
        `SELECT s.*, c.name AS campaign_name, c.min_confidence, c.reply_template, ag.display_name AS reviewed_by_agent_name
         FROM campaign_submissions s
         JOIN campaigns c ON c.id = s.campaign_id
         LEFT JOIN agents ag ON ag.id = s.reviewed_by_agent_id
         WHERE s.conversation_id = $1
         ORDER BY s.created_at DESC
         LIMIT 20`,
        [conversationId]
      );
      return res.rows.map(formatSubmission);
    },

    /**
     * Atomically claims 1 available voucher (1 code / 1 time) using PostgreSQL FOR UPDATE SKIP LOCKED.
     */
    async claimVoucherAtomic({ submissionId, agentId, allowOverride = false }) {
      const nowIso = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const subRes = await client.query(
          `SELECT s.*, c.min_confidence, c.reply_template
           FROM campaign_submissions s
           JOIN campaigns c ON c.id = s.campaign_id
           WHERE s.id = $1
           FOR UPDATE OF s`,
          [submissionId]
        );
        const subRow = subRes.rows[0];
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

        const existingClaimRes = await client.query(
          `SELECT code FROM vouchers
           WHERE campaign_id = $1 AND claimed_by_customer_id = $2 AND status = 'claimed'
           LIMIT 1`,
          [subRow.campaign_id, subRow.customer_id]
        );
        if (existingClaimRes.rows[0]) {
          const err = new Error(`ลูกค้ารายนี้เคยรับโค้ดในกิจกรรมนี้ไปแล้ว (${existingClaimRes.rows[0].code})`);
          err.statusCode = 409;
          throw err;
        }

        // PostgreSQL row-level lock with SKIP LOCKED prevents race conditions across concurrent workers
        const nextVoucherRes = await client.query(
          `SELECT id, code, reward_value, expires_at
           FROM vouchers
           WHERE campaign_id = $1 AND status = 'available'
           ORDER BY created_at ASC, id ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [subRow.campaign_id]
        );
        const nextVoucher = nextVoucherRes.rows[0];
        if (!nextVoucher) {
          const err = new Error('โค้ด Gift Voucher ในคลังหมดแล้ว กรุณานำเข้าไฟล์ .xls เพิ่ม');
          err.statusCode = 409;
          throw err;
        }

        const claimRes = await client.query(
          `UPDATE vouchers
           SET status = 'claimed',
               claimed_by_customer_id = $1,
               claimed_conversation_id = $2,
               claimed_submission_id = $3,
               claimed_by_agent_id = $4,
               claimed_at = $5
           WHERE id = $6 AND status = 'available'`,
          [subRow.customer_id, subRow.conversation_id, subRow.id, agentId, nowIso, nextVoucher.id]
        );
        if ((claimRes.rowCount || 0) !== 1) {
          const err = new Error('เกิดการแย่งดึงโค้ดพร้อมกัน กรุณากดใหม่อีกครั้ง');
          err.statusCode = 409;
          throw err;
        }

        await client.query(
          `UPDATE campaign_submissions
           SET status = 'approved',
               voucher_id = $1,
               voucher_code = $2,
               reviewed_by_agent_id = $3,
               reviewed_at = $4
           WHERE id = $5`,
          [nextVoucher.id, nextVoucher.code, agentId, nowIso, subRow.id]
        );

        const custRes = await client.query('SELECT tags FROM customers WHERE id = $1', [subRow.customer_id]);
        const tags = safeJsonParse(custRes.rows[0]?.tags, []);
        if (!tags.includes('รับโค้ดแล้ว')) {
          tags.push('รับโค้ดแล้ว');
          await client.query('UPDATE customers SET tags = $1 WHERE id = $2', [
            JSON.stringify(tags),
            subRow.customer_id,
          ]);
        }

        await client.query('COMMIT');

        return {
          voucher: nextVoucher,
          submission: await this.getSubmissionById(subRow.id),
          replyTemplate: subRow.reply_template,
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async rejectSubmission({ submissionId, agentId }) {
      const nowIso = new Date().toISOString();
      const res = await pool.query(
        `UPDATE campaign_submissions
         SET status = 'rejected', reviewed_by_agent_id = $1, reviewed_at = $2
         WHERE id = $3 AND status = 'pending'`,
        [agentId, nowIso, submissionId]
      );
      if ((res.rowCount || 0) === 0) return null;
      return this.getSubmissionById(submissionId);
    },
  };
}
