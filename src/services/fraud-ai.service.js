import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Computes exact SHA-256 hash & Base64 binary for an evidence image
 * (supports both local /uploads/... files and remote Cloudflare R2 https://... URLs).
 */
export async function computeImageFingerprint(mediaUrl, uploadService, fetchImpl = fetch) {
  if (!mediaUrl) return null;
  const rawUrl = String(mediaUrl);
  const match = rawUrl.match(/^\/uploads\/([a-zA-Z0-9._-]+)$/);
  if (match && uploadService) {
    const resolved = uploadService.resolveUpload(match[1]);
    if (resolved) {
      const buf = fs.readFileSync(resolved.fullPath);
      return {
        hash: crypto.createHash('sha256').update(buf).digest('hex'),
        mimeType: resolved.mimeType,
        base64: buf.toString('base64'),
        size: buf.length,
      };
    }
  }

  if (/^https:\/\//i.test(rawUrl)) {
    try {
      const res = await fetchImpl(rawUrl, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
        const buf = Buffer.from(await res.arrayBuffer());
        return {
          hash: crypto.createHash('sha256').update(buf).digest('hex'),
          mimeType,
          base64: buf.toString('base64'),
          size: buf.length,
        };
      }
    } catch {
      // Fall back to URL hash if remote image temporarily unreachable
    }
  }

  return {
    hash: crypto.createHash('sha256').update(rawUrl).digest('hex'),
    mimeType: null,
    base64: null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverAvailableGeminiModels(apiKey) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    return models
      .filter((m) => {
        const methods = m.supportedGenerationMethods || [];
        const name = String(m.name || '').replace(/^models\//, '');
        if (!methods.includes('generateContent')) return false;
        if (!/^gemini-/i.test(name)) return false;
        if (/(embedding|imagen|veo|tts|audio|live|aqa|robotics|computer-use)/i.test(name)) return false;
        return true;
      })
      .map((m) => String(m.name).replace(/^models\//, ''))
      .sort((a, b) => {
        // Prefer flash / lite vision models first, newest version first
        const score = (n) => (n.includes('flash-lite') ? 3 : n.includes('flash') ? 2 : n.includes('pro') ? 1 : 0);
        if (score(b) !== score(a)) return score(b) - score(a);
        return b.localeCompare(a);
      })
      .slice(0, 6);
  } catch {
    return [];
  }
}

async function callGeminiVision({ apiKey, model, campaign, shopName, images }) {
  const inlineParts = images
    .filter((img) => img.base64 && img.mimeType)
    .map((img) => ({
      inline_data: {
        mime_type: img.mimeType,
        data: img.base64,
      },
    }));

  if (inlineParts.length === 0) {
    throw new Error('No readable image binary available for Gemini Vision');
  }

  const prompt = `คุณคือผู้ตรวจสอบหลักฐานกิจกรรมแจก Gift Voucher สำหรับร้านค้าออนไลน์ "${shopName}"
กติกากิจกรรม: ${campaign.required_rules}

ลูกค้าส่งภาพหลักฐานรวมกันมาทั้งหมด ${inlineParts.length} ภาพ (อาจแยกเป็นภาพกดไลก์เพจกับภาพแชร์ หรือรวมในภาพเดียว หรือมีภาพอื่นปนมาด้วย)
ให้วิเคราะห์ภาพทั้งหมดร่วมกันแล้วตอบกลับเป็น JSON ตามโครงสร้างนี้เท่านั้น:
{
  "confidence": 0-100 (ความมั่นใจรวมว่าหลักฐานครบถ้วนและไม่ใช่การโกง/ตัดต่อ),
  "liked_page": true/false,
  "liked_page_detail": "คำอธิบายสั้นๆ ภาษาไทย",
  "shared_post": true/false,
  "shared_post_detail": "คำอธิบายสั้นๆ ภาษาไทย",
  "public_share_globe": true/false (ต้องเห็นสัญลักษณ์ลูกโลกสาธารณะ Public ไม่ใช่เพื่อนหรือเฉพาะฉัน),
  "public_share_detail": "คำอธิบายสั้นๆ ภาษาไทย",
  "tampering_suspected": true/false (สงสัยรูปตัดต่อ/แคปซ้ำ/ผิดปกติหรือไม่),
  "tampering_detail": "คำอธิบายสั้นๆ ภาษาไทย",
  "extracted_fb_name": "ชื่อบัญชี Facebook ที่ปรากฏบนโพสต์ที่แชร์ (ถ้าไม่เห็นใส่ null)",
  "summary": "สรุปผลการตรวจภาษาไทยแบบกระชับ 1-2 ประโยค"
}`;

  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [{ text: prompt }, ...inlineParts],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const triedModels = new Set();
  const attemptLogs = [];
  let data = null;
  let usedModel = model;

  async function tryModel(candidateModel, maxRetries = 2) {
    if (!candidateModel || triedModels.has(candidateModel)) return false;
    triedModels.add(candidateModel);

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: AbortSignal.timeout(25_000),
      });

      if (res.ok) {
        data = await res.json();
        usedModel = candidateModel;
        return true;
      }

      const errText = await res.text();
      attemptLogs.push(`${candidateModel}:${res.status}`);

      if ((res.status === 503 || res.status === 500 || res.status === 429) && attempt < maxRetries) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
      if (res.status === 404 || res.status === 503 || res.status === 500 || res.status === 429) {
        return false;
      }
      throw new Error(`Gemini API error (${res.status} on ${candidateModel}): ${errText}`);
    }
    return false;
  }

  // 1. Try configured primary model first (with 2 retries on 503)
  await tryModel(model, 2);

  // 2. If primary failed (503/404), dynamically discover live available models for this API key
  if (!data) {
    const discovered = await discoverAvailableGeminiModels(apiKey);
    for (const candidate of discovered) {
      const ok = await tryModel(candidate, 1);
      if (ok) break;
    }
  }

  if (!data) {
    const err = new Error(
      `เซิร์ฟเวอร์ Gemini API ยังไม่พร้อมใช้งานชั่วคราว (ลองแล้ว: ${attemptLogs.join(', ')}) กรุณาลองใหม่อีกครั้งในอีก 10–30 วินาที`
    );
    err.statusCode = 503;
    throw err;
  }

  const rawText = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const parsed = JSON.parse(rawText);

  return {
    provider: `gemini:${usedModel}`,
    confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence || 0)))),
    likedPage: Boolean(parsed.liked_page),
    likedPageDetail: parsed.liked_page_detail || '',
    sharedPost: Boolean(parsed.shared_post),
    sharedPostDetail: parsed.shared_post_detail || '',
    publicShareGlobe: Boolean(parsed.public_share_globe),
    publicShareDetail: parsed.public_share_detail || '',
    tamperingSuspected: Boolean(parsed.tampering_suspected),
    tamperingDetail: parsed.tampering_detail || '',
    extractedFbName: parsed.extracted_fb_name ? String(parsed.extracted_fb_name).trim() : null,
    summary: parsed.summary || 'ตรวจสอบด้วย Gemini Vision เสร็จสิ้น',
  };
}

