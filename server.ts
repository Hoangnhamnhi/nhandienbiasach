import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import sql from 'mssql';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';
import { z3950Search } from './src/lib/z3950-client';

/*CONFIG */
const PORT = Number(process.env.PORT) || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY1?.trim() ?? '';
const SQL_CONNECTION_STRING =
  process.env.SQL_CONNECTION_STRING ??
  'Data Source=localhost;Initial Catalog=librarydb;Persist Security Info=True;User ID=sa;Password=123456;Pooling=False;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=True;Command Timeout=0';

if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('your')) {
  console.error('❌  GEMINI_API_KEY1 chưa được cấu hình trong .env');
}

/*AI*/
const ai = GEMINI_API_KEY && !GEMINI_API_KEY.includes('your')
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

/*DATABASE — schema definitions */
let pool: sql.ConnectionPool | null = null;

// Desired full schema for books table
const BOOKS_REQUIRED_COLUMNS: Record<string, string> = {
  title:       'NVARCHAR(255)',
  author:      'NVARCHAR(255)',
  publishYear: 'INT',
  isbn:        'NVARCHAR(50)',
  ddc:         'NVARCHAR(50)',
  publisher:   'NVARCHAR(255)',
  language:    'NVARCHAR(50)',
  physical:    'NVARCHAR(255)',
  pageCount:   'NVARCHAR(100)',
  dimensions:  'NVARCHAR(100)',
  summary:     'NVARCHAR(MAX)',
  toc:         'NVARCHAR(MAX)',
  subjects:    'NVARCHAR(MAX)',
  rawMarc:     'NVARCHAR(MAX)',
};

// Desired full schema for users table
const USERS_REQUIRED_COLUMNS: Record<string, string> = {
  username:     'NVARCHAR(100)',
  email:        'NVARCHAR(255)',
  password:  'NVARCHAR(255)',
  createdAt:    'DATETIME',
};

/** Read existing columns from INFORMATION_SCHEMA, return lowercased set */
async function getExistingColumns(table: string): Promise<Set<string>> {
  const result = await pool!.request()
    .input('tbl', sql.NVarChar, table)
    .query(`
      SELECT LOWER(COLUMN_NAME) AS col
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tbl
    `);
  return new Set(result.recordset.map((r: any) => r.col));
}

/** Add only the missing columns to a table */
async function ensureColumns(
  table: string,
  required: Record<string, string>
): Promise<void> {
  const existing = await getExistingColumns(table);
  const missing = Object.entries(required).filter(
    ([col]) => !existing.has(col.toLowerCase())
  );

  if (missing.length === 0) {
    return;
  }

  for (const [col, type] of missing) {
    const nullable = type.includes('MAX') || type.includes('NVARCHAR') ? ' NULL' : ' NULL';
    await pool!.request().query(
      `ALTER TABLE [${table}] ADD [${col}] ${type}${nullable}`
    );
    console.log(`  ➕ [${table}].${col} ${type} — đã thêm`);
  }
}

async function initDb(): Promise<void> {
  try {
    pool = await sql.connect(SQL_CONNECTION_STRING);
    console.log('SQL Server connected → librarydb');

    //books table 
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='books' AND xtype='U')
      CREATE TABLE books (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        title       NVARCHAR(255)    NULL,
        author      NVARCHAR(255)    NULL,
        publishYear INT              NULL,
        isbn        NVARCHAR(50)     NULL,
        ddc         NVARCHAR(50)     NULL,
        publisher   NVARCHAR(255)    NULL,
        rawMarc     NVARCHAR(MAX)    NULL
      )
    `);
    await ensureColumns('books', BOOKS_REQUIRED_COLUMNS);

    //users table
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='users' AND xtype='U')
      CREATE TABLE users (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        username     NVARCHAR(100)  NOT NULL UNIQUE,
        email        NVARCHAR(255)  NOT NULL UNIQUE,
        [password]   NVARCHAR(255)  NOT NULL,
        createdAt    DATETIME       NOT NULL DEFAULT GETDATE()
      )
    `);
    await ensureColumns('users', USERS_REQUIRED_COLUMNS);

  } catch (err: any) {
    const hints: Record<string, string> = {
      ELOGIN:  '  • Bật SQL Server and Windows Authentication trong SSMS > Properties > Security\n  • Đảm bảo tài khoản sa được Enable và mật khẩu đúng',
      ESOCKET: '  • Kiểm tra SQL Server đang chạy\n  • Bật TCP/IP trong SQL Server Configuration Manager',
    };
    console.error(`❌  Kết nối SQL Server thất bại [${err.code ?? 'ERR'}]`);
    console.error(hints[err.code] ?? `  ${err.message}`);
  }
}

