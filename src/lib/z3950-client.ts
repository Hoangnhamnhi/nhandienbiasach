/*z3950-client.ts  — NLV-compatible version*/

import * as net from 'net';

/*Vietnamese text helpers*/
function decodeMarc8(buf: Buffer): string {
  // Thử UTF-8 trước (NLV Koha thường lưu UTF-8)
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  // Fallback: latin1 (một số record cũ)
  return buf.toString('latin1');
}

/*ASN.1 BER helpers*/

function berLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
}

function berTLV(tag: number[], value: Buffer): Buffer {
  const t = Buffer.from(tag);
  const l = berLen(value.length);
  return Buffer.concat([t, l, value]);
}

function berInt(n: number): Buffer {
  if (n === 0) return Buffer.from([0x00]);
  const bytes: number[] = [];
  let v = n;
  while (v !== 0 && v !== -1) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  if ((n > 0 && (bytes[0] & 0x80)) || (n < 0 && !(bytes[0] & 0x80)))
    bytes.unshift(n < 0 ? 0xff : 0x00);
  return Buffer.from(bytes);
}

/*Z39.50 PDU Builders*/

const Z3950_BIB1_OID = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x13, 0x03, 0x01]);
const Z3950_USMARC_OID = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x13, 0x05, 0x0a]);
const Z3950_RESULT_SET = '1';
const Z3950_UTF8_NEGOTIATION = Buffer.from(
  'bf814920301ea41c06072a8648ce130f03a011a10fa10aa208820628d316010008830101',
  'hex',
);

