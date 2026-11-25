import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ALLOWED_MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const EXT_TO_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/**
 * Pure-Node AWS Signature V4 PUT uploader for Cloudflare R2 (S3-compatible API).
 * Zero external dependencies — handles 500K+ messages/month with zero egress fees.
 */
async function putObjectToR2({ accountId, accessKeyId, secretAccessKey, bucket, key, buffer, contentType, fetchImpl }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${bucket}/${key}`;
  const url = `https://${host}${canonicalUri}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const payloadHash = sha256Hex(buffer);

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
    body: buffer,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Cloudflare R2 upload failed (${res.status}): ${errText}`);
  }
}

export function createUploadService(uploadsDir, { r2Config = null, fetchImpl = fetch } = {}) {
  const r2Enabled = Boolean(
    r2Config?.accountId &&
    r2Config?.accessKeyId &&
    r2Config?.secretAccessKey &&
    r2Config?.bucket &&
    r2Config?.publicUrl
  );

  if (!r2Enabled) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  return {
    isCloudStorage: r2Enabled,
    storageProvider: r2Enabled ? 'cloudflare-r2' : 'local-disk',

    async saveBase64Image({ dataUrl, mimeType, dataBase64 }) {
      let resolvedMime = mimeType;
      let rawBase64 = dataBase64;

      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
        const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
        if (!match) {
          const err = new Error('Invalid image data URL');
          err.statusCode = 400;
          throw err;
        }
        resolvedMime = match[1].toLowerCase();
        rawBase64 = match[2];
      }

      if (!rawBase64) {
        const err = new Error('Image payload is empty');
        err.statusCode = 400;
        throw err;
      }

      const buf = Buffer.from(rawBase64, 'base64');
      return this.saveBinaryImage({ buffer: buf, mimeType: resolvedMime });
    },

    async saveBinaryImage({ buffer, mimeType }) {
      const normalizedMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
      const ext = ALLOWED_MIME_EXT[normalizedMime];
      if (!ext) {
        const err = new Error('รองรับเฉพาะไฟล์รูปภาพ PNG, JPG, WEBP หรือ GIF เท่านั้น');
        err.statusCode = 400;
        throw err;
      }

      const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
      if (buf.length === 0 || buf.length > MAX_BYTES) {
        const err = new Error('ขนาดรูปภาพต้องไม่เกิน 5 MB');
        err.statusCode = 413;
        throw err;
      }

      const filename = `img_${Date.now()}_${crypto.randomBytes(5).toString('hex')}${ext}`;

      if (r2Enabled) {
        const objectKey = `uploads/${filename}`;
        await putObjectToR2({
          accountId: r2Config.accountId,
          accessKeyId: r2Config.accessKeyId,
          secretAccessKey: r2Config.secretAccessKey,
          bucket: r2Config.bucket,
          key: objectKey,
          buffer: buf,
          contentType: normalizedMime,
          fetchImpl,
        });
        const publicBase = r2Config.publicUrl.replace(/\/+$/, '');
        return {
          filename,
          url: `${publicBase}/${objectKey}`,
          mimeType: normalizedMime,
          size: buf.length,
          storage: 'cloudflare-r2',
        };
      }

      fs.mkdirSync(uploadsDir, { recursive: true });
      const fullPath = path.join(uploadsDir, filename);
      fs.writeFileSync(fullPath, buf);

      return {
        filename,
        url: `/uploads/${filename}`,
        mimeType: normalizedMime,
        size: buf.length,
        storage: 'local-disk',
      };
    },

    resolveUpload(filename) {
      if (!filename || !/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
      const resolved = path.resolve(uploadsDir, filename);
      if (!resolved.startsWith(path.resolve(uploadsDir))) return null;
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return null;
      const ext = path.extname(resolved).toLowerCase();
      return {
        fullPath: resolved,
        mimeType: EXT_TO_MIME[ext] || 'application/octet-stream',
      };
    },
  };
}