/**
 * Local Mock AI Evaluator used when GEMINI_API_KEY is not configured.
 * Allows testing multi-image bundles, >=90% pass, <90% needs_review, and fraud rules locally.
 */
function runLocalMockEvaluator({ images, customerName, mockScenario = 'auto' }) {
  const count = images.length;

  if (mockScenario === 'fraud_tampered') {
    return {
      provider: 'mock',
      confidence: 28,
      likedPage: false,
      likedPageDetail: 'พบรอยตัดต่อบริเวณปุ่มถูกใจ',
      sharedPost: true,
      sharedPostDetail: 'พบการแชร์โพสต์แต่ผิดปกติ',
      publicShareGlobe: false,
      publicShareDetail: 'ตั้งค่าความเป็นส่วนตัวเป็น "เฉพาะฉัน" (ไอคอนแม่กุญแจ)',
      tamperingSuspected: true,
      tamperingDetail: 'AI ตรวจพบความผิดปกติของภาพ (สงสัยตัดต่อ)',
      extractedFbName: customerName || null,
      summary: '[Mock AI] พบความเสี่ยง Fraud / ภาพไม่ตรงเงื่อนไขสาธารณะ',
    };
  }

  if (mockScenario === 'low_confidence' || count === 1) {
    return {
      provider: 'mock',
      confidence: 74,
      likedPage: true,
      likedPageDetail: 'พบการกดไลก์เพจในภาพที่ส่งมา',
      sharedPost: count >= 2,
      sharedPostDetail: count >= 2 ? 'พบโพสต์แชร์กิจกรรม' : 'ส่งมาเพียง 1 ภาพ ยังไม่เห็นหลักฐานแชร์โพสต์ครบถ้วน',
      publicShareGlobe: false,
      publicShareDetail: 'ยังไม่เห็นสัญลักษณ์ลูกโลกสาธารณะ (Public 🌐) ชัดเจน',
      tamperingSuspected: false,
      tamperingDetail: 'ไม่พบร่องรอยการตัดต่อ',
      extractedFbName: customerName || null,
      summary: '[Mock AI] ความมั่นใจ 74% (ต่ำกว่าเกณฑ์ 90%) — แนะนำขอภาพหลักฐานการแชร์เปิดสาธารณะเพิ่ม หรือส่งเข้า "ต้องดำเนินการ"',
    };
  }

  // 2+ images in bundle (e.g. Like + Public Share screenshots) -> High confidence >= 90%
  return {
    provider: 'mock',
    confidence: 95,
    likedPage: true,
    likedPageDetail: 'พบการกดไลก์/ติดตามเพจเรียบร้อยแล้ว',
    sharedPost: true,
    sharedPostDetail: `ตรวจพบการแชร์โพสต์กิจกรรมจากชุดภาพ ${count} รูป`,
    publicShareGlobe: true,
    publicShareDetail: 'พบไอคอนลูกโลก (เปิดสาธารณะ 🌐) ชัดเจน',
    tamperingSuspected: false,
    tamperingDetail: 'ไม่พบร่องรอยการตัดต่อหรือภาพผิดปกติ',
    extractedFbName: customerName || null,
    summary: `[Mock AI] ตรวจรวม ${count} รูปผ่านครบทุกกติกา ความมั่นใจ 95% (ไม่พบ Fraud) — พร้อมให้แอดมินกดแจกโค้ด`,
  };
}

