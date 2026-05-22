import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { parseMarcIso2709, z3950Search, type MarcField, type MarcRecord } from './src/lib/z3950-client.js';

/*CONFIG */
const PORT = Number(process.env.PORT) || 3000;
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY1 ?? process.env.GEMINI_API_KEY)?.trim() ?? '';

if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('your')) {
  console.error('❌  GEMINI_API_KEY hoặc GEMINI_API_KEY1 chưa được cấu hình');
}

/*AI*/
const ai = GEMINI_API_KEY && !GEMINI_API_KEY.includes('your')
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

/*EXPRESS APP*/
export const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

/*HELPERS */
function requireAi(res: Response): boolean {
  if (!ai)   { res.status(400).json({ error: 'AI chưa được khởi tạo — kiểm tra GEMINI_API_KEY1' }); return false; }
  return true;
}

function hashPassword(plain: string): string {
  return crypto.createHash('sha256').update(plain + 'lib_salt_2024').digest('hex');
}

interface DemoUser {
  id: number;
  username: string;
  email: string;
  password: string;
}

let demoUserId = 1;
let demoBookId = 1;
const demoUsers: DemoUser[] = [
  {
    id: demoUserId++,
    username: 'admin',
    email: 'admin@gmail.com',
    password: hashPassword('admin123'),
  },
];
const demoBooks: any[] = [];

function extractJson(raw: string): string {
  const s = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  return (start !== -1 && end >= start) ? s.slice(start, end + 1) : s;
}

const EXTRACT_PROMPT = `
Bạn là CHUYÊN GIA THƯ VIỆN HỌC. Nhiệm vụ:
1. Nhận diện hình ảnh sách (bìa trước, bìa sau, mục lục, trang bản quyền...).
2. Đọc kỹ để lấy tóm tắt, mục lục và thông tin xuất bản.
   - Nếu ảnh chỉ có mục lục hoặc nội dung (không có bìa), dùng Google Search để xác định tên sách và tác giả.
3. Dùng Google Search để bổ sung thêm thông tin còn thiếu (ISBN, số trang, nhà xuất bản...).
   - Riêng DDC (082): CHỈ điền khi nhìn thấy trực tiếp trên ảnh, trang bản quyền/CIP, gáy nhãn thư viện, hoặc tìm được trong bản ghi thư mục đáng tin cậy có trường DDC/082.
   - KHÔNG suy đoán DDC theo thể loại, tên sách, tác giả hoặc chủ đề. Nếu không có nguồn rõ ràng, để "ddc": "".
   - Không dùng một mã DDC mặc định/lặp lại cho nhiều sách. Sách văn học, thiếu nhi, kỹ năng... có thể cùng lớp rộng nhưng vẫn không được tự gán nếu thiếu nguồn.

[YÊU CẦU BẮT BUỘC]
- Trả về DUY NHẤT một JSON hợp lệ. KHÔNG thêm văn bản, giải thích hay markdown bên ngoài.
- Trường thiếu để chuỗi rỗng "".

{
  "title": "Tên sách (245)",
  "author": "Tác giả (100)",
  "year": 2024,
  "publisher": "Nhà xuất bản",
  "isbn": "ISBN",
  "ddc": "Phân loại DDC nếu có nguồn rõ ràng, nếu không để chuỗi rỗng",
  "language": "vie",
  "physical": "Mô tả vật lý",
  "pageCount": "Số trang",
  "dimensions": "Khổ sách",
  "summary": "Tóm tắt nội dung",
  "toc": "Mục lục (nếu có)",
  "subjects": ["Chủ đề 1", "Chủ đề 2"]
}
`.trim();

/*AUTH ROUTES  (in-memory)*/

// POST /api/auth/register
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { username, email, password } = req.body;

  if (!username?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
  }
  if (password.length < 3) {
    return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 3 ký tự' });
  }

  const cleanUsername = username.trim();
  const cleanEmail = email.trim();
  const exists = demoUsers.some(
    user => user.username === cleanUsername || user.email === cleanEmail
  );

  if (exists) {
    return res.status(409).json({ error: 'Email hoặc tên đăng nhập đã tồn tại' });
  }

  const user = {
    id: demoUserId++,
    username: cleanUsername,
    email: cleanEmail,
    password: hashPassword(password),
  };
  demoUsers.push(user);
  return res.status(201).json({ id: user.id, username: user.username, email: user.email });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
  }

  const cleanUsername = username.trim();
  const hashedPassword = hashPassword(password);
  const user = demoUsers.find(
    item => item.username === cleanUsername && item.password === hashedPassword
  );

  if (!user) {
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
  }

  return res.json({ id: user.id, username: user.username, email: user.email });
});

/*BOOK ROUTES*/

// POST /api/extract
app.post('/api/extract', upload.array('images', 10), async (req: Request, res: Response) => {
  if (!requireAi(res)) return;

  const files = req.files as Express.Multer.File[];
  if (!files?.length) return res.status(400).json({ error: 'Vui lòng upload ít nhất 1 ảnh' });

  const parts: any[] = [
    { text: EXTRACT_PROMPT },
    ...files.map(f => ({ inlineData: { data: f.buffer.toString('base64'), mimeType: f.mimetype } })),
  ];

  let response;
  let useSearch = true;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await ai!.models.generateContent({
        model: 'gemini-flash-latest',
        contents: [{ role: 'user', parts }],
        config: useSearch ? { tools: [{ googleSearch: {} }] } : undefined,
      });
      break;
    } catch (err: any) {
      const status = err?.status ?? 0;
      if (status === 429) {
        if (useSearch) {
          console.warn('');
          useSearch = false; continue;
        }
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      } else if (status === 503) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      } else throw err;
      if (attempt === 2) throw err;
    }
  }

  if (!response) return res.status(500).json({ error: 'AI không phản hồi sau 3 lần thử' });

  try {
    res.json(JSON.parse(extractJson(response.text ?? '{}')));
  } catch {
    res.status(500).json({ error: 'AI không trả về JSON hợp lệ', raw: response.text });
  }
});

