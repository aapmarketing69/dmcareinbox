# API Specification — Omnichannel Social Media Chat

Base URL (Production): `https://api.yourdomain.com`  
Base URL (Local Prototype): `http://localhost:3000`

---

## 1. Webhook Endpoints (ขาเข้าจาก LINE & Facebook)

### 1.1 LINE Messaging API Webhook
- **Endpoint:** `POST /webhooks/line/:channelKey` (เช่น `/webhooks/line/a1` ถึง `/webhooks/line/a5`)
- **Headers:**
  - `X-Line-Signature`: `Base64(HMAC-SHA256(rawBody, channel_secret))`
- **Behavior:**
  1. ค้นหา Channel จาก `channelKey`
  2. ถอดรหัส `channel_secret` และตรวจสอบ `X-Line-Signature` ด้วย `timingSafeEqual`
  3. วนลูป `events[]`:
     - อัปเดตหรือสร้าง `customer` (ดึง Profile จาก LINE API ถ้ายังไม่มี)
     - หา/สร้าง `conversation` และบันทึก `replyToken` พร้อมเวลาหมดอายุ (`now + 50s`)
     - บันทึก `message` (เช็ค `platform_message_id` กันข้อความซ้ำ)
     - Broadcast Event `message:created` ผ่าน SSE/WebSocket
  4. ตอบกลับ `200 OK` ทันที (Production แนะนำให้ Enqueue ลง Redis/BullMQ แล้วตอบ `200 OK` ภายใน < 200ms)

### 1.2 Facebook Messenger Webhook Verification
- **Endpoint:** `GET /webhooks/facebook`
- **Query Params:**
  - `hub.mode=subscribe`
  - `hub.verify_token=<FB_VERIFY_TOKEN>`
  - `hub.challenge=<random_string>`
- **Response:** `200 OK` พร้อม body เป็นค่า `hub.challenge` (plain text)

### 1.3 Facebook Messenger Webhook Receiver
- **Endpoint:** `POST /webhooks/facebook`
- **Headers:**
  - `X-Hub-Signature-256`: `sha256=<Hex(HMAC-SHA256(rawBody, FB_APP_SECRET))>`
- **Behavior:**
  1. ตรวจสอบ `X-Hub-Signature-256` ด้วย `FB_APP_SECRET`
  2. วนลูป `entry[]`:
     - ใช้ `entry.id` (Page ID) ค้นหา Channel (`b1–b5`)
     - วนลูป `entry.messaging[]`:
       - ข้าม `is_echo: true` (หรือเก็บเป็น Agent reply จากหน้าเพจ)
       - อัปเดต `last_customer_msg_at` (รีเซ็ตหน้าต่าง 24 ชม.)
       - บันทึก `message` และ Broadcast ผ่าน SSE/WebSocket
  3. ตอบกลับ `200 OK`

---

## 2. Inbox & Channel Management REST API

> ใน Production ทุกเส้นทาง `/api/*` ต้องแนบ `Authorization: Bearer <JWT>` และตรวจสิทธิ์ `agent_channel_permissions`

