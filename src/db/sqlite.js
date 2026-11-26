import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getConfig } from '../config.js';
import { encryptSecret } from '../services/crypto.service.js';
import { hashPassword } from '../services/auth.service.js';

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan_code TEXT NOT NULL DEFAULT 'pro',
  max_channels INTEGER NOT NULL DEFAULT 10,
  max_agents INTEGER NOT NULL DEFAULT 10,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  contact_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'ws_default' REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_secret_encrypted TEXT,
  totp_recovery_hashes TEXT NOT NULL DEFAULT '[]',
  role TEXT NOT NULL DEFAULT 'agent',
  avatar_color TEXT NOT NULL DEFAULT '#2563eb',
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_channel_permissions (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, channel_id)
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'ws_default' REFERENCES workspaces(id) ON DELETE CASCADE,
  shop_code TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('line', 'facebook')),
  external_channel_id TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  channel_secret_enc TEXT,
  webhook_path_key TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, external_channel_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (channel_id, external_user_id)
);

CREATE TABLE IF NOT EXISTS conversations (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conv_inbox ON conversations(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_channel_customer ON conversations(channel_id, customer_id);

CREATE TABLE IF NOT EXISTS messages (
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
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS quick_replies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'ws_default' REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
  shortcut TEXT NOT NULL,
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  media_url TEXT
);

CREATE TABLE IF NOT EXISTS custom_stickers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'ws_default' REFERENCES workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'processed',
  error_message TEXT,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'ws_default' REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  required_rules TEXT NOT NULL,
  reply_template TEXT NOT NULL,
  min_confidence INTEGER NOT NULL DEFAULT 90,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vouchers (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, code)
);

CREATE INDEX IF NOT EXISTS idx_vouchers_campaign_status ON vouchers(campaign_id, status);

CREATE TABLE IF NOT EXISTS campaign_submissions (
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
);

CREATE INDEX IF NOT EXISTS idx_submissions_conv ON campaign_submissions(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_camp ON campaign_submissions(campaign_id, status);
`;

export function initDb(customDbPath, customEncryptionKey, options = {}) {
  const config = getConfig();
  const dbPath = customDbPath || config.dbPath;
  const encryptionKey = customEncryptionKey || config.encryptionKey;
  const isProduction = options.isProduction ?? config.isProduction;
  const adminEmail = options.adminEmail || config.adminEmail;
  const adminPassword = options.adminPassword || config.adminPassword;
  const adminName = options.adminName || config.adminName;

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }
  db.exec(SCHEMA_SQL);
  ensureWorkspaceSchemaAndSeed(db);
  ensureAgentAuthColumns(db);
  ensureConversationReplyColumns(db);
  ensureQuickReplyChannelColumn(db);

  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM channels').get();
  if (countRow.cnt === 0) {
    seedInitialData(db, encryptionKey, { isProduction, adminEmail, adminPassword, adminName });
  }
  seedDefaultAgentAuthIfMissing(db, { adminPassword });
  ensureSuperAdminExists(db);
  seedShopQuickRepliesIfMissing(db);
  seedDefaultCampaignIfMissing(db);

  return db;
}

function ensureWorkspaceSchemaAndSeed(db) {
  const wsCols = db.prepare('PRAGMA table_info(workspaces)').all().map((c) => c.name);
  if (!wsCols.includes('contact_notes')) {
    db.exec("ALTER TABLE workspaces ADD COLUMN contact_notes TEXT NOT NULL DEFAULT ''");
  }

  db.prepare(`
    INSERT OR IGNORE INTO workspaces (id, name, slug, plan_code, max_channels, max_agents, ai_enabled, is_active, created_at)
    VALUES ('ws_default', 'DmCare Main', 'dmcare-main', 'enterprise', 50, 50, 1, 1, ?)
  `).run(new Date().toISOString());

  for (const table of ['agents', 'channels', 'quick_replies', 'campaigns']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes('workspace_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default'`);
    }
  }
}

