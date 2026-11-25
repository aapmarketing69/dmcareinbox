import crypto from 'node:crypto';
import { timingSafeEqualStr } from '../services/crypto.service.js';

export function signFacebookPayload(rawBodyBuffer, appSecret) {
  const digest = crypto.createHmac('sha256', appSecret).update(rawBodyBuffer).digest('hex');
  return `sha256=${digest}`;
}

export function verifyFacebookSignature(rawBodyBuffer, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;
  const expected = signFacebookPayload(rawBodyBuffer, appSecret);
  return timingSafeEqualStr(signatureHeader, expected);
}

/**
 * Normalizes Facebook Page Messenger webhook events into internal message payloads.
 * Supports multiple pages (b1-b5) via entry.id (Page ID).
 */
export function parseFacebookWebhookEvents(payload) {
  if (payload?.object !== 'page') return [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const normalized = [];

  for (const entry of entries) {
    const pageId = String(entry.id || '');
    const messagingList = Array.isArray(entry.messaging) ? entry.messaging : [];

    for (const ev of messagingList) {
      if (!ev.message || ev.message.is_echo || !ev.sender?.id) continue;

      const msg = ev.message;
      let messageType = 'text';
      let contentText = msg.text || '';
      let mediaUrl = null;

      if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
        const firstAtt = msg.attachments[0];
        messageType = firstAtt.type || 'file';
        mediaUrl = firstAtt.payload?.url || null;
        if (!contentText) {
          contentText = messageType === 'image' ? '[รูปภาพจากลูกค้า]' : `[ไฟล์แนบ: ${messageType}]`;
        }
      }

      const timestampMs = ev.timestamp || Date.now();
      normalized.push({
        platform: 'facebook',
        externalChannelId: pageId,
        externalUserId: String(ev.sender.id),
        displayName: ev.mockSenderName || null,
        platformMessageId: msg.mid || `fb_${timestampMs}_${Math.random().toString(36).slice(2, 7)}`,
        messageType,
        contentText,
        mediaUrl,
        timestampIso: new Date(timestampMs).toISOString(),
        raw: ev,
      });
    }
  }

  return normalized;
}

/**
 * Fetches real customer name & avatar from Facebook Graph API.
 */
export async function fetchFacebookUserProfile({ accessToken, psid, fetchImpl = fetch }) {
  if (!accessToken || accessToken.startsWith('mock_') || !psid) return null;
  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(psid)}?fields=first_name,last_name,name,profile_pic&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const displayName =
      data.name ||
      [data.first_name, data.last_name].filter(Boolean).join(' ').trim() ||
      null;
    return {
      displayName,
      avatarUrl: data.profile_pic || null,
    };
  } catch {
    return null;
  }
}

/**
 * Mirrors an expiring Facebook attachment image URL into local uploads storage
 * so it never expires, can be hashed for Anti-Fraud, and can be read by Gemini Vision.
 */
export async function downloadFacebookMedia({ url, uploadService, fetchImpl = fetch }) {
  if (!url || !String(url).startsWith('https://') || !uploadService) return null;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const arrayBuf = await res.arrayBuffer();
    const saved = await uploadService.saveBinaryImage({
      buffer: Buffer.from(arrayBuf),
      mimeType: contentType,
    });
    return saved.url;
  } catch {
    return null;
  }
}

/**
 * Sends a message to a Facebook Messenger user (PSID) enforcing Meta's 24h & 7d Human Agent policies.
 */
export async function sendFacebookMessage({
  accessToken,
  recipientId,
  text,
  messageType = 'text',
  mediaUrl = null,
  lastCustomerMsgAt,
  liveDeliveryEnabled,
  fetchImpl = fetch,
}) {
  const now = Date.now();
  const hoursSince = lastCustomerMsgAt ? (now - Date.parse(lastCustomerMsgAt)) / 3_600_000 : 0;

  let deliveryMethod = 'fb_standard';
  const messagePayload = messageType === 'image' && mediaUrl
    ? { attachment: { type: 'image', payload: { url: mediaUrl, is_reusable: true } } }
    : { text };

  const payload = {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: messagePayload,
  };

  if (hoursSince > 168) {
    const err = new Error('ไม่สามารถส่งข้อความ Facebook ได้ เนื่องจากลูกค้าไม่ได้ทักมาเกิน 7 วัน (เกินสิทธิ์ Human Agent Window)');
    err.statusCode = 422;
    throw err;
  } else if (hoursSince > 24) {
    deliveryMethod = 'fb_human_agent';
    payload.messaging_type = 'MESSAGE_TAG';
    payload.tag = 'HUMAN_AGENT';
  }

  const isMockToken = !accessToken || accessToken.startsWith('mock_');
  if (!liveDeliveryEnabled || isMockToken) {
    return {
      ok: true,
      simulated: true,
      deliveryMethod,
      platformMessageId: `sim_fb_out_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    };
  }

  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Facebook Send API error (${res.status}): ${errText}`);
  }

  const data = await res.json().catch(() => ({}));
  return {
    ok: true,
    simulated: false,
    deliveryMethod,
    platformMessageId: data?.message_id || `fb_out_${Date.now()}`,
  };
}