// GET /api/books
app.get('/api/books', async (_req: Request, res: Response) => {
  return res.json([...demoBooks].sort((a, b) => b.id - a.id));
});

// POST /api/books
app.post('/api/books', async (req: Request, res: Response) => {
  const {
    title, author, year, isbn, ddc, publisher,
    language, physical, pageCount, dimensions,
    summary, toc, subjects, rawOcrText,
    rawMarc, marcLeader, marcFields,
    searchSnippet,
    subtitle, publishedDate, isbn10, isbn13, mainCategory,
    googleBooksId, selfLink, previewLink, infoLink, canonicalVolumeLink,
    thumbnail, printType, averageRating, ratingsCount, maturityRating,
    contentVersion, saleability, isEbook, country, viewability,
    accessViewStatus, embeddable, publicDomain, webReaderLink,
  } = req.body;

  const subjectsStr = Array.isArray(subjects) ? subjects.join('; ') : (subjects ?? '');

  const book = {
    id: demoBookId++,
    title: title || 'Không rõ',
    author: author || '',
    publishYear: year ? Number(year) : null,
    isbn: isbn || '',
    ddc: ddc || '',
    publisher: publisher || '',
    language: language || '',
    physical: physical || '',
    pageCount: pageCount || '',
    dimensions: dimensions || '',
    summary: summary || '',
    searchSnippet: searchSnippet || '',
    toc: toc || '',
    subjects: subjectsStr,
    rawMarc: rawOcrText || rawMarc || '',
    marcLeader: marcLeader || '',
    marcFields: Array.isArray(marcFields) ? marcFields : [],
    subtitle: subtitle || '',
    publishedDate: publishedDate || '',
    isbn10: isbn10 || '',
    isbn13: isbn13 || '',
    mainCategory: mainCategory || '',
    googleBooksId: googleBooksId || '',
    selfLink: selfLink || '',
    previewLink: previewLink || '',
    infoLink: infoLink || '',
    canonicalVolumeLink: canonicalVolumeLink || '',
    thumbnail: thumbnail || '',
    printType: printType || '',
    averageRating: averageRating || '',
    ratingsCount: ratingsCount || '',
    maturityRating: maturityRating || '',
    contentVersion: contentVersion || '',
    saleability: saleability || '',
    isEbook: isEbook || '',
    country: country || '',
    viewability: viewability || '',
    accessViewStatus: accessViewStatus || '',
    embeddable: embeddable || '',
    publicDomain: publicDomain || '',
    webReaderLink: webReaderLink || '',
  };
  demoBooks.push(book);
  return res.status(201).json({ id: book.id, title: book.title, author: book.author });
});
// DELETE /api/books/:id
app.delete('/api/books/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID không hợp lệ' });

  const index = demoBooks.findIndex(book => book.id === id);
  if (index === -1) return res.status(404).json({ error: 'Không tìm thấy sách' });
  demoBooks.splice(index, 1);
  return res.json({ success: true, id });
});
// GET /api/catalog/search?host
app.get('/api/catalog/search', async (req: Request, res: Response) => {
  const {
    host,
    port,
    database,
    searchType = 'title',
    query,
  } = req.query as Record<string, string>;

  if (!host || !port || !database || !query?.trim()) {
    return res.status(400).json({ error: 'Thiếu tham số: host, port, database, query' });
  }

  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return res.status(400).json({ error: 'Port không hợp lệ' });
  }

  // Đặt timeout cho response để client không treo vô hạn
  const resTimer = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: `Hết thời gian chờ kết nối Z39.50 tới ${host}:${portNum}` });
  }, 22000);

  try {
    const records = await z3950Search({
      host,
      port: portNum,
      database,
      searchType,
      query: query.trim(),
      maxResults: 20,
      timeoutMs: 20000,
    });

    clearTimeout(resTimer);
    if (!res.headersSent) res.json({
      records,
      total: records.length,
      source: `${host}:${portNum}/${database}`,
    });
  } catch (err: any) {
    clearTimeout(resTimer);
    console.error('GET /api/catalog/search', err.message);
    if (!res.headersSent) res.status(502).json({ error: err.message || 'Lỗi kết nối Z39.50' });
  }
});

/*NLV SCRAPE — tìm kiếm opac.nlv.gov.vn qua HTTP (không cần Z39.50 TCP)*/

// NLV OPAC search: mô phỏng POST /Search của website, rồi tải MARC ISO2709 từ trang chi tiết.
app.get('/api/catalog/search-nlv-opac', async (req: Request, res: Response) => {
  const { searchType = 'title', query } = req.query as Record<string, string>;
  if (!query?.trim()) return res.status(400).json({ error: 'Thiáº¿u tham sá»‘ query' });

  const cacheKey = `${searchType}:${query.toLowerCase().trim()}`;
  const cached = nlvOpacCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < NLV_OPAC_CACHE_TTL) {
    return res.json({
      records: cached.records,
      total: cached.total,
      returned: cached.records.length,
      source: 'Thư viện Quốc gia Việt Nam OPAC',
    });
  }

  try {
    const result = await searchNlvOpac(searchType, query.trim());
    nlvOpacCache.set(cacheKey, { ts: Date.now(), records: result.records, total: result.total });
    res.json({
      records: result.records,
      total: result.total,
      returned: result.records.length,
      source: 'Thư viện Quốc gia Việt Nam OPAC',
    });
  } catch (err: any) {
    console.error('GET /api/catalog/search-nlv-opac', err.message);
    res.status(502).json({ error: `Không thể tìm trên OPAC Thư viện Quốc gia Việt Nam: ${err.message}` });
  }
});

