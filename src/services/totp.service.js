import crypto from 'node:crypto';
import { timingSafeEqualStr } from './crypto.service.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(str) {
  const cleaned = String(str || '')
    .toUpperCase()
    .replace(/[\s=-]+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error('Invalid Base32 secret');
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generates a 160-bit Base32 TOTP secret (32 chars) compatible with
 * Google Authenticator, Apple Passwords, 1Password, Microsoft Authenticator, and Authy.
 */
export function generateTotpSecret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function formatSecretForDisplay(secretBase32) {
  return String(secretBase32 || '')
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

/**
 * RFC 6238 TOTP code generator (HMAC-SHA1, 30s period, 6 digits).
 */
export function generateTotpCode(secretBase32, { timestampMs = Date.now(), stepSec = 30, digits = 6 } = {}) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSec);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Verifies a 6-digit TOTP code with ±1 step (±30s) clock drift tolerance.
 */
export function verifyTotpCode(secretBase32, rawCode, { timestampMs = Date.now(), stepSec = 30, window = 1 } = {}) {
  const normalized = String(rawCode || '').replace(/[\s-]+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  for (let delta = -window; delta <= window; delta += 1) {
    const candidate = generateTotpCode(secretBase32, {
      timestampMs: timestampMs + delta * stepSec * 1000,
      stepSec,
      digits: 6,
    });
    if (timingSafeEqualStr(normalized, candidate)) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri({ secret, accountName, issuer = 'DmCare' }) {
  const safeIssuer = encodeURIComponent(issuer);
  const safeAccount = encodeURIComponent(String(accountName || 'admin'));
  const label = `${safeIssuer}:${safeAccount}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// =============================================================================
// 1-Time Backup Recovery Codes
// =============================================================================
function hashRecoveryCode(code, masterKey) {
  const normalized = String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return crypto
    .createHmac('sha256', `${String(masterKey || 'dmcare')}:recovery_v1`)
    .update(normalized)
    .digest('hex');
}

export function generateRecoveryCodes(masterKey, count = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const plainCodes = [];
  const hashedCodes = [];
  for (let i = 0; i < count; i += 1) {
    const rand = crypto.randomBytes(8);
    let raw = '';
    for (let j = 0; j < 8; j += 1) {
      raw += chars[rand[j] % chars.length];
    }
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    plainCodes.push(formatted);
    hashedCodes.push(hashRecoveryCode(formatted, masterKey));
  }
  return { plainCodes, hashedCodes };
}

export function consumeRecoveryCode(inputCode, hashedCodes, masterKey) {
  const cleaned = String(inputCode || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 6 || !Array.isArray(hashedCodes) || hashedCodes.length === 0) {
    return { matched: false, remainingHashes: hashedCodes || [] };
  }
  const candidateHash = hashRecoveryCode(cleaned, masterKey);
  const idx = hashedCodes.findIndex((h) => timingSafeEqualStr(String(h), candidateHash));
  if (idx === -1) {
    return { matched: false, remainingHashes: hashedCodes };
  }
  const remainingHashes = hashedCodes.filter((_, i) => i !== idx);
  return { matched: true, remainingHashes };
}

// =============================================================================
// Self-Contained ISO/IEC 18004 QR Code Generator (EC Level L, Versions 1–10)
// Zero external dependencies — generates crisp offline SVG for Authenticator apps
// =============================================================================
const QR_VERSIONS_L = [
  null,
  { size: 21, totalData: 19, ecPerBlock: 7, blocks: [[1, 19]], align: [] },
  { size: 25, totalData: 34, ecPerBlock: 10, blocks: [[1, 34]], align: [6, 18] },
  { size: 29, totalData: 55, ecPerBlock: 15, blocks: [[1, 55]], align: [6, 22] },
  { size: 33, totalData: 80, ecPerBlock: 20, blocks: [[1, 80]], align: [6, 26] },
  { size: 37, totalData: 108, ecPerBlock: 26, blocks: [[1, 108]], align: [6, 30] },
  { size: 41, totalData: 136, ecPerBlock: 18, blocks: [[2, 68]], align: [6, 34] },
  { size: 45, totalData: 156, ecPerBlock: 20, blocks: [[2, 78]], align: [6, 22, 38] },
  { size: 49, totalData: 194, ecPerBlock: 24, blocks: [[2, 97]], align: [6, 24, 42] },
  { size: 53, totalData: 232, ecPerBlock: 30, blocks: [[2, 116]], align: [6, 26, 46] },
  { size: 57, totalData: 274, ecPerBlock: 18, blocks: [[2, 68], [2, 69]], align: [6, 28, 50] },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Uint8Array(ecCount);
  for (const byte of data) {
    const factor = byte ^ res[0];
    for (let i = 0; i < ecCount - 1; i += 1) {
      res[i] = res[i + 1] ^ gfMul(gen[i + 1], factor);
    }
    res[ecCount - 1] = gfMul(gen[ecCount], factor);
  }
  return res;
}

function computeFormatBits(ecLevelBits, maskPattern) {
  const data = (ecLevelBits << 3) | maskPattern;
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

function chooseQrVersion(byteLen) {
  for (let v = 1; v < QR_VERSIONS_L.length; v += 1) {
    const countBits = v <= 9 ? 8 : 16;
    const capacityBits = QR_VERSIONS_L[v].totalData * 8;
    if (4 + countBits + byteLen * 8 <= capacityBits) {
      return v;
    }
  }
  throw new Error('QR payload too long for versions 1-10');
}

function buildQrCodewords(bytes, version) {
  const spec = QR_VERSIONS_L[version];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1);
  };

  // Byte mode indicator (0100) + byte length + payload bytes
  pushBits(0b0100, 4);
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const totalBits = spec.totalData * 8;
  const terminator = Math.min(4, totalBits - bits.length);
  for (let i = 0; i < terminator; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    dataCodewords.push(byte);
  }
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (dataCodewords.length < spec.totalData) {
    dataCodewords.push(padBytes[padIdx % 2]);
    padIdx += 1;
  }

  // Split into RS blocks and interleave
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, blockDataLen] of spec.blocks) {
    for (let b = 0; b < count; b += 1) {
      const slice = dataCodewords.slice(offset, offset + blockDataLen);
      offset += blockDataLen;
      dataBlocks.push(slice);
      ecBlocks.push(rsEncode(slice, spec.ecPerBlock));
    }
  }

  const finalBytes = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) finalBytes.push(block[i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const ec of ecBlocks) {
      finalBytes.push(ec[i]);
    }
  }
  return finalBytes;
}

export function buildQrMatrix(text) {
  const bytes = Buffer.from(String(text || ''), 'utf8');
  const version = chooseQrVersion(bytes.length);
  const spec = QR_VERSIONS_L[version];
  const size = spec.size;

  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunction = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunc = (r, c, dark) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = dark ? 1 : 0;
    isFunction[r][c] = 1;
  };

  // Finder patterns + separators
  const drawFinder = (top, left) => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark =
          inside &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFunc(r, c, dark);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const align = spec.align;
  for (let i = 0; i < align.length; i += 1) {
    for (let j = 0; j < align.length; j += 1) {
      const isCorner =
        (i === 0 && j === 0) ||
        (i === 0 && j === align.length - 1) ||
        (i === align.length - 1 && j === 0);
      if (isCorner) continue;
      const cr = align[i];
      const cc = align[j];
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunc(cr + dr, cc + dc, dist !== 1);
        }
      }
    }
  }

  // Reserve format info areas + fixed dark module
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      setFunc(8, i, false);
      setFunc(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    setFunc(8, size - 1 - i, false);
    setFunc(size - 1 - i, 8, false);
  }
  setFunc(size - 8, 8, true);

  // Version info (v >= 7)
  if (version >= 7) {
    const vBits = computeVersionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = Boolean((vBits >>> i) & 1);
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  // Place data bits in zig-zag order
  const codewords = buildQrCodewords(bytes, version);
  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx += 1) {
        const c = right - dx;
        if (isFunction[r][c]) continue;
        const byteIndex = bitIdx >>> 3;
        const bitOffset = 7 - (bitIdx & 7);
        const dark = byteIndex < codewords.length ? Boolean((codewords[byteIndex] >>> bitOffset) & 1) : false;
        modules[r][c] = dark ? 1 : 0;
        bitIdx += 1;
      }
    }
    upward = !upward;
  }

  const maskFns = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  const writeFormat = (grid, maskIdx) => {
    // EC Level L = 01
    const bits = computeFormatBits(0b01, maskIdx);
    const bit = (i) => ((bits >>> i) & 1);
    for (let i = 0; i <= 5; i += 1) grid[8][i] = bit(14 - i);
    grid[8][7] = bit(8);
    grid[8][8] = bit(7);
    grid[7][8] = bit(6);
    for (let i = 9; i < 15; i += 1) grid[14 - i][8] = bit(14 - i);

    for (let i = 0; i < 8; i += 1) grid[8][size - 1 - i] = bit(i);
    for (let i = 0; i < 7; i += 1) grid[size - 1 - i][8] = bit(14 - i);
    grid[size - 8][8] = 1;
  };

  const evaluatePenalty = (grid) => {
    let penalty = 0;
    // Rule 1: consecutive runs
    for (let r = 0; r < size; r += 1) {
      let runVal = grid[r][0];
      let runLen = 1;
      for (let c = 1; c < size; c += 1) {
        if (grid[r][c] === runVal) {
          runLen += 1;
        } else {
          if (runLen >= 5) penalty += 3 + (runLen - 5);
          runVal = grid[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) penalty += 3 + (runLen - 5);
    }
    for (let c = 0; c < size; c += 1) {
      let runVal = grid[0][c];
      let runLen = 1;
      for (let r = 1; r < size; r += 1) {
        if (grid[r][c] === runVal) {
          runLen += 1;
        } else {
          if (runLen >= 5) penalty += 3 + (runLen - 5);
          runVal = grid[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) penalty += 3 + (runLen - 5);
    }
    // Rule 2: 2x2 blocks
    for (let r = 0; r < size - 1; r += 1) {
      for (let c = 0; c < size - 1; c += 1) {
        const v = grid[r][c];
        if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) {
          penalty += 3;
        }
      }
    }
    // Rule 4: dark ratio balance
    let dark = 0;
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) dark += grid[r][c];
    }
    const pct = (dark * 100) / (size * size);
    penalty += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return penalty;
  };

  let bestGrid = null;
  let bestPenalty = Infinity;

  for (let m = 0; m < 8; m += 1) {
    const candidate = modules.map((row) => Uint8Array.from(row));
    const fn = maskFns[m];
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!isFunction[r][c] && fn(r, c)) {
          candidate[r][c] ^= 1;
        }
      }
    }
    writeFormat(candidate, m);
    const p = evaluatePenalty(candidate);
    if (p < bestPenalty) {
      bestPenalty = p;
      bestGrid = candidate;
    }
  }

  return bestGrid;
}

export function generateQrSvg(text, { margin = 3, moduleSize = 5 } = {}) {
  const matrix = buildQrMatrix(text);
  const size = matrix.length;
  const full = size + margin * 2;
  const paths = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (matrix[r][c]) {
        paths.push(`M${c + margin},${r + margin}h1v1h-1z`);
      }
    }
  }
  const px = full * moduleSize;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR Code สำหรับตั้งค่า 2FA"><rect width="100%" height="100%" fill="#ffffff"/><path d="${paths.join('')}" fill="#0f172a"/></svg>`;
}