function normalizeZ3950Query(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function z3950Terms(useAttr: number, query: string): string[] {
  if (useAttr === 7) {
    const isbn = query.replace(/[^0-9Xx]/g, '').toUpperCase();
    return [isbn || normalizeZ3950Query(query)];
  }

  const normalized = normalizeZ3950Query(query);
  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.length > 1 ? tokens.slice(0, 8) : [normalized];
}

function buildZ3950InitRequest(): Buffer {
  const body = Buffer.concat([
    berTLV([0x83], Buffer.from([0x00, 0xe0])),
    berTLV([0x84], Buffer.from([0x00, 0xe9, 0xa2, 0x40])),
    berTLV([0x85], berInt(1048576)),
    berTLV([0x86], berInt(1048576)),
    berTLV([0x9f, 0x6e], Buffer.from('81')),
    berTLV([0x9f, 0x6f], Buffer.from('LibraryScanner')),
    berTLV([0x9f, 0x70], Buffer.from('1.0')),
    Z3950_UTF8_NEGOTIATION,
  ]);

  return berTLV([0xb4], body);
}

function buildZ3950AttributePlusTerm(useAttr: number, termText: string): Buffer {
  const attrUse = berTLV([0x30], Buffer.concat([
    berTLV([0x9f, 0x78], berInt(1)),
    berTLV([0x9f, 0x79], berInt(useAttr)),
  ]));
  const attributes = berTLV([0xbf, 0x2c], attrUse);
  const term = berTLV([0x9f, 0x2d], Buffer.from(termText, 'ascii'));
  return berTLV([0xbf, 0x66], Buffer.concat([attributes, term]));
}

function buildZ3950Operand(useAttr: number, termText: string): Buffer {
  return berTLV([0xa0], buildZ3950AttributePlusTerm(useAttr, termText));
}

function buildZ3950AndRpn(useAttr: number, terms: string[]): Buffer {
  const [first, ...rest] = terms.length ? terms : [''];
  return rest.reduce(
    (left, term) => berTLV([0xa1], Buffer.concat([
      left,
      buildZ3950Operand(useAttr, term),
      berTLV([0xbf, 0x2e], berTLV([0x80], Buffer.alloc(0))),
    ])),
    buildZ3950Operand(useAttr, first),
  );
}

function buildZ3950SearchRequest(database: string, useAttr: number, queryStr: string): Buffer {
  const rpnStruct = buildZ3950AndRpn(useAttr, z3950Terms(useAttr, queryStr));
  const query = berTLV([0xb5], berTLV([0xa1], Buffer.concat([
    berTLV([0x06], Z3950_BIB1_OID),
    rpnStruct,
  ])));

  const body = Buffer.concat([
    berTLV([0x8d], berInt(0)),
    berTLV([0x8e], berInt(1)),
    berTLV([0x8f], berInt(0)),
    berTLV([0x90], Buffer.from([0x01])),
    berTLV([0x91], Buffer.from(Z3950_RESULT_SET)),
    berTLV([0xb2], berTLV([0x9f, 0x69], Buffer.from(database, 'ascii'))),
    query,
  ]);

  return berTLV([0xb6], body);
}

function buildZ3950PresentRequest(start: number, count: number): Buffer {
  const body = Buffer.concat([
    berTLV([0x9f, 0x1f], Buffer.from(Z3950_RESULT_SET)),
    berTLV([0x9e], berInt(start)),
    berTLV([0x9d], berInt(count)),
    berTLV([0x9f, 0x68], Z3950_USMARC_OID),
  ]);

  return berTLV([0xb8], body);
}

/*MARC21 ISO2709 Parser*/

export interface MarcRecord {
  id: string;
  marcLeader: string;
  marcFields: MarcField[];
  title: string;
  author: string;
  year: string;
  isbn: string;
  publisher: string;
  ddc: string;
  language: string;
  physical: string;
  pageCount: string;
  dimensions: string;
  summary: string;
  subjects: string[];
  rawMarc: string;
  source: string;
}

export interface MarcSubfield {
  code: string;
  value: string;
}

export interface MarcField {
  tag: string;
  ind1?: string;
  ind2?: string;
  value?: string;
  subfields?: MarcSubfield[];
  raw: string;
}

function subfield(content: string, code: string): string {
  const re = new RegExp(`[\x1f$]${code}([^\x1f$\x1e]+)`, 'i');
  const m = re.exec(content);
  return m ? m[1].trim() : '';
}

function parseMarcField(tag: string, fieldData: string): MarcField {
  if (/^00\d$/.test(tag)) {
    return {
      tag,
      value: fieldData.replace(/\x1e/g, '').trim(),
      raw: fieldData.replace(/\x1e/g, ''),
    };
  }

  const ind1 = fieldData[0] || ' ';
  const ind2 = fieldData[1] || ' ';
  const body = fieldData.slice(2);
  const subfields = body
    .split('\x1f')
    .slice(1)
    .map(part => ({
      code: part.charAt(0),
      value: part.slice(1).replace(/\x1e/g, '').trim(),
    }))
    .filter(item => item.code && item.value);

  return {
    tag,
    ind1,
    ind2,
    subfields,
    raw: fieldData.replace(/\x1e/g, ''),
  };
}

export function parseMarcIso2709(raw: Buffer, index: number, source: string): MarcRecord | null {
  const rec: MarcRecord = {
    id: `z_${Date.now()}_${index}`,
    marcLeader: '', marcFields: [],
    title: '', author: '', year: '', isbn: '', publisher: '',
    ddc: '', language: '', physical: '', pageCount: '',
    dimensions: '', summary: '', subjects: [], rawMarc: '', source,
  };

  try {
    // Dùng decodeMarc8 thay vì latin1 cứng — NLV có thể trả UTF-8
    rec.rawMarc = decodeMarc8(raw);

    if (raw.length < 24) return null;
    rec.marcLeader = raw.toString('ascii', 0, 24);

    const baseAddr = parseInt(raw.toString('ascii', 12, 17), 10);
    if (isNaN(baseAddr) || baseAddr >= raw.length) return null;

    const dir = raw.toString('ascii', 24, baseAddr - 1);
    for (let i = 0; i + 12 <= dir.length; i += 12) {
      const tag    = dir.slice(i, i + 3);
      const length = parseInt(dir.slice(i + 3, i + 7), 10);
      const offset = parseInt(dir.slice(i + 7, i + 12), 10);

      if (isNaN(length) || isNaN(offset)) continue;

      const fieldData = decodeMarc8(raw.slice(baseAddr + offset, baseAddr + offset + length - 1));
      rec.marcFields.push(parseMarcField(tag, fieldData));

      switch (tag) {
        case '020': {
          const v = subfield(fieldData, 'a') || fieldData.replace(/\x1e/g, '').trim();
          if (!rec.isbn) rec.isbn = v.split(/[^0-9X]/i)[0] || v;
          break;
        }
        case '041':
          if (!rec.language) rec.language = subfield(fieldData, 'a') || fieldData.slice(2).trim();
          break;
        case '082':
          if (!rec.ddc) rec.ddc = subfield(fieldData, 'a');
          break;
        case '100': case '110': case '111':
          if (!rec.author) rec.author = (subfield(fieldData, 'a') + ' ' + subfield(fieldData, 'b')).trim().replace(/[,./]+$/, '');
          break;
        case '245': {
          const a = subfield(fieldData, 'a').replace(/[/:]+$/, '').trim();
          const b = subfield(fieldData, 'b').replace(/[/:]+$/, '').trim();
          rec.title = b ? `${a} ${b}`.trim() : a;
          if (!rec.title) rec.title = fieldData.slice(2).replace(/\x1f./g, ' ').trim();
          break;
        }
        case '260': case '264':
          if (!rec.publisher) rec.publisher = subfield(fieldData, 'b').replace(/[,]+$/, '').trim();
          if (!rec.year) {
            const cy = subfield(fieldData, 'c');
            const m = cy.match(/\d{4}/);
            rec.year = m ? m[0] : '';
          }
          break;
        case '300': {
          const a = subfield(fieldData, 'a');
          rec.physical = a || fieldData.slice(2).trim();
          const pg = a.match(/(\d+)/);
          if (pg) rec.pageCount = pg[1];
          rec.dimensions = subfield(fieldData, 'c');
          break;
        }
        case '520':
          if (!rec.summary) rec.summary = subfield(fieldData, 'a') || fieldData.slice(2).trim();
          break;
        case '600': case '610': case '650': case '651': case '653': {
          const sa = subfield(fieldData, 'a');
          const sx = subfield(fieldData, 'x');
          const subj = [sa, sx].filter(Boolean).join(' -- ');
          if (subj && rec.subjects.length < 8) rec.subjects.push(subj);
          break;
        }
        case '700': case '710':
          if (!rec.author) rec.author = subfield(fieldData, 'a').replace(/[,./]+$/, '').trim();
          break;
      }
    }
  } catch (_) {
    return null;
  }

  return (rec.title || rec.author || rec.isbn) ? rec : null;
}

/*Z39.50 Connection*/

const USE_ATTRS: Record<string, number> = {
  title:   4,
  author:  1003,
  isbn:    7,
  keyword: 1016,
};

interface SearchOptions {
  host: string;
  port: number;
  database: string;
  searchType: string;
  query: string;
  maxResults?: number;
  timeoutMs?: number;
}

function readBerTagEnd(buffer: Buffer, offset: number): number | null {
  if (offset >= buffer.length) return null;
  let cursor = offset + 1;
  if ((buffer[offset] & 0x1f) === 0x1f) {
    while (true) {
      if (cursor >= buffer.length) return null;
      const byte = buffer[cursor++];
      if ((byte & 0x80) === 0) break;
    }
  }
  return cursor;
}

function readBerLength(buffer: Buffer, offset: number): { contentStart: number; length: number | null } | null {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  if (first < 0x80) return { contentStart: offset + 1, length: first };
  if (first === 0x80) return { contentStart: offset + 1, length: null };

  const byteCount = first & 0x7f;
  if (byteCount === 0 || byteCount > 4 || offset + 1 + byteCount > buffer.length) return null;

  let length = 0;
  for (let i = 0; i < byteCount; i++) length = (length << 8) | buffer[offset + 1 + i];
  return { contentStart: offset + 1 + byteCount, length };
}

function readBerFrameLength(buffer: Buffer): number | null {
  const tagEnd = readBerTagEnd(buffer, 0);
  if (tagEnd === null) return null;

  const rootLength = readBerLength(buffer, tagEnd);
  if (!rootLength) return null;
  if (rootLength.length !== null) {
    const frameEnd = rootLength.contentStart + rootLength.length;
    return frameEnd <= buffer.length ? frameEnd : null;
  }

  let cursor = rootLength.contentStart;
  let openIndefinite = 1;

  while (cursor < buffer.length) {
    if (cursor + 2 <= buffer.length && buffer[cursor] === 0x00 && buffer[cursor + 1] === 0x00) {
      cursor += 2;
      openIndefinite--;
      if (openIndefinite === 0) return cursor;
      continue;
    }

    const itemTagEnd = readBerTagEnd(buffer, cursor);
    if (itemTagEnd === null) return null;

    const itemLength = readBerLength(buffer, itemTagEnd);
    if (!itemLength) return null;

    if (itemLength.length === null) {
      openIndefinite++;
      cursor = itemLength.contentStart;
      continue;
    }

    const itemEnd = itemLength.contentStart + itemLength.length;
    if (itemEnd > buffer.length) return null;
    cursor = itemEnd;
  }

  return null;
}

export async function z3950Search(opts: SearchOptions): Promise<MarcRecord[]> {
  const { host, port, database, searchType, query, maxResults = 20, timeoutMs = 15000 } = opts;
  const useAttr = USE_ATTRS[searchType] ?? USE_ATTRS.keyword;

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);

    const records: MarcRecord[] = [];
    let buf = Buffer.alloc(0);
    let phase: 'init' | 'search' | 'present' | 'done' = 'init';
    let totalHits = 0;

    const cleanup = (err?: Error) => {
      socket.destroy();
      if (err) reject(err);
      else resolve(records);
    };

    const send = (pdu: Buffer) => {
      try { socket.write(pdu); } catch (e) { cleanup(e as Error); }
    };

    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      while (buf.length >= 2) {
        const pduLen = readBerFrameLength(buf);
        if (pduLen === null) break;
        if (buf.length < pduLen) break;

        const pdu = buf.slice(0, pduLen);
        buf = buf.slice(pduLen);
        handlePDU(pdu);
      }
    });

    const handlePDU = (pdu: Buffer) => {
      try {
        if (phase === 'init') {
          phase = 'search';
          send(buildZ3950SearchRequest(database, useAttr, query));
          return;
        }

        if (phase === 'search') {
          const hits = extractSearchHits(pdu);
          totalHits = Math.min(hits, maxResults);

          if (totalHits === 0) { cleanup(); return; }

          phase = 'present';
          send(buildZ3950PresentRequest(1, totalHits));
          return;
        }

        if (phase === 'present') {
          extractRecords(pdu, records, `${host}:${port}`);
          phase = 'done';
          cleanup();
        }
      } catch (e) {
        cleanup(e as Error);
      }
    };

    socket.on('timeout', () => cleanup(new Error(`Hết thời gian kết nối tới ${host}:${port}`)));
    socket.on('error',   (err) => cleanup(new Error(`Lỗi TCP ${host}:${port} — ${err.message}`)));

    socket.connect(port, host, () => { send(buildZ3950InitRequest()); });
  });
}

