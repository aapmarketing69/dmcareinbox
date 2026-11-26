import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { signLinePayload } from '../src/channels/line.adapter.js';
import { signFacebookPayload } from '../src/channels/facebook.adapter.js';
import { decryptSecret } from '../src/services/crypto.service.js';
import { generateTotpCode, generateQrSvg } from '../src/services/totp.service.js';

let app;
let tmpUploadsDir;
let supervisorCookie = '';

async function loginAs(email, password) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email, password },
  });
  const setCookie = res.headers['Set-Cookie'] || res.headers['set-cookie'] || '';
  const cookiePair = String(setCookie).split(';')[0];
  return { res, cookie: cookiePair };
}

test.before(async () => {
  tmpUploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmcare-uploads-'));
  app = await createApp({
    dbPath: ':memory:',
    uploadsDir: tmpUploadsDir,
    configOverride: {
      isProduction: false,
      databaseUrl: '',
      r2AccountId: '',
      fbVerifyToken: 'test_verify_token',
      fbAppSecret: 'test_fb_secret',
      encryptionKey: 'test_encryption_key',
      liveDeliveryEnabled: false,
      geminiApiKey: '',
    },
  });

  // Wrap app.inject with a helper for authenticated supervisor calls when cookie not explicitly overridden
  const rawInject = app.inject;
  app.rawInject = rawInject;
  const loginRes = await loginAs('may@shop.local', 'admin1234');
  assert.equal(loginRes.res.status, 200);
  supervisorCookie = loginRes.cookie;

  app.inject = (opts) => {
    const hdrs = { ...(opts.headers || {}) };
    if (!('Cookie' in hdrs) && !('cookie' in hdrs) && !opts.unauthenticated) {
      hdrs.Cookie = supervisorCookie;
    }
    return rawInject({ ...opts, headers: hdrs });
  };
});

test.after(async () => {
  await app.close();
  fs.rmSync(tmpUploadsDir, { recursive: true, force: true });
});

test('Auth & Per-Shop RBAC enforce login, HttpOnly cookies, channel isolation, and agent management', async () => {
  // 1. Unauthenticated API request -> 401
  const unauthRes = await app.rawInject({ method: 'GET', url: '/api/channels' });
  assert.equal(unauthRes.status, 401);

  // 2. Wrong password -> 401
  const badLogin = await app.rawInject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'may@shop.local', password: 'wrongpassword' },
  });
  assert.equal(badLogin.status, 401);

  // 3. Regular Agent (ton@shop.local) only sees a1-a3, b1-b3 (6 shops) and cannot access a4 or /api/agents
  const tonLogin = await app.rawInject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'ton@shop.local', password: 'agent1234' },
  });
  assert.equal(tonLogin.status, 200);
  const tonSetCookie = String(tonLogin.headers['Set-Cookie'] || '');
  assert.ok(tonSetCookie.includes('HttpOnly'));
  const tonCookie = tonSetCookie.split(';')[0];

  const tonChannels = (await app.rawInject({
    method: 'GET',
    url: '/api/channels',
    headers: { Cookie: tonCookie },
  })).json();
  assert.equal(tonChannels.channels.length, 6);
  assert.ok(!tonChannels.channels.some((c) => c.shop_code === 'a4'));

  // Blocked from restricted channel a4 (403)
  const tonForbiddenChan = await app.rawInject({
    method: 'GET',
    url: '/api/conversations?channelId=ch_line_a4',
    headers: { Cookie: tonCookie },
  });
  assert.equal(tonForbiddenChan.status, 403);

  // Blocked from manager-only /api/agents (403)
  const tonForbiddenMgr = await app.rawInject({
    method: 'GET',
    url: '/api/agents',
    headers: { Cookie: tonCookie },
  });
  assert.equal(tonForbiddenMgr.status, 403);

  // 4. Supervisor creates a new agent with access to b5 only -> new agent logs in and changes password
  const createAg = await app.inject({
    method: 'POST',
    url: '/api/agents',
    headers: { 'Content-Type': 'application/json' },
    body: {
      displayName: 'แอดมินใหม่',
      email: 'newbie@shop.local',
      password: 'initpassword',
      role: 'agent',
      channelIds: ['ch_fb_b5'],
    },
  });
  assert.equal(createAg.status, 201);

  const newbieLogin = await app.rawInject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'newbie@shop.local', password: 'initpassword' },
  });
  assert.equal(newbieLogin.status, 200);
  const newbieCookie = String(newbieLogin.headers['Set-Cookie']).split(';')[0];

  const newbieChannels = (await app.rawInject({
    method: 'GET',
    url: '/api/channels',
    headers: { Cookie: newbieCookie },
  })).json();
  assert.deepEqual(newbieChannels.channels.map((c) => c.shop_code), ['b5']);

  // Change own password
  const pwChange = await app.rawInject({
    method: 'POST',
    url: '/api/auth/change-password',
    headers: { 'Content-Type': 'application/json', Cookie: newbieCookie },
    body: { currentPassword: 'initpassword', newPassword: 'newpassword99' },
  });
  assert.equal(pwChange.status, 200);

  const reloginNewPw = await app.rawInject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'newbie@shop.local', password: 'newpassword99' },
  });
  assert.equal(reloginNewPw.status, 200);
});

test('GET /api/channels returns all 10 seeded shops (LINE a1-a5 & FB b1-b5)', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/channels' });
  assert.equal(res.status, 200);
  const data = res.json();
  assert.equal(data.channels.length, 10);

  const lineCodes = data.channels.filter((c) => c.platform === 'line').map((c) => c.shop_code).sort();
  const fbCodes = data.channels.filter((c) => c.platform === 'facebook').map((c) => c.shop_code).sort();
  assert.deepEqual(lineCodes, ['a1', 'a2', 'a3', 'a4', 'a5']);
  assert.deepEqual(fbCodes, ['b1', 'b2', 'b3', 'b4', 'b5']);
});

test('LINE webhook enforces X-Line-Signature, deduplicates messages, and switches reply -> push', async () => {
  const payload = {
    destination: '2000000003',
    events: [
      {
        type: 'message',
        replyToken: 'valid_reply_token_a3',
        timestamp: Date.now(),
        source: { type: 'user', userId: 'U_test_customer_a3' },
        message: { id: 'line_unique_msg_999', type: 'text', text: 'ถามราคาสินค้าจากร้าน a3 ครับ' },
      },
    ],
  };
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');

  // 1. Invalid signature -> 401
  const badRes = await app.inject({
    method: 'POST',
    url: '/webhooks/line/a3',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'bad-sig' },
    body: raw,
  });
  assert.equal(badRes.status, 401);

  // 2. Valid signature -> 200
  const sig = signLinePayload(raw, 'mock_line_secret_a3');
  const okRes = await app.inject({
    method: 'POST',
    url: '/webhooks/line/a3',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': sig },
    body: raw,
  });
  assert.equal(okRes.status, 200);
  const okData = okRes.json();
  assert.equal(okData.received, 1);
  assert.equal(okData.results[0].duplicate, false);

  const convId = okData.results[0].conversation.id;
  assert.equal(okData.results[0].conversation.shop_code, 'a3');

  // 3. Duplicate delivery -> idempotent (duplicate: true)
  const dupRes = await app.inject({
    method: 'POST',
    url: '/webhooks/line/a3',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': sig },
    body: raw,
  });
  assert.equal(dupRes.json().results[0].duplicate, true);

  // 4. First agent reply uses FREE line_reply
  const reply1 = await app.inject({
    method: 'POST',
    url: `/api/conversations/${convId}/messages`,
    headers: { 'Content-Type': 'application/json' },
    body: { text: 'สวัสดีครับ ใบละ 990 บาทครับ', agentId: 'agent_1' },
  });
  assert.equal(reply1.status, 201);
  assert.equal(reply1.json().delivery.deliveryMethod, 'line_reply');

  // 5. Second agent reply falls back to line_push (replyToken consumed)
  const reply2 = await app.inject({
    method: 'POST',
    url: `/api/conversations/${convId}/messages`,
    headers: { 'Content-Type': 'application/json' },
    body: { text: 'ส่งฟรี EMS ด้วยนะครับ', agentId: 'agent_1' },
  });
  assert.equal(reply2.status, 201);
  assert.equal(reply2.json().delivery.deliveryMethod, 'line_push');
});

