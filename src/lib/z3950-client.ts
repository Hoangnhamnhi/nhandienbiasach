/*z3950-client.ts  — NLV-compatible version*/

import * as net from 'net';

/*Vietnamese text helpers*/
function toAsciiQuery(str: string): string {
  const map: Record<string, string> = {
    à:'a',á:'a',â:'a',ã:'a',ä:'a',å:'a',
    è:'e',é:'e',ê:'e',ë:'e',
    ì:'i',í:'i',î:'i',ï:'i',
    ò:'o',ó:'o',ô:'o',õ:'o',ö:'o',
    ù:'u',ú:'u',û:'u',ü:'u',
    ý:'y',ÿ:'y',
    ă:'a',ắ:'a',ằ:'a',ẳ:'a',ẵ:'a',ặ:'a',
    đ:'d',
    ế:'e',ề:'e',ể:'e',ễ:'e',ệ:'e',
    ị:'i',
    ơ:'o',ớ:'o',ờ:'o',ở:'o',ỡ:'o',ợ:'o',
    ố:'o',ồ:'o',ổ:'o',ỗ:'o',ộ:'o',
    ụ:'u',ư:'u',ứ:'u',ừ:'u',ử:'u',ữ:'u',ự:'u',
    ỳ:'y',ỷ:'y',ỹ:'y',ỵ:'y',
    ả:'a',ạ:'a',
    ẻ:'e',ẽ:'e',ẹ:'e',
    ỉ:'i',ĩ:'i',
    ỏ:'o',ọ:'o',
    ủ:'u',ũ:'u',
    // uppercase
    À:'A',Á:'A',Â:'A',Ã:'A',Ä:'A',Å:'A',
    È:'E',É:'E',Ê:'E',Ë:'E',
    Ì:'I',Í:'I',Î:'I',Ï:'I',
    Ò:'O',Ó:'O',Ô:'O',Õ:'O',Ö:'O',
    Ù:'U',Ú:'U',Û:'U',Ü:'U',
    Ý:'Y',Đ:'D',
    Ă:'A',Ắ:'A',Ằ:'A',Ẳ:'A',Ẵ:'A',Ặ:'A',
    Ế:'E',Ề:'E',Ể:'E',Ễ:'E',Ệ:'E',
    Ị:'I',
    Ơ:'O',Ớ:'O',Ờ:'O',Ở:'O',Ỡ:'O',Ợ:'O',
    Ố:'O',Ồ:'O',Ổ:'O',Ỗ:'O',Ộ:'O',
    Ụ:'U',Ư:'U',Ứ:'U',Ừ:'U',Ử:'U',Ữ:'U',Ự:'U',
  };
  return str
    .split('')
    .map(c => map[c] ?? c)
    .join('')
    .replace(/[^\x20-\x7E]/g, '') // strip non-ASCII còn lại
    .replace(/\s+/g, ' ')
    .trim();
}
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

function berOctet(s: string): Buffer { return Buffer.from(s, 'latin1'); }
function berBool(b: boolean): Buffer { return Buffer.from([b ? 0xff : 0x00]); }

/*Z39.50 PDU Builders*/

/** INIT Request */
function buildInitRequest(): Buffer {
  const refId       = berTLV([0x02], berInt(1));
  const protVer     = Buffer.from([0xa0, 0x07, 0x80, 0x05, 0x50, 0x00, 0x00, 0x04, 0x00]);
  const options     = Buffer.from([0xa1, 0x07, 0x80, 0x05, 0xf6, 0xc0, 0x00, 0x00, 0x00]);
  const prefMsgSize = berTLV([0x02], berInt(1048576));
  const maxRecSize  = berTLV([0x06], berInt(1048576));
  const implId      = berTLV([0x61], berTLV([0x04], Buffer.from('81')));
  const implName    = berTLV([0x62], Buffer.from('LibraryScanner'));
  const implVer     = berTLV([0x63], Buffer.from('1.0'));
  const body = Buffer.concat([refId, protVer, options, prefMsgSize, maxRecSize, implId, implName, implVer]);
  return berTLV([0x30], berTLV([0xa0], body));
}

/**
 * Search Request — dùng @attr 4=6 (word-list AND) cho NLV
 *
 * NLV Zebra chỉ hỗ trợ:
 *   @attr 4=6  = word-list (AND các từ) ← dùng cái này
 *   @attr 4=1  = phrase (exact phrase)  ← NLV không hỗ trợ tốt
 *
 * Query phải là ASCII (bỏ dấu) vì NLV MARC-8 không nhận UTF-8.
 */
