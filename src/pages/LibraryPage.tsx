import React, { useState, useEffect } from 'react';
import { BookOpen, RefreshCw, Search, X, ChevronDown, ChevronUp, Hash, Calendar, Building2, Tag, FileText, List, Globe, Ruler, BookMarked, Trash2 } from 'lucide-react';
import { SavedBook } from '../App';
import { deleteLocalBook, getLocalBooks, mergeWithLocalBooks } from '../lib/demo-books';

function normalize(raw: any): SavedBook {
  if (!raw) return raw;
  const out: any = {};
  for (const key of Object.keys(raw)) {
    out[key.charAt(0).toLowerCase() + key.slice(1)] = raw[key];
  }
  // Alias một số trường SQL Server hay trả khác tên
  if (out.publishyear !== undefined && out.publishYear === undefined) out.publishYear = out.publishyear;
  if (out.pagecount   !== undefined && out.pageCount   === undefined) out.pageCount   = out.pagecount;
  return out as SavedBook;
}

function Badge({ children, color = 'neutral' }: { children: React.ReactNode; color?: string }) {
  const map: Record<string, string> = {
    blue:    'bg-blue-50 text-blue-700 border-blue-100',
    amber:   'bg-amber-50 text-amber-700 border-amber-100',
    purple:  'bg-purple-50 text-purple-700 border-purple-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    neutral: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${map[color] ?? map.neutral}`}>
      {children}
    </span>
  );
}

function MarcField({ tag, label, value }: { tag: string; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="font-mono font-bold text-blue-600 w-8 flex-shrink-0">{tag}</span>
      <span className="text-neutral-500 flex-shrink-0">{label}:</span>
      <span className="text-neutral-700 break-words">{value}</span>
    </div>
  );
}