### 2.1 Channels (ร้านค้าทั้งหมด)
| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/channels` | ดึงรายชื่อร้านค้าทั้งหมด (`a1–a5`, `b1–b5`) พร้อมจำนวนแชทที่ยังไม่อ่าน (`unread_count`) |
| `POST` | `/api/channels` | เพิ่มร้านค้าใหม่ (LINE Channel หรือ Facebook Page) พร้อมเข้ารหัส Token |
| `PATCH` | `/api/channels/:id` | อัปเดตชื่อร้าน, สถานะ active, หรือ Token |

**Example Response (`GET /api/channels`):**
```json
{
  "channels": [
    {
      "id": "ch_line_a1",
      "shop_code": "a1",
      "name": "ร้าน a1 (แฟชั่น)",
      "platform": "line",
      "external_channel_id": "2000000001",
      "webhook_path_key": "a1",
      "webhook_url": "/webhooks/line/a1",
      "is_active": true,
      "unread_count": 2,
      "open_conversations": 1
    }
  ]
}
```

### 2.2 Conversations (ห้องแชท)
| Method | Path | Query Params / Body | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/conversations` | `?platform=line\|facebook&channelId=...&status=open\|resolved&q=...` | ดึงรายการห้องแชท เรียงจากข้อความล่าสุด |
| `GET` | `/api/conversations/:id/messages` | `?limit=50&before=<iso>` | ดึงประวัติข้อความในห้องแชท + ข้อมูลลูกค้าและสถานะ 24h window / replyToken |
| `PATCH` | `/api/conversations/:id` | `{ "status": "resolved", "assigned_agent_id": "agent_1", "tags": ["VIP"] }` | เปลี่ยนสถานะห้องแชท / Assign แอดมิน / ติดแท็ก |
| `POST` | `/api/conversations/:id/read` | — | รีเซ็ต `unread_count = 0` เมื่อแอดมินเปิดอ่าน |

### 2.3 Send Reply (แอดมินส่งข้อความตอบลูกค้า)
- **Endpoint:** `POST /api/conversations/:id/messages`
- **Request Body:**
```json
{
  "text": "สวัสดีครับ สินค้าพร้อมส่งเลยครับ",
  "agentId": "agent_1",
  "messageType": "text"
}
```
- **Platform Routing Logic:**
  - **LINE:**
    1. ถ้ามี `line_reply_token` ที่ยังไม่หมดอายุ -> ยิง `POST https://api.line.me/v2/bot/message/reply` (**ฟรี!**) แล้วล้าง token ทิ้ง
    2. ถ้าไม่มีหรือหมดอายุ -> ยิง `POST https://api.line.me/v2/bot/message/push` (นับโควตา Push)
  - **Facebook:**
    1. ถ้าภายใน 24 ชม. หลัง `last_customer_msg_at` -> ยิง `POST https://graph.facebook.com/v21.0/me/messages` (`messaging_type: "RESPONSE"`)
    2. ถ้าเกิน 24 ชม. แต่ไม่เกิน 7 วัน -> ใช้ `messaging_type: "MESSAGE_TAG"`, `tag: "HUMAN_AGENT"` (ต้องได้รับสิทธิ์จาก Meta)
    3. ถ้าเกิน 7 วัน -> Return `422 Unprocessable Entity` พร้อมแจ้งเตือนใน UI
- **Response (`201 Created`):**
```json
{
  "message": {
    "id": "msg_xxx",
    "conversation_id": "conv_xxx",
    "sender_type": "agent",
    "content_text": "สวัสดีครับ สินค้าพร้อมส่งเลยครับ",
    "delivery_status": "sent",
    "delivery_method": "line_reply",
    "created_at": "2026-11-24T16:10:00.000Z"
  }
}
```

### 2.4 Quick Replies & Simulator (สำหรับทดสอบในเครื่อง)
| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/quick-replies` | ดึงข้อความตอบด่วน |
| `POST` | `/api/simulator/inbound` | จำลองลูกค้าทักเข้ามาในร้านใดก็ได้ (`a1–a5`, `b1–b5`) โดยสร้าง Payload + Signature จริงแล้วยิงผ่าน Webhook pipeline |

---

## 3. Real-time Stream (Server-Sent Events / WebSocket)

- **Endpoint:** `GET /api/events` (`Content-Type: text/event-stream`)
- **Events:**
  - `connected`: ส่งเมื่อเชื่อมต่อสำเร็จ
  - `message:created`: ส่งเมื่อมีข้อความใหม่ทั้งจากลูกค้าและแอดมิน (Payload มีทั้ง `message` และ `conversation` อัปเดตล่าสุด)
  - `conversation:updated`: ส่งเมื่อมีการ Assign แอดมิน, เปลี่ยนสถานะ, หรืออ่านแชทแล้ว
  - `heartbeat`: ส่งทุก 25 วินาทีเพื่อคงการเชื่อมต่อผ่าน Load Balancer/Proxy