/**
 * Orchestrates Anti-Fraud checks (exact duplicate image, customer double-claim, FB name reuse)
 * combined with AI Vision (Gemini API or Mock Evaluator) enforcing the >=90% no-fraud gate.
 */
export async function verifyEvidenceBundle({
  campaign,
  conversation,
  imageUrls,
  repo,
  uploadService,
  config,
  fetchImpl = fetch,
  mockScenario = 'auto',
}) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    const err = new Error('กรุณาเลือกรูปหลักฐานอย่างน้อย 1 รูป');
    err.statusCode = 400;
    throw err;
  }

  const images = [];
  for (const url of imageUrls) {
    const fp = await computeImageFingerprint(url, uploadService, fetchImpl);
    images.push({ url, ...(fp || {}) });
  }

  const hashes = images.map((i) => i.hash).filter(Boolean);
  const fraudFlags = [];

  // 1. Check if this customer already claimed a voucher in this campaign (1 customer / 1 campaign)
  const existingClaim = await repo.findCustomerClaimInCampaign(campaign.id, conversation.customer_id);
  if (existingClaim) {
    fraudFlags.push({
      code: 'CUSTOMER_ALREADY_CLAIMED',
      message: `ลูกค้ารายนี้เคยรับโค้ดไปแล้ว (${existingClaim.code}) เมื่อ ${existingClaim.claimed_at}`,
    });
  }

  // 2. Check duplicate evidence images submitted by other customers (Anti-reuse / Anti-fraud)
  const duplicateImages = await repo.findDuplicateSubmissionImages(campaign.id, hashes, conversation.customer_id);
  if (duplicateImages.length > 0) {
    const dup = duplicateImages[0];
    fraudFlags.push({
      code: 'DUPLICATE_IMAGE',
      message: `พบรูปหลักฐานซ้ำกับแชทของ "${dup.customer_name}" (${dup.platform.toUpperCase()} ${dup.shop_code})`,
    });
  }

  // 3. Run AI Vision analysis (Gemini if API key configured, otherwise local Mock Evaluator)
  let aiResult;
  if (config.geminiApiKey && images.some((i) => i.base64)) {
    aiResult = await callGeminiVision({
      apiKey: config.geminiApiKey,
      model: config.geminiModel || 'gemini-3.8-flash',
      campaign,
      shopName: conversation.channel_name,
      images,
    });
  } else {
    aiResult = runLocalMockEvaluator({
      images,
      customerName: conversation.customer_name,
      mockScenario,
    });
  }

  if (aiResult.tamperingSuspected) {
    fraudFlags.push({
      code: 'AI_TAMPERING_SUSPECTED',
      message: aiResult.tamperingDetail || 'AI สงสัยว่ารูปภาพอาจถูกตัดต่อหรือไม่ใช่หลักฐานจริง',
    });
  }

  // 4. Cross-shop duplicate Facebook name check
  if (aiResult.extractedFbName) {
    const dupFb = await repo.findDuplicateFbNameClaim(campaign.id, aiResult.extractedFbName, conversation.customer_id);
    if (dupFb) {
      fraudFlags.push({
        code: 'DUPLICATE_FB_ACCOUNT',
        message: `ชื่อบัญชี Facebook "${aiResult.extractedFbName}" เคยรับโค้ดไปแล้วในร้าน ${dupFb.shop_code}`,
      });
    }
  }

  const minConfidence = Number(campaign.min_confidence || 90);
  const allChecksPassed = aiResult.likedPage && aiResult.sharedPost && aiResult.publicShareGlobe;

  let verdict = 'needs_review';
  let finalConfidence = aiResult.confidence;

  if (fraudFlags.length > 0) {
    verdict = 'fraud';
    finalConfidence = Math.min(finalConfidence, 35);
  } else if (finalConfidence >= minConfidence && allChecksPassed) {
    verdict = 'pass';
  } else {
    verdict = 'needs_review';
  }

  const checklist = [
    { key: 'liked_page', label: 'กดไลก์ / ติดตามเพจ', passed: aiResult.likedPage, detail: aiResult.likedPageDetail },
    { key: 'shared_post', label: 'แชร์โพสต์กิจกรรม', passed: aiResult.sharedPost, detail: aiResult.sharedPostDetail },
    { key: 'public_share', label: 'เปิดแชร์เป็นสาธารณะ (🌐)', passed: aiResult.publicShareGlobe, detail: aiResult.publicShareDetail },
    {
      key: 'no_fraud',
      label: 'ไม่พบรูปซ้ำ / Fraud / รับสิทธิ์ซ้ำ',
      passed: fraudFlags.length === 0,
      detail: fraudFlags.length === 0 ? 'ผ่านการตรวจสอบกันโกงทั้งหมด' : fraudFlags.map((f) => f.message).join(' | '),
    },
  ];

  const submission = await repo.createSubmission({
    campaignId: campaign.id,
    conversationId: conversation.id,
    customerId: conversation.customer_id,
    channelId: conversation.channel_id,
    imageUrls,
    imageHashes: hashes,
    extractedFbName: aiResult.extractedFbName,
    aiConfidence: finalConfidence,
    aiVerdict: verdict,
    aiProvider: aiResult.provider,
    aiSummary: fraudFlags.length > 0 ? fraudFlags.map((f) => f.message).join(' · ') : aiResult.summary,
    aiChecklist: checklist,
    fraudFlags,
  });

  return submission;
}