function BookCard({ book: raw, onDelete }: { book: any; onDelete: (id: number) => void }) {
  const book = normalize(raw);
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const handleDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    setDeleting(true);
    onDelete(book.id);
    try {
      const res = await fetch(`/api/books/${book.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Lỗi xóa');
      onDelete(book.id);
    } catch {
      setDeleting(false);
      setConfirmDel(false);
    }
  };

  const subjectsArr: string[] = typeof book.subjects === 'string'
    ? book.subjects.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean)
    : (Array.isArray(book.subjects) ? book.subjects : []);

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow">
      {/* ── Header màu ── */}
      <div className="h-1.5 bg-gradient-to-r from-blue-500 to-blue-700" />

      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-neutral-900 leading-snug text-base">
                {book.title || <span className="italic text-neutral-400">Không có tiêu đề</span>}
              </h3>
              {book.author && (
                <p className="text-sm text-neutral-500 mt-0.5">{book.author}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-mono text-neutral-400 bg-neutral-100 px-2 py-1 rounded-lg">
              #{book.id}
            </span>
            {confirmDel ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs px-2 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {deleting ? 'Đang xóa...' : 'Xác nhận'}
                </button>
                <button
                  onClick={() => setConfirmDel(false)}
                  className="text-xs px-2 py-1 bg-neutral-100 text-neutral-600 rounded-lg hover:bg-neutral-200 transition-colors"
                >
                  Hủy
                </button>
              </div>
            ) : (
              <button
                onClick={handleDelete}
                className="p-1.5 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Xóa sách"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* ── Badges thông tin nhanh ── */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {book.publishYear && (
            <Badge color="neutral">
              <Calendar className="w-3 h-3" /> {book.publishYear}
            </Badge>
          )}
          {book.publisher && (
            <Badge color="neutral">
              <Building2 className="w-3 h-3" /> {book.publisher}
            </Badge>
          )}
          {book.language && (
            <Badge color="purple">
              <Globe className="w-3 h-3" /> {book.language}
            </Badge>
          )}
          {book.ddc && (
            <Badge color="amber">
              <Hash className="w-3 h-3" /> DDC: {book.ddc}
            </Badge>
          )}
          {book.isbn && (
            <Badge color="neutral">
              ISBN: {book.isbn}
            </Badge>
          )}
          {(book.pageCount || book.physical) && (
            <Badge color="neutral">
              <Ruler className="w-3 h-3" />
              {book.pageCount ? `${book.pageCount} tr.` : ''}{book.dimensions ? ` ${book.dimensions}` : ''}
              {!book.pageCount && book.physical ? book.physical : ''}
            </Badge>
          )}
        </div>

        {/* ── Chủ đề (650) ── */}
        {subjectsArr.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {subjectsArr.map((s, i) => (
              <Badge key={i} color="blue">
                <Tag className="w-2.5 h-2.5" /> {s}
              </Badge>
            ))}
          </div>
        )}

        {/* ── Tóm tắt (520) preview ── */}
        {book.summary && (
          <p className="text-xs text-neutral-500 leading-relaxed line-clamp-2 mb-3 bg-neutral-50 rounded-lg px-3 py-2 border border-neutral-100">
            <span className="font-semibold text-neutral-600">520 · </span>
            {book.summary}
          </p>
        )}

        {/* ── Toggle chi tiết MARC ── */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors font-medium"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? 'Ẩn chi tiết MARC21' : 'Xem chi tiết MARC21'}
        </button>

        {/* ── Chi tiết MARC ── */}
        {expanded && (
          <div className="mt-3 bg-neutral-50 border border-neutral-200 rounded-lg p-4 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-3">
              MARC21 Fields
            </div>
            <MarcField tag="245" label="Nhan đề"         value={book.title} />
            <MarcField tag="100" label="Tác giả"         value={book.author} />
            <MarcField tag="020" label="ISBN"            value={book.isbn} />
            <MarcField tag="041" label="Ngôn ngữ"        value={book.language} />
            <MarcField tag="082" label="DDC"             value={book.ddc} />
            <MarcField tag="260" label="Năm xuất bản"    value={book.publishYear?.toString()} />
            <MarcField tag="260" label="Nhà xuất bản"    value={book.publisher} />
            <MarcField tag="300" label="Mô tả vật lý"    value={[book.pageCount ? book.pageCount + ' trang' : '', book.dimensions].filter(Boolean).join('; ')} />
            {subjectsArr.length > 0 && (
              <div className="flex gap-2 text-xs">
                <span className="font-mono font-bold text-blue-600 w-8 flex-shrink-0">650</span>
                <span className="text-neutral-500 flex-shrink-0">Chủ đề:</span>
                <span className="text-neutral-700">{subjectsArr.join(' | ')}</span>
              </div>
            )}
            {book.summary && (
              <div className="pt-2 border-t border-neutral-200">
                <div className="flex gap-2 text-xs mb-1">
                  <span className="font-mono font-bold text-blue-600 w-8">520</span>
                  <span className="text-neutral-500">Tóm tắt:</span>
                </div>
                <p className="text-xs text-neutral-600 ml-10 leading-relaxed whitespace-pre-wrap">{book.summary}</p>
              </div>
            )}
            {book.toc && (
              <div className="pt-2 border-t border-neutral-200">
                <div className="flex gap-2 text-xs mb-1">
                  <span className="font-mono font-bold text-blue-600 w-8">505</span>
                  <span className="text-neutral-500">Mục lục:</span>
                </div>
                <p className="text-xs text-neutral-600 ml-10 leading-relaxed whitespace-pre-wrap">{book.toc}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   TRANG CHÍNH
───────────────────────────────────────── */
export default function LibraryPage() {
  const [allBooks, setAllBooks]   = useState<any[]>([]);
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => { fetchBooks(); }, []);

  const fetchBooks = async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/books');
      const data = await res.json();
      setAllBooks(mergeWithLocalBooks(Array.isArray(data) ? data : []));
    } catch {
      setError('Không thể tải danh sách sách.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: number) => {
    deleteLocalBook(id);
    setAllBooks(prev => prev.filter((b: any) => b.id !== id && b.Id !== id));
  };

  const filtered = allBooks.filter(raw => {
    const b = normalize(raw);
    const q = search.toLowerCase();
    return (
      (b.title  || '').toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q) ||
      (b.isbn   || '').toLowerCase().includes(q) ||
      (b.ddc    || '').toLowerCase().includes(q) ||
      (b.subjects || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <BookMarked className="w-5 h-5 text-blue-600" />
            Sách trong CSDL
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            {allBooks.length} bản ghi — hiển thị theo chuẩn MARC21
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Tìm kiếm */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm tên, tác giả, ISBN..."
              className="pl-8 pr-8 py-2 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-56"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Refresh */}
          <button
            onClick={fetchBooks}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-neutral-600 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Tải lại
          </button>
        </div>
      </div>

      {/* ── Lỗi ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white border border-neutral-200 rounded-xl p-5 animate-pulse">
              <div className="flex gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-neutral-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-neutral-200 rounded w-3/4" />
                  <div className="h-3 bg-neutral-100 rounded w-1/2" />
                </div>
              </div>
              <div className="flex gap-1.5 mb-3">
                {[1,2,3].map(j => <div key={j} className="h-5 w-16 bg-neutral-100 rounded-full" />)}
              </div>
              <div className="h-8 bg-neutral-50 rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {/* ── Không có sách ── */}
      {!loading && filtered.length === 0 && (
        <div className="bg-white border border-neutral-200 rounded-2xl p-16 text-center">
          <BookOpen className="w-12 h-12 text-neutral-200 mx-auto mb-4" />
          <p className="text-neutral-500 font-medium">
            {search ? `Không tìm thấy kết quả cho "${search}"` : 'Chưa có sách nào trong CSDL'}
          </p>
          {search && (
            <button onClick={() => setSearch('')} className="mt-3 text-sm text-blue-600 hover:underline">
              Xoá bộ lọc
            </button>
          )}
        </div>
      )}

      {/* ── Danh sách dạng card ── */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((book, i) => (
            <BookCard key={book.id ?? i} book={book} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
