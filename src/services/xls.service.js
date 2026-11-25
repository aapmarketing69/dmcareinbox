import zlib from 'node:zlib';

/**
 * Zero-dependency spreadsheet parser & exporter supporting:
 * - Excel .xls (SpreadsheetML 2003 XML, HTML-table .xls, and Binary BIFF8 OLE2 .xls)
 * - Excel .xlsx (OOXML ZIP archive)
 * - .csv / .tsv / plain newline text
 */

function xmlUnescape(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function xmlEscape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseXmlSpreadsheetRows(text) {
  const rows = [];
  const rowMatches = text.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/gi);
  for (const rm of rowMatches) {
    const cells = [];
    const cellMatches = rm[1].matchAll(/<Cell\b[^>]*>[\s\S]*?<Data\b[^>]*>([\s\S]*?)<\/Data>[\s\S]*?<\/Cell>/gi);
    for (const cm of cellMatches) {
      cells.push(xmlUnescape(cm[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function parseHtmlTableRows(text) {
  const rows = [];
  const trMatches = text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const tr of trMatches) {
    const cells = [];
    const tdMatches = tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi);
    for (const td of tdMatches) {
      const stripped = td[1].replace(/<[^>]+>/g, '');
      cells.push(xmlUnescape(stripped));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function parseCsvRows(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const delimiter = line.includes('\t') ? '\t' : ',';
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  });
}

/**
 * Minimal ZIP reader for .xlsx files (uses Node built-in zlib.inflateRawSync).
 */
function readZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) break;

    const rawSlice = buffer.subarray(dataStart, dataEnd);
    try {
      if (compression === 0) {
        entries.set(name, rawSlice);
      } else if (compression === 8) {
        entries.set(name, zlib.inflateRawSync(rawSlice));
      }
    } catch {
      // Skip unreadable entry
    }
    offset = dataEnd;
  }
  return entries;
}

function parseXlsxRows(buffer) {
  const entries = readZipEntries(buffer);
  const sharedStrings = [];
  const ssXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  if (ssXml) {
    for (const si of ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
      const parts = [...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => xmlUnescape(m[1]));
      sharedStrings.push(parts.join(''));
    }
  }

  let sheetXml = entries.get('xl/worksheets/sheet1.xml')?.toString('utf8') || '';
  if (!sheetXml) {
    for (const [k, v] of entries.entries()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(k)) {
        sheetXml = v.toString('utf8');
        break;
      }
    }
  }
  if (!sheetXml) return [];

  const rows = [];
  for (const rm of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attrs = cm[1];
      const inner = cm[2];
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const cellType = typeMatch ? typeMatch[1] : '';

      if (cellType === 'inlineStr') {
        const tMatch = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/i);
        cells.push(tMatch ? xmlUnescape(tMatch[1]) : '');
      } else {
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/i);
        if (!vMatch) continue;
        const val = xmlUnescape(vMatch[1]);
        if (cellType === 's') {
          cells.push(sharedStrings[Number(val)] ?? '');
        } else {
          cells.push(val);
        }
      }
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Fallback extractor for legacy binary BIFF8 .xls (OLE2 compound file)
 * Extracts printable voucher-like code tokens from UTF-16LE / ASCII string tables.
 */
function parseLegacyBinaryXlsRows(buffer) {
  const candidates = new Set();
  const asciiMatches = buffer.toString('latin1').matchAll(/[A-Z0-9][A-Z0-9_-]{4,31}/g);
  for (const m of asciiMatches) {
    const token = m[0];
    if (/^(WORKBOOK|ROOTENTRY|SUMMARY|EXCEL|CALIBRI|ARIAL|MICROSOFT|SHEET\d+)$/i.test(token)) continue;
    if (/[0-9]/.test(token) && /[A-Z]/.test(token)) {
      candidates.add(token);
    }
  }
  return [...candidates].map((c) => [c]);
}

function normalizeRowsToVouchers(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return [];

  let codeIdx = 0;
  let valueIdx = -1;
  let expireIdx = -1;
  let startRow = 0;

  const header = rawRows[0].map((c) => String(c || '').toLowerCase().trim());
  const looksLikeHeader = header.some((h) =>
    /^(code|voucher|voucher_code|coupon|รหัส|โค้ด|gift|reward|value|มูลค่า|expire|expired|วันหมดอายุ)/.test(h)
  );

  if (looksLikeHeader) {
    startRow = 1;
    header.forEach((h, idx) => {
      if (/(code|voucher|coupon|รหัส|โค้ด)/.test(h) && codeIdx === 0 && idx > 0) codeIdx = idx;
      if (/(code|voucher|coupon|รหัส|โค้ด)/.test(h) && idx === 0) codeIdx = 0;
      if (/(value|amount|reward|มูลค่า|ส่วนลด)/.test(h)) valueIdx = idx;
      if (/(expire|exp|วันหมดอายุ)/.test(h)) expireIdx = idx;
    });
  } else if (rawRows[0].length >= 2) {
    valueIdx = 1;
    if (rawRows[0].length >= 3) expireIdx = 2;
  }

  const seen = new Set();
  const result = [];
  for (let i = startRow; i < rawRows.length; i++) {
    const row = rawRows[i];
    const code = String(row[codeIdx] || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push({
      code,
      rewardValue: valueIdx >= 0 ? String(row[valueIdx] || '').trim() : '',
      expiresAt: expireIdx >= 0 ? String(row[expireIdx] || '').trim() : '',
    });
  }
  return result;
}

export function parseVoucherUpload({ filename = 'vouchers.xls', buffer, rawText = '' }) {
  if (rawText && !buffer) {
    const rows = parseCsvRows(rawText);
    return { format: 'text/csv', rows: normalizeRowsToVouchers(rows) };
  }

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (buf.length === 0) {
    return { format: 'empty', rows: [] };
  }

  // 1. Check ZIP signature (PK\x03\x04) -> .xlsx
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return { format: 'xlsx', rows: normalizeRowsToVouchers(parseXlsxRows(buf)) };
  }

  // 2. Check OLE2 Binary .xls signature (D0 CF 11 E0)
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    return { format: 'xls-biff8', rows: normalizeRowsToVouchers(parseLegacyBinaryXlsRows(buf)) };
  }

  const text = buf.toString('utf8');
  // 3. Excel 2003 SpreadsheetML XML (.xls)
  if (/<Workbook\b/i.test(text) && /<Row\b/i.test(text)) {
    return { format: 'xls-xml', rows: normalizeRowsToVouchers(parseXmlSpreadsheetRows(text)) };
  }

  // 4. HTML Table .xls
  if (/<table\b/i.test(text) && /<tr\b/i.test(text)) {
    return { format: 'xls-html', rows: normalizeRowsToVouchers(parseHtmlTableRows(text)) };
  }

  // 5. CSV / TSV / Plain text
  return { format: filename.endsWith('.xls') ? 'xls-text' : 'csv', rows: normalizeRowsToVouchers(parseCsvRows(text)) };
}