/**
 * Extract resultCount từ SearchResponse.
 * Zebra/YAZ trả context tags: resultCount [23] = 0x97
 */
function extractSearchHits(pdu: Buffer): number {
  // Context tag [23] primitive = 0x97
  for (let i = 0; i < pdu.length - 2; i++) {
    if (pdu[i] === 0x97) {
      const len = pdu[i + 1];
      if (len >= 1 && len <= 4 && i + 2 + len <= pdu.length) {
        let val = 0;
        for (let j = 0; j < len; j++) val = (val << 8) | pdu[i + 2 + j];
        if (val >= 0) return val;
      }
    }
  }
  // Fallback: universal INTEGER > 1 (bỏ qua refId=1, status=0/1)
  for (let i = 0; i < pdu.length - 2; i++) {
    if (pdu[i] === 0x02) {
      const len = pdu[i + 1];
      if (len >= 1 && len <= 4 && i + 2 + len <= pdu.length) {
        let val = 0;
        for (let j = 0; j < len; j++) val = (val << 8) | pdu[i + 2 + j];
        if (val > 1 && val < 100000) return val;
      }
    }
  }
  return 0;
}

/** Extract MARC ISO2709 records từ present response */
function extractRecords(pdu: Buffer, out: MarcRecord[], source: string): void {
  let i = 0;
  let idx = 0;
  while (i < pdu.length - 5) {
    const lenStr = pdu.slice(i, i + 5).toString('ascii');
    const recLen = /^\d{5}$/.test(lenStr) ? parseInt(lenStr, 10) : NaN;

    if (!isNaN(recLen) && recLen > 24 && recLen < 100000 && i + recLen <= pdu.length) {
      const marcBuf = pdu.slice(i, i + recLen);
      const rec = parseMarcIso2709(marcBuf, idx++, source);
      if (rec) out.push(rec);
      i += recLen;
    } else {
      i++;
    }
  }
}