test('Facebook webhook handles verification challenge, signature check, multi-page routing (b4), and 24h/7d rules', async () => {
  // 1. Challenge verification
  const badVerify = await app.inject({
    method: 'GET',
    url: '/webhooks/facebook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345',
  });
  assert.equal(badVerify.status, 403);

  const okVerify = await app.inject({
    method: 'GET',
    url: '/webhooks/facebook?hub.mode=subscribe&hub.verify_token=test_verify_token&hub.challenge=CHALLENGE_OK',
  });
  assert.equal(okVerify.status, 200);
  assert.equal(okVerify.text(), 'CHALLENGE_OK');

  // 2. Signed Page b4 event (with one echo message that should be ignored)
  const payload = {
    object: 'page',
    entry: [
      {
        id: '100000000004', // Page b4
        time: Date.now(),
        messaging: [
          {
            sender: { id: '100000000004' },
            recipient: { id: 'PSID_fb_user_b4' },
            timestamp: Date.now(),
            message: { mid: 'm_echo_1', is_echo: true, text: 'echo ignored' },
          },
          {
            sender: { id: 'PSID_fb_user_b4' },
            recipient: { id: '100000000004' },
            timestamp: Date.now(),
            message: { mid: 'm_fb_b4_001', text: 'ครีมกันแดดเพจ b4 พร้อมส่งไหมคะ' },
          },
        ],
      },
    ],
  };
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');

  const badSigRes = await app.inject({
    method: 'POST',
    url: '/webhooks/facebook',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=invalid' },
    body: raw,
  });
  assert.equal(badSigRes.status, 401);

  const sig = signFacebookPayload(raw, 'test_fb_secret');
  const okRes = await app.inject({
    method: 'POST',
    url: '/webhooks/facebook',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
    body: raw,
  });
  assert.equal(okRes.status, 200);
  const okData = okRes.json();
  assert.equal(okData.received, 1);
  const conv = okData.results[0].conversation;
  assert.equal(conv.shop_code, 'b4');

  // Standard 24h reply
  const replyRes = await app.inject({
    method: 'POST',
    url: `/api/conversations/${conv.id}/messages`,
    headers: { 'Content-Type': 'application/json' },
    body: { text: 'พร้อมส่งค่ะ', agentId: 'agent_2' },
  });
  assert.equal(replyRes.status, 201);
  assert.equal(replyRes.json().delivery.deliveryMethod, 'fb_standard');

  // Seeded conv_4 is >24h old -> should use fb_human_agent
  const humanAgentRes = await app.inject({
    method: 'POST',
    url: '/api/conversations/conv_4/messages',
    headers: { 'Content-Type': 'application/json' },
    body: { text: 'ติดตามผลหลังรับสินค้าครับ', agentId: 'agent_1' },
  });
  assert.equal(humanAgentRes.status, 201);
  assert.equal(humanAgentRes.json().delivery.deliveryMethod, 'fb_human_agent');
});

test('Simulator, Add Channel encryption, and Inbox HTML serving work cleanly', async () => {
  // Simulator
  const simRes = await app.inject({
    method: 'POST',
    url: '/api/simulator/inbound',
    headers: { 'Content-Type': 'application/json' },
    body: {
      channelId: 'ch_line_a5',
      customerName: 'คุณกานต์ ทดสอบ',
      text: 'สั่งโคมไฟร้าน a5 ครับ',
    },
  });
  assert.equal(simRes.status, 201);
  assert.equal(simRes.json().results[0].conversation.shop_code, 'a5');

  // Add new channel a6 and verify access token is encrypted at rest
  const chRes = await app.inject({
    method: 'POST',
    url: '/api/channels',
    headers: { 'Content-Type': 'application/json' },
    body: {
      shopCode: 'a6',
      name: 'ร้าน a6 (ใหม่)',
      platform: 'line',
      externalChannelId: '2000000006',
      accessToken: 'super_secret_token_a6',
      channelSecret: 'super_secret_key_a6',
    },
  });
  assert.equal(chRes.status, 201);
  const created = chRes.json().channel;
  const rawRow = await app.repo.getChannelById(created.id);
  assert.notEqual(rawRow.access_token_enc, 'super_secret_token_a6');
  assert.equal(decryptSecret(rawRow.access_token_enc, 'test_encryption_key'), 'super_secret_token_a6');

  // Static UI
  const uiRes = await app.inject({ method: 'GET', url: '/' });
  assert.equal(uiRes.status, 200);
  assert.ok(uiRes.text().includes('DmCare'));
});

test('Replied conversations move into box=replied and return to box=unreplied when customer replies again', async () => {
  // 1. Simulate inbound message on LINE a4 -> appears in box=unreplied
  const sim1 = await app.inject({
    method: 'POST',
    url: '/api/simulator/inbound',
    headers: { 'Content-Type': 'application/json' },
    body: {
      channelId: 'ch_line_a4',
      externalUserId: 'U_reply_box_flow_01',
      customerName: 'คุณทดสอบกล่องตอบแล้ว',
      text: 'สอบถามลิปสติกร้าน a4 ค่ะ',
    },
  });
  assert.equal(sim1.status, 201);
  const convId = sim1.json().results[0].conversation.id;

  const unrepliedBefore = (await app.inject({ method: 'GET', url: '/api/conversations?box=unreplied' })).json();
  assert.ok(unrepliedBefore.conversations.some((c) => c.id === convId));

  // 2. Admin replies -> conversation moves to box=replied
  const reply = await app.inject({
    method: 'POST',
    url: `/api/conversations/${convId}/messages`,
    headers: { 'Content-Type': 'application/json' },
    body: { text: 'มีพร้อมส่งทุกสีเลยครับ', agentId: 'agent_1' },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.json().conversation.is_replied, true);

  const unrepliedAfter = (await app.inject({ method: 'GET', url: '/api/conversations?box=unreplied' })).json();
  assert.ok(!unrepliedAfter.conversations.some((c) => c.id === convId));

  const repliedAfter = (await app.inject({ method: 'GET', url: '/api/conversations?box=replied' })).json();
  assert.ok(repliedAfter.conversations.some((c) => c.id === convId));

  // 3. Customer sends a follow-up -> conversation returns to box=unreplied automatically
  const sim2 = await app.inject({
    method: 'POST',
    url: '/api/simulator/inbound',
    headers: { 'Content-Type': 'application/json' },
    body: {
      channelId: 'ch_line_a4',
      externalUserId: 'U_reply_box_flow_01',
      text: 'ขอรับสีแดง 2 แท่งค่ะ',
    },
  });
  assert.equal(sim2.status, 201);
  assert.equal(sim2.json().results[0].conversation.is_replied, false);

  const unrepliedReturned = (await app.inject({ method: 'GET', url: '/api/conversations?box=unreplied' })).json();
  assert.ok(unrepliedReturned.conversations.some((c) => c.id === convId));

  // 4. Admin escalates to "ต้องดำเนินการ" (status = pending) -> moves to box=pending and leaves box=unreplied
  const escalateRes = await app.inject({
    method: 'PATCH',
    url: `/api/conversations/${convId}`,
    headers: { 'Content-Type': 'application/json' },
    body: { status: 'pending' },
  });
  assert.equal(escalateRes.status, 200);
  assert.equal(escalateRes.json().conversation.status, 'pending');

  const pendingList = (await app.inject({ method: 'GET', url: '/api/conversations?box=pending' })).json();
  assert.ok(pendingList.conversations.some((c) => c.id === convId));
  assert.equal(pendingList.counts.pending, 1);

  const unrepliedAfterEscalate = (await app.inject({ method: 'GET', url: '/api/conversations?box=unreplied' })).json();
  assert.ok(!unrepliedAfterEscalate.conversations.some((c) => c.id === convId));
});

test('Per-shop Quick Replies, Image Upload/Reply, and Collision Presence APIs work cleanly', async () => {
  // 1. Per-shop Quick Replies filtering (a1 sees global + a1, not b1)
  const qrA1 = (await app.inject({ method: 'GET', url: '/api/quick-replies?channelId=ch_line_a1' })).json();
  assert.ok(qrA1.quickReplies.some((q) => q.shortcut === '/size' && q.channel_id === 'ch_line_a1'));
  assert.ok(qrA1.quickReplies.some((q) => q.shortcut === '/hello' && q.channel_id === null));
  assert.ok(!qrA1.quickReplies.some((q) => q.channel_id === 'ch_fb_b1'));

  const createdQr = await app.inject({
    method: 'POST',
    url: '/api/quick-replies',
    headers: { 'Content-Type': 'application/json' },
    body: {
      channelId: 'ch_line_a1',
      shortcut: 'vip_a1',
      title: 'ส่วนลด VIP a1',
      contentText: 'ลูกค้า VIP ร้าน a1 ลดเพิ่ม 15% ครับ',
      mediaUrl: '/uploads/sample_qr.png',
    },
  });
  assert.equal(createdQr.status, 201);
  const createdQrData = createdQr.json().quickReply;
  assert.equal(createdQrData.shortcut, '/vip_a1');
  assert.equal(createdQrData.media_url, '/uploads/sample_qr.png');

  // Edit Quick Reply (PATCH)
  const updatedQr = await app.inject({
    method: 'PATCH',
    url: `/api/quick-replies/${createdQrData.id}`,
    headers: { 'Content-Type': 'application/json' },
    body: {
      channelId: 'ch_line_a1',
      shortcut: '/vip20',
      title: 'ส่วนลด VIP 20%',
      contentText: 'ลดพิเศษ 20% สำหรับลูกค้า VIP ร้าน a1',
      mediaUrl: null,
    },
  });
  assert.equal(updatedQr.status, 200);
  assert.equal(updatedQr.json().quickReply.shortcut, '/vip20');
  assert.equal(updatedQr.json().quickReply.media_url, null);

  // Delete Quick Reply (DELETE)
  const deletedQr = await app.inject({
    method: 'DELETE',
    url: `/api/quick-replies/${createdQrData.id}`,
  });
  assert.equal(deletedQr.status, 200);
  const afterDeleteList = (await app.inject({ method: 'GET', url: '/api/quick-replies?channelId=ch_line_a1' })).json();
  assert.ok(!afterDeleteList.quickReplies.some((q) => q.id === createdQrData.id));

  // 2. Image Upload (1x1 transparent PNG) + Serving + Send Image Message
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const badUpload = await app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { 'Content-Type': 'application/json' },
    body: { dataUrl: `data:text/plain;base64,${tinyPngBase64}` },
  });
  assert.equal(badUpload.status, 400);

  const okUpload = await app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { 'Content-Type': 'application/json' },
    body: { dataUrl: `data:image/png;base64,${tinyPngBase64}` },
  });
  assert.equal(okUpload.status, 201);
  const uploadData = okUpload.json();
  assert.ok(uploadData.url.startsWith('/uploads/img_'));

  const fetchedImg = await app.inject({ method: 'GET', url: uploadData.url });
  assert.equal(fetchedImg.status, 200);
  assert.equal(fetchedImg.headers['Content-Type'], 'image/png');

  const imgReply = await app.inject({
    method: 'POST',
    url: '/api/conversations/conv_1/messages',
    headers: { 'Content-Type': 'application/json' },
    body: { text: 'ส่งรูปสินค้าครับ', agentId: 'agent_1', messageType: 'image', mediaUrl: uploadData.url },
  });
  assert.equal(imgReply.status, 201);
  const imgReplyData = imgReply.json();
  assert.equal(imgReplyData.messages.length, 2);
  assert.equal(imgReplyData.messages[0].message_type, 'image');
  assert.equal(imgReplyData.messages[0].media_url, uploadData.url);
  assert.equal(imgReplyData.messages[0].content_text, '');
  assert.equal(imgReplyData.messages[1].message_type, 'text');
  assert.equal(imgReplyData.messages[1].content_text, 'ส่งรูปสินค้าครับ');
  assert.equal(imgReplyData.messages[1].media_url, null);

  // 3. Collision Detection / Presence
  const p1 = await app.inject({
    method: 'POST',
    url: '/api/presence',
    headers: { 'Content-Type': 'application/json' },
    body: { clientId: 'tab_a', agentId: 'agent_1', conversationId: 'conv_2', isTyping: true },
  });
  assert.equal(p1.status, 200);
  assert.equal(p1.json().presence.conv_2.length, 1);
  assert.equal(p1.json().presence.conv_2[0].isTyping, true);

  const p2 = await app.inject({
    method: 'POST',
    url: '/api/presence',
    headers: { 'Content-Type': 'application/json' },
    body: { clientId: 'tab_a', agentId: 'agent_1', conversationId: null, isTyping: false },
  });
  assert.equal(p2.status, 200);
  assert.equal(p2.json().presence.conv_2, undefined);
});