// Google Books search, reranked locally for Vietnamese cataloging.
app.get('/api/catalog/search-nlv', async (req: Request, res: Response) => {
  const { searchType = 'title', query } = req.query as Record<string, string>;
  if (!query?.trim()) return res.status(400).json({ error: 'Thiếu tham số query' });

  try {
    const records = await searchVietnameseBooks(searchType, query.trim());
    res.json({ records, total: records.length, source: 'Google Books' });
  } catch (err: any) {
    console.error('GET /api/catalog/search-nlv', err.message);
    res.status(502).json({ error: `Lỗi tìm kiếm: ${err.message}` });
  }
});

/*Tìm sách tiếng Việt qua Google Books API*/

// Cache đơn giản: key = "searchType:query", TTL 10 phút
const gbCache = new Map<string, { ts: number; result: object[] }>();
const GB_CACHE_TTL = 10 * 60 * 1000;
const GOOGLE_BOOKS_MAX_RESULTS = 20;
const GOOGLE_BOOKS_RETURN_LIMIT = 12;
const NLV_OPAC_BASE_URL = 'https://opac.nlv.gov.vn';
const NLV_OPAC_TIMEOUT_MS = 20000;
const NLV_OPAC_MAX_RESULTS = 10;
const NLV_OPAC_CACHE_TTL = 5 * 60 * 1000;
const LOC_SRU_TIMEOUT_MS = 30000;
const LOC_SRU_MAX_RECORDS = 10;
const LOC_SRU_BASE_URLS = [
  'https://lx2.loc.gov/sru/lcdb',
  'http://lx2.loc.gov:210/lcdb',
];

const nlvOpacCache = new Map<string, { ts: number; records: object[]; total: number }>();

type CatalogSearchType = 'title' | 'author' | 'isbn' | 'keyword';

interface NlvOpacSession {
  token: string;
  cookie: string;
}

interface NlvOpacRow {
  opacId: string;
  href: string;
  slug: string;
  title: string;
  author: string;
  year: string;
  publisher: string;
  ddc: string;
  physical: string;
  pageCount: string;
  dimensions: string;
  summary: string;
  subjects: string[];
}

interface GoogleBooksSearchPlan {
  q: string;
  langRestrict?: string;
}

