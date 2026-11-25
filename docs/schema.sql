-- =============================================================================
-- Omnichannel Social Media Chat (LINE a1-a5, Facebook b1-b5)
-- Production Database Schema for PostgreSQL 15+
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. Tenants / Workspaces (รองรับการแยกบริษัทหรือกลุ่มธุรกิจในอนาคต)
-- -----------------------------------------------------------------------------
CREATE TABLE workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(120) NOT NULL,
    slug            VARCHAR(80)  NOT NULL UNIQUE,
    plan            VARCHAR(32)  NOT NULL DEFAULT 'starter',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. Agents (พนักงาน/แอดมินตอบแชท)
-- -----------------------------------------------------------------------------
CREATE TABLE agents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    display_name    VARCHAR(100) NOT NULL,
    role            VARCHAR(32)  NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'admin', 'supervisor', 'agent')),
    is_online       BOOLEAN      NOT NULL DEFAULT FALSE,
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. Channels (ร้านค้า/ช่องทาง เช่น LINE a1-a5, Facebook b1-b5)
-- -----------------------------------------------------------------------------
CREATE TABLE channels (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id         UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    shop_code            VARCHAR(32)  NOT NULL,  -- เช่น 'a1', 'a2', ..., 'b5'
    name                 VARCHAR(120) NOT NULL,  -- เช่น 'ร้าน a1 (LINE)'
    platform             VARCHAR(32)  NOT NULL CHECK (platform IN ('line', 'facebook', 'instagram', 'tiktok')),
    external_channel_id  VARCHAR(128) NOT NULL,  -- LINE Channel ID หรือ Facebook Page ID
    access_token_enc     TEXT         NOT NULL,  -- เข้ารหัสด้วย AES-256-GCM ก่อนเก็บ
    channel_secret_enc   TEXT,                   -- LINE Channel Secret (เข้ารหัส)
    webhook_path_key     VARCHAR(64)  NOT NULL UNIQUE, -- ใช้สร้าง /webhooks/line/:webhook_path_key
    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
    metadata             JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (platform, external_channel_id)
);

CREATE INDEX idx_channels_workspace ON channels(workspace_id, platform, is_active);

-- -----------------------------------------------------------------------------
-- 4. Agent-Channel Permissions (กำหนดว่าแอดมินคนไหนเห็น/ตอบร้านไหนได้บ้าง)
-- -----------------------------------------------------------------------------
CREATE TABLE agent_channel_permissions (
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    can_reply       BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (agent_id, channel_id)
);

-- -----------------------------------------------------------------------------
-- 5. Customers (ลูกค้าแต่ละช่องทาง; LINE userId / FB PSID เป็นเอกลักษณ์ต่อ 1 channel)
-- -----------------------------------------------------------------------------
CREATE TABLE customers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id        UUID         NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    external_user_id  VARCHAR(128) NOT NULL, -- LINE userId (Uxxxx) หรือ Facebook PSID
    display_name      VARCHAR(150) NOT NULL DEFAULT 'Unknown Customer',
    avatar_url        TEXT,
    phone             VARCHAR(32),
    crm_customer_id   VARCHAR(128),          -- ผูกกับระบบ ERP/CRM ภายนอก (ถ้ามี)
    tags              TEXT[]       NOT NULL DEFAULT '{}',
    notes             TEXT,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, external_user_id)
);

CREATE INDEX idx_customers_channel_ext ON customers(channel_id, external_user_id);
CREATE INDEX idx_customers_tags ON customers USING GIN(tags);

-- -----------------------------------------------------------------------------
-- 6. Conversations (ห้องแชทของลูกค้าในแต่ละร้าน)
-- -----------------------------------------------------------------------------
CREATE TABLE conversations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id            UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id              UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    customer_id             UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    status                  VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'spam')),
    is_replied              BOOLEAN     NOT NULL DEFAULT FALSE, -- TRUE เมื่อแอดมินตอบแล้ว (ย้ายไปกล่อง "ตอบแล้ว")
    last_replied_at         TIMESTAMPTZ,
    assigned_agent_id       UUID        REFERENCES agents(id) ON DELETE SET NULL,
    unread_count            INTEGER     NOT NULL DEFAULT 0,
    last_message_preview    TEXT,
    last_message_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_customer_msg_at    TIMESTAMPTZ, -- ใช้คำนวณ Facebook 24-hour messaging window
    -- เก็บ LINE replyToken ล่าสุด เพื่อตอบฟรีภายใน ~50 วินาที
    line_reply_token        TEXT,
    line_reply_expires_at   TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index สำคัญสำหรับการโหลดหน้า Inbox ที่เรียงแชทล่าสุดเร็วที่สุด
CREATE INDEX idx_conversations_inbox
    ON conversations(workspace_id, status, last_message_at DESC);
CREATE INDEX idx_conversations_channel_customer
    ON conversations(channel_id, customer_id);
CREATE INDEX idx_conversations_assigned
    ON conversations(assigned_agent_id, status, last_message_at DESC);