test('Campaign .xls Import/Export, Multi-image AI >=90% gate, Anti-Fraud duplicate image, and Atomic 1-code/1-time claim', async () => {
  // 1. Download sample .xls and import it into default campaign
  const sampleRes = await app.inject({ method: 'GET', url: '/api/campaigns/sample-vouchers.xls' });
  assert.equal(sampleRes.status, 200);
  assert.ok(sampleRes.text().includes('<Workbook'));

  const campId = 'camp_like_share_1212';
  const importRes = await app.inject({
    method: 'POST',
    url: `/api/campaigns/${campId}/vouchers/import`,
    headers: { 'Content-Type': 'application/json' },
    body: {
      filename: 'sample-gift-vouchers.xls',
      fileBase64: Buffer.from(sampleRes.text(), 'utf8').toString('base64'),
    },
  });
  assert.equal(importRes.status, 201);
  assert.equal(importRes.json().format, 'xls-xml');
  assert.equal(importRes.json().inserted, 10);

  // Re-importing same .xls skips all duplicates
  const dupImportRes = await app.inject({
    method: 'POST',
    url: `/api/campaigns/${campId}/vouchers/import`,
    headers: { 'Content-Type': 'application/json' },
    body: {
      filename: 'sample-gift-vouchers.xls',
      fileBase64: Buffer.from(sampleRes.text(), 'utf8').toString('base64'),
    },
  });
  assert.equal(dupImportRes.json().inserted, 0);
  assert.equal(dupImportRes.json().skipped, 10);

  // 2. Upload 2 distinct PNG evidence images for Customer A
  const pngA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const pngB = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const up1 = (await app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { 'Content-Type': 'application/json' },
    body: { dataUrl: `data:image/png;base64,${pngA}` },
  })).json();
  const up2 = (await app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { 'Content-Type': 'application/json' },
    body: { dataUrl: `data:image/png;base64,${pngB}` },
  })).json();

  // Customer A sends both evidence images bundled together on FB b1
  const simA = await app.inject({
    method: 'POST',
    url: '/api/simulator/inbound',
    headers: { 'Content-Type': 'application/json' },
    body: {
      channelId: 'ch_fb_b1',
      externalUserId: 'PSID_voucher_cust_A',
      customerName: 'คุณเอ ร่วมกิจกรรม',
      text: 'ส่งหลักฐานครบ 2 รูปแล้วครับ',
      mediaUrls: [up1.url, up2.url],
    },
  });
  assert.equal(simA.status, 201);
  const convAId = simA.json().results[0].conversation.id;

  // 3. Verifying only 1 image yields <90% (needs_review) and blocks approve
  const lowVerify = await app.inject({
    method: 'POST',
    url: `/api/conversations/${convAId}/verify-evidence`,
    headers: { 'Content-Type': 'application/json' },
    body: { campaignId: campId, imageUrls: [up1.url] },
  });
  assert.equal(lowVerify.status, 201);
  assert.equal(lowVerify.json().submission.ai_verdict, 'needs_review');
  assert.ok(lowVerify.json().submission.ai_confidence < 90);

  const blockedApprove = await app.inject({
    method: 'POST',
    url: `/api/submissions/${lowVerify.json().submission.id}/approve`,
    headers: { 'Content-Type': 'application/json' },
    body: { agentId: 'agent_1' },
  });
  assert.equal(blockedApprove.status, 422);

  // 4. Verifying both images together yields >=90% pass -> Admin approves -> 1 code / 1 time issued!
  const passVerify = await app.inject({
    method: 'POST',
    url: `/api/conversations/${convAId}/verify-evidence`,
    headers: { 'Content-Type': 'application/json' },
    body: { campaignId: campId, imageUrls: [up1.url, up2.url] },
  });
  assert.equal(passVerify.status, 201);
  assert.equal(passVerify.json().submission.ai_verdict, 'pass');
  assert.ok(passVerify.json().submission.ai_confidence >= 90);

  const approveA = await app.inject({
    method: 'POST',
    url: `/api/submissions/${passVerify.json().submission.id}/approve`,
    headers: { 'Content-Type': 'application/json' },
    body: { agentId: 'agent_1' },
  });
  assert.equal(approveA.status, 200);
  const issuedCode = approveA.json().voucher.code;
  assert.ok(issuedCode.startsWith('GV1212-'));

  // Re-approving same submission is blocked (409)
  const doubleApprove = await app.inject({
    method: 'POST',
    url: `/api/submissions/${passVerify.json().submission.id}/approve`,
    headers: { 'Content-Type': 'application/json' },
    body: { agentId: 'agent_1' },
  });
  assert.equal(doubleApprove.status, 409);

  // 5. Fraud test: Customer B reuses Customer A's exact evidence image -> flagged as FRAUD and blocked!
  const simB = await app.inject({
    method: 'POST',
    url: '/api/simulator/inbound',
    headers: { 'Content-Type': 'application/json' },
    body: {
      channelId: 'ch_line_a2',
      externalUserId: 'U_voucher_cust_B',
      customerName: 'คุณบี ส่งรูปซ้ำ',
      text: 'ขอรับโค้ดด้วยครับ',
      mediaUrls: [up1.url, up2.url],
    },
  });
  const convBId = simB.json().results[0].conversation.id;

  const fraudVerify = await app.inject({
    method: 'POST',
    url: `/api/conversations/${convBId}/verify-evidence`,
    headers: { 'Content-Type': 'application/json' },
    body: { campaignId: campId, imageUrls: [up1.url, up2.url] },
  });
  assert.equal(fraudVerify.status, 201);
  assert.equal(fraudVerify.json().submission.ai_verdict, 'fraud');
  assert.ok(fraudVerify.json().submission.fraud_flags.some((f) => f.code === 'DUPLICATE_IMAGE'));

  const blockedFraudApprove = await app.inject({
    method: 'POST',
    url: `/api/submissions/${fraudVerify.json().submission.id}/approve`,
    headers: { 'Content-Type': 'application/json' },
    body: { agentId: 'agent_1' },
  });
  assert.equal(blockedFraudApprove.status, 422);

  // 6. Export .xls report includes the issued code and customer name
  const exportRes = await app.inject({
    method: 'GET',
    url: `/api/campaigns/${campId}/vouchers/export.xls`,
  });
  assert.equal(exportRes.status, 200);
  assert.ok(exportRes.text().includes(issuedCode));
  assert.ok(exportRes.text().includes('คุณเอ ร่วมกิจกรรม'));
});