/*EXPRESS APP*/
const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

/*HELPERS */
function requireDb(res: Response): boolean {
  if (!pool) { res.status(503).json({ error: 'Chưa kết nối CSDL SQL Server' }); return false; }
  return true;
}
function requireAi(res: Response): boolean {
  if (!ai)   { res.status(400).json({ error: 'AI chưa được khởi tạo — kiểm tra GEMINI_API_KEY1' }); return false; }
  return true;
}

function hashPassword(plain: string): string {
  return crypto.createHash('sha256').update(plain + 'lib_salt_2024').digest('hex');
}

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
3. Dùng Google Search để bổ sung thêm thông tin còn thiếu (ISBN, DDC, số trang...).

[YÊU CẦU BẮT BUỘC]
- Trả về DUY NHẤT một JSON hợp lệ. KHÔNG thêm văn bản, giải thích hay markdown bên ngoài.
- Trường thiếu để chuỗi rỗng "".

{
  "title": "Tên sách (245)",
  "author": "Tác giả (100)",
  "year": 2024,
  "publisher": "Nhà xuất bản",
  "isbn": "ISBN",
  "ddc": "Phân loại DDC",
  "language": "vie",
  "physical": "Mô tả vật lý",
  "pageCount": "Số trang",
  "dimensions": "Khổ sách",
  "summary": "Tóm tắt nội dung",
  "toc": "Mục lục (nếu có)",
  "subjects": ["Chủ đề 1", "Chủ đề 2"]
}
`.trim();

/*AUTH ROUTES  (dùng bảng users trong SQL)*/

// POST /api/auth/register
app.post('/api/auth/register', async (req: Request, res: Response) => {
  if (!requireDb(res)) return;
  const { username, email, password } = req.body;

  if (!username?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
  }

  try {
    // Check duplicate
    const exists = await pool!.request()
      .input('email',    sql.NVarChar, email.trim())
      .input('username', sql.NVarChar, username.trim())
      .query('SELECT id FROM users WHERE email = @email OR username = @username');

    if (exists.recordset.length > 0) {
      return res.status(409).json({ error: 'Email hoặc tên đăng nhập đã tồn tại' });
    }

    const result = await pool!.request()
      .input('username',     sql.NVarChar, username.trim())
      .input('email',        sql.NVarChar, email.trim())
      .input('password', sql.NVarChar, hashPassword(password))
      .query(`
        INSERT INTO users (username, email, [password], createdAt)
        OUTPUT inserted.id, inserted.username, inserted.email
        VALUES (@username, @email, @password, GETDATE())
      `);

    const user = result.recordset[0];
    res.status(201).json({ id: user.id, username: user.username, email: user.email });
  } catch (err: any) {
    console.error('POST /api/auth/register', err.message);
    res.status(500).json({ error: 'Lỗi đăng ký tài khoản' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req: Request, res: Response) => {
  if (!requireDb(res)) return;
  const { username, password } = req.body;

  if (!username?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
  }

  try {
    const result = await pool!.request()
      .input('username',  sql.NVarChar, username.trim())
      .input('password',  sql.NVarChar, hashPassword(password))
      .query('SELECT id, username, email FROM users WHERE username = @username AND [password] = @password');

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }

    const user = result.recordset[0];
    res.json({ id: user.id, username: user.username, email: user.email });
  } catch (err: any) {
    console.error('POST /api/auth/login', err.message);
    res.status(500).json({ error: 'Lỗi đăng nhập' });
  }
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
  if (!requireDb(res)) return;
  try {
    const { recordset } = await pool!.request().query('SELECT * FROM books ORDER BY id DESC');
    res.json(recordset);
  } catch (err: any) {
    console.error('GET /api/books', err.message);
    res.status(500).json({ error: 'Lỗi lấy dữ liệu' });
  }
});

// POST /api/books
app.post('/api/books', async (req: Request, res: Response) => {
  if (!requireDb(res)) return;

  const {
    title, author, year, isbn, ddc, publisher,
    language, physical, pageCount, dimensions,
    summary, toc, subjects, rawOcrText,
  } = req.body;

  const subjectsStr = Array.isArray(subjects) ? subjects.join('; ') : (subjects ?? '');

  try {
    const result = await pool!.request()
      .input('title',      sql.NVarChar, title      || 'Không rõ')
      .input('author',     sql.NVarChar, author     || '')
      .input('year',       sql.Int,      year       || null)
      .input('isbn',       sql.NVarChar, isbn       || '')
      .input('ddc',        sql.NVarChar, ddc        || '')
      .input('publisher',  sql.NVarChar, publisher  || '')
      .input('language',   sql.NVarChar, language   || '')
      .input('physical',   sql.NVarChar, physical   || '')
      .input('pageCount',  sql.NVarChar, pageCount  || '')
      .input('dimensions', sql.NVarChar, dimensions || '')
      .input('summary',    sql.NVarChar, summary    || '')
      .input('toc',        sql.NVarChar, toc        || '')
      .input('subjects',   sql.NVarChar, subjectsStr)
      .input('rawMarc',    sql.NVarChar, rawOcrText || '')
      .query(`
        INSERT INTO books
          (title, author, publishYear, isbn, ddc, publisher,
           language, physical, pageCount, dimensions,
           summary, toc, subjects, rawMarc)
        OUTPUT inserted.id
        VALUES
          (@title, @author, @year, @isbn, @ddc, @publisher,
           @language, @physical, @pageCount, @dimensions,
           @summary, @toc, @subjects, @rawMarc)
      `);

    res.status(201).json({ id: result.recordset[0].id, title, author });
  } catch (err: any) {
    console.error('POST /api/books', err.message);
    res.status(500).json({ error: 'Lỗi lưu sách' });
  }
});
// DELETE /api/books/:id
app.delete('/api/books/:id', async (req: Request, res: Response) => {
  if (!requireDb(res)) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID không hợp lệ' });
  try {
    const result = await pool!.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM books WHERE id = @id');
    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Không tìm thấy sách' });
    res.json({ success: true, id });
  } catch (err: any) {
    console.error('DELETE /api/books', err.message);
    res.status(500).json({ error: 'Lỗi xóa sách' });
  }
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

// ── NLV qua WorldCat SRU (public) + Google Books làm fallback cho sách Việt ──
app.get('/api/catalog/search-nlv', async (req: Request, res: Response) => {
  const { searchType = 'title', query } = req.query as Record<string, string>;
  if (!query?.trim()) return res.status(400).json({ error: 'Thiếu tham số query' });

  try {
    const records = await searchVietnameseBooks(searchType, query.trim());
    res.json({ records, total: records.length, source: 'Google Books / WorldCat (Việt Nam)' });
  } catch (err: any) {
    console.error('GET /api/catalog/search-nlv', err.message);
    res.status(502).json({ error: `Lỗi tìm kiếm: ${err.message}` });
  }
});

/*Tìm sách tiếng Việt qua Google Books API*/

// Cache đơn giản: key = "searchType:query", TTL 10 phút
const gbCache = new Map<string, { ts: number; result: object[] }>();
const GB_CACHE_TTL = 10 * 60 * 1000;

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

async function searchVietnameseBooks(searchType: string, query: string): Promise<object[]> {
  const cacheKey = `${searchType}:${query.toLowerCase().trim()}`;
  const cached = gbCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < GB_CACHE_TTL) return cached.result;

  if (ai) {
    const result = await searchWithGemini(searchType, query);
    if (result.length > 0) {
      gbCache.set(cacheKey, { ts: Date.now(), result });
      return result;
    }
  }

  // Fallback: Google Books API
  const fieldMap: Record<string, string> = { title: 'intitle', author: 'inauthor', isbn: 'isbn', keyword: '' };
  const field   = fieldMap[searchType] ?? '';
  const gbQuery = field ? `${field}:${query}` : query;
  const langRestrict = (searchType === 'keyword' || searchType === 'title') ? '&langRestrict=vi' : '';
  const apiKey  = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  const keyParam = apiKey ? `&key=${apiKey}` : '';
  const gbUrl   = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(gbQuery)}${langRestrict}&maxResults=20&printType=books${keyParam}`;

  console.log(`[GB] URL: ${gbUrl.replace(apiKey ?? '', apiKey ? '***KEY***' : '')}`);
  const data = await fetchWithRetry(gbUrl);
  console.log(`[GB] totalItems=${data.totalItems ?? 0}, items=${(data.items ?? []).length}, error=${JSON.stringify(data.error ?? null)}`);
  if (data.error) throw new Error(`Google Books API lỗi: ${data.error.message ?? JSON.stringify(data.error)}`);

  const items: any[] = data.items ?? [];
  const result = items.map((item: any, i: number) => {
    const vi = item.volumeInfo ?? {};
    const isbn13 = (vi.industryIdentifiers ?? []).find((x: any) => x.type === 'ISBN_13')?.identifier ?? '';
    const isbn10 = (vi.industryIdentifiers ?? []).find((x: any) => x.type === 'ISBN_10')?.identifier ?? '';
    const isbn    = isbn13 || isbn10;
    const authors = (vi.authors ?? []).join('; ');
    const year    = (vi.publishedDate ?? '').slice(0, 4);
    const language = vi.language === 'vi' ? 'vie' : (vi.language ?? '');
    const subjects = (vi.categories ?? []).slice(0, 6);
    const pageCount = vi.pageCount ? String(vi.pageCount) : '';
    return {
      id:         `gb_${item.id}_${i}`,
      title:      vi.title     ?? '',
      author:     authors,
      year,
      isbn,
      publisher:  vi.publisher ?? '',
      ddc:        '',
      language,
      physical:   '',
      pageCount,
      dimensions: '',
      summary:    vi.description ? vi.description.slice(0, 400) : '',
      subjects,
      rawMarc:    JSON.stringify(vi).slice(0, 500),
      source:     `Google Books — ${vi.publisher ?? 'NLV/Việt Nam'}`,
    };
  });

  gbCache.set(cacheKey, { ts: Date.now(), result });
  return result;
}