function ensureAgentAuthColumns(db) {
  const cols = db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name);
  if (!cols.includes('password_hash')) {
    db.exec('ALTER TABLE agents ADD COLUMN password_hash TEXT');
  }
  if (!cols.includes('must_change_password')) {
    db.exec('ALTER TABLE agents ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('is_active')) {
    db.exec('ALTER TABLE agents ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  }
  if (!cols.includes('last_login_at')) {
    db.exec('ALTER TABLE agents ADD COLUMN last_login_at TEXT');
  }
  if (!cols.includes('totp_enabled')) {
    db.exec('ALTER TABLE agents ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('totp_secret_encrypted')) {
    db.exec('ALTER TABLE agents ADD COLUMN totp_secret_encrypted TEXT');
  }
  if (!cols.includes('totp_recovery_hashes')) {
    db.exec("ALTER TABLE agents ADD COLUMN totp_recovery_hashes TEXT NOT NULL DEFAULT '[]'");
  }
}

function ensureSuperAdminExists(db) {
  const hasSuper = db.prepare("SELECT COUNT(*) AS cnt FROM agents WHERE role = 'super_admin'").get();
  if (Number(hasSuper?.cnt || 0) > 0) return;

  const primary = db
    .prepare("SELECT id FROM agents WHERE id = 'agent_1' OR role IN ('owner', 'admin', 'supervisor') ORDER BY (id = 'agent_1') DESC, id ASC LIMIT 1")
    .get();
  if (primary) {
    db.prepare("UPDATE agents SET role = 'super_admin' WHERE id = ?").run(primary.id);
  }
}

function seedDefaultAgentAuthIfMissing(db, { adminPassword = 'admin1234' } = {}) {
  const agents = db.prepare('SELECT id, role, password_hash FROM agents').all();
  const updatePw = db.prepare('UPDATE agents SET password_hash = ? WHERE id = ?');

  for (const ag of agents) {
    if (!ag.password_hash) {
      const defaultPass = ['owner', 'admin', 'supervisor'].includes(ag.role) ? adminPassword : 'agent1234';
      updatePw.run(hashPassword(defaultPass), ag.id);
    }
  }

  const alreadySeededPerms = db.prepare("SELECT value FROM app_meta WHERE key = 'agent_perms_seeded'").get();
  if (alreadySeededPerms) return;

  const insertPerm = db.prepare('INSERT OR IGNORE INTO agent_channel_permissions (agent_id, channel_id) VALUES (?, ?)');
  const hasChannel = db.prepare('SELECT 1 FROM channels WHERE id = ?');
  const hasAgent = db.prepare('SELECT 1 FROM agents WHERE id = ?');

  // Seed realistic shop-level RBAC for regular agents (agent_1 is supervisor -> sees all shops)
  const defaults = {
    agent_2: ['ch_line_a1', 'ch_line_a2', 'ch_line_a3', 'ch_fb_b1', 'ch_fb_b2', 'ch_fb_b3'],
    agent_3: ['ch_line_a4', 'ch_line_a5', 'ch_fb_b4', 'ch_fb_b5'],
  };

  for (const [agentId, channelIds] of Object.entries(defaults)) {
    if (!hasAgent.get(agentId)) continue;
    for (const chId of channelIds) {
      if (hasChannel.get(chId)) {
        insertPerm.run(agentId, chId);
      }
    }
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('agent_perms_seeded', '1')").run();
}

function seedDefaultCampaignIfMissing(db) {
  const already = db.prepare("SELECT value FROM app_meta WHERE key = 'campaign_seeded'").get();
  if (already) return;

  const campId = 'camp_like_share_1212';
  db.prepare(`
    INSERT OR IGNORE INTO campaigns (id, name, channel_id, required_rules, reply_template, min_confidence, is_active)
    VALUES (?, ?, NULL, ?, ?, 90, 1)
  `).run(
    campId,
    'กิจกรรมกดไลก์เพจ + แชร์เปิดสาธารณะ (แจก Gift Voucher)',
    'ลูกค้าต้องกดไลก์/ติดตามเพจ และแชร์โพสต์กิจกรรมโดยเปิดสถานะเป็นสาธารณะ (ไอคอนลูกโลก 🌐)',
    'ยินดีด้วยครับ! หลักฐานกิจกรรมครบถ้วนแล้ว 🎁\nรหัส Gift Voucher ของคุณคือ: {{code}}\n(สามารถใช้สิทธิ์ได้ 1 ครั้งเท่านั้น)'
  );

  const insertVoucher = db.prepare(`
    INSERT OR IGNORE INTO vouchers (id, campaign_id, code, reward_value, expires_at, status)
    VALUES (?, ?, ?, ?, ?, 'available')
  `);
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(3, '0');
    insertVoucher.run(`vch_seed_${num}`, campId, `GV1212-A${num}`, '100 บาท', '2026-12-31');
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('campaign_seeded', '1')").run();
}

function ensureQuickReplyChannelColumn(db) {
  const cols = db.prepare('PRAGMA table_info(quick_replies)').all().map((c) => c.name);
  if (!cols.includes('channel_id')) {
    db.exec('ALTER TABLE quick_replies ADD COLUMN channel_id TEXT');
  }
  if (!cols.includes('media_url')) {
    db.exec('ALTER TABLE quick_replies ADD COLUMN media_url TEXT');
  }
}

function seedShopQuickRepliesIfMissing(db) {
  const alreadySeeded = db.prepare("SELECT value FROM app_meta WHERE key = 'shop_qr_seeded'").get();
  if (alreadySeeded) return;

  const shopReplies = [
    {
      id: 'qr_a1_size',
      channelId: 'ch_line_a1',
      shortcut: '/size',
      title: 'ตารางไซซ์เสื้อ (a1)',
      contentText: 'ตารางไซซ์เสื้อร้าน a1: S อก 36" | M อก 38" | L อก 40" | XL อก 42" พร้อมส่งทุกสีครับ',
    },
    {
      id: 'qr_a2_shoe',
      channelId: 'ch_line_a2',
      shortcut: '/shoe',
      title: 'ไซซ์รองเท้า (a2)',
      contentText: 'รองเท้าร้าน a2 มีไซซ์ EU 36–44 ครับ แนะนำวัดความยาวเท้าเป็นซม. เพื่อเลือกไซซ์ที่พอดีครับ',
    },
    {
      id: 'qr_a3_bag',
      channelId: 'ch_line_a3',
      shortcut: '/bag',
      title: 'รายละเอียดกระเป๋า (a3)',
      contentText: 'กระเป๋าร้าน a3 หนัง PU พรีเมียม กันน้ำ มีสายสะพายยาวแถมให้ 2 เส้น รับประกันซิป 6 เดือนครับ',
    },
    {
      id: 'qr_b1_promo',
      channelId: 'ch_fb_b1',
      shortcut: '/promo',
      title: 'โปรหน้าเพจ b1',
      contentText: 'โปรโมชันพิเศษเพจ b1 วันนี้ ซื้อ 2 ชิ้นลดเพิ่ม 10% พร้อมส่งฟรีทั่วประเทศค่ะ!',
    },
    {
      id: 'qr_b2_cod',
      channelId: 'ch_fb_b2',
      shortcut: '/cod',
      title: 'เก็บเงินปลายทาง (b2)',
      contentText: 'เพจ b2 มีบริการเก็บเงินปลายทาง (COD) บวกเพิ่มเพียง 30 บาท แจ้งชื่อ-ที่อยู่-เบอร์โทรได้เลยครับ',
    },
  ];

  const hasChannel = db.prepare('SELECT 1 FROM channels WHERE id = ?');
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO quick_replies (id, channel_id, shortcut, title, content_text)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const qr of shopReplies) {
    if (hasChannel.get(qr.channelId)) {
      upsert.run(qr.id, qr.channelId, qr.shortcut, qr.title, qr.contentText);
    }
  }
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('shop_qr_seeded', '1')").run();
}

function ensureConversationReplyColumns(db) {
  const cols = db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
  if (!cols.includes('is_replied')) {
    db.exec('ALTER TABLE conversations ADD COLUMN is_replied INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('last_replied_at')) {
    db.exec('ALTER TABLE conversations ADD COLUMN last_replied_at TEXT');
  }
  if (!cols.includes('last_read_by_agent_id')) {
    db.exec('ALTER TABLE conversations ADD COLUMN last_read_by_agent_id TEXT');
  }
  if (!cols.includes('last_read_at')) {
    db.exec('ALTER TABLE conversations ADD COLUMN last_read_at TEXT');
  }

  // Backfill conversations whose latest message was already sent by an agent
  db.exec(`
    UPDATE conversations
    SET
      is_replied = 1,
      last_replied_at = COALESCE(last_replied_at, last_message_at)
    WHERE is_replied = 0
      AND (
        SELECT m.sender_type
        FROM messages m
        WHERE m.conversation_id = conversations.id
        ORDER BY m.created_at DESC, rowid DESC
        LIMIT 1
      ) = 'agent'
  `);
}

function seedInitialData(db, encryptionKey, { isProduction = false, adminEmail = 'may@shop.local', adminPassword = 'admin1234', adminName = 'แอดมินเมย์' } = {}) {
  const insertAgent = db.prepare(
    'INSERT INTO agents (id, workspace_id, display_name, email, password_hash, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertAgent.run('agent_1', 'ws_default', adminName, adminEmail.toLowerCase(), hashPassword(adminPassword), 'super_admin', '#2563eb');
  if (!isProduction) {
    insertAgent.run('agent_2', 'ws_default', 'แอดมินต้น', 'ton@shop.local', hashPassword('agent1234'), 'agent', '#059669');
    insertAgent.run('agent_3', 'ws_default', 'แอดมินฟ้า', 'fah@shop.local', hashPassword('agent1234'), 'agent', '#7c3aed');
  }

  const insertChannel = db.prepare(`
    INSERT INTO channels (id, shop_code, name, platform, external_channel_id, access_token_enc, channel_secret_enc, webhook_path_key, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const lineShops = [
    { code: 'a1', name: 'ร้าน a1 (แฟชั่น)', extId: '2000000001' },
    { code: 'a2', name: 'ร้าน a2 (รองเท้า)', extId: '2000000002' },
    { code: 'a3', name: 'ร้าน a3 (กระเป๋า)', extId: '2000000003' },
    { code: 'a4', name: 'ร้าน a4 (เครื่องสำอาง)', extId: '2000000004' },
    { code: 'a5', name: 'ร้าน a5 (ของแต่งบ้าน)', extId: '2000000005' },
  ];

  for (const shop of lineShops) {
    insertChannel.run(
      `ch_line_${shop.code}`,
      shop.code,
      shop.name,
      'line',
      shop.extId,
      encryptSecret(`mock_line_access_token_${shop.code}`, encryptionKey),
      encryptSecret(`mock_line_secret_${shop.code}`, encryptionKey),
      shop.code
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
    insertChannel.run(
      `ch_fb_${shop.code}`,
      shop.code,
      shop.name,
      'facebook',
      shop.pageId,
      encryptSecret(`mock_fb_page_token_${shop.code}`, encryptionKey),
      null,
      shop.code
    );
  }

  // Quick Replies
  const insertQR = db.prepare(
    'INSERT INTO quick_replies (id, shortcut, title, content_text) VALUES (?, ?, ?, ?)'
  );
  insertQR.run('qr_1', '/hello', 'ทักทายลูกค้า', 'สวัสดีครับ ยินดีให้บริการครับ สนใจสินค้าตัวไหนสอบถามได้เลยนะครับ');
  insertQR.run('qr_2', '/bank', 'ส่งเลขบัญชีโอนเงิน', 'สามารถโอนชำระได้ที่ ธ.กสิกรไทย 123-4-56789-0 บจก. DmCare โอนแล้วส่งสลิปได้เลยครับ');
  insertQR.run('qr_3', '/ship', 'แจ้งรอบจัดส่ง', 'ทางร้านตัดรอบจัดส่งเวลา 14:00 น. ทุกวันจันทร์–เสาร์ และแจ้งเลขพัสดุช่วงเย็นครับ');
  insertQR.run('qr_4', '/close', 'ปิดการขาย', 'ขอบคุณที่อุดหนุนครับ หากได้รับสินค้าแล้วมีข้อสงสัยทักมาได้ตลอดเลยนะครับ');

  if (isProduction) {
    return;
  }

  // Seed realistic sample conversations across LINE (a1, a2) and Facebook (b1, b3)
  const now = Date.now();
  const isoAgo = (minutes) => new Date(now - minutes * 60_000).toISOString();
  const isoAhead = (seconds) => new Date(now + seconds * 1000).toISOString();

  const insertCustomer = db.prepare(`
    INSERT INTO customers (id, channel_id, external_user_id, display_name, tags, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertConv = db.prepare(`
    INSERT INTO conversations (id, channel_id, customer_id, status, assigned_agent_id, unread_count, last_message_preview, last_message_at, last_customer_msg_at, line_reply_token, line_reply_expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMsg = db.prepare(`
    INSERT INTO messages (id, conversation_id, channel_id, platform_message_id, sender_type, sender_agent_id, message_type, content_text, delivery_status, delivery_method, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1. LINE a1 (active reply token!)
  insertCustomer.run('cust_1', 'ch_line_a1', 'U_line_somchai_01', 'สมชาย ใจดี', '["VIP","รอโอน"]', 'ลูกค้าประจำ สั่งไซซ์ L');
  insertConv.run(
    'conv_1', 'ch_line_a1', 'cust_1', 'open', 'agent_1', 2,
    'เสื้อเชิ้ตสีขาวไซซ์ L ยังมีของไหมครับ', isoAgo(1), isoAgo(1),
    'mock_reply_token_active_a1', isoAhead(45)
  );
  insertMsg.run('msg_1', 'conv_1', 'ch_line_a1', 'line_m_001', 'customer', null, 'text', 'สวัสดีครับร้าน a1', 'delivered', 'line_webhook', isoAgo(2));
  insertMsg.run('msg_2', 'conv_1', 'ch_line_a1', 'line_m_002', 'customer', null, 'text', 'เสื้อเชิ้ตสีขาวไซซ์ L ยังมีของไหมครับ', 'delivered', 'line_webhook', isoAgo(1));

  // 2. Facebook b1 (within 24h window)
  insertCustomer.run('cust_2', 'ch_fb_b1', 'PSID_fb_nattaporn_01', 'ณัฐพร สว่างวงศ์', '["สอบถามสินค้า"]', '');
  insertConv.run(
    'conv_2', 'ch_fb_b1', 'cust_2', 'open', 'agent_2', 1,
    'เห็นจากโพสต์หน้าเพจ b1 ขอราคาโปรหน่อยค่ะ', isoAgo(6), isoAgo(6),
    null, null
  );
  insertMsg.run('msg_3', 'conv_2', 'ch_fb_b1', 'fb_mid_001', 'customer', null, 'text', 'เห็นจากโพสต์หน้าเพจ b1 ขอราคาโปรหน่อยค่ะ', 'delivered', 'fb_webhook', isoAgo(6));

  // 3. LINE a2 (reply token expired -> will use LINE Push)
  insertCustomer.run('cust_3', 'ch_line_a2', 'U_line_pim_02', 'พิมพ์ชนก รักสวย', '["ติดตามพัสดุ"]', '');
  insertConv.run(
    'conv_3', 'ch_line_a2', 'cust_3', 'open', null, 1,
    'รบกวนขอเลขพัสดุออเดอร์เมื่อวานหน่อยค่ะ', isoAgo(25), isoAgo(25),
    null, null
  );
  insertMsg.run('msg_4', 'conv_3', 'ch_line_a2', 'line_m_003', 'customer', null, 'text', 'รบกวนขอเลขพัสดุออเดอร์เมื่อวานหน่อยค่ะ', 'delivered', 'line_webhook', isoAgo(25));

  // 4. Facebook b3 (resolved, > 24h ago to demonstrate Human Agent warning)
  insertCustomer.run('cust_4', 'ch_fb_b3', 'PSID_fb_krit_03', 'กฤตภาส มั่นคง', '["ปิดการขายแล้ว"]', '');
  insertConv.run(
    'conv_4', 'ch_fb_b3', 'cust_4', 'resolved', 'agent_1', 0,
    'ขอบคุณครับ ได้รับกระเป๋าแล้ว สวยมากครับ', isoAgo(1600), isoAgo(1600),
    null, null
  );
  insertMsg.run('msg_5', 'conv_4', 'ch_fb_b3', 'fb_mid_002', 'customer', null, 'text', 'สั่งกระเป๋าสีดำ 1 ใบครับ', 'delivered', 'fb_webhook', isoAgo(1620));
  insertMsg.run('msg_6', 'conv_4', 'ch_fb_b3', 'fb_mid_003', 'agent', 'agent_1', 'text', 'รับออเดอร์เรียบร้อยครับ จัดส่งให้วันนี้เลยครับ', 'sent', 'fb_standard', isoAgo(1615));
  insertMsg.run('msg_7', 'conv_4', 'ch_fb_b3', 'fb_mid_004', 'customer', null, 'text', 'ขอบคุณครับ ได้รับกระเป๋าแล้ว สวยมากครับ', 'delivered', 'fb_webhook', isoAgo(1600));
}