test('Live Mode: LINE Content API download, FB media mirror, Profile fetch, and PUBLIC_BASE_URL outbound check', async () => {
  const samplePngBuf = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const outboundCalls = [];

  const mockFetch = async (url, opts = {}) => {
    const u = String(url);
    // LINE Profile API
    if (u.startsWith('https://api.line.me/v2/bot/profile/')) {
      return new Response(JSON.stringify({ displayName: 'คุณลูกค้าตัวจริง LINE', pictureUrl: 'https://profile.line/pic.jpg' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // LINE Content API (binary image)
    if (u.startsWith('https://api-data.line.me/v2/bot/message/')) {
      return new Response(samplePngBuf, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }
    // Facebook Graph Profile API
    if (u.startsWith('https://graph.facebook.com/v21.0/PSID_live_fb_01')) {
      return new Response(JSON.stringify({ name: 'Nida RealFB', profile_pic: 'https://fb.pic/nida.jpg' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Facebook CDN image mirror
    if (u === 'https://scontent.fbcdn.net/proof.png') {
      return new Response(samplePngBuf, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }
    // Outbound LINE / FB send calls
    outboundCalls.push({ url: u, body: JSON.parse(opts.body || '{}') });
    return new Response(JSON.stringify({ sentMessages: [{ id: 'live_out_1' }], message_id: 'live_fb_out_1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const liveTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmcare-live-'));
  const liveApp = await createApp({
    dbPath: ':memory:',
    uploadsDir: liveTmpDir,
    fetchImpl: mockFetch,
    configOverride: {
      isProduction: false,
      databaseUrl: '',
      r2AccountId: '',
      fbVerifyToken: 'live_verify',
      fbAppSecret: 'live_fb_secret',
      encryptionKey: 'live_enc_key',
      liveDeliveryEnabled: true,
      publicBaseUrl: 'https://chat.myshop.example',
      geminiApiKey: '',
    },
  });

  try {
    // Login as supervisor
    const loginRes = await liveApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'may@shop.local', password: 'admin1234' },
    });
    const cookie = String(loginRes.headers['Set-Cookie']).split(';')[0];

    // Configure real (non-mock) credentials on LINE a1 and FB b1 via PATCH /api/channels/:id
    await liveApp.inject({
      method: 'PATCH',
      url: '/api/channels/ch_line_a1',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: { accessToken: 'real_line_token_a1', channelSecret: 'real_line_secret_a1' },
    });
    await liveApp.inject({
      method: 'PATCH',
      url: '/api/channels/ch_fb_b1',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: { accessToken: 'real_fb_token_b1' },
    });

    // 1. Live LINE inbound image -> fetches real profile + downloads binary image to /uploads/
    const lineBody = {
      destination: '2000000001',
      events: [
        {
          type: 'message',
          replyToken: 'live_reply_tok_1',
          timestamp: Date.now(),
          source: { type: 'user', userId: 'U_live_line_01' },
          message: { id: '555111222', type: 'image' },
        },
      ],
    };
    const rawLine = Buffer.from(JSON.stringify(lineBody), 'utf8');
    const lineRes = await liveApp.inject({
      method: 'POST',
      url: '/webhooks/line/a1',
      headers: {
        'Content-Type': 'application/json',
        'X-Line-Signature': signLinePayload(rawLine, 'real_line_secret_a1'),
      },
      body: rawLine,
    });
    assert.equal(lineRes.status, 200);
    const lineResult = lineRes.json().results[0];
    assert.equal(lineResult.conversation.customer_name, 'คุณลูกค้าตัวจริง LINE');
    assert.ok(lineResult.message.media_url.startsWith('/uploads/img_'));

    // 2. Live Facebook inbound image -> fetches real FB profile + mirrors CDN image to /uploads/
    const fbBody = {
      object: 'page',
      entry: [
        {
          id: '100000000001',
          time: Date.now(),
          messaging: [
            {
              sender: { id: 'PSID_live_fb_01' },
              recipient: { id: '100000000001' },
              timestamp: Date.now(),
              message: {
                mid: 'm_live_fb_img_1',
                attachments: [{ type: 'image', payload: { url: 'https://scontent.fbcdn.net/proof.png' } }],
              },
            },
          ],
        },
      ],
    };
    const rawFb = Buffer.from(JSON.stringify(fbBody), 'utf8');
    const fbRes = await liveApp.inject({
      method: 'POST',
      url: '/webhooks/facebook',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signFacebookPayload(rawFb, 'live_fb_secret'),
      },
      body: rawFb,
    });
    assert.equal(fbRes.status, 200);
    const fbResult = fbRes.json().results[0];
    assert.equal(fbResult.conversation.customer_name, 'Nida RealFB');
    assert.ok(fbResult.message.media_url.startsWith('/uploads/img_'));

    // 3. Outbound image reply converts /uploads/... -> https://chat.myshop.example/uploads/...
    const outRes = await liveApp.inject({
      method: 'POST',
      url: `/api/conversations/${lineResult.conversation.id}/messages`,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: { text: 'ได้รับรูปแล้วครับ', messageType: 'image', mediaUrl: lineResult.message.media_url },
    });
    assert.equal(outRes.status, 201);
    assert.equal(outboundCalls.length, 1);
    assert.equal(
      outboundCalls[0].body.messages[0].originalContentUrl,
      `https://chat.myshop.example${lineResult.message.media_url}`
    );
  } finally {
    await liveApp.close();
    fs.rmSync(liveTmpDir, { recursive: true, force: true });
  }
});

test('Cloudflare R2 SigV4 upload & remote HTTPS image fingerprint anti-fraud detection work cleanly', async () => {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const r2Store = new Map();
  const putRequests = [];

  const mockR2Fetch = async (url, opts = {}) => {
    const u = String(url);
    if (opts.method === 'PUT' && u.startsWith('https://acc123.r2.cloudflarestorage.com/dmcare-media/')) {
      putRequests.push({ url: u, headers: opts.headers, body: opts.body });
      const key = u.replace('https://acc123.r2.cloudflarestorage.com/dmcare-media/', '');
      r2Store.set(`https://media.dmcare.app/${key}`, {
        body: Buffer.from(opts.body),
        contentType: opts.headers['Content-Type'],
      });
      return new Response('', { status: 200 });
    }
    if (r2Store.has(u)) {
      const obj = r2Store.get(u);
      return new Response(obj.body, { status: 200, headers: { 'Content-Type': obj.contentType } });
    }
    return new Response('Not Found', { status: 404 });
  };

  const r2App = await createApp({
    dbPath: ':memory:',
    fetchImpl: mockR2Fetch,
    configOverride: {
      isProduction: false,
      databaseUrl: '',
      encryptionKey: 'r2_test_key',
      geminiApiKey: '',
      r2AccountId: 'acc123',
      r2AccessKeyId: 'AKIA_TEST_KEY',
      r2SecretAccessKey: 'SECRET_TEST_KEY',
      r2Bucket: 'dmcare-media',
      r2PublicUrl: 'https://media.dmcare.app',
    },
  });

  try {
    const health = (await r2App.inject({ method: 'GET', url: '/health' })).json();
    assert.equal(health.storageProvider, 'cloudflare-r2');
    assert.equal(health.brandName, 'DmCare');

    const loginRes = await r2App.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'may@shop.local', password: 'admin1234' },
    });
    const cookie = String(loginRes.headers['Set-Cookie']).split(';')[0];

    const up = await r2App.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: { dataUrl: `data:image/png;base64,${pngBytes.toString('base64')}` },
    });
    assert.equal(up.status, 201);
    const upData = up.json();
    assert.equal(upData.storage, 'cloudflare-r2');
    assert.ok(upData.url.startsWith('https://media.dmcare.app/uploads/img_'));
    assert.equal(putRequests.length, 1);
    assert.ok(String(putRequests[0].headers.Authorization).startsWith('AWS4-HMAC-SHA256 Credential=AKIA_TEST_KEY/'));

    // Verify remote R2 image fingerprint works for Anti-Fraud duplicate detection across two customers
    const sim1 = (await r2App.inject({
      method: 'POST',
      url: '/api/simulator/inbound',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: {
        channelId: 'ch_line_a1',
        externalUserId: 'U_r2_cust_1',
        customerName: 'ลูกค้า R2 คนที่ 1',
        mediaUrls: [upData.url],
      },
    })).json();
    const conv1Id = sim1.results[0].conversation.id;

    const v1 = await r2App.inject({
      method: 'POST',
      url: `/api/conversations/${conv1Id}/verify-evidence`,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: { campaignId: 'camp_like_share_1212', imageUrls: [upData.url], manualFallback: true },
    });
    assert.equal(v1.status, 201);
    assert.equal(v1.json().submission.fraud_flags.length, 0);

    // Upload identical PNG bytes again (different R2 filename/URL, same SHA-256 content) for Customer 2
    const up2 = (await r2App.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: { dataUrl: `data:image/png;base64,${pngBytes.toString('base64')}` },
    })).json();
    assert.notEqual(up2.url, upData.url);

    const sim2 = (await r2App.inject({
      method: 'POST',
      url: '/api/simulator/inbound',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: {
        channelId: 'ch_fb_b1',
        externalUserId: 'PSID_r2_cust_2',
        customerName: 'ลูกค้า R2 คนที่ 2',
        mediaUrls: [up2.url],
      },
    })).json();
    const conv2Id = sim2.results[0].conversation.id;

    const v2 = await r2App.inject({
      method: 'POST',
      url: `/api/conversations/${conv2Id}/verify-evidence`,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: { campaignId: 'camp_like_share_1212', imageUrls: [up2.url], manualFallback: true },
    });
    assert.equal(v2.status, 201);
    assert.equal(v2.json().submission.ai_verdict, 'fraud');
    assert.ok(v2.json().submission.fraud_flags.some((f) => f.code === 'DUPLICATE_IMAGE'));
  } finally {
    await r2App.close();
  }
});

test('Production Guardrails disable Simulator, seed clean custom Owner account, and support Supervisor Manual Override', async () => {
  const prodTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmcare-prod-'));
  const prodApp = await createApp({
    dbPath: ':memory:',
    uploadsDir: prodTmpDir,
    configOverride: {
      isProduction: true,
      brandName: 'DmCare',
      databaseUrl: '',
      r2AccountId: '',
      encryptionKey: 'prod_enc_key_123456',
      adminEmail: 'owner@dmcare.app',
      adminPassword: 'StrongProdPassword99',
      adminName: 'เจ้าของร้าน DmCare',
      liveDeliveryEnabled: false,
      geminiApiKey: '',
    },
  });

  try {
    // 1. /api/auth/me exposes isProduction=true & brandName='DmCare'
    const meBefore = (await prodApp.inject({ method: 'GET', url: '/api/auth/me' })).json();
    assert.equal(meBefore.isProduction, true);
    assert.equal(meBefore.brandName, 'DmCare');

    // 2. Demo accounts do not exist in fresh production seed
    const demoFail = await prodApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'ton@shop.local', password: 'agent1234' },
    });
    assert.equal(demoFail.status, 401);

    // 3. Custom Owner account works and sets dmcare_session cookie
    const ownerLogin = await prodApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'owner@dmcare.app', password: 'StrongProdPassword99' },
    });
    assert.equal(ownerLogin.status, 200);
    const setCookie = String(ownerLogin.headers['Set-Cookie'] || '');
    assert.ok(setCookie.startsWith('dmcare_session='));
    const cookie = setCookie.split(';')[0];

    // 4. Simulator route is blocked (403) in Production
    const simBlocked = await prodApp.inject({
      method: 'POST',
      url: '/api/simulator/inbound',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: { channelId: 'ch_line_a1', text: 'test' },
    });
    assert.equal(simBlocked.status, 403);

    // 5. Real signed LINE webhook still works in Production + Supervisor Manual Fallback & Override
    const linePayload = {
      destination: '2000000001',
      events: [
        {
          type: 'message',
          replyToken: 'prod_reply_tok_1',
          timestamp: Date.now(),
          source: { type: 'user', userId: 'U_prod_customer_1' },
          message: {
            id: 'prod_line_img_1',
            type: 'image',
            contentProvider: { type: 'external', originalContentUrl: 'https://example.com/prod-proof.png' },
          },
        },
      ],
    };
    const rawLine = Buffer.from(JSON.stringify(linePayload), 'utf8');
    const whRes = await prodApp.inject({
      method: 'POST',
      url: '/webhooks/line/a1',
      headers: {
        'Content-Type': 'application/json',
        'X-Line-Signature': signLinePayload(rawLine, 'mock_line_secret_a1'),
      },
      body: rawLine,
    });
    assert.equal(whRes.status, 200);
    const convId = whRes.json().results[0].conversation.id;

    // Supervisor creates manual fallback submission and approves with allowOverride=true
    const manualSub = await prodApp.inject({
      method: 'POST',
      url: `/api/conversations/${convId}/verify-evidence`,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: {
        campaignId: 'camp_like_share_1212',
        imageUrls: ['https://example.com/prod-proof.png'],
        manualFallback: true,
      },
    });
    assert.equal(manualSub.status, 201);
    assert.equal(manualSub.json().submission.ai_provider, 'manual-supervisor');

    const manualApprove = await prodApp.inject({
      method: 'POST',
      url: `/api/submissions/${manualSub.json().submission.id}/approve`,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: { allowOverride: true },
    });
    assert.equal(manualApprove.status, 200);
    assert.ok(manualApprove.json().voucher.code.startsWith('GV1212-'));
  } finally {
    await prodApp.close();
    fs.rmSync(prodTmpDir, { recursive: true, force: true });
  }
});