/**
 * Generates an Excel 2003 SpreadsheetML (.xls) file with UTF-8 Thai support.
 * Opens directly in Microsoft Excel, macOS Numbers, and Google Sheets.
 */
export function buildSpreadsheetXls({ sheetName = 'Vouchers', headers = [], rows = [] }) {
  const safeSheet = xmlEscape(sheetName.slice(0, 31) || 'Sheet1');
  const headerXml = headers
    .map((h) => `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`)
    .join('');

  const bodyXml = rows
    .map((row) => {
      const cells = row
        .map((val) => `<Cell><Data ss:Type="String">${xmlEscape(val)}</Data></Cell>`)
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Font ss:FontName="Tahoma" ss:Size="11"/>
    </Style>
    <Style ss:ID="sHeader">
      <Font ss:FontName="Tahoma" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#2563EB" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="${safeSheet}">
    <Table>
      <Row>${headerXml}</Row>
      ${bodyXml}
    </Table>
  </Worksheet>
</Workbook>
`;
}

export function buildSampleVouchersXls() {
  const prefix = `GV${new Date().toISOString().slice(5, 10).replace('-', '')}`;
  const sampleRows = Array.from({ length: 10 }, (_, idx) => {
    const num = String(idx + 1).padStart(3, '0');
    return [`${prefix}-PROMO-${num}`, '100 บาท', '2026-12-31'];
  });
  return buildSpreadsheetXls({
    sheetName: 'GiftVouchers',
    headers: ['code', 'value', 'expire_date'],
    rows: sampleRows,
  });
}
