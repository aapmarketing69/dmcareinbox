import { decryptSecret } from './crypto.service.js';
import {
  downloadLineMessageContent,
  fetchLineUserProfile,
  parseLineWebhookEvents,
  sendLineMessage,
  signLinePayload,
  verifyLineSignature,
} from '../channels/line.adapter.js';
import {
  downloadFacebookMedia,
  fetchFacebookUserProfile,
  parseFacebookWebhookEvents,
  sendFacebookMessage,
  signFacebookPayload,
  verifyFacebookSignature,
} from '../channels/facebook.adapter.js';

export function resolveOutboundMediaUrl(mediaUrl, { publicBaseUrl, isLiveRealToken }) {
  if (!mediaUrl) return null;
  if (/^https:\/\//i.test(mediaUrl)) return mediaUrl;
  if (mediaUrl.startsWith('/')) {
    if (publicBaseUrl && /^https:\/\//i.test(publicBaseUrl)) {
      return `${publicBaseUrl.replace(/\/+$/, '')}${mediaUrl}`;
    }
    if (isLiveRealToken) {
      const err = new Error(
        'กรุณาตั้งค่า PUBLIC_BASE_URL=https://... (เช่น ลิงก์ Cloudflare Tunnel) ในไฟล์ .env ก่อนส่งรูปภาพออกไป LINE/Facebook จริง'
      );
      err.statusCode = 400;
      throw err;
    }
  }
  return mediaUrl;
}

export function createChatService({ repo, sseHub, config, uploadService = null, fetchImpl = fetch }) {
  async function ingestNormalizedEvent(channel, event) {
    // Idempotency check: prevent duplicate webhook deliveries from creating duplicate messages
    const existingMsg = await repo.findMessageByPlatformId(channel.id, event.platformMessageId);
    if (existingMsg) {
      return { duplicate: true, message: existingMsg };
    }

    const accessToken = decryptSecret(channel.access_token_enc, config.encryptionKey);
    const isLiveRealToken = Boolean(config.liveDeliveryEnabled && accessToken && !accessToken.startsWith('mock_'));

    // 1. Fetch real customer profile (displayName & avatarUrl) on first contact when live
    let displayName = event.displayName || null;
    let avatarUrl = null;
    const existingCustomer = await repo.findCustomer(channel.id, event.externalUserId);
    const needsProfile = !existingCustomer || existingCustomer.display_name.startsWith('ลูกค้า ');

    if (isLiveRealToken && needsProfile && !displayName) {
      const profile = channel.platform === 'line'
        ? await fetchLineUserProfile({ accessToken, externalUserId: event.externalUserId, fetchImpl })
        : await fetchFacebookUserProfile({ accessToken, psid: event.externalUserId, fetchImpl });
      if (profile) {
        displayName = profile.displayName || displayName;
        avatarUrl = profile.avatarUrl || null;
      }
    }

    // 2. Download real inbound media (LINE Content API / Facebook expiring CDN URL) into uploads / R2
    let resolvedMediaUrl = event.mediaUrl || null;
    if (isLiveRealToken && uploadService && event.messageType === 'image') {
      if (channel.platform === 'line' && (!resolvedMediaUrl || (!resolvedMediaUrl.startsWith('/uploads/') && !resolvedMediaUrl.startsWith('https://')))) {
        const storedUrl = await downloadLineMessageContent({
          accessToken,
          messageId: event.platformMessageId,
          uploadService,
          fetchImpl,
        });
        if (storedUrl) resolvedMediaUrl = storedUrl;
      } else if (channel.platform === 'facebook' && resolvedMediaUrl && resolvedMediaUrl.startsWith('https://')) {
        const storedUrl = await downloadFacebookMedia({
          url: resolvedMediaUrl,
          uploadService,
          fetchImpl,
        });
        if (storedUrl) resolvedMediaUrl = storedUrl;
      }
    }

    const customer = await repo.upsertCustomer({
      channelId: channel.id,
      externalUserId: event.externalUserId,
      displayName,
      avatarUrl,
    });

    const conversation = await repo.findOrCreateConversation({
      channelId: channel.id,
      customerId: customer.id,
      preview: event.contentText,
      timestampIso: event.timestampIso,
      replyToken: event.replyToken,
      replyExpiresAt: event.replyExpiresAt,
    });

    const message = await repo.insertMessage({
      conversationId: conversation.id,
      channelId: channel.id,
      platformMessageId: event.platformMessageId,
      senderType: 'customer',
      messageType: event.messageType,
      contentText: event.contentText,
      mediaUrl: resolvedMediaUrl,
      deliveryStatus: 'delivered',
      deliveryMethod: `${channel.platform}_webhook`,
      rawPayload: event.raw,
      createdAt: event.timestampIso,
    });

    const payload = {
      message,
      conversation,
      channels: await repo.listChannelsWithStats(),
    };
    sseHub.broadcast('message:created', payload);

    return { duplicate: false, message, conversation };
  }

  return {
    async handleLineWebhook({ channelKey, rawBody, signature, parsedBody }) {
      const channel = await repo.getChannelByWebhookKey('line', channelKey);
      if (!channel) {
        const err = new Error(`LINE channel not found for key: ${channelKey}`);
        err.statusCode = 404;
        throw err;
      }

      const secret = decryptSecret(channel.channel_secret_enc, config.encryptionKey);
      if (!verifyLineSignature(rawBody, signature, secret)) {
        await repo.logWebhookEvent({
          platform: 'line',
          channelId: channel.id,
          status: 'failed',
          errorMessage: 'Invalid X-Line-Signature',
          payload: parsedBody,
        });
        const err = new Error('Invalid X-Line-Signature');
        err.statusCode = 401;
        throw err;
      }

      const events = parseLineWebhookEvents(parsedBody);
      const results = [];
      for (const ev of events) {
        results.push(await ingestNormalizedEvent(channel, ev));
      }

      await repo.logWebhookEvent({
        platform: 'line',
        channelId: channel.id,
        status: 'processed',
        payload: parsedBody,
      });

      return { received: events.length, results };
    },

    async handleFacebookWebhook({ rawBody, signature, parsedBody }) {
      if (!verifyFacebookSignature(rawBody, signature, config.fbAppSecret)) {
        await repo.logWebhookEvent({
          platform: 'facebook',
          status: 'failed',
          errorMessage: 'Invalid X-Hub-Signature-256',
          payload: parsedBody,
        });
        const err = new Error('Invalid X-Hub-Signature-256');
        err.statusCode = 401;
        throw err;
      }

      const events = parseFacebookWebhookEvents(parsedBody);
      const results = [];

      for (const ev of events) {
        const channel = await repo.getChannelByExternalId('facebook', ev.externalChannelId);
        if (!channel) {
          await repo.logWebhookEvent({
            platform: 'facebook',
            status: 'failed',
            errorMessage: `Unknown Facebook Page ID: ${ev.externalChannelId}`,
            payload: ev.raw,
          });
          continue;
        }
        results.push(await ingestNormalizedEvent(channel, ev));
      }

      await repo.logWebhookEvent({
        platform: 'facebook',
        status: 'processed',
        payload: parsedBody,
      });

      return { received: events.length, results };
    },

    async sendAgentReply({ conversationId, text = '', agentId = 'agent_1', messageType = 'text', mediaUrl = null }) {
      const cleanText = String(text || '').trim();
      const hasMedia = Boolean(mediaUrl);
      if (!cleanText && !hasMedia) {
        const err = new Error('Message text or image is required');
        err.statusCode = 400;
        throw err;
      }

      const conv = await repo.getConversationSummaryById(conversationId);
      if (!conv) {
        const err = new Error('Conversation not found');
        err.statusCode = 404;
        throw err;
      }

      const channel = await repo.getChannelById(conv.channel_id);
      const accessToken = decryptSecret(channel.access_token_enc, config.encryptionKey);
      const isLiveRealToken = Boolean(config.liveDeliveryEnabled && accessToken && !accessToken.startsWith('mock_'));
      const outboundMediaUrl = resolveOutboundMediaUrl(mediaUrl, {
        publicBaseUrl: config.publicBaseUrl,
        isLiveRealToken,
      });

      const baseMs = Date.now();
      const savedMessages = [];
      let deliveryResult;

      if (hasMedia && cleanText) {
        // Real LINE & Facebook Messenger deliver image and text as 2 separate bubbles
        if (channel.platform === 'line') {
          // LINE supports multiple bubbles in 1 API call (saves Reply/Push quota)
          deliveryResult = await sendLineMessage({
            accessToken,
            externalUserId: conv.customer_external_id,
            replyToken: conv.line_reply_token,
            replyExpiresAt: conv.line_reply_expires_at,
            text: cleanText,
            messageType: 'image',
            mediaUrl: outboundMediaUrl,
            liveDeliveryEnabled: config.liveDeliveryEnabled,
            fetchImpl,
          });

          savedMessages.push(
            await repo.insertMessage({
              conversationId: conv.id,
              channelId: channel.id,
              platformMessageId: `${deliveryResult.platformMessageId}_img`,
              senderType: 'agent',
              senderAgentId: agentId,
              messageType: 'image',
              contentText: '',
              mediaUrl,
              deliveryStatus: 'sent',
              deliveryMethod: deliveryResult.deliveryMethod,
              createdAt: new Date(baseMs).toISOString(),
            }),
            await repo.insertMessage({
              conversationId: conv.id,
              channelId: channel.id,
              platformMessageId: `${deliveryResult.platformMessageId}_txt`,
              senderType: 'agent',
              senderAgentId: agentId,
              messageType: 'text',
              contentText: cleanText,
              mediaUrl: null,
              deliveryStatus: 'sent',
              deliveryMethod: deliveryResult.deliveryMethod,
              createdAt: new Date(baseMs + 1).toISOString(),
            })
          );
        } else {
          // Facebook Send API requires separate requests for image attachment and text
          const imgDelivery = await sendFacebookMessage({
            accessToken,
            recipientId: conv.customer_external_id,
            text: '',
            messageType: 'image',
            mediaUrl: outboundMediaUrl,
            lastCustomerMsgAt: conv.last_customer_msg_at,
            liveDeliveryEnabled: config.liveDeliveryEnabled,
            fetchImpl,
          });
          const txtDelivery = await sendFacebookMessage({
            accessToken,
            recipientId: conv.customer_external_id,
            text: cleanText,
            messageType: 'text',
            mediaUrl: null,
            lastCustomerMsgAt: conv.last_customer_msg_at,
            liveDeliveryEnabled: config.liveDeliveryEnabled,
            fetchImpl,
          });
          deliveryResult = txtDelivery;

          savedMessages.push(
            await repo.insertMessage({
              conversationId: conv.id,
              channelId: channel.id,
              platformMessageId: imgDelivery.platformMessageId,
              senderType: 'agent',
              senderAgentId: agentId,
              messageType: 'image',
              contentText: '',
              mediaUrl,
              deliveryStatus: 'sent',
              deliveryMethod: imgDelivery.deliveryMethod,
              createdAt: new Date(baseMs).toISOString(),
            }),
            await repo.insertMessage({
              conversationId: conv.id,
              channelId: channel.id,
              platformMessageId: txtDelivery.platformMessageId,
              senderType: 'agent',
              senderAgentId: agentId,
              messageType: 'text',
              contentText: cleanText,
              mediaUrl: null,
              deliveryStatus: 'sent',
              deliveryMethod: txtDelivery.deliveryMethod,
              createdAt: new Date(baseMs + 1).toISOString(),
            })
          );
        }
      } else {
        const resolvedType = hasMedia ? (messageType === 'text' ? 'image' : messageType) : 'text';
        if (channel.platform === 'line') {
          deliveryResult = await sendLineMessage({
            accessToken,
            externalUserId: conv.customer_external_id,
            replyToken: conv.line_reply_token,
            replyExpiresAt: conv.line_reply_expires_at,
            text: cleanText,
            messageType: resolvedType,
            mediaUrl: outboundMediaUrl,
            liveDeliveryEnabled: config.liveDeliveryEnabled,
            fetchImpl,
          });
        } else {
          deliveryResult = await sendFacebookMessage({
            accessToken,
            recipientId: conv.customer_external_id,
            text: cleanText,
            messageType: resolvedType,
            mediaUrl: outboundMediaUrl,
            lastCustomerMsgAt: conv.last_customer_msg_at,
            liveDeliveryEnabled: config.liveDeliveryEnabled,
            fetchImpl,
          });
        }

        savedMessages.push(
          await repo.insertMessage({
            conversationId: conv.id,
            channelId: channel.id,
            platformMessageId: deliveryResult.platformMessageId,
            senderType: 'agent',
            senderAgentId: agentId,
            messageType: resolvedType,
            contentText: cleanText,
            mediaUrl,
            deliveryStatus: 'sent',
            deliveryMethod: deliveryResult.deliveryMethod,
            createdAt: new Date(baseMs).toISOString(),
          })
        );
      }

      const lastMsg = savedMessages[savedMessages.length - 1];
      const previewLabel = hasMedia
        ? (cleanText ? `คุณ: [รูปภาพ] ${cleanText}` : 'คุณ: [ส่งรูปภาพ]')
        : `คุณ: ${cleanText}`;

      const updatedConv = await repo.updateConversationAfterAgentReply({
        conversationId: conv.id,
        preview: previewLabel,
        timestampIso: lastMsg.created_at,
        clearReplyToken: Boolean(deliveryResult.usedReplyToken),
      });

      sseHub.broadcast('message:created', {
        message: lastMsg,
        messages: savedMessages,
        conversation: updatedConv,
        channels: await repo.listChannelsWithStats(),
      });

      return { message: lastMsg, messages: savedMessages, conversation: updatedConv, delivery: deliveryResult };
    },

    /**
     * Generates a genuine signed webhook payload (LINE or Facebook) and routes it through
     * the exact same signature verification & ingestion pipeline used in production.
     */
    async simulateInbound({ channelId, customerName, externalUserId, text, mediaUrl = null, mediaUrls = [] }) {
      const channel = await repo.getChannelById(channelId);
      if (!channel) {
        const err = new Error('Channel not found');
        err.statusCode = 404;
        throw err;
      }

      const allMedia = [
        ...(Array.isArray(mediaUrls) ? mediaUrls.filter(Boolean) : []),
        ...(mediaUrl ? [mediaUrl] : []),
      ];
      const cleanText = String(text || '').trim() || (allMedia.length > 0 ? '' : 'สวัสดีครับ สนใจสินค้าครับ');
      const senderId = externalUserId || `${channel.platform === 'line' ? 'U' : 'PSID'}_sim_${Date.now().toString(36)}`;
      const now = Date.now();

      if (channel.platform === 'line') {
        const events = [];
        if (cleanText) {
          events.push({
            type: 'message',
            replyToken: `sim_reply_${now}`,
            timestamp: now,
            source: { type: 'user', userId: senderId },
            mockSenderName: customerName || undefined,
            message: {
              id: `sim_line_msg_${now}_${Math.random().toString(36).slice(2, 6)}`,
              type: 'text',
              text: cleanText,
            },
          });
        }
        allMedia.forEach((url, idx) => {
          events.push({
            type: 'message',
            replyToken: `sim_reply_${now}_${idx}`,
            timestamp: now + idx + 1,
            source: { type: 'user', userId: senderId },
            mockSenderName: customerName || undefined,
            message: {
              id: `sim_line_img_${now}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
              type: 'image',
              contentProvider: { type: 'external', originalContentUrl: url },
            },
          });
        });

        const bodyObj = {
          destination: channel.external_channel_id,
          events,
        };
        const rawBody = Buffer.from(JSON.stringify(bodyObj), 'utf8');
        const secret = decryptSecret(channel.channel_secret_enc, config.encryptionKey);
        const signature = signLinePayload(rawBody, secret);
        return this.handleLineWebhook({
          channelKey: channel.webhook_path_key,
          rawBody,
          signature,
          parsedBody: bodyObj,
        });
      }

      // Facebook Page Webhook payload (supports text + multiple image attachments sent together)
      const messaging = [];
      if (cleanText) {
        messaging.push({
          sender: { id: senderId },
          recipient: { id: channel.external_channel_id },
          timestamp: now,
          mockSenderName: customerName || undefined,
          message: {
            mid: `sim_fb_mid_${now}_${Math.random().toString(36).slice(2, 6)}`,
            text: cleanText,
          },
        });
      }
      allMedia.forEach((url, idx) => {
        messaging.push({
          sender: { id: senderId },
          recipient: { id: channel.external_channel_id },
          timestamp: now + idx + 1,
          mockSenderName: customerName || undefined,
          message: {
            mid: `sim_fb_img_${now}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
            attachments: [{ type: 'image', payload: { url } }],
          },
        });
      });

      const bodyObj = {
        object: 'page',
        entry: [
          {
            id: channel.external_channel_id,
            time: now,
            messaging,
          },
        ],
      };
      const rawBody = Buffer.from(JSON.stringify(bodyObj), 'utf8');
      const signature = signFacebookPayload(rawBody, config.fbAppSecret);
      return this.handleFacebookWebhook({
        rawBody,
        signature,
        parsedBody: bodyObj,
      });
    },
  };
}