test('PostgreSQL repository executes schema init, parameterized $1 queries, and FOR UPDATE SKIP LOCKED atomic voucher claim', async () => {
  const { initPgDb, createPgRepository } = await import('../src/db/postgres.js');
  const executedQueries = [];

  const mockQuery = async (sql, params = []) => {
    const cleanSql = sql.replace(/\s+/g, ' ').trim();
    executedQueries.push({ sql: cleanSql, params });

    if (cleanSql.startsWith('SELECT COUNT(*)::int AS cnt FROM channels')) {
      return { rows: [{ cnt: 1 }], rowCount: 1 };
    }
    if (cleanSql.startsWith("SELECT value FROM app_meta WHERE key = 'campaign_seeded'")) {
      return { rows: [{ value: '1' }], rowCount: 1 };
    }
    if (cleanSql.includes('FROM campaign_submissions s') && cleanSql.includes('FOR UPDATE OF s')) {
      return {
        rows: [
          {
            id: 'sub_pg_1',
            campaign_id: 'camp_1',
            conversation_id: 'conv_pg_1',
            customer_id: 'cust_pg_1',
            channel_id: 'ch_line_a1',
            status: 'pending',
            ai_verdict: 'pass',
            ai_confidence: 96,
            min_confidence: 90,
            fraud_flags: '[]',
            reply_template: 'Code: {{code}}',
          },
        ],
        rowCount: 1,
      };
    }
    if (cleanSql.includes('FROM vouchers') && cleanSql.includes('claimed_by_customer_id = $2')) {
      return { rows: [], rowCount: 0 };
    }
    if (cleanSql.includes('FOR UPDATE SKIP LOCKED')) {
      return {
        rows: [{ id: 'vch_pg_1', code: 'DMCARE-PG-001', reward_value: '100 บาท', expires_at: '2026-12-31' }],
        rowCount: 1,
      };
    }
    if (cleanSql.startsWith("UPDATE vouchers SET status = 'claimed'")) {
      return { rows: [], rowCount: 1 };
    }
    if (cleanSql.startsWith('SELECT tags FROM customers WHERE id = $1')) {
      return { rows: [{ tags: '["VIP"]' }], rowCount: 1 };
    }
    if (cleanSql.includes('FROM campaign_submissions s') && cleanSql.includes('WHERE s.id = $1')) {
      return {
        rows: [
          {
            id: 'sub_pg_1',
            campaign_id: 'camp_1',
            campaign_name: 'Campaign 1',
            min_confidence: 90,
            conversation_id: 'conv_pg_1',
            customer_id: 'cust_pg_1',
            channel_id: 'ch_line_a1',
            image_urls: '[]',
            image_hashes: '[]',
            ai_confidence: 96,
            ai_verdict: 'pass',
            ai_provider: 'gemini',
            ai_summary: 'ok',
            ai_checklist: '[]',
            fraud_flags: '[]',
            status: 'approved',
            voucher_id: 'vch_pg_1',
            voucher_code: 'DMCARE-PG-001',
            created_at: new Date().toISOString(),
          },
        ],
        rowCount: 1,
      };
    }
    if (cleanSql.startsWith('DELETE FROM webhook_events WHERE received_at < $1')) {
      return { rows: [], rowCount: 42 };
    }
    return { rows: [], rowCount: 0 };
  };

  let released = false;
  const mockPool = {
    query: mockQuery,
    connect: async () => ({
      query: mockQuery,
      release: () => {
        released = true;
      },
    }),
  };

  await initPgDb(mockPool, { encryptionKey: 'pg_test_key', isProduction: true });
  assert.ok(executedQueries.some((q) => q.sql.includes('CREATE TABLE IF NOT EXISTS conversations')));

  const pgRepo = createPgRepository(mockPool, 'pg_test_key');
  const claimed = await pgRepo.claimVoucherAtomic({ submissionId: 'sub_pg_1', agentId: 'agent_1' });
  assert.equal(claimed.voucher.code, 'DMCARE-PG-001');
  assert.equal(released, true);
  assert.ok(executedQueries.some((q) => q.sql === 'BEGIN'));
  assert.ok(executedQueries.some((q) => q.sql.includes('FOR UPDATE SKIP LOCKED')));
  assert.ok(executedQueries.some((q) => q.sql === 'COMMIT'));

  const cleaned = await pgRepo.cleanupOldWebhookEvents(14);
  assert.equal(cleaned, 42);
});