/**
 * Supervisor Manual Fallback (used when Gemini API is temporarily unavailable 503).
 * Still runs deterministic SHA-256 duplicate-image & customer double-claim Anti-Fraud checks.
 */
export async function createManualEvidenceSubmission({
  campaign,
  conversation,
  imageUrls,
  repo,
  uploadService,
  fetchImpl = fetch,
}) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    const err = new Error('กรุณาเลือกรูปหลักฐานอย่างน้อย 1 รูป');
    err.statusCode = 400;
    throw err;
  }

  const hashes = [];
  for (const url of imageUrls) {
    const fp = await computeImageFingerprint(url, uploadService, fetchImpl);
    if (fp?.hash) hashes.push(fp.hash);
  }

  const fraudFlags = [];
  const existingClaim = await repo.findCustomerClaimInCampaign(campaign.id, conversation.customer_id);
  if (existingClaim) {
    fraudFlags.push({
      code: 'CUSTOMER_ALREADY_CLAIMED',
      message: `ลูกค้ารายนี้เคยรับโค้ดไปแล้ว (${existingClaim.code}) เมื่อ ${existingClaim.claimed_at}`,
    });
  }

  const duplicateImages = await repo.findDuplicateSubmissionImages(campaign.id, hashes, conversation.customer_id);
  if (duplicateImages.length > 0) {
    const dup = duplicateImages[0];
    fraudFlags.push({
      code: 'DUPLICATE_IMAGE',
      message: `พบรูปหลักฐานซ้ำกับแชทของ "${dup.customer_name}" (${dup.platform.toUpperCase()} ${dup.shop_code})`,
    });
  }

  const hasFraud = fraudFlags.length > 0;
  return repo.createSubmission({
    campaignId: campaign.id,
    conversationId: conversation.id,
    customerId: conversation.customer_id,
    channelId: conversation.channel_id,
    imageUrls,
    imageHashes: hashes,
    extractedFbName: null,
    aiConfidence: hasFraud ? 0 : 100,
    aiVerdict: hasFraud ? 'fraud' : 'needs_review',
    aiProvider: 'manual-supervisor',
    aiSummary: hasFraud
      ? fraudFlags.map((f) => f.message).join(' · ')
      : 'สร้างรายการตรวจด้วยตนเองโดย Supervisor (ข้าม AI ชั่วคราว — ผ่านการตรวจรูปซ้ำและสิทธิ์ซ้ำแล้ว)',
    aiChecklist: [
      {
        key: 'manual_review',
        label: 'ตรวจสอบโดย Supervisor',
        passed: !hasFraud,
        detail: hasFraud ? 'ถูกบล็อกโดยระบบกันโกงอัตโนมัติ' : 'พร้อมให้ Supervisor กดอนุมัติแจกโค้ด (Manual Override)',
      },
      {
        key: 'no_fraud',
        label: 'ไม่พบรูปซ้ำ / รับสิทธิ์ซ้ำ',
        passed: !hasFraud,
        detail: !hasFraud ? 'ผ่านการตรวจสอบ SHA-256 และ 1 คน / 1 สิทธิ์' : fraudFlags.map((f) => f.message).join(' | '),
      },
    ],
    fraudFlags,
  });
}
