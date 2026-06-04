import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { MarcField as MarcFieldType, SavedBook } from '../App';
import { deleteLocalBook, mergeWithLocalBooks } from '../lib/demo-books';
import { exportBooksToExcel } from '../lib/export-books';

function normalize(raw: any): SavedBook {
  if (!raw) return raw;
  const out: any = {};
  for (const key of Object.keys(raw)) {
    out[key.charAt(0).toLowerCase() + key.slice(1)] = raw[key];
  }
  if (out.publishyear !== undefined && out.publishYear === undefined) out.publishYear = out.publishyear;
  if (out.pagecount !== undefined && out.pageCount === undefined) out.pageCount = out.pagecount;
  return out as SavedBook;
}

function getMarcFields(value: unknown): MarcFieldType[] {
  if (Array.isArray(value)) return value as MarcFieldType[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getSubjects(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[;,]/).map(s => s.trim()).filter(Boolean);
  return [];
}

function joinValues(values: Array<string | number | null | undefined>, separator = '; '): string {
  return values
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .join(separator);
}

function publicationInfo(book: SavedBook): string {
  const placeAndPublisher = joinValues([book.productionPlace, book.publisher], ' : ');
  return joinValues([placeAndPublisher, book.publishYear], ', ');
}

function physicalDescription(book: SavedBook): string {
  if (book.physical?.trim()) return book.physical.trim();
  return joinValues([
    book.pageCount ? `${book.pageCount} trang` : '',
    book.dimensions,
  ], '; ');
}

function DetailLine({ label, value }: { label: string; value?: string | number | null }) {
  if (!value) return null;

  return (
    <p className="text-sm leading-relaxed text-neutral-700">
      <span className="font-semibold text-neutral-900">{label}: </span>
      {value}
    </p>
  );
}

function FullMarcFields({ leader, fields }: { leader?: string; fields: MarcFieldType[] }) {
  if (!leader && fields.length === 0) {
    return <p className="text-sm text-neutral-500">Chưa có trường MARC21 gốc.</p>;
  }

  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">MARC21 gốc</p>
        <span className="text-xs text-neutral-500">{fields.length} trường</span>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {leader && (
          <div className="grid grid-cols-[58px_1fr] gap-3 border-b border-neutral-200 px-4 py-2 text-xs">
            <span className="font-mono font-bold text-blue-700">LDR</span>
            <span className="break-all font-mono text-neutral-800">{leader}</span>
          </div>
        )}

        {fields.map((field, index) => (
          <div key={`${field.tag}-${index}`} className="grid grid-cols-[58px_1fr] gap-3 border-b border-neutral-200 px-4 py-2 text-xs last:border-b-0">
            <span className="font-mono font-bold text-blue-700">{field.tag}</span>
            <span className="break-words text-neutral-800">
              {field.value ? (
                <span className="font-mono">{field.value}</span>
              ) : (
                <>
                  <span className="mr-2 font-mono text-neutral-500">
                    [{field.ind1 || ' '}{field.ind2 || ' '}]
                  </span>
                  {(field.subfields ?? []).map((sub, subIndex) => (
                    <span key={`${sub.code}-${subIndex}`} className="mr-2">
                      <span className="font-mono text-neutral-600">${sub.code}</span> {sub.value}
                    </span>
                  ))}
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookResult({
  book: raw,
  index,
  onDelete,
}: {
  book: any;
  index: number;
  onDelete: (id: number) => void;
}) {
  const book = normalize(raw);
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const marcFields = getMarcFields(book.marcFields);
  const subjects = getSubjects(book.subjects);
  const publication = publicationInfo(book);
  const physical = physicalDescription(book);
  const classification = joinValues([
    book.ddc ? `DDC ${book.ddc}` : '',
    book.isbn ? `ISBN ${book.isbn}` : '',
  ], ' | ');
  const bookId = Number(book.id);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    if (!Number.isFinite(bookId)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error('Delete failed');
      onDelete(bookId);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <article className="bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-sm font-semibold text-neutral-500">
          {index + 1}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-blue-700">
            {book.title || <span className="italic text-neutral-400">Không có tiêu đề</span>}
          </h3>

          <div className="mt-2 space-y-1">
            <DetailLine label="Tác giả" value={book.author} />
            <DetailLine label="Thông tin xuất bản" value={publication} />
            <DetailLine label="Phân loại" value={classification} />
            <DetailLine label="Thông tin vật lý" value={physical} />
            <DetailLine label="Ngôn ngữ" value={book.language} />
            <DetailLine label="Chủ đề" value={subjects.join('; ')} />
            <DetailLine label="Tóm tắt" value={book.summary} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1 font-mono">
              ID #{book.id}
            </span>
            {marcFields.length > 0 && (
              <span className="rounded border border-blue-100 bg-blue-50 px-2 py-1 text-blue-700">
                MARC21: {marcFields.length} trường
              </span>
            )}
          </div>

          {expanded && (
            <FullMarcFields leader={book.marcLeader} fields={marcFields} />
          )}
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-start gap-2 sm:w-36 sm:flex-col sm:items-stretch">
          <button
            onClick={() => setExpanded(value => !value)}
            className="inline-flex items-center justify-center gap-1 rounded border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? 'Ẩn MARC' : 'Xem MARC'}
          </button>

          {confirmDelete ? (
            <div className="flex gap-1 sm:flex-col">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded border border-red-600 bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Đang xóa...' : 'Xác nhận'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
              >
                Hủy
              </button>
            </div>
          ) : (
            <button
              onClick={handleDelete}
              className="inline-flex items-center justify-center gap-1 rounded border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              title="Xóa sách"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Xóa
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function LibraryPage() {
  const [allBooks, setAllBooks] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { fetchBooks(); }, []);

  const fetchBooks = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/books');
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
    setAllBooks(previous => previous.filter((book: any) => Number(book.id ?? book.Id) !== id));
  };

  const handleExportExcel = () => {
    try {
      setError('');
      exportBooksToExcel(allBooks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xuất file Excel.');
    }
  };

  const filtered = allBooks.filter(raw => {
    const book = normalize(raw);
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return (
      (book.title || '').toLowerCase().includes(query) ||
      (book.author || '').toLowerCase().includes(query) ||
      (book.isbn || '').toLowerCase().includes(query) ||
      (book.ddc || '').toLowerCase().includes(query) ||
      (book.publisher || '').toLowerCase().includes(query) ||
      (book.productionPlace || '').toLowerCase().includes(query) ||
      String(book.subjects || '').toLowerCase().includes(query) ||
      JSON.stringify(getMarcFields((book as any).marcFields)).toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-neutral-200 bg-white">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Nhập từ khóa tìm kiếm"
              className="w-full rounded border border-neutral-300 bg-white py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExportExcel}
              disabled={loading || allBooks.length === 0}
              className="inline-flex items-center gap-1.5 rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Xuất Excel
            </button>
            <button
              onClick={fetchBooks}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Tải lại
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-md border border-neutral-200 bg-white">
        <div className="flex flex-col gap-1 border-b border-neutral-200 bg-neutral-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-neutral-700">
            Tìm thấy <span className="font-semibold text-neutral-900">{filtered.length}</span> bản ghi
          </p>
          <p className="text-xs text-neutral-500">Hiển thị theo dạng danh mục thư viện</p>
        </div>

        {loading && (
          <div className="divide-y divide-neutral-200">
            {[1, 2, 3].map(item => (
              <div key={item} className="animate-pulse px-5 py-5">
                <div className="h-4 w-2/3 rounded bg-neutral-200" />
                <div className="mt-3 space-y-2">
                  <div className="h-3 w-1/2 rounded bg-neutral-100" />
                  <div className="h-3 w-3/4 rounded bg-neutral-100" />
                  <div className="h-3 w-2/5 rounded bg-neutral-100" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="px-5 py-14 text-center">
            <BookOpen className="mx-auto mb-3 h-10 w-10 text-neutral-200" />
            <p className="font-medium text-neutral-500">
              {search ? `Không tìm thấy kết quả cho "${search}"` : 'Chưa có sách nào trong thư viện'}
            </p>
            {search && (
              <button onClick={() => setSearch('')} className="mt-3 text-sm font-medium text-blue-700 hover:underline">
                Xóa bộ lọc
              </button>
            )}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="divide-y divide-neutral-200">
            {filtered.map((book, index) => (
              <BookResult key={book.id ?? book.Id ?? index} book={book} index={index} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