test('v1.1 Add, Pause/Resume, and Delete Channel work cleanly', async () => {
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/channels',
    headers: { 'Content-Type': 'application/json' },
    body: {
      shopCode: 'temp99',
      name: 'ร้านชั่วคราว temp99',
      platform: 'line',
      externalChannelId: '2999999999',
      accessToken: 'mock_line_token_temp99',
      channelSecret: 'mock_line_secret_temp99',
    },
  });
  assert.equal(createRes.status, 201);
  const chId = createRes.json().channel.id;

  // Pause channel
  const pauseRes = await app.inject({
    method: 'PATCH',
    url: `/api/channels/${chId}`,
    headers: { 'Content-Type': 'application/json' },
    body: { isActive: false },
  });
  assert.equal(pauseRes.status, 200);
  assert.equal(pauseRes.json().channel.is_active, false);

  // Delete channel
  const delRes = await app.inject({
    method: 'DELETE',
    url: `/api/channels/${chId}`,
  });
  assert.equal(delRes.status, 200);
  assert.equal(delRes.json().deleted, true);

  const listAfter = (await app.inject({ method: 'GET', url: '/api/channels' })).json();
  assert.ok(!listAfter.channels.some((c) => c.id === chId));
});

test('v1.1 Multi-Tenant 3-Tier SaaS Isolation, Quotas, AI Subscription Gate, Suspension, and Dashboards', async () => {
  // 1. Tier 1 Super Admin creates a clean Starter client workspace (max 2 channels, max 2 agents, AI OFF)
  const wsRes = await app.inject({
    method: 'POST',
    url: '/api/admin/workspaces',
    headers: { 'Content-Type': 'application/json' },
    body: {
      name: 'ร้านแฟชั่นคุณแนน',
      planCode: 'starter',
      maxChannels: 2,
      maxAgents: 2,
      aiEnabled: false,
      ownerName: 'คุณแนน (Owner)',
      ownerEmail: 'nan@client-a.local',
      ownerPassword: 'ownerpassword123',
    },
  });
  assert.equal(wsRes.status, 201);
  const clientWsId = wsRes.json().workspace.id;
  assert.equal(wsRes.json().workspace.ai_enabled, false);
  assert.equal(wsRes.json().owner.role, 'owner');

  // 2. Tier 2 Client Owner logs in with 1-time initial password -> MUST change password first!
  const ownerLogin = await app.rawInject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'nan@client-a.local', password: 'ownerpassword123' },
  });
  assert.equal(ownerLogin.status, 200);
  assert.equal(ownerLogin.json().user.must_change_password, true);
  const ownerCookie = String(ownerLogin.headers['Set-Cookie']).split(';')[0];

  // Blocked from workspace APIs until 1-time password is changed (403 MUST_CHANGE_PASSWORD)
  const blockedBeforeChange = await app.rawInject({
    method: 'GET',
    url: '/api/channels',
    headers: { Cookie: ownerCookie },
  });
  assert.equal(blockedBeforeChange.status, 403);
  assert.equal(blockedBeforeChange.json().code, 'MUST_CHANGE_PASSWORD');

  // Owner changes password to their private password -> unlocks workspace!
  const firstPwChange = await app.rawInject({
    method: 'POST',
    url: '/api/auth/change-password',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: { currentPassword: 'ownerpassword123', newPassword: 'MyPrivateOwnerPass99!' },
  });
  assert.equal(firstPwChange.status, 200);
  assert.equal(firstPwChange.json().user.must_change_password, false);

  const ownerChannels0 = (await app.rawInject({
    method: 'GET',
    url: '/api/channels',
    headers: { Cookie: ownerCookie },
  })).json();
  assert.equal(ownerChannels0.channels.length, 0);

  const ownerForbiddenAdmin = await app.rawInject({
    method: 'GET',
    url: '/api/admin/overview',
    headers: { Cookie: ownerCookie },
  });
  assert.equal(ownerForbiddenAdmin.status, 403);

  // 3. Client Owner adds 2 shops (s1, s2) -> 3rd shop blocked by maxChannels=2 quota!
  const ch1Res = await app.rawInject({
    method: 'POST',
    url: '/api/channels',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: {
      shopCode: 'a1', // Same shopCode as ws_default -> must get unique webhook_path_key without collision!
      name: 'ร้านแนน LINE 1',
      platform: 'line',
      externalChannelId: '3000000001',
      channelSecret: 'client_secret_1',
    },
  });
  assert.equal(ch1Res.status, 201);
  const ch1 = ch1Res.json().channel;
  assert.notEqual(ch1.webhook_path_key, 'a1'); // Auto-disambiguated!

  const ch2Res = await app.rawInject({
    method: 'POST',
    url: '/api/channels',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: {
      shopCode: 'fb1',
      name: 'เพจแนน FB 1',
      platform: 'facebook',
      externalChannelId: '4000000001',
    },
  });
  assert.equal(ch2Res.status, 201);

  const ch3QuotaBlocked = await app.rawInject({
    method: 'POST',
    url: '/api/channels',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: {
      shopCode: 'fb2',
      name: 'เพจแนน FB 2',
      platform: 'facebook',
      externalChannelId: '4000000002',
    },
  });
  assert.equal(ch3QuotaBlocked.status, 403);

  // 4. Client Owner creates 1 Agent (total 2/2 agents) -> 2nd agent blocked by maxAgents=2 quota!
  const staffRes = await app.rawInject({
    method: 'POST',
    url: '/api/agents',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: {
      displayName: 'น้องพลอย (Agent)',
      email: 'ploy@client-a.local',
      password: 'staffpassword123',
      role: 'agent',
      channelIds: [ch1.id],
    },
  });
  assert.equal(staffRes.status, 201);

  const extraStaffBlocked = await app.rawInject({
    method: 'POST',
    url: '/api/agents',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: {
      displayName: 'คนที่เกินโควตา',
      email: 'extra@client-a.local',
      password: 'staffpassword123',
      role: 'agent',
      channelIds: [ch1.id],
    },
  });
  assert.equal(extraStaffBlocked.status, 403);

  // 5. Tier 3 Agent logs in -> sees ONLY ch1, blocked from Dashboard (403) & Delete Channel (403)
  const staffLogin = await app.rawInject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'ploy@client-a.local', password: 'staffpassword123' },
  });
  assert.equal(staffLogin.status, 200);
  const staffCookie = String(staffLogin.headers['Set-Cookie']).split(';')[0];

  const staffChs = (await app.rawInject({
    method: 'GET',
    url: '/api/channels',
    headers: { Cookie: staffCookie },
  })).json();
  assert.deepEqual(staffChs.channels.map((c) => c.id), [ch1.id]);

  const staffNoDash = await app.rawInject({
    method: 'GET',
    url: '/api/dashboard',
    headers: { Cookie: staffCookie },
  });
  assert.equal(staffNoDash.status, 403);

  const staffNoDel = await app.rawInject({
    method: 'DELETE',
    url: `/api/channels/${ch1.id}`,
    headers: { Cookie: staffCookie },
  });
  assert.equal(staffNoDel.status, 403);

  // 6. Simulate inbound chat + Agent reply in Client Workspace -> test AI Pro Subscription Gate & Tier 2 Dashboard
  const simClient = await app.rawInject({
    method: 'POST',
    url: '/api/simulator/inbound',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: {
      channelId: ch1.id,
      customerName: 'ลูกค้าคุณแนน',
      text: 'ส่งหลักฐานค่ะ',
      mediaUrls: ['https://example.com/a.png', 'https://example.com/b.png'],
    },
  });
  assert.equal(simClient.status, 201);
  const clientConvId = simClient.json().results[0].conversation.id;

  // Agent replies (generates line_reply count for Dashboard)
  const replyRes = await app.rawInject({
    method: 'POST',
    url: `/api/conversations/${clientConvId}/messages`,
    headers: { 'Content-Type': 'application/json', Cookie: staffCookie },
    body: { text: 'รับทราบค่ะ' },
  });
  assert.equal(replyRes.status, 201);

  // AI verify blocked while aiEnabled=false (403)
  const clientCamps = (await app.rawInject({
    method: 'GET',
    url: '/api/campaigns',
    headers: { Cookie: ownerCookie },
  })).json().campaigns;
  assert.equal(clientCamps.length, 1);

  const aiBlocked = await app.rawInject({
    method: 'POST',
    url: `/api/conversations/${clientConvId}/verify-evidence`,
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: { campaignId: clientCamps[0].id },
  });
  assert.equal(aiBlocked.status, 403);

  // Super Admin enables AI Pro -> AI verify now succeeds (201)
  const upgradeWs = await app.inject({
    method: 'PATCH',
    url: `/api/admin/workspaces/${clientWsId}`,
    headers: { 'Content-Type': 'application/json' },
    body: { planCode: 'pro', aiEnabled: true },
  });
  assert.equal(upgradeWs.status, 200);
  assert.equal(upgradeWs.json().workspace.ai_enabled, true);

  const aiPassed = await app.rawInject({
    method: 'POST',
    url: `/api/conversations/${clientConvId}/verify-evidence`,
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: { campaignId: clientCamps[0].id },
  });
  assert.equal(aiPassed.status, 201);

  // 7. Tier 2 Owner Dashboard returns accurate LINE Reply quota & Agent KPI
  const ownerDashRes = await app.rawInject({
    method: 'GET',
    url: '/api/dashboard?range=30d',
    headers: { Cookie: ownerCookie },
  });
  assert.equal(ownerDashRes.status, 200);
  const dash = ownerDashRes.json();
  assert.equal(dash.workspace.id, clientWsId);
  assert.equal(dash.channels.length, 2);
  const lineStat = dash.channels.find((c) => c.id === ch1.id);
  assert.equal(lineStat.line_reply_month, 1);
  assert.equal(lineStat.line_reply_quota, 25000);
  assert.ok(dash.agents.some((a) => a.email === 'ploy@client-a.local' && a.messages_sent === 1));

  // 8. Tier 1 Super Admin Overview sees all workspaces & suspending client blocks Owner login (403)
  const adminOverview = (await app.inject({ method: 'GET', url: '/api/admin/overview' })).json();
  assert.ok(adminOverview.summary.totalWorkspaces >= 2);

  const suspendRes = await app.inject({
    method: 'PATCH',
    url: `/api/admin/workspaces/${clientWsId}`,
    headers: { 'Content-Type': 'application/json' },
    body: { isActive: false },
  });
  assert.equal(suspendRes.status, 200);

  const suspendedLogin = await app.rawInject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'nan@client-a.local', password: 'MyPrivateOwnerPass99!' },
  });
  assert.equal(suspendedLogin.status, 403);

  // 9. Super Admin quick-renews (+30d), saves contactNotes, resets Owner password (1-time), and deletes workspace (2-step confirm)
  const renewRes = await app.inject({
    method: 'PATCH',
    url: `/api/admin/workspaces/${clientWsId}`,
    headers: { 'Content-Type': 'application/json' },
    body: { extendDays: 30, contactNotes: 'คุณแนน 081-000-0000' },
  });
  assert.equal(renewRes.status, 200);
  assert.equal(renewRes.json().workspace.is_active, true);
  assert.equal(renewRes.json().workspace.contact_notes, 'คุณแนน 081-000-0000');
  assert.ok(renewRes.json().workspace.expires_at);

  const resetRes = await app.inject({
    method: 'POST',
    url: `/api/admin/workspaces/${clientWsId}/reset-owner-password`,
    headers: { 'Content-Type': 'application/json' },
    body: {},
  });
  assert.equal(resetRes.status, 200);
  const tempPw = resetRes.json().tempPassword;
  assert.ok(tempPw && tempPw.length >= 8);

  const resetLogin = await app.rawInject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'nan@client-a.local', password: tempPw },
  });
  assert.equal(resetLogin.status, 200);
  assert.equal(resetLogin.json().user.must_change_password, true);

  // Delete workspace requires exact confirmName match
  const badDel = await app.inject({
    method: 'DELETE',
    url: `/api/admin/workspaces/${clientWsId}`,
    headers: { 'Content-Type': 'application/json' },
    body: { confirmName: 'wrong name' },
  });
  assert.equal(badDel.status, 400);

  const okDel = await app.inject({
    method: 'DELETE',
    url: `/api/admin/workspaces/${clientWsId}`,
    headers: { 'Content-Type': 'application/json' },
    body: { confirmName: 'ร้านแฟชั่นคุณแนน' },
  });
  assert.equal(okDel.status, 200);
  assert.equal(okDel.json().deleted, true);

  // Default workspace cannot be deleted
  const delDefault = await app.inject({
    method: 'DELETE',
    url: '/api/admin/workspaces/ws_default',
    headers: { 'Content-Type': 'application/json' },
    body: { confirmName: 'DmCare Main' },
  });
  assert.equal(delDefault.status, 400);
});

