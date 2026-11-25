import crypto from 'node:crypto';
import { timingSafeEqualStr } from '../services/crypto.service.js';

export function signLinePayload(rawBodyBuffer, channelSecret) {
  return crypto.createHmac('sha256', channelSecret).update(rawBodyBuffer).digest('base64');
}

export function verifyLineSignature(rawBodyBuffer, signatureHeader, channelSecret) {
  if (!signatureHeader || !channelSecret) return false;
  const expected = signLinePayload(rawBodyBuffer, channelSecret);
  return timingSafeEqualStr(signatureHeader, expected);
}

/**
 * Normalizes LINE Messaging API webhook events into internal message payloads.
 */
export function parseLineWebhookEvents(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const normalized = [];

  for (const ev of events) {
    if (ev.type !== 'message' || !ev.source?.userId) continue;

    const msg = ev.message || {};
    let messageType = msg.type || 'text';
    let contentText = '';

    if (messageType === 'text') {
      contentText = msg.text || '';
    } else if (messageType === 'image') {
      contentText = '[รูปภาพจากลูกค้า]';
    } else if (messageType === 'sticker') {
      contentText = `[สติกเกอร์ #${msg.stickerId || ''}]`;
    } else if (messageType === 'file') {
      contentText = `[ไฟล์แนบ: ${msg.fileName || 'document'}]`;
    } else {
      contentText = `[ข้อความประเภท ${messageType}]`;
    }

    const timestampMs = ev.timestamp || Date.now();
    // LINE replyToken expires quickly (~30-60s); treat as valid for 50s safely
    const replyToken = ev.replyToken || null;
    const replyExpiresAt = replyToken ? new Date(Date.now() + 50_000).toISOString() : null;

    normalized.push({
      platform: 'line',
      externalUserId: ev.source.userId,
      displayName: ev.mockSenderName || null,
      platformMessageId: msg.id || `line_${timestampMs}_${Math.random().toString(36).slice(2, 7)}`,
      messageType,
      contentText,
      mediaUrl: msg.contentProvider?.originalContentUrl || null,
      replyToken,
      replyExpiresAt,
      timestampIso: new Date(timestampMs).toISOString(),
      raw: ev,
    });
  }

  return normalized;
}

/**
 * Fetches real customer display name & avatar from LINE Profile API.
 */
export async function fetchLineUserProfile({ accessToken, externalUserId, fetchImpl = fetch }) {
  if (!accessToken || accessToken.startsWith('mock_') || !externalUserId) return null;
  try {
    const res = await fetchImpl(
      `https://api.line.me/v2/bot/profile/${encodeURIComponent(externalUserId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      displayName: data.displayName || null,
      avatarUrl: data.pictureUrl || null,
    };
  } catch {
    return null;
  }
}

/**
 * Downloads real binary image content sent by a LINE user via LINE Content API
 * and saves it into local uploads storage so UI, Anti-Fraud hashing, and Gemini Vision can read it.
 */
export async function downloadLineMessageContent({ accessToken, messageId, uploadService, fetchImpl = fetch }) {
  if (!accessToken || accessToken.startsWith('mock_') || !messageId || !uploadService) return null;
  try {
    const res = await fetchImpl(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      }
    );
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
 * Sends a message to a LINE user.
 * Automatically prefers Reply API (FREE) when a valid replyToken is available,
 * and falls back to Push API (counted against LINE OA quota) otherwise.
 */
export async function sendLineMessage({
  accessToken,
  externalUserId,
  replyToken,
  replyExpiresAt,
  text,
  messageType = 'text',
  mediaUrl = null,
  liveDeliveryEnabled,
  fetchImpl = fetch,
}) {
  const canUseReply = Boolean(
    replyToken && replyExpiresAt && Date.parse(replyExpiresAt) > Date.now()
  );
  const deliveryMethod = canUseReply ? 'line_reply' : 'line_push';
  const isMockToken = !accessToken || accessToken.startsWith('mock_');

  if (!liveDeliveryEnabled || isMockToken) {
    return {
      ok: true,
      simulated: true,
      deliveryMethod,
      usedReplyToken: canUseReply,
      platformMessageId: `sim_line_out_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    };
  }

  const endpoint = canUseReply
    ? 'https://api.line.me/v2/bot/message/reply'
    : 'https://api.line.me/v2/bot/message/push';

  const messages = [];
  if (messageType === 'image' && mediaUrl) {
    messages.push({
      type: 'image',
      originalContentUrl: mediaUrl,
      previewImageUrl: mediaUrl,
    });
  }
  if (text) {
    messages.push({ type: 'text', text });
  }

  const body = canUseReply
    ? { replyToken, messages }
    : { to: externalUserId, messages };

  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    // If replyToken unexpectedly expired on LINE's side, automatically retry via Push API
    if (canUseReply && res.status === 400) {
      return sendLineMessage({
        accessToken,
        externalUserId,
        replyToken: null,
        replyExpiresAt: null,
        text,
        messageType,
        mediaUrl,
        liveDeliveryEnabled,
        fetchImpl,
      });
    }
    throw new Error(`LINE API error (${res.status}): ${errText}`);
  }

  const data = await res.json().catch(() => ({}));
  return {
    ok: true,
    simulated: false,
    deliveryMethod,
    usedReplyToken: canUseReply,
    platformMessageId: data?.sentMessages?.[0]?.id || `line_out_${Date.now()}`,
  };
}