function buildSearchRequest(
  database: string,
  useAttr: number,
  queryStr: string,
  refId: number = 2,
): Buffer {
  // BIB-1 attribute set OID: 1.2.840.10003.3.1
  const BIB1_OID = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x13, 0x03, 0x01]);
  // USMARC OID: 1.2.840.10003.5.10
  const USMARC_OID = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x13, 0x05, 0x0a]);

  // Bỏ dấu tiếng Việt → ASCII trước khi gửi
  const asciiQuery = toAsciiQuery(queryStr);

  // Attribute 1 (Use): useAttr value
  const attrUse = berTLV([0x30], Buffer.concat([
    berTLV([0x02], berInt(1)),       // attributeType = 1
    berTLV([0x02], berInt(useAttr)),
  ]));

  // Attribute 4 (Structure): 6 = word-list
  const attrStruct = berTLV([0x30], Buffer.concat([
    berTLV([0x02], berInt(4)),  // attributeType = 4 (Structure)
    berTLV([0x02], berInt(6)),  // attributeValue = 6 (word-list AND)
  ]));

  // Attribute 5 (Truncation): 100 = do not truncate (default)
  // Skip - let server decide

  // AttributeList = SEQUENCE OF AttributeElement
  const attrList = berTLV([0x30], Buffer.concat([attrUse, attrStruct]));

  // term [2] general OCTET STRING
  const term = berTLV([0x82], Buffer.from(asciiQuery, 'ascii'));

  // AttributesPlusTerm
  const apt = berTLV([0x30], Buffer.concat([attrList, term]));

  // Operand [103] constructed = 0xBF 0x67
  const operand = berTLV([0xbf, 0x67], apt);

  // RPNStructure [1]
  const rpnStruct = berTLV([0xa1], operand);

  // RPNQuery SEQUENCE { attributeSet OID, rpn RPNStructure }
  const rpnQuery = berTLV([0x30], Buffer.concat([
    berTLV([0x06], BIB1_OID),
    rpnStruct,
  ]));

  // Query [1] RPNQuery
  const query = berTLV([0xa1], rpnQuery);

  // databaseNames: SEQUENCE { VisibleString }
  const dbNames = berTLV([0x30], berTLV([0x1b], Buffer.from(database)));

  // preferredRecordSyntax
  const prefSyntax = berTLV([0x19], USMARC_OID);

  const body = Buffer.concat([
    berTLV([0x02], berInt(refId)),         // referenceId
    berTLV([0x02], berInt(0)),             // smallSetUpperBound
    berTLV([0x02], berInt(0)),             // largeSetLowerBound
    berTLV([0x02], berInt(20)),            // mediumSetPresentNumber
    berTLV([0x01], berBool(true)),         // replaceIndicator
    berTLV([0x1a], Buffer.from('default')), // resultSetName
    berTLV([0x30], dbNames),               // databaseNames
    query,
    prefSyntax,
  ]);

  return berTLV([0x30], berTLV([0xa3], body));
}

/** Present Request */
function buildPresentRequest(start: number, count: number, refId: number = 3): Buffer {
  const USMARC_OID = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x13, 0x05, 0x0a]);
  const body = Buffer.concat([
    berTLV([0x02], berInt(refId)),
    berTLV([0x1a], Buffer.from('default')),  // resultSetId
    berTLV([0x06], berInt(start)),           // resultSetStartPoint
    berTLV([0x07], berInt(count)),           // numberOfRecordsRequested
    berTLV([0x19], USMARC_OID),              // preferredRecordSyntax
  ]);
  return berTLV([0x30], berTLV([0xa6], body));
}

/*MARC21 ISO2709 Parser*/

export interface MarcRecord {
  id: string;
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

function subfield(content: string, code: string): string {
  const re = new RegExp(`[\x1f$]${code}([^\x1f$\x1e]+)`, 'i');
  const m = re.exec(content);
  return m ? m[1].trim() : '';
}

export function parseMarcIso2709(raw: Buffer, index: number, source: string): MarcRecord | null {
  const rec: MarcRecord = {
    id: `z_${Date.now()}_${index}`,
    title: '', author: '', year: '', isbn: '', publisher: '',
    ddc: '', language: '', physical: '', pageCount: '',
    dimensions: '', summary: '', subjects: [], rawMarc: '', source,
  };

  try {
    // Dùng decodeMarc8 thay vì latin1 cứng — NLV có thể trả UTF-8
    const text = decodeMarc8(raw);
    rec.rawMarc = text;

    if (text.length < 24) return null;

    const baseAddr = parseInt(text.slice(12, 17), 10);
    if (isNaN(baseAddr) || baseAddr >= text.length) return null;

    const dir = text.slice(24, baseAddr - 1);
    for (let i = 0; i + 12 <= dir.length; i += 12) {
      const tag    = dir.slice(i, i + 3);
      const length = parseInt(dir.slice(i + 3, i + 7), 10);
      const offset = parseInt(dir.slice(i + 7, i + 12), 10);

      if (isNaN(length) || isNaN(offset)) continue;

      const fieldData = text.slice(baseAddr + offset, baseAddr + offset + length - 1);

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
        case '600': case '610': case '650': case '651': {
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
        let idx = 0;
        idx++; // skip outer tag byte
        if (idx >= buf.length) break;

        let pduLen: number;
        const lb = buf[idx];
        if (lb < 0x80) {
          pduLen = lb + idx + 1; idx++;
        } else if (lb === 0x81) {
          if (buf.length < idx + 2) break;
          pduLen = buf[idx + 1] + idx + 2; idx += 2;
        } else if (lb === 0x82) {
          if (buf.length < idx + 3) break;
          pduLen = ((buf[idx + 1] << 8) | buf[idx + 2]) + idx + 3; idx += 3;
        } else break;

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
          send(buildSearchRequest(database, useAttr, query));
          return;
        }

        if (phase === 'search') {
          const hits = extractSearchHits(pdu);
          totalHits = Math.min(hits, maxResults);

          if (totalHits === 0) { cleanup(); return; }

          phase = 'present';
          send(buildPresentRequest(1, totalHits));
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

    socket.connect(port, host, () => { send(buildInitRequest()); });
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
    const recLen = parseInt(lenStr, 10);

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