const SEARCH_PROMPT = (searchType: string, query: string) => `
Bạn là chuyên gia thư viện. Hãy tìm kiếm thông tin về sách theo yêu cầu sau và trả về danh sách kết quả.

Loại tìm kiếm: ${searchType === 'title' ? 'Tên sách' : searchType === 'author' ? 'Tác giả' : searchType === 'isbn' ? 'ISBN' : 'Từ khóa'}
Từ khóa: "${query}"

Dùng Google Search để tìm kiếm, ưu tiên sách tiếng Việt, sách xuất bản tại Việt Nam.
Tìm tối đa 10 cuốn sách phù hợp nhất.

Trả về DUY NHẤT một JSON hợp lệ theo định dạng sau, KHÔNG thêm văn bản hay markdown:
{
  "books": [
    {
      "title": "Tên sách",
      "author": "Tác giả",
      "year": "2024",
      "publisher": "Nhà xuất bản",
      "isbn": "ISBN nếu có",
      "ddc": "Phân loại DDC nếu biết",
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

/*LOC SRU — Library of Congress qua HTTP (không cần Z39.50 TCP)*/

// GET /api/catalog/search-loc?searchType=title|author|isbn|keyword&query=...
app.get('/api/catalog/search-loc', async (req: Request, res: Response) => {
  const { searchType = 'title', query } = req.query as Record<string, string>;
  if (!query?.trim()) return res.status(400).json({ error: 'Thiếu tham số query' });

  // Map sang CQL index của LOC SRU
  const indexMap: Record<string, string> = {
    title:   'dc.title',
    author:  'dc.creator',
    isbn:    'bath.isbn',
    keyword: 'anywhere',
  };
  const cqlIndex = indexMap[searchType] ?? 'anywhere';
  // Dùng "=" exact word match. Thêm "vi" vào author search cho sách VN
  const cleanQ = query.trim().replace(/"/g, '');
  const cqlQuery = `${cqlIndex} = "${cleanQ}"`;

  try {
    // LOC SRU dùng HTTP (không phải HTTPS) trên port 7090
    const sruUrl = `http://z3950.loc.gov:7090/voyager?version=1.1&operation=searchRetrieve&recordSchema=marcxml&maximumRecords=15&query=${encodeURIComponent(cqlQuery)}`;

    const xmlRes = await fetch(sruUrl, {
      headers: { 'Accept': 'application/xml, text/xml' },
      signal: AbortSignal.timeout(20000),
    });

    if (!xmlRes.ok) throw new Error(`LOC SRU trả về HTTP ${xmlRes.status}`);
    const xml = await xmlRes.text();

    const records = parseLocSruXml(xml);
    res.json({ records, total: records.length, source: 'z3950.loc.gov (SRU)' });

  } catch (err: any) {
    console.error('GET /api/catalog/search-loc', err.message);
    res.status(502).json({ error: `Lỗi kết nối LOC SRU: ${err.message}` });
  }
});

/** Decode XML numeric entities → real Unicode (vd: &#x1EA1; → ạ) */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_m: string, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g,            (_m: string, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"');
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
async function startServer(): Promise<void> {
  await initDb();

  if (process.env.NODE_ENV !== 'production') {
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

startServer();