-- -----------------------------------------------------------------------------
-- 7. Messages (ประวัติข้อความทั้งหมด)
-- -----------------------------------------------------------------------------
CREATE TABLE messages (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id      UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    channel_id           UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    platform_message_id  VARCHAR(150), -- ใช้ทำ Idempotency ป้องกัน Webhook ส่งซ้ำ
    sender_type          VARCHAR(16) NOT NULL CHECK (sender_type IN ('customer', 'agent', 'bot', 'system')),
    sender_agent_id      UUID        REFERENCES agents(id) ON DELETE SET NULL,
    message_type         VARCHAR(24) NOT NULL DEFAULT 'text'
                         CHECK (message_type IN ('text', 'image', 'video', 'audio', 'file', 'sticker', 'location', 'template')),
    content_text         TEXT,
    media_url            TEXT,         -- URL ที่เก็บใน S3 / Cloudflare R2 ของเราเอง
    media_mime_type      VARCHAR(100),
    delivery_status      VARCHAR(24) NOT NULL DEFAULT 'sent'
                         CHECK (delivery_status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
    delivery_method      VARCHAR(24),  -- เช่น 'line_reply', 'line_push', 'fb_standard', 'fb_human_agent'
    raw_payload          JSONB,        -- เก็บ Payload ดิบสำหรับ Debug
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, platform_message_id)
);

CREATE INDEX idx_messages_conversation_time
    ON messages(conversation_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 8. Webhook Events Log (Audit & Dead-Letter Queue สำหรับ Retry)
-- -----------------------------------------------------------------------------
CREATE TABLE webhook_events (
    id              BIGSERIAL PRIMARY KEY,
    platform        VARCHAR(32) NOT NULL,
    channel_id      UUID        REFERENCES channels(id) ON DELETE SET NULL,
    event_hash      VARCHAR(64) NOT NULL,
    status          VARCHAR(24) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
    error_message   TEXT,
    payload         JSONB       NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_webhook_events_status ON webhook_events(status, received_at DESC);

-- -----------------------------------------------------------------------------
-- 9. Quick Replies (ข้อความตอบด่วนแยกตามร้านหรือใช้ร่วมกันทั้ง Workspace)
-- -----------------------------------------------------------------------------
CREATE TABLE quick_replies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id      UUID        REFERENCES channels(id) ON DELETE CASCADE, -- NULL = ใช้ได้ทุกร้าน
    shortcut        VARCHAR(40) NOT NULL, -- เช่น '/bank', '/ship'
    title           VARCHAR(100) NOT NULL,
    content_text    TEXT        NOT NULL,
    media_url       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 10. Campaigns, Gift Vouchers (1 code / 1 time) & AI Evidence Submissions
-- -----------------------------------------------------------------------------
CREATE TABLE campaigns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id      UUID         REFERENCES channels(id) ON DELETE SET NULL,
    name            VARCHAR(160) NOT NULL,
    required_rules  TEXT         NOT NULL,
    reply_template  TEXT         NOT NULL,
    min_confidence  INTEGER      NOT NULL DEFAULT 90,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE vouchers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id             UUID         NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    code                    VARCHAR(120) NOT NULL,
    reward_value            VARCHAR(80)  NOT NULL DEFAULT '',
    expires_at              VARCHAR(40)  NOT NULL DEFAULT '',
    status                  VARCHAR(20)  NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'claimed')),
    claimed_by_customer_id  UUID         REFERENCES customers(id) ON DELETE SET NULL,
    claimed_conversation_id UUID         REFERENCES conversations(id) ON DELETE SET NULL,
    claimed_submission_id   UUID,
    claimed_by_agent_id     UUID         REFERENCES agents(id) ON DELETE SET NULL,
    claimed_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, code)
);

CREATE INDEX idx_vouchers_campaign_status ON vouchers(campaign_id, status);

CREATE TABLE campaign_submissions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id           UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    conversation_id       UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    customer_id           UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel_id            UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    image_urls            JSONB       NOT NULL DEFAULT '[]'::jsonb,
    image_hashes          JSONB       NOT NULL DEFAULT '[]'::jsonb,
    extracted_fb_name     VARCHAR(160),
    ai_confidence         INTEGER     NOT NULL DEFAULT 0,
    ai_verdict            VARCHAR(24) NOT NULL CHECK (ai_verdict IN ('pass', 'needs_review', 'fraud')),
    ai_provider           VARCHAR(32) NOT NULL DEFAULT 'gemini',
    ai_summary            TEXT        NOT NULL DEFAULT '',
    ai_checklist          JSONB       NOT NULL DEFAULT '[]'::jsonb,
    fraud_flags           JSONB       NOT NULL DEFAULT '[]'::jsonb,
    status                VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    voucher_id            UUID        REFERENCES vouchers(id) ON DELETE SET NULL,
    voucher_code          VARCHAR(120),
    reviewed_by_agent_id  UUID        REFERENCES agents(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at           TIMESTAMPTZ
);