test('Read Receipts track FB message_reads watermark, LINE customer follow-up read, and Admin read-by attribution', async () => {
  // 1. Facebook inbound -> Admin replies (status = 'sent') -> FB read watermark webhook updates to 'read'
  const simFb = await app.inject({
    method: 'POST',
    url: '/api/simulator/inbound',
    headers: { 'Content-Type': 'application/json' },
    body: {
      channelId: 'ch_fb_b2',
      externalUserId: 'PSID_read_receipt_01',
      customerName: 'คุณอ่านแล้ว FB',
      text: 'สอบถามรองเท้าครับ',
    },
  });
  assert.equal(simFb.status, 201);
  const fbConvId = simFb.json().results[0].conversation.id;

  // Admin opens and marks conversation read -> records last_read_by_agent_name & last_read_at
  const readRes = await app.inject({
    method: 'POST',
    url: `/api/conversations/${fbConvId}/read`,
  });
  assert.equal(readRes.status, 200);
  assert.equal(readRes.json().conversation.unread_count, 0);
  assert.equal(readRes.json().conversation.last_read_by_agent_name, 'แอดมินเมย์');
  assert.ok(readRes.json().conversation.last_read_at);

  // Admin replies -> starts as delivery_status = 'sent'
  const fbReply = await app.inject({
    method: 'POST',
    url: `/api/conversations/${fbConvId}/messages`,
    headers: { 'Content-Type': 'application/json' },
    body: { text: 'มีไซซ์ 42 พร้อมส่งครับ' },
  });
  assert.equal(fbReply.status, 201);
  assert.equal(fbReply.json().message.delivery_status, 'sent');

  // Customer reads message on Facebook -> Meta sends read.watermark webhook
  const readPayload = {
    object: 'page',
    entry: [
      {
        id: '100000000002', // Page b2
        time: Date.now() + 5000,
        messaging: [
          {
            sender: { id: 'PSID_read_receipt_01' },
            recipient: { id: '100000000002' },
            timestamp: Date.now() + 5000,
            read: { watermark: Date.now() + 5000 },
          },
        ],
      },
    ],
  };
  const rawRead = Buffer.from(JSON.stringify(readPayload), 'utf8');
  const fbReadRes = await app.inject({
    method: 'POST',
    url: '/webhooks/facebook',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signFacebookPayload(rawRead, 'test_fb_secret'),
    },
    body: rawRead,
  });
  assert.equal(fbReadRes.status, 200);
  assert.equal(fbReadRes.json().readUpdates, 1);

  const msgsAfterFbRead = (await app.inject({
    method: 'GET',
    url: `/api/conversations/${fbConvId}/messages`,
  })).json().messages;
  const agentMsg = msgsAfterFbRead.find((m) => m.sender_type === 'agent');
  assert.equal(agentMsg.delivery_status, 'read');

  // 2. LINE: customer replies back after agent message -> marks prior agent message as 'read'
  const simLine1 = await app.inject({
    method: 'POST',
    url: '/api/simulator/inbound',
    headers: { 'Content-Type': 'application/json' },
    body: {
      channelId: 'ch_line_a2',
      externalUserId: 'U_line_read_01',
      customerName: 'คุณอ่านแล้ว LINE',
      text: 'ถามราคาครับ',
    },
  });
  const lineConvId = simLine1.json().results[0].conversation.id;

  await app.inject({
    method: 'POST',
    url: `/api/conversations/${lineConvId}/messages`,
    headers: { 'Content-Type': 'application/json' },
    body: { text: 'คู่ละ 1,290 บาทครับ' },
  });

  // Customer replies back -> prior agent message becomes 'read'
  await app.inject({
    method: 'POST',
    url: '/api/simulator/inbound',
    headers: { 'Content-Type': 'application/json' },
    body: {
      channelId: 'ch_line_a2',
      externalUserId: 'U_line_read_01',
      text: 'โอเคครับ สั่ง 1 คู่',
    },
  });

  const lineMsgs = (await app.inject({
    method: 'GET',
    url: `/api/conversations/${lineConvId}/messages`,
  })).json().messages;
  const lineAgentMsg = lineMsgs.find((m) => m.sender_type === 'agent');
  assert.equal(lineAgentMsg.delivery_status, 'read');

  // 3. Mark conversation as "ไม่ต้องตอบ / อ่านแล้ว" (isReplied=true) without sending a reply
  const markNoReply = await app.inject({
    method: 'PATCH',
    url: `/api/conversations/${lineConvId}`,
    headers: { 'Content-Type': 'application/json' },
    body: { isReplied: true },
  });
  assert.equal(markNoReply.status, 200);
  assert.equal(markNoReply.json().conversation.is_replied, true);
  assert.equal(markNoReply.json().conversation.unread_count, 0);

  // 4. Outbound LINE official sticker reply stores sticker mediaUrl & messageType='sticker'
  const stickerReply = await app.inject({
    method: 'POST',
    url: `/api/conversations/${lineConvId}/messages`,
    headers: { 'Content-Type': 'application/json' },
    body: { messageType: 'sticker', stickerPackageId: '11537', stickerId: '52002736' },
  });
  assert.equal(stickerReply.status, 201);
  assert.equal(stickerReply.json().message.message_type, 'sticker');
  assert.ok(stickerReply.json().message.media_url.includes('52002736'));

  // 5. Inbound Facebook sticker (with sticker_id) & Workspace Custom Sticker CRUD + FB outbound sticker
  const fbStickerPayload = {
    object: 'page',
    entry: [
      {
        id: '100000000002',
        time: Date.now() + 8000,
        messaging: [
          {
            sender: { id: 'PSID_read_receipt_01' },
            recipient: { id: '100000000002' },
            timestamp: Date.now() + 8000,
            message: {
              mid: 'm_fb_sticker_01',
              attachments: [
                {
                  type: 'image',
                  payload: { url: 'https://scontent.fbcdn.net/like-thumb.png', sticker_id: 369239263222822 },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const rawFbStk = Buffer.from(JSON.stringify(fbStickerPayload), 'utf8');
  const fbStkIn = await app.inject({
    method: 'POST',
    url: '/webhooks/facebook',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signFacebookPayload(rawFbStk, 'test_fb_secret'),
    },
    body: rawFbStk,
  });
  assert.equal(fbStkIn.status, 200);
  assert.equal(fbStkIn.json().results[0].message.message_type, 'sticker');

  const createStk = await app.inject({
    method: 'POST',
    url: '/api/stickers',
    headers: { 'Content-Type': 'application/json' },
    body: { label: 'โลโก้ร้าน', mediaUrl: '/uploads/shop_sticker.png' },
  });
  assert.equal(createStk.status, 201);
  const stkId = createStk.json().sticker.id;

  const fbStkOut = await app.inject({
    method: 'POST',
    url: `/api/conversations/${fbConvId}/messages`,
    headers: { 'Content-Type': 'application/json' },
    body: { messageType: 'sticker', mediaUrl: '/uploads/shop_sticker.png' },
  });
  assert.equal(fbStkOut.status, 201);
  assert.equal(fbStkOut.json().message.message_type, 'sticker');

  const delStk = await app.inject({ method: 'DELETE', url: `/api/stickers/${stkId}` });
  assert.equal(delStk.status, 200);
});

test('v1.1 TOTP 2FA (RFC 6238, offline QR SVG, 2-step login, 1-time recovery codes, Manager unlock) & Customer Rename', async () => {
  // 1. Verify official RFC 6238 SHA-1 test vector ("12345678901234567890" -> Base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(generateTotpCode(rfcSecret, { timestampMs: 59 * 1000, digits: 8 }), '94287082');
  assert.equal(generateTotpCode(rfcSecret, { timestampMs: 59 * 1000, digits: 6 }), '287082');

  // 2. Verify offline QR SVG generator builds crisp SVG with finder pattern & dimensions
  const sampleSvg = generateQrSvg('otpauth://totp/DmCare:owner%40dmcare.app?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=DmCare');
  assert.ok(sampleSvg.startsWith('<svg '));
  assert.ok(sampleSvg.includes('viewBox="0 0 '));
  assert.ok(sampleSvg.endsWith('</svg>'));

  // 3. Setup & enable 2FA on agent_2 (ton@shop.local)
  const { cookie: tonCookie } = await loginAs('ton@shop.local', 'agent1234');
  const setupRes = await app.inject({
    method: 'POST',
    url: '/api/auth/2fa/setup',
    headers: { Cookie: tonCookie },
  });
  assert.equal(setupRes.status, 200);
  const setup = setupRes.json();
  assert.ok(setup.setupToken);
  assert.ok(setup.secret && setup.secret.length >= 16);
  assert.ok(setup.qrSvg.startsWith('<svg '));

  // Wrong code must fail
  const badEnable = await app.inject({
    method: 'POST',
    url: '/api/auth/2fa/enable',
    headers: { 'Content-Type': 'application/json', Cookie: tonCookie },
    body: { setupToken: setup.setupToken, currentPassword: 'agent1234', code: '000000' },
  });
  assert.equal(badEnable.status, 400);

  // Valid TOTP code enables 2FA and returns 8 one-time recovery codes
  const validCode = generateTotpCode(setup.secret);
  const okEnable = await app.inject({
    method: 'POST',
    url: '/api/auth/2fa/enable',
    headers: { 'Content-Type': 'application/json', Cookie: tonCookie },
    body: { setupToken: setup.setupToken, currentPassword: 'agent1234', code: validCode },
  });
  assert.equal(okEnable.status, 200);
  const enabledData = okEnable.json();
  assert.equal(enabledData.user.totp_enabled, true);
  assert.equal(enabledData.recoveryCodes.length, 8);

  // 4. Next login must require 2FA and NOT set session cookie yet
  const step1 = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'ton@shop.local', password: 'agent1234' },
  });
  assert.equal(step1.status, 200);
  assert.equal(step1.json().requiresTotp, true);
  assert.ok(step1.json().challengeToken);
  assert.equal(step1.headers['Set-Cookie'], undefined);

  // Bad 2FA code rejected
  const badStep2 = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-2fa',
    headers: { 'Content-Type': 'application/json' },
    body: { challengeToken: step1.json().challengeToken, code: '999999' },
  });
  assert.equal(badStep2.status, 401);

  // Valid 6-digit TOTP code succeeds and sets dmcare_session cookie
  const okStep2 = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-2fa',
    headers: { 'Content-Type': 'application/json' },
    body: { challengeToken: step1.json().challengeToken, code: generateTotpCode(setup.secret) },
  });
  assert.equal(okStep2.status, 200);
  assert.equal(okStep2.json().authenticated, true);
  assert.ok(String(okStep2.headers['Set-Cookie'] || '').startsWith('dmcare_session='));

  // 5. Recovery code works ONCE and cannot be reused
  const recCode = enabledData.recoveryCodes[0];
  const recLogin1 = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-2fa',
    headers: { 'Content-Type': 'application/json' },
    body: { challengeToken: step1.json().challengeToken, code: recCode },
  });
  assert.equal(recLogin1.status, 200);
  assert.equal(recLogin1.json().usedRecoveryCode, true);
  assert.equal(recLogin1.json().remainingRecoveryCodes, 7);

  const recLoginReplay = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-2fa',
    headers: { 'Content-Type': 'application/json' },
    body: { challengeToken: step1.json().challengeToken, code: recCode },
  });
  assert.equal(recLoginReplay.status, 401);

  // 6. Manager can unlock (reset) a team member's 2FA via PATCH /api/agents/:id
  const unlockRes = await app.inject({
    method: 'PATCH',
    url: '/api/agents/agent_2',
    headers: { 'Content-Type': 'application/json' },
    body: { resetTotp: true },
  });
  assert.equal(unlockRes.status, 200);
  assert.equal(unlockRes.json().agent.totp_enabled, false);

  // 7. Customer inline rename persists via PATCH /api/conversations/:id
  const convList = (await app.inject({ method: 'GET', url: '/api/conversations?box=all' })).json().conversations;
  const targetConv = convList[0];
  const renameRes = await app.inject({
    method: 'PATCH',
    url: `/api/conversations/${targetConv.id}`,
    headers: { 'Content-Type': 'application/json' },
    body: { customerName: 'คุณลูกค้า VIP (แก้ไขชื่อแล้ว)' },
  });
  assert.equal(renameRes.status, 200);
  assert.equal(renameRes.json().conversation.customer_name, 'คุณลูกค้า VIP (แก้ไขชื่อแล้ว)');
});