interface GoogleBookResult {
  item: any;
  planIndex: number;
  itemIndex: number;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value = ''): string {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitSetCookie(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(/,(?=\s*[^;,=]+=[^;,]+)/g)
    .map(part => part.split(';')[0].trim())
    .filter(Boolean);
}

function extractVerificationToken(html: string): string {
  return html.match(/id=requestVerificationToken value=([^>\s]+)/)?.[1]
    ?? html.match(/id=["']requestVerificationToken["'][^>]*value=["']([^"']+)/)?.[1]
    ?? '';
}

function normalizeNlvCookie(resp: globalThis.Response): string {
  return splitSetCookie(resp.headers.get('set-cookie')).join('; ');
}

function mapNlvSearchOption(searchType: string): string {
  const map: Record<string, string> = {
    title: 'ti',
    author: 'au',
    isbn: 'bn',
    keyword: 'kw',
  };
  return map[searchType] ?? 'qs';
}

function parseYear(value: string): string {
  return (value.match(/\b(1[5-9]\d{2}|20\d{2})\b/) || [])[0] ?? '';
}

function parsePublisher(publication: string): string {
  return publication
    .replace(/\b(1[5-9]\d{2}|20\d{2})\b.*$/, '')
    .replace(/^[^:]*:\s*/, '')
    .replace(/[.,;:\s-]+$/g, '')
    .trim();
}

function parsePhysicalParts(physical: string): { pageCount: string; dimensions: string } {
  const pageCount = (physical.match(/(\d+)\s*(?:tr|tr\.|p|p\.)/i) || physical.match(/(\d+)/))?.[1] ?? '';
  const dimensions = (physical.match(/(\d+(?:\s*x\s*\d+)?\s*cm)\b/i) || [])[1] ?? '';
  return { pageCount, dimensions };
}

function extractParagraphValue(block: string, label: string): string {
  const re = new RegExp(`${escapeRegExp(label)}:\\s*<span[^>]*>([\\s\\S]*?)<\\/span>`, 'i');
  return stripHtml(re.exec(block)?.[1] ?? '');
}

function extractNlvSubjects(block: string): string[] {
  const subjectBlock = block.match(/Từ khóa:\s*([\s\S]*?)(?:<\/p>|<p|$)/i)?.[1] ?? '';
  return [...subjectBlock.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(match => stripHtml(match[1]))
    .filter(Boolean)
    .slice(0, 8);
}

function parseNlvOpacTotal(html: string, rowsLength: number): number {
  const text = stripHtml(html);
  const match = text.match(/Kết quả\s+\d+\s*-\s*\d+\s+trong\s+([\d.,]+)/i);
  if (!match) return rowsLength;
  return Number(match[1].replace(/[^\d]/g, '')) || rowsLength;
}

function parseNlvOpacRows(html: string): NlvOpacRow[] {
  const blockRe = /<div\s+data-id="([^"]+)"\s+class="result-block__main__bookContainer"[\s\S]*?(?=<div\s+data-id="[^"]+"\s+class="result-block__main__bookContainer"|<nav|$)/gi;
  const rows: NlvOpacRow[] = [];

  for (const match of html.matchAll(blockRe)) {
    const block = match[0];
    const titleMatch = block.match(/<a[^>]*class=['"]result-block__main__bookContainer__info_title['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i);
    const href = decodeHtmlEntities(titleMatch?.[1] ?? '');
    const title = stripHtml(titleMatch?.[2] ?? '');
    const author = stripHtml(block.match(/<p class=['"]authors['"]>([\s\S]*?)<\/p>/i)?.[1] ?? '')
      .replace(/^Tác giả:\s*/i, '')
      .replace(/\s*;\s*/g, '; ')
      .trim();
    const publication = extractParagraphValue(block, 'Thông tin xuất bản');
    const physical = extractParagraphValue(block, 'Thông tin vật lý');
    const physicalParts = parsePhysicalParts(physical);

    rows.push({
      opacId: match[1],
      href,
      slug: href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '',
      title,
      author,
      year: parseYear(publication),
      publisher: parsePublisher(publication),
      ddc: extractParagraphValue(block, 'Phân loại').split('/')[0]?.trim() ?? '',
      physical,
      pageCount: physicalParts.pageCount,
      dimensions: physicalParts.dimensions,
      summary: stripHtml(block.match(/result-block__main__bookContainer__info_summary[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ''),
      subjects: extractNlvSubjects(block),
    });
  }

  return rows.filter(row => row.title || row.opacId);
}

function getMarcSubfield(fields: MarcField[], tag: string, code: string): string {
  const field = fields.find(item => item.tag === tag && item.subfields?.some(sub => sub.code === code));
  return field?.subfields?.find(sub => sub.code === code)?.value ?? '';
}

function getMarcSubfields(fields: MarcField[], tags: string[], code: string): string[] {
  return fields
    .filter(field => tags.includes(field.tag))
    .flatMap(field => field.subfields?.filter(sub => sub.code === code).map(sub => sub.value) ?? [])
    .filter(Boolean);
}

function buildRecordFromMarcFields(fields: MarcField[], index: number, source: string, rawMarc = '', leader = ''): MarcRecord | null {
  if (fields.length === 0) return null;

  const titleA = getMarcSubfield(fields, '245', 'a').replace(/[/:]+$/, '').trim();
  const titleB = getMarcSubfield(fields, '245', 'b').replace(/[/:]+$/, '').trim();
  const physical = getMarcSubfield(fields, '300', 'a');
  const physicalParts = parsePhysicalParts(physical);
  const yearValue = getMarcSubfield(fields, '260', 'c') || getMarcSubfield(fields, '264', 'c');

  return {
    id: `nlv_${Date.now()}_${index}`,
    marcLeader: leader,
    marcFields: fields,
    title: [titleA, titleB].filter(Boolean).join(' ').trim(),
    author: getMarcSubfield(fields, '100', 'a') || getMarcSubfield(fields, '700', 'a'),
    year: parseYear(yearValue),
    isbn: getMarcSubfield(fields, '020', 'a'),
    publisher: getMarcSubfield(fields, '260', 'b') || getMarcSubfield(fields, '264', 'b'),
    ddc: getMarcSubfield(fields, '082', 'a'),
    language: getMarcSubfield(fields, '041', 'a'),
    physical,
    pageCount: physicalParts.pageCount,
    dimensions: getMarcSubfield(fields, '300', 'c') || physicalParts.dimensions,
    summary: getMarcSubfield(fields, '520', 'a'),
    subjects: getMarcSubfields(fields, ['600', '610', '650', '651', '653'], 'a').slice(0, 8),
    rawMarc,
    source,
  };
}

function parseNlvMarcTable(detailHtml: string, index: number, source: string): MarcRecord | null {
  const table = detailHtml.match(/<table[^>]*class=["'][^"']*marc21[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) return null;

  const fields: MarcField[] = [];
  let current: MarcField | null = null;

  for (const rowMatch of table.matchAll(/<tr[^>]*>([\s\S]*?)(?=<tr|<\/tbody>|<\/table>|$)/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)(?=<td|<\/tr>|$)/gi)]
      .map(cell => stripHtml(cell[1]).replace(/^#$/, ''));
    if (cells.length < 5) continue;

    const [tag, ind1, ind2, code, value] = cells;
    if (tag) {
      current = /^\d{3}$/.test(tag) && code
        ? { tag, ind1: ind1 || ' ', ind2: ind2 || ' ', subfields: [], raw: `${ind1 || ' '}${ind2 || ' '}` }
        : { tag, value, raw: value };
      fields.push(current);
    }

    if (current?.subfields && code && value) {
      current.subfields.push({ code, value });
      current.raw += `\x1f${code}${value}`;
    } else if (current && value && !current.value) {
      current.value = value;
      current.raw = value;
    }
  }

  return buildRecordFromMarcFields(fields, index, source, '', '');
}

function mergeNlvRowWithMarc(row: NlvOpacRow, marc: MarcRecord | null, index: number): object {
  const detailUrl = row.href ? new URL(row.href, NLV_OPAC_BASE_URL).toString() : '';
  return {
    ...(marc ?? {}),
    id: `nlv_${row.opacId || index}`,
    opacId: row.opacId,
    title: marc?.title || row.title,
    author: marc?.author || row.author,
    year: marc?.year || row.year,
    isbn: marc?.isbn || '',
    publisher: marc?.publisher || row.publisher,
    ddc: marc?.ddc || row.ddc,
    language: marc?.language || '',
    physical: marc?.physical || row.physical,
    pageCount: marc?.pageCount || row.pageCount,
    dimensions: marc?.dimensions || row.dimensions,
    summary: marc?.summary || row.summary,
    searchSnippet: row.summary,
    subjects: marc?.subjects?.length ? marc.subjects : row.subjects,
    rawMarc: marc?.rawMarc || '',
    marcLeader: marc?.marcLeader || '',
    marcFields: marc?.marcFields || [],
    source: 'Thư viện Quốc gia Việt Nam OPAC',
    infoLink: detailUrl,
    canonicalVolumeLink: detailUrl,
  };
}

async function createNlvOpacSession(pathname = '/tim-kiem'): Promise<NlvOpacSession> {
  const resp = await fetch(`${NLV_OPAC_BASE_URL}${pathname}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*' },
    signal: AbortSignal.timeout(NLV_OPAC_TIMEOUT_MS),
  });

  if (!resp.ok) throw new Error(`OPAC trả về HTTP ${resp.status}`);
  const html = await resp.text();
  return { token: extractVerificationToken(html), cookie: normalizeNlvCookie(resp) };
}

async function fetchNlvOpacSearchHtml(searchType: string, query: string, session: NlvOpacSession): Promise<string> {
  const payload = {
    type: 'quick',
    page: 1,
    pageSize: NLV_OPAC_MAX_RESULTS,
    request: {
      searchBy: [['option', mapNlvSearchOption(searchType)], ['keyword', query]],
      sortBy: [['year_pub', 'desc']],
      filterBy: [],
    },
    hasFacetFilter: true,
  };

  const resp = await fetch(`${NLV_OPAC_BASE_URL}/Search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'RequestVerificationToken': session.token,
      'Cookie': session.cookie,
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/html,*/*',
      'Referer': `${NLV_OPAC_BASE_URL}/tim-kiem`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(NLV_OPAC_TIMEOUT_MS),
  });

  if (!resp.ok) throw new Error(`/Search trả về HTTP ${resp.status}`);
  return resp.text();
}

async function fetchNlvOpacMarc(row: NlvOpacRow, index: number): Promise<MarcRecord | null> {
  if (!row.slug) return null;

  const detailPath = row.href.startsWith('/') ? row.href : `/chi-tiet-tai-lieu/${row.slug}`;
  const detailUrl = new URL(detailPath, NLV_OPAC_BASE_URL).toString();
  const detailResp = await fetch(detailUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*' },
    signal: AbortSignal.timeout(NLV_OPAC_TIMEOUT_MS),
  });
  if (!detailResp.ok) throw new Error(`detail ${row.slug} trả về HTTP ${detailResp.status}`);

  const detailHtml = await detailResp.text();
  const detailToken = extractVerificationToken(detailHtml);
  const detailCookie = normalizeNlvCookie(detailResp);
  const detailTitle = stripHtml(detailHtml.match(/<p class=top-block__infoBlock__title>([\s\S]*?)(?:<div|<\/p>)/i)?.[1] ?? '')
    || decodeHtmlEntities(detailHtml.match(/<meta property=og:title content="([^"]+)"/i)?.[1] ?? '')
    || row.title;

  const downloadUrl = `${NLV_OPAC_BASE_URL}/download-marc?slug=${encodeURIComponent(row.slug)}&title=${encodeURIComponent(detailTitle)}`;
  const marcResp = await fetch(downloadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'RequestVerificationToken': detailToken,
      'Cookie': detailCookie,
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/octet-stream,text/plain,*/*',
      'Referer': detailUrl,
    },
    signal: AbortSignal.timeout(NLV_OPAC_TIMEOUT_MS),
  });

  const marcBuffer = Buffer.from(await marcResp.arrayBuffer());
  const contentType = marcResp.headers.get('content-type') ?? '';
  if (marcResp.ok && !contentType.includes('text/html') && !marcBuffer.toString('utf8', 0, 20).startsWith('<')) {
    const parsed = parseMarcIso2709(marcBuffer, index, 'Thư viện Quốc gia Việt Nam OPAC');
    if (parsed) return parsed;
  }

  return parseNlvMarcTable(detailHtml, index, 'Thư viện Quốc gia Việt Nam OPAC');
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const current = next++;
      results[current] = await mapper(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function searchNlvOpac(searchType: string, query: string): Promise<{ records: object[]; total: number }> {
  const session = await createNlvOpacSession();
  const html = await fetchNlvOpacSearchHtml(searchType, query, session);
  const rows = parseNlvOpacRows(html);
  const total = parseNlvOpacTotal(html, rows.length);

  const records = await mapWithConcurrency(rows.slice(0, NLV_OPAC_MAX_RESULTS), 4, async (row, index) => {
    try {
      const marc = await fetchNlvOpacMarc(row, index);
      return mergeNlvRowWithMarc(row, marc, index);
    } catch (err: any) {
      console.warn(`NLV OPAC MARC ${row.slug || row.opacId} failed: ${err.message}`);
      return mergeNlvRowWithMarc(row, null, index);
    }
  });

  return { records, total };
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (resp.status === 429) {
      if (attempt === maxRetries) throw new Error(`Google Books trả về HTTP 429 (quá giới hạn rate limit sau ${maxRetries + 1} lần thử)`);
      const retryAfter = Number(resp.headers.get('Retry-After') ?? 0);
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt + Math.random() * 500, 16000);
      console.warn(`Google Books 429 — thử lại sau ${Math.round(delay)}ms (lần ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    if (!resp.ok) throw new Error(`Google Books trả về HTTP ${resp.status}`);
    return resp.json();
  }
}

function cleanSearchTerm(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/"/g, '');
}

function quoteSearchTerm(value: string): string {
  return `"${cleanSearchTerm(value)}"`;
}

function normalizeForMatch(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function extractIsbn(value: string): string {
  const compact = value.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (compact.length === 10 || compact.length === 13) return compact;
  const found = value.match(/(?:97[89][-\s]?)?\d[-\s\d]{8,}[\dXx]/);
  return found ? found[0].replace(/[^0-9Xx]/g, '').toUpperCase() : compact;
}

function buildGoogleBooksPlans(searchType: string, query: string): GoogleBooksSearchPlan[] {
  const type = (['title', 'author', 'isbn', 'keyword'].includes(searchType) ? searchType : 'keyword') as CatalogSearchType;
  const term = cleanSearchTerm(query);
  const exact = quoteSearchTerm(term);
  const isbn = extractIsbn(term);
  const plans: GoogleBooksSearchPlan[] = [];

  if (type === 'isbn') {
    plans.push({ q: `isbn:${isbn || term}` });
  } else if (type === 'title') {
    plans.push(
      { q: term, langRestrict: 'vi' },
      { q: term },
      { q: exact, langRestrict: 'vi' },
      { q: `intitle:${term}`, langRestrict: 'vi' },
      { q: `intitle:${exact}` },
      { q: exact },
    );
  } else if (type === 'author') {
    plans.push(
      { q: `inauthor:${exact}` },
      { q: `inauthor:${term}` },
      { q: exact },
    );
  } else {
    plans.push(
      { q: exact, langRestrict: 'vi' },
      { q: term, langRestrict: 'vi' },
      { q: exact },
      { q: term },
    );
  }

  const seen = new Set<string>();
  return plans.filter(plan => {
    const key = `${plan.q}|${plan.langRestrict ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(plan.q.trim());
  });
}

function getGoogleBooksIdentifier(vi: any, type: string): string {
  return (vi.industryIdentifiers ?? []).find((item: any) => item.type === type)?.identifier ?? '';
}

function formatGoogleBooksDimensions(dimensions: any): string {
  if (!dimensions || typeof dimensions !== 'object') return '';
  return [dimensions.height, dimensions.width, dimensions.thickness]
    .filter(Boolean)
    .join(' x ');
}

function boolLabel(value: unknown): string {
  if (value === true) return 'Có';
  if (value === false) return 'Không';
  return '';
}

function uniqueNonEmpty(values: unknown[]): string[] {
  return [...new Set(values.map(value => String(value ?? '').trim()).filter(Boolean))];
}

function cleanHtmlSnippet(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function googleBookDedupeKey(item: any): string {
  const vi = item.volumeInfo ?? {};
  const isbn13 = (vi.industryIdentifiers ?? []).find((x: any) => x.type === 'ISBN_13')?.identifier;
  const isbn10 = (vi.industryIdentifiers ?? []).find((x: any) => x.type === 'ISBN_10')?.identifier;
  const isbn = String(isbn13 || isbn10 || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (isbn) return `isbn:${isbn}`;

  const title = normalizeForMatch(vi.title);
  const author = normalizeForMatch((vi.authors ?? []).join(' '));
  return `book:${title}|${author}`;
}

async function fetchGoogleBooksPlan(plan: GoogleBooksSearchPlan): Promise<any[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  const params = new URLSearchParams({
    q: plan.q,
    maxResults: String(GOOGLE_BOOKS_MAX_RESULTS),
    printType: 'books',
    orderBy: 'relevance',
  });
  if (plan.langRestrict) params.set('langRestrict', plan.langRestrict);
  if (apiKey) params.set('key', apiKey);

  const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;
  const safeUrl = apiKey ? url.replace(apiKey, '***KEY***') : url;
  console.log(`[GB] URL: ${safeUrl}`);

  const data = await fetchWithRetry(url);
  console.log(`[GB] totalItems=${data.totalItems ?? 0}, items=${(data.items ?? []).length}, error=${JSON.stringify(data.error ?? null)}`);
  if (data.error) throw new Error(`Google Books API lỗi: ${data.error.message ?? JSON.stringify(data.error)}`);

  return Array.isArray(data.items) ? data.items : [];
}

async function searchGoogleBooks(searchType: string, query: string): Promise<object[]> {
  const plans = buildGoogleBooksPlans(searchType, query);
  const deduped = new Map<string, GoogleBookResult>();

  for (const [planIndex, plan] of plans.entries()) {
    const items = await fetchGoogleBooksPlan(plan);
    items.forEach((item, itemIndex) => {
      const key = googleBookDedupeKey(item);
      const googleBook = {
        item,
        planIndex,
        itemIndex,
      };
      if (!deduped.has(key)) {
        deduped.set(key, googleBook);
      }
    });
  }

  return [...deduped.values()]
    .slice(0, GOOGLE_BOOKS_RETURN_LIMIT)
    .map((googleBook, i) => {
      const vi = googleBook.item.volumeInfo ?? {};
      const saleInfo = googleBook.item.saleInfo ?? {};
      const accessInfo = googleBook.item.accessInfo ?? {};
      const isbn13 = getGoogleBooksIdentifier(vi, 'ISBN_13');
      const isbn10 = getGoogleBooksIdentifier(vi, 'ISBN_10');
      const otherIdentifier = (vi.industryIdentifiers ?? []).find((x: any) => x.identifier)?.identifier ?? '';
      const isbn = isbn13 || isbn10 || otherIdentifier;
      const authors = (vi.authors ?? []).join('; ');
      const year = (vi.publishedDate ?? '').slice(0, 4);
      const language = vi.language === 'vi' ? 'vie' : (vi.language ?? '');
      const subjects = uniqueNonEmpty([vi.mainCategory, ...(vi.categories ?? [])]).slice(0, 8);
      const pageCount = vi.pageCount ? String(vi.pageCount) : '';
      const dimensions = formatGoogleBooksDimensions(vi.dimensions);
      const physical = [pageCount ? `${pageCount} trang` : '', dimensions].filter(Boolean).join('; ');
      const thumbnail = (vi.imageLinks?.thumbnail ?? vi.imageLinks?.smallThumbnail ?? '').replace(/^http:/, 'https:');
      const rawMarc = {
        id: googleBook.item.id,
        selfLink: googleBook.item.selfLink,
        volumeInfo: vi,
        saleInfo,
        accessInfo,
      };

      return {
        id: `gb_${googleBook.item.id ?? i}_${i}`,
        title: vi.title ?? '',
        subtitle: vi.subtitle ?? '',
        author: authors,
        year,
        publishedDate: vi.publishedDate ?? '',
        isbn,
        isbn10,
        isbn13,
        publisher: vi.publisher ?? '',
        ddc: '',
        language,
        physical,
        pageCount,
        dimensions,
        summary: vi.description ? vi.description.slice(0, 1200) : '',
        searchSnippet: cleanHtmlSnippet(googleBook.item.searchInfo?.textSnippet),
        subjects,
        mainCategory: vi.mainCategory ?? '',
        googleBooksId: googleBook.item.id ?? '',
        selfLink: googleBook.item.selfLink ?? '',
        previewLink: vi.previewLink ?? '',
        infoLink: vi.infoLink ?? '',
        canonicalVolumeLink: vi.canonicalVolumeLink ?? '',
        thumbnail,
        printType: vi.printType ?? '',
        averageRating: vi.averageRating ? String(vi.averageRating) : '',
        ratingsCount: vi.ratingsCount ? String(vi.ratingsCount) : '',
        maturityRating: vi.maturityRating ?? '',
        contentVersion: vi.contentVersion ?? '',
        saleability: saleInfo.saleability ?? '',
        isEbook: boolLabel(saleInfo.isEbook),
        country: saleInfo.country ?? '',
        viewability: accessInfo.viewability ?? '',
        accessViewStatus: accessInfo.accessViewStatus ?? '',
        embeddable: boolLabel(accessInfo.embeddable),
        publicDomain: boolLabel(accessInfo.publicDomain),
        webReaderLink: accessInfo.webReaderLink ?? '',
        rawMarc: JSON.stringify(rawMarc).slice(0, 5000),
        source: 'Google Books',
      };
    });
}

async function searchVietnameseBooks(searchType: string, query: string): Promise<object[]> {
  const cacheKey = `${searchType}:${query.toLowerCase().trim()}`;
  const cached = gbCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < GB_CACHE_TTL) return cached.result;

  const result = await searchGoogleBooks(searchType, query);
  if (result.length > 0) {
    gbCache.set(cacheKey, { ts: Date.now(), result });
    return result;
  }

  const fallback = ai ? await searchWithGemini(searchType, query) : [];

  gbCache.set(cacheKey, { ts: Date.now(), result: fallback });
  return fallback;
}

const SEARCH_PROMPT = (searchType: string, query: string) => `
Bạn là chuyên gia thư viện. Hãy tìm kiếm thông tin về sách theo yêu cầu sau và trả về danh sách kết quả.

Loại tìm kiếm: ${searchType === 'title' ? 'Tên sách' : searchType === 'author' ? 'Tác giả' : searchType === 'isbn' ? 'ISBN' : 'Từ khóa'}
Từ khóa: "${query}"

Dùng Google Search để tìm kiếm, ưu tiên sách tiếng Việt, sách xuất bản tại Việt Nam.
Tìm tối đa 10 cuốn sách phù hợp nhất.
Riêng trường DDC: chỉ điền nếu nguồn tìm được hiển thị rõ DDC/082. Nếu không chắc chắn, để chuỗi rỗng. Không suy đoán DDC theo thể loại.

Trả về DUY NHẤT một JSON hợp lệ theo định dạng sau, KHÔNG thêm văn bản hay markdown:
{
  "books": [
    {
      "title": "Tên sách",
      "author": "Tác giả",
      "year": "2024",
      "publisher": "Nhà xuất bản",
      "isbn": "ISBN nếu có",
      "ddc": "Phân loại DDC nếu nguồn hiển thị rõ, nếu không để rỗng",
      "language": "vie",
      "pageCount": "Số trang nếu biết",
      "dimensions": "Khổ sách nếu biết",
      "summary": "Tóm tắt ngắn",
      "subjects": ["Chủ đề 1", "Chủ đề 2"]
    }
  ]
}
`.trim();

async function searchWithGemini(searchType: string, query: string): Promise<object[]> {
  if (!ai) return [];
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: [{ role: 'user', parts: [{ text: SEARCH_PROMPT(searchType, query) }] }],
      config: { tools: [{ googleSearch: {} }] },
    });

    const raw = response.text ?? '';
    const parsed = JSON.parse(extractJson(raw));
    const books: any[] = parsed.books ?? [];

    return books.map((b: any, i: number) => ({
      id:         `gemini_${i}_${Date.now()}`,
      title:      b.title      ?? '',
      author:     b.author     ?? '',
      year:       String(b.year ?? ''),
      isbn:       b.isbn       ?? '',
      publisher:  b.publisher  ?? '',
      ddc:        b.ddc        ?? '',
      language:   b.language   ?? 'vie',
      physical:   '',
      pageCount:  String(b.pageCount ?? ''),
      dimensions: b.dimensions ?? '',
      summary:    b.summary    ?? '',
      subjects:   Array.isArray(b.subjects) ? b.subjects.slice(0, 6) : [],
      rawMarc:    '',
      source:     'Gemini + Google Search',
    }));
  } catch (err: any) {
    console.warn('[Gemini Search] lỗi:', err.message);
    return [];
  }
}

/*LOC SRU — Library of Congress LCDB/Folio qua HTTPS (không cần Z39.50 TCP)*/

// GET /api/catalog/search-loc?searchType=title|author|isbn|keyword&query=...
app.get('/api/catalog/search-loc', async (req: Request, res: Response) => {
  const { searchType = 'title', query } = req.query as Record<string, string>;
  if (!query?.trim()) return res.status(400).json({ error: 'Thiếu tham số query' });

  // Map sang CQL index của LOC SRU
  const indexMap: Record<string, string> = {
    title:   'dc.title',
    author:  'dc.creator',
    isbn:    'bath.isbn',
    keyword: 'cql.anywhere',
  };
  const cqlIndex = indexMap[searchType] ?? 'cql.anywhere';
  // LOC LCDB/Folio hỗ trợ SRU/CQL. Với ISBN, LOC khuyến nghị bỏ dấu gạch nối.
  const cleanQ = searchType === 'isbn'
    ? query.replace(/[^0-9Xx]/g, '')
    : query.trim().replace(/"/g, '');
  const cqlQuery = `${cqlIndex} = "${cleanQ}"`;

  try {
    const xml = await fetchLocSruXml(cqlQuery);

    const records = parseLocSruXml(xml);
    const total = parseSruNumberOfRecords(xml) || records.length;
    res.json({ records, total, returned: records.length, source: 'Library of Congress LCDB/Folio (SRU)' });

  } catch (err: any) {
    console.error('GET /api/catalog/search-loc', err.message);
    res.status(503).json({
      error: 'Thư viện Quốc hội Mỹ đang phản hồi chậm hoặc tạm thời lỗi. Vui lòng thử lại sau, hoặc tìm bằng ISBN/nhan đề tiếng Anh ngắn hơn.',
      detail: err.message,
    });
  }
});

async function fetchLocSruXml(cqlQuery: string): Promise<string> {
  let lastError: Error | null = null;

  for (const baseUrl of LOC_SRU_BASE_URLS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const params = new URLSearchParams({
        version: '1.1',
        operation: 'searchRetrieve',
        recordSchema: 'marcxml',
        maximumRecords: String(LOC_SRU_MAX_RECORDS),
        query: cqlQuery,
      });
      const sruUrl = `${baseUrl}?${params.toString()}`;

      try {
        const xmlRes = await fetch(sruUrl, {
          headers: { 'Accept': 'application/xml, text/xml' },
          signal: AbortSignal.timeout(LOC_SRU_TIMEOUT_MS),
        });

        if (!xmlRes.ok) {
          throw new Error(`${baseUrl} trả về HTTP ${xmlRes.status}`);
        }

        return await xmlRes.text();
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`LOC SRU retry ${attempt + 1}/2 failed: ${lastError.message}`);
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 800));
      }
    }
  }

  throw lastError ?? new Error('Không thể kết nối LOC SRU');
}

/** Decode XML numeric entities → real Unicode (vd: &#x1EA1; → ạ) */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_m: string, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g,            (_m: string, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

function parseSruNumberOfRecords(xml: string): number {
  const match = xml.match(/<(?:[a-z]+:)?numberOfRecords>(\d+)<\/(?:[a-z]+:)?numberOfRecords>/i);
  return match ? Number(match[1]) : 0;
}

/** Parse MARCXML từ LOC SRU response */
function parseLocSruXml(xml: string): object[] {
  const records: object[] = [];
  // LOC có thể dùng namespace zs: hoặc srw: hoặc không có
  const recMatches = [...xml.matchAll(/<(?:[a-z]+:)?recordData[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?recordData>/gi)];

  recMatches.forEach((rm, idx) => {
    const marc = rm[1];

    const getSubfield = (tag: string, sub: string): string => {
      const pat = new RegExp(
        `<(?:marc:)?datafield[^>]+tag="${tag}"[\\s\\S]*?<(?:marc:)?subfield[^>]+code="${sub}">([^<]+)<\/(?:marc:)?subfield>`,
        'i'
      );
      return decodeXmlEntities((pat.exec(marc) || [])[1]?.trim() || '');
    };
    const getAllSubfields = (tag: string, sub: string): string[] => {
      const out: string[] = [];
      const tp = new RegExp(`<(?:marc:)?datafield[^>]+tag="${tag}"[\\s\\S]*?<\/(?:marc:)?datafield>`, 'gi');
      for (const tm of marc.matchAll(tp)) {
        const sp = new RegExp(`<(?:marc:)?subfield[^>]+code="${sub}">([^<]+)<\/(?:marc:)?subfield>`, 'gi');
        for (const sm of tm[0].matchAll(sp)) out.push(decodeXmlEntities(sm[1].trim()));
      }
      return out;
    };

    const t245a = getSubfield('245', 'a').replace(/[/:]\s*$/, '').trim();
    const t245b = getSubfield('245', 'b').replace(/[/:]\s*$/, '').trim();
    const title  = t245b ? `${t245a} ${t245b}`.trim() : t245a;

    const author =
      getSubfield('100', 'a').replace(/[,.]$/, '').trim() ||
      getSubfield('110', 'a').replace(/[,.]$/, '').trim() ||
      getSubfield('700', 'a').replace(/[,.]$/, '').trim();

    const year260 = getSubfield('260', 'c') || getSubfield('264', 'c');
    const year    = (year260.match(/\d{4}/) || [])[0] || '';
    const publisher = getSubfield('260', 'b').replace(/[,.]$/, '').trim() || getSubfield('264', 'b').trim();
    const isbn      = getSubfield('020', 'a').split(/[^0-9Xx]/)[0] || '';
    const ddc       = getSubfield('082', 'a');
    const language  = getAllSubfields('041', 'a')[0] || '';
    const phys300   = getSubfield('300', 'a');
    const pageCount = (phys300.match(/(\d+)/) || [])[1] || '';
    const dimensions= getSubfield('300', 'c');
    const summary   = getSubfield('520', 'a');
    const subjects  = [...new Set([
      ...getAllSubfields('650', 'a'),
      ...getAllSubfields('600', 'a'),
      ...getAllSubfields('651', 'a'),
    ])].filter(Boolean).slice(0, 8);

    if (!title && !author) return;
    records.push({
      id: `loc_sru_${idx}_${Date.now()}`,
      title, author, year, isbn, publisher, ddc, language,
      physical: phys300, pageCount, dimensions, summary, subjects,
      rawMarc: marc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
      source: 'Library of Congress (SRU)',
    });
  });

  return records;
}

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Lỗi máy chủ' });
});

/*STARTUP*/
export async function startServer(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => res.sendFile(path.resolve('dist', 'index.html')));
  }

  const server = app.listen(PORT, () => console.log(`http://localhost:${PORT}`));

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} đang bị chiếm. Chạy lệnh sau để giải phóng rồi thử lại:`);
      console.error(`    netstat -ano | findstr :${PORT}`);
      console.error(`    taskkill /PID <PID> /F`);
    } else {
      console.error('Server error:', err.message);
    }
    process.exit(1);
  });
}

function isMainModule(): boolean {
  return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  startServer();
}
