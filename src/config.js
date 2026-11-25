import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

// Minimal .env loader (zero external dependencies)
function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const val = line.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

export function getConfig() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    brandName: process.env.BRAND_NAME || 'DmCare',
    isProduction,
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
    // Database: PostgreSQL if DATABASE_URL is set (Railway/Production), otherwise local SQLite
    databaseUrl: process.env.DATABASE_URL || '',
    dbPath: process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'omnichannel.db'),
    // Security
    encryptionKey: process.env.ENCRYPTION_KEY || 'dev-omnichannel-secret-key-please-change',
    sessionSecret: process.env.SESSION_SECRET || '',
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    // Initial Admin Seed (for fresh production PostgreSQL DB)
    adminEmail: process.env.ADMIN_EMAIL || 'may@shop.local',
    adminPassword: process.env.ADMIN_PASSWORD || 'admin1234',
    adminName: process.env.ADMIN_NAME || 'แอดมินเมย์',
    // Facebook App Settings
    fbVerifyToken: process.env.FB_VERIFY_TOKEN || 'omnichannel_fb_verify_token_dev',
    fbAppSecret: process.env.FB_APP_SECRET || 'dev_fb_app_secret_change_in_prod',
    // Live Delivery & Gemini AI
    liveDeliveryEnabled: process.env.LIVE_DELIVERY_ENABLED === 'true',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    // Cloudflare R2 Object Storage (optional; uses local disk when unset)
    r2AccountId: process.env.R2_ACCOUNT_ID || '',
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    r2Bucket: process.env.R2_BUCKET || '',
    r2PublicUrl: (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, ''),
  };
}
