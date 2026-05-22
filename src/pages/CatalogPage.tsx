import React, { useState, useRef } from 'react';
import {
  Search, Download, CheckCircle, AlertCircle, Loader2,
  BookOpen, Globe, Database, ChevronDown, ChevronUp, X,
  BookMarked, Hash, Calendar, Building2, Tag, FileText,
  Layers, Info, RefreshCw, Pencil, Save, ExternalLink,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { saveLocalBook } from '../lib/demo-books';

/*Types*/
interface Library {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  description: string;
  flag: string;
  searchMode: 'z3950' | 'nlv' | 'loc-sru';
}

interface MarcRecord {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  year: string;
  publishedDate?: string;
  isbn: string;
  isbn10?: string;
  isbn13?: string;
  publisher: string;
  ddc: string;
  language: string;
  physical: string;
  pageCount: string;
  dimensions: string;
  summary: string;
  searchSnippet?: string;
  subjects: string[];
  mainCategory?: string;
  googleBooksId?: string;
  selfLink?: string;
  previewLink?: string;
  infoLink?: string;
  canonicalVolumeLink?: string;
  thumbnail?: string;
  printType?: string;
  averageRating?: string;
  ratingsCount?: string;
  maturityRating?: string;
  contentVersion?: string;
  saleability?: string;
  isEbook?: string;
  country?: string;
  viewability?: string;
  accessViewStatus?: string;
  embeddable?: string;
  publicDomain?: string;
  webReaderLink?: string;
  rawMarc: string;
  source: string;
}

type SearchType = 'title' | 'author' | 'isbn' | 'keyword';
type ImportStatus = 'idle' | 'importing' | 'success' | 'error';

/*Constants*/
const LIBRARIES: Library[] = [
  {
    id: 'nlv',
    name: 'Thư viện Quốc gia Việt Nam',
    host: 'googleapis.com',
    port: 443,
    database: 'google-books',
    description: 'Sách Việt Nam qua Google Books API',
    flag: '🇻🇳',
    searchMode: 'nlv',
  },
  {
    id: 'loc',
    name: 'Thư viện Quốc hội Mỹ',
    host: 'lx2.loc.gov',
    port: 210,
    database: 'lcdb',
    description: 'Library of Congress — LCDB/Folio SRU',
    flag: '🇺🇸',
    searchMode: 'loc-sru',
  },
];

const LANG_MAP: Record<string, string> = {
  vie: 'Tiếng Việt', eng: 'Tiếng Anh', fre: 'Tiếng Pháp',
  ger: 'Tiếng Đức',  jpn: 'Tiếng Nhật', chi: 'Tiếng Trung',
  kor: 'Tiếng Hàn',  rus: 'Tiếng Nga',
};

function langLabel(code: string): string {
  return LANG_MAP[code?.toLowerCase()] ?? code ?? '';
}

/*Sub-components*/
function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-neutral-400 flex-shrink-0 mt-0.5">{icon}</span>
      <span className="text-neutral-500 flex-shrink-0 min-w-[72px]">{label}:</span>
      <span className="text-neutral-800 break-words leading-relaxed">{value}</span>
    </div>
  );
}

function LinkRow({ label, href }: { label: string; href?: string | null }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 hover:underline"
    >
      <ExternalLink className="w-3 h-3" />
      {label}
    </a>
  );
}

function ImportButton({ status, onImport }: { status: ImportStatus; onImport: () => void }) {
  if (status === 'success') {
    return (
      <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
        <CheckCircle className="w-4 h-4" />Đã import
      </div>
    );
  }
  if (status === 'error') {
    return (
      <button onClick={onImport} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100 border border-red-200 transition-colors">
        <AlertCircle className="w-3.5 h-3.5" />Thử lại
      </button>
    );
  }
  if (status === 'importing') {
    return (
      <div className="flex items-center gap-1.5 text-blue-500 text-xs font-medium">
        <Loader2 className="w-4 h-4 animate-spin" />Đang lưu...
      </div>
    );
  }
  return (
    <button onClick={onImport} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
      <Pencil className="w-3.5 h-3.5" />Sửa &amp; Import
    </button>
  );
}

/*EditImportModal*/
interface EditImportModalProps {
  record: MarcRecord;
  onClose: () => void;
  onSave: (edited: MarcRecord) => void;
  saving: boolean;
}

/*Validation helpers*/

/** ISBN-10 checksum (mod 11) */
function validateIsbn10(s: string): boolean {
  const d = s.replace(/[^0-9Xx]/g, '');
  if (d.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * parseInt(d[i], 10);
  const last = d[9].toUpperCase() === 'X' ? 10 : parseInt(d[9], 10);
  sum += last;
  return sum % 11 === 0;
}

/** ISBN-13 checksum (EAN-13) */
function validateIsbn13(s: string): boolean {
  const d = s.replace(/[^0-9]/g, '');
  if (d.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(d[i], 10) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(d[12], 10);
}

/** Format ISBN: chỉ giữ số và X, trả về raw digits */
function cleanIsbn(s: string): string {
  return s.replace(/[^0-9Xx]/g, '').toUpperCase();
}

/** Kiểm tra ISBN hợp lệ */
function isbnStatus(raw: string): { ok: boolean; msg: string } {
  if (!raw.trim()) return { ok: true, msg: '' };
  const clean = cleanIsbn(raw);
  if (clean.length === 10) {
    return validateIsbn10(clean)
      ? { ok: true,  msg: 'ISBN-10 hợp lệ ✓' }
      : { ok: false, msg: 'ISBN-10 sai checksum — vui lòng kiểm tra lại' };
  }
  if (clean.length === 13) {
    return validateIsbn13(clean)
      ? { ok: true,  msg: 'ISBN-13 hợp lệ ✓' }
      : { ok: false, msg: 'ISBN-13 sai checksum — vui lòng kiểm tra lại' };
  }
  return { ok: false, msg: `ISBN phải có 10 hoặc 13 chữ số (hiện tại: ${clean.length})` };
}

/**
 * DDC (082): phần nguyên 3 chữ số, tùy chọn thập phân tối đa 7 chữ số.
 * Ví dụ hợp lệ: 895, 895.9, 895.9223, 005.133
 */
function ddcStatus(raw: string): { ok: boolean; msg: string } {
  if (!raw.trim()) return { ok: true, msg: '' };
  // Cho phép khoảng trắng/dấu nháy đầu cuối (một số nguồn có "895.9/B")
  const clean = raw.trim().replace(/[/\\].*$/, '').trim();
  if (/^\d{3}(\.\d{1,7})?$/.test(clean)) return { ok: true, msg: 'DDC hợp lệ ✓' };
  if (/^\d{1,2}(\.\d*)?$/.test(clean))
    return { ok: false, msg: 'Phần nguyên DDC phải có đúng 3 chữ số (vd: 895.9)' };
  return { ok: false, msg: 'DDC không đúng định dạng — ví dụ: 895.9223' };
}

/**
 * Chuẩn hóa một tiêu đề chủ đề (LCSH 650):
 * - Viết hoa chữ đầu
 * - Kết thúc KHÔNG có dấu chấm (trừ viết tắt) — dấu chấm cuối là lỗi phổ biến
 * - Phân cấp dùng " -- " (có khoảng trắng 2 bên)
 */
function normalizeSubject(s: string): string {
  let t = s.trim();
  // Chuẩn hóa dấu phân cấp: "--, ---, —" → " -- "
  t = t.replace(/\s*--+\s*/g, ' -- ').replace(/\s*—\s*/g, ' -- ');
  // Viết hoa chữ đầu mỗi phân cấp
  t = t.split(' -- ').map(part => {
    const p = part.trim();
    return p.length > 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p;
  }).join(' -- ');
  // Xóa dấu chấm cuối (trừ khi là viết tắt kiểu "U.S." hay chữ số)
  t = t.replace(/\.(?!\S)$/, '');
  return t;
}

function subjectErrors(subjects: string[]): string[] {
  return subjects.map(s => {
    const t = s.trim();
    if (!t) return '';
    if (t.length < 2) return 'Chủ đề quá ngắn';
    if (/[,;]/.test(t)) return 'Dùng " -- " để phân cấp, không dùng dấu phẩy/chấm phẩy trong một chủ đề';
    return '';
  });
}

/* ── EditImportModal ── */
function EditImportModal({ record, onClose, onSave, saving }: EditImportModalProps) {
  const [draft, setDraft] = useState<MarcRecord>({ ...record });
  const [subjectInput, setSubjectInput] = useState((record.subjects ?? []).join('\n'));
  const [triedSave, setTriedSave] = useState(false);

  const set = (field: keyof MarcRecord, value: string) =>
    setDraft(d => ({ ...d, [field]: value }));

  // Sync subjects từ textarea (mỗi dòng = 1 chủ đề)
  const handleSubjectChange = (raw: string) => {
    setSubjectInput(raw);
    const list = raw.split('\n').map(normalizeSubject).filter(Boolean);
    setDraft(d => ({ ...d, subjects: list }));
  };

  // Normalize toàn bộ khi rời ô
  const handleSubjectBlur = () => {
    const normalized = subjectInput
      .split('\n')
      .map(normalizeSubject)
      .filter(Boolean);
    setSubjectInput(normalized.join('\n'));
    setDraft(d => ({ ...d, subjects: normalized }));
  };

  const isbn  = isbnStatus(draft.isbn  ?? '');
  const ddc   = ddcStatus(draft.ddc    ?? '');
  const subjs = (draft.subjects ?? []);
  const subjErrs = subjectErrors(subjs);
  const hasSubjErr = subjErrs.some(Boolean);
  const canSave = isbn.ok && ddc.ok && !hasSubjErr;

  const handleSaveClick = () => {
    setTriedSave(true);
    if (!canSave) return;
    onSave(draft);
  };

  const Field = ({
    label, field, multiline = false,
  }: { label: string; field: keyof MarcRecord; multiline?: boolean }) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-neutral-500">{label}</label>
      {multiline ? (
        <textarea
          rows={3}
          value={(draft[field] as string) ?? ''}
          onChange={e => set(field, e.target.value)}
          className="px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-neutral-50"
        />
      ) : (
        <input
          type="text"
          value={(draft[field] as string) ?? ''}
          onChange={e => set(field, e.target.value)}
          className="px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-neutral-50"
        />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-blue-600" />
            <h2 className="font-semibold text-neutral-800 text-sm">Kiểm tra &amp; chỉnh sửa trước khi import</h2>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-3 flex-1">
          <Field label="Nhan đề (245)" field="title" />
          <Field label="Phụ đề" field="subtitle" />
          <Field label="Tác giả (100)" field="author" />
          <Field label="Năm xuất bản" field="year" />

          {/* ISBN (020) — validate checksum */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">ISBN (020)</label>
            <input
              type="text"
              value={draft.isbn ?? ''}
              onChange={e => set('isbn', e.target.value)}
              placeholder="vd: 9786041234567"
              className={cn(
                'px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 bg-neutral-50',
                triedSave && !isbn.ok
                  ? 'border-red-400 focus:ring-red-400'
                  : isbn.ok && draft.isbn
                    ? 'border-emerald-400 focus:ring-emerald-400'
                    : 'border-neutral-200 focus:ring-blue-500'
              )}
            />
            {draft.isbn && (
              <p className={cn('text-xs mt-0.5', isbn.ok ? 'text-emerald-600' : 'text-red-500')}>
                {isbn.msg}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* DDC (082) — validate format */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-500">DDC (082)</label>
              <input
                type="text"
                value={draft.ddc ?? ''}
                onChange={e => set('ddc', e.target.value)}
                placeholder="vd: 895.9223"
                className={cn(
                  'px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 bg-neutral-50',
                  triedSave && !ddc.ok
                    ? 'border-red-400 focus:ring-red-400'
                    : ddc.ok && draft.ddc
                      ? 'border-emerald-400 focus:ring-emerald-400'
                      : 'border-neutral-200 focus:ring-blue-500'
                )}
              />
              {draft.ddc && (
                <p className={cn('text-xs mt-0.5', ddc.ok ? 'text-emerald-600' : 'text-red-500')}>
                  {ddc.msg}
                </p>
              )}
              <p className="text-xs text-neutral-400">3 chữ số + tùy chọn thập phân (vd: 895, 005.133)</p>
            </div>

            <Field label="Ngôn ngữ" field="language" />
          </div>

          <Field label="Nhà xuất bản (260$b)" field="publisher" />
          <Field label="Mô tả vật lý (300)" field="physical" />
          <Field label="Tóm tắt (520)" field="summary" multiline />

          {/* Chủ đề (650) — mỗi dòng 1 chủ đề, chuẩn LCSH */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-500">
                Chủ đề (650) — mỗi dòng 1 chủ đề, phân cấp bằng <code className="bg-neutral-100 px-1 rounded"> -- </code>
              </label>
              <span className="text-xs text-neutral-400">{subjs.length} chủ đề</span>
            </div>
            <textarea
              rows={Math.max(3, subjs.length + 1)}
              value={subjectInput}
              onChange={e => handleSubjectChange(e.target.value)}
              onBlur={handleSubjectBlur}
              placeholder={"Văn học Việt Nam\nTiểu thuyết -- Lịch sử và phê bình\nTác giả Việt Nam -- Thế kỷ 20"}
              className={cn(
                'px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 resize-none bg-neutral-50 font-mono',
                triedSave && hasSubjErr ? 'border-red-400 focus:ring-red-400' : 'border-neutral-200 focus:ring-blue-500'
              )}
            />
            <p className="text-xs text-neutral-400">Hệ thống tự viết hoa chữ đầu và chuẩn hóa dấu " -- " khi bạn rời ô nhập.</p>
            {/* Preview badges + lỗi từng dòng */}
            {subjs.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {subjs.map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border flex-shrink-0',
                      subjErrs[i]
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-teal-50 text-teal-700 border-teal-100'
                    )}>
                      <Tag className="w-2.5 h-2.5" />{s}
                    </span>
                    {subjErrs[i] && <span className="text-xs text-red-500 mt-0.5">{subjErrs[i]}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-neutral-100">
          <div className="text-xs text-neutral-400">
            {!canSave && triedSave && <span className="text-red-500">Vui lòng sửa các trường lỗi trước khi lưu</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-800 transition-colors disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              onClick={handleSaveClick}
              disabled={saving}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-colors shadow-sm disabled:opacity-50',
                canSave
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-neutral-200 text-neutral-500 cursor-not-allowed'
              )}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Đang lưu...' : 'Lưu vào thư viện'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordCard({ record }: { record: MarcRecord }) {
  const [expanded, setExpanded] = useState(false);
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Mở modal chỉnh sửa khi nhấn nút
  const handleImport = () => setShowModal(true);

  // Lưu sau khi đã chỉnh sửa trong modal
  const handleSave = async (edited: MarcRecord) => {
    setSaving(true);
    try {
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:      edited.title      || 'Không rõ',
          author:     edited.author     || '',
          year:       edited.year ? parseInt(edited.year, 10) : null,
          isbn:       edited.isbn       || '',
          ddc:        edited.ddc        || '',
          publisher:  edited.publisher  || '',
          language:   edited.language   || '',
          physical:   edited.physical   || '',
          pageCount:  edited.pageCount  || '',
          dimensions: edited.dimensions || '',
          summary:    edited.summary    || '',
          searchSnippet: edited.searchSnippet || '',
          subjects:   edited.subjects   || [],
          rawOcrText: edited.rawMarc    || '',
          subtitle: edited.subtitle || '',
          publishedDate: edited.publishedDate || '',
          isbn10: edited.isbn10 || '',
          isbn13: edited.isbn13 || '',
          mainCategory: edited.mainCategory || '',
          googleBooksId: edited.googleBooksId || '',
          selfLink: edited.selfLink || '',
          previewLink: edited.previewLink || '',
          infoLink: edited.infoLink || '',
          canonicalVolumeLink: edited.canonicalVolumeLink || '',
          thumbnail: edited.thumbnail || '',
          printType: edited.printType || '',
          averageRating: edited.averageRating || '',
          ratingsCount: edited.ratingsCount || '',
          maturityRating: edited.maturityRating || '',
          contentVersion: edited.contentVersion || '',
          saleability: edited.saleability || '',
          isEbook: edited.isEbook || '',
          country: edited.country || '',
          viewability: edited.viewability || '',
          accessViewStatus: edited.accessViewStatus || '',
          embeddable: edited.embeddable || '',
          publicDomain: edited.publicDomain || '',
          webReaderLink: edited.webReaderLink || '',
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      saveLocalBook({ ...edited, rawOcrText: edited.rawMarc }, data.id);
      setImportStatus('success');
      setShowModal(false);
    } catch (e) {
      console.error('Import lỗi:', e);
      setImportStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const subjects = record.subjects ?? [];

  return (
    <>
    <div className={cn(
      'bg-white border rounded-xl overflow-hidden transition-shadow hover:shadow-md',
      importStatus === 'success' ? 'border-emerald-200' : 'border-neutral-200'
    )}>
      <div className={cn('h-1 w-full', importStatus === 'success'
        ? 'bg-gradient-to-r from-emerald-400 to-teal-500'
        : 'bg-gradient-to-r from-blue-500 to-blue-700'
      )} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-20 h-28 rounded-md bg-neutral-100 border border-neutral-200 overflow-hidden flex items-center justify-center flex-shrink-0">
              {record.thumbnail ? (
                <img
                  src={record.thumbnail}
                  alt={record.title ? `Bìa ${record.title}` : 'Bìa sách'}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <BookOpen className="w-6 h-6 text-neutral-300" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-neutral-900 leading-snug text-base">
                {record.title || <span className="italic text-neutral-400">Không có tiêu đề</span>}
              </h3>
              {record.subtitle && <p className="text-xs text-neutral-500 mt-0.5">{record.subtitle}</p>}
              {(record.author || record.year) && (
                <p className="text-sm text-neutral-500 mt-1">
                  {[record.author, record.year].filter(Boolean).join(' · ')}
                </p>
              )}
              {(record.searchSnippet || record.summary) && (
                <p className="text-xs text-neutral-600 mt-2 leading-relaxed line-clamp-3">
                  {record.searchSnippet || record.summary}
                </p>
              )}
              <div className="flex flex-wrap gap-3 mt-2">
                <LinkRow label="Google Sách" href={record.infoLink || record.canonicalVolumeLink} />
                <LinkRow label="Xem trước" href={record.previewLink} />
              </div>
            </div>
          </div>
          <div className="flex-shrink-0">
            <ImportButton status={importStatus} onImport={handleImport} />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {record.year && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-100">
              <Calendar className="w-3 h-3" />{record.year}
            </span>
          )}
          {record.isbn && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-neutral-100 text-neutral-600 border border-neutral-200 font-mono">
              <Hash className="w-3 h-3" />{record.isbn}
            </span>
          )}
          {record.ddc && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700 border border-purple-100">
              <Layers className="w-3 h-3" />DDC {record.ddc}
            </span>
          )}
          {record.language && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-600 border border-blue-100">
              <Globe className="w-3 h-3" />{langLabel(record.language)}
            </span>
          )}
        </div>

        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-3 flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? 'Thu gọn' : 'Chi tiết MARC21'}
        </button>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-neutral-100 space-y-1.5">
            <InfoRow icon={<Building2 className="w-3 h-3" />} label="Nhà xuất bản" value={record.publisher} />
            <InfoRow icon={<Calendar className="w-3 h-3" />} label="Ngày XB" value={record.publishedDate || record.year} />
            <InfoRow icon={<Hash className="w-3 h-3" />} label="ISBN-10" value={record.isbn10} />
            <InfoRow icon={<BookMarked className="w-3 h-3" />} label="Mô tả vật lý" value={[record.pageCount ? record.pageCount + ' trang' : '', record.dimensions].filter(Boolean).join('; ')} />
            <InfoRow icon={<Tag className="w-3 h-3" />} label="Danh mục" value={record.mainCategory} />
            <InfoRow icon={<Info className="w-3 h-3" />} label="Truy cập" value={[record.printType, record.saleability, record.accessViewStatus, record.viewability].filter(Boolean).join(' • ')} />
            {record.summary && (
              <div className="mt-2 p-2.5 bg-neutral-50 rounded-lg text-xs text-neutral-600 leading-relaxed">
                <span className="font-medium text-neutral-700">Tóm tắt: </span>{record.summary}
              </div>
            )}
            {subjects.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {subjects.slice(0, 6).map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-teal-50 text-teal-700 border border-teal-100">
                    <Tag className="w-2.5 h-2.5" />{s}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-3 mt-2">
              <LinkRow label="Thông tin Google Books" href={record.infoLink || record.canonicalVolumeLink} />
              <LinkRow label="Xem trước" href={record.previewLink} />
              <LinkRow label="Đọc trên web" href={record.webReaderLink} />
            </div>
            <div className="mt-2 text-xs text-neutral-400 font-mono truncate">Nguồn: {record.source}</div>
          </div>
        )}
      </div>
    </div>

    {/* Edit modal */}
    {showModal && (
      <EditImportModal
        record={record}
        onClose={() => setShowModal(false)}
        onSave={handleSave}
        saving={saving}
      />
    )}
    </>
  );
}

/* ─────────────────────────────────────────
   Main Page
───────────────────────────────────────── */
export default function CatalogPage({ blocked = false }: { blocked?: boolean }) {
  const [selectedLibrary, setSelectedLibrary] = useState<Library>(LIBRARIES[0]);
  const [searchType, setSearchType] = useState<SearchType>('title');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<MarcRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q || isSearching) return;

    setIsSearching(true);
    setError(null);
    setResults(null);

    try {
      let url: string;

      if (selectedLibrary.searchMode === 'nlv') {
        url = `/api/catalog/search-nlv?searchType=${encodeURIComponent(searchType)}&query=${encodeURIComponent(q)}`;
      } else if (selectedLibrary.searchMode === 'loc-sru') {
        url = `/api/catalog/search-loc?searchType=${encodeURIComponent(searchType)}&query=${encodeURIComponent(q)}`;
      } else {
        url = `/api/catalog/search?host=${encodeURIComponent(selectedLibrary.host)}&port=${selectedLibrary.port}&database=${encodeURIComponent(selectedLibrary.database)}&searchType=${encodeURIComponent(searchType)}&query=${encodeURIComponent(q)}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Lỗi HTTP ${res.status}`);

      setResults(data.records ?? []);
      setTotal(data.total ?? 0);
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối tới thư viện');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleClear = () => {
    setSearchQuery('');
    setResults(null);
    setError(null);
    inputRef.current?.focus();
  };

  const handleLibraryChange = (lib: Library) => {
    setSelectedLibrary(lib);
    setResults(null);
    setError(null);
  };

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="bg-gradient-to-br from-blue-700 to-blue-900 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Biên mục từ Thư viện Quốc tế
            </h2>
            <p className="text-blue-200 text-sm mt-1">
              Tìm kiếm &amp; import bản ghi MARC21 • Google Books / Z39.50
            </p>
          </div>
          {results !== null && (
            <div className="text-right text-sm text-blue-200">
              <div className="text-2xl font-bold text-white">{total}</div>
              <div className="text-xs">kết quả</div>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {LIBRARIES.map(lib => (
            <button
              key={lib.id}
              onClick={() => handleLibraryChange(lib)}
              className={cn(
                'text-left p-3 rounded-xl border transition-all',
                selectedLibrary.id === lib.id
                  ? 'bg-white text-blue-800 border-white shadow-lg'
                  : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
              )}
            >
              <div className="flex items-center gap-2 font-semibold text-sm">
                <span className="text-xl">{lib.flag}</span>
                <span className="leading-tight">{lib.name}</span>
              </div>
              <div className={cn('text-xs mt-1', selectedLibrary.id === lib.id ? 'text-blue-500' : 'text-blue-200')}>
                {lib.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-100 p-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={searchType}
            onChange={e => setSearchType(e.target.value as SearchType)}
            className="px-3 py-2.5 text-sm bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-44"
          >
            <option value="title">Nhan đề (245)</option>
            <option value="author">Tác giả (100)</option>
            <option value="isbn">ISBN (020)</option>
            <option value="keyword">Từ khóa</option>
          </select>

          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                searchType === 'title'   ? 'Nhập tên sách (có thể dùng tiếng Việt)...' :
                searchType === 'author'  ? 'Nhập tên tác giả...' :
                searchType === 'isbn'    ? 'Nhập số ISBN (10 hoặc 13 chữ số)...' :
                                          'Nhập từ khóa tìm kiếm...'
              }
              className="w-full pl-4 pr-10 py-2.5 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-neutral-50"
            />
            {searchQuery && (
              <button onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {isSearching ? 'Đang tìm...' : 'Tìm kiếm'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
          <span className="flex items-center gap-1">
            <Database className="w-3.5 h-3.5" />
            <b className="text-neutral-600">{selectedLibrary.name}</b>
          </span>
          <span className="font-mono">{selectedLibrary.host}:{selectedLibrary.port}/{selectedLibrary.database}</span>
          {selectedLibrary.id === 'nlv' && (
            <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
              <Info className="w-3 h-3" />Google Books API — ưu tiên sách tiếng Việt
            </span>
          )}
        </div>
      </div>

      {/* LOADING */}
      {isSearching && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-100 p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-3" />
          <p className="text-neutral-600 text-sm font-medium">
            Đang kết nối tới <b>{selectedLibrary.name}</b>...
          </p>
          <p className="text-neutral-400 text-xs mt-1">
            {selectedLibrary.searchMode === 'nlv' ? 'Google Books API' : `LOC SRU • ${selectedLibrary.host}:${selectedLibrary.port}/${selectedLibrary.database}`} • Có thể mất 10–30 giây
          </p>
        </div>
      )}

      {/* ERROR */}
      {error && !isSearching && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">Lỗi kết nối</p>
              <p className="text-xs text-red-600 mt-1">{error}</p>
              {selectedLibrary.id === 'nlv' && (
                <ul className="mt-2 text-xs text-red-500 space-y-0.5 list-disc list-inside">
                  <li>Server NLV đôi khi không ổn định — thử lại sau vài giây</li>
                  <li>Dùng từ khóa ngắn, không dấu nếu vẫn lỗi (vd: "van hoc viet nam")</li>
                </ul>
              )}
              {selectedLibrary.id === 'loc' && (
                <ul className="mt-2 text-xs text-red-500 space-y-0.5 list-disc list-inside">
                  <li>Dịch vụ LOC SRU đôi khi timeout hoặc trả 502 khi tải cao.</li>
                  <li>Thử tìm bằng ISBN, nhan đề tiếng Anh ngắn hơn, hoặc quay lại Google Books cho sách tiếng Việt.</li>
                </ul>
              )}
              <button onClick={handleSearch} className="mt-3 flex items-center gap-1.5 text-xs text-red-600 hover:text-red-800 font-medium">
                <RefreshCw className="w-3.5 h-3.5" /> Thử lại
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NO RESULTS */}
      {results !== null && results.length === 0 && !isSearching && !error && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-100 p-12 text-center">
          <BookOpen className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
          <p className="text-neutral-500 text-sm font-medium">Không tìm thấy kết quả</p>
          <p className="text-neutral-400 text-xs mt-1">Thử từ khóa khác hoặc đổi loại tìm kiếm</p>
          {selectedLibrary.id === 'nlv' && (
            <p className="text-xs text-amber-600 mt-2 bg-amber-50 rounded-lg px-3 py-2 inline-block">
              Thử tên sách hoặc tác giả tiếng Việt
            </p>
          )}
        </div>
      )}

      {/* RESULTS */}
      {results && results.length > 0 && !isSearching && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-medium text-neutral-700">
                Tìm thấy <b>{total}</b> kết quả từ <b>{selectedLibrary.name}</b>
              </span>
            </div>
            <span className="text-xs text-neutral-400">Nhấn "Import" để lưu bản ghi vào thư viện</span>
          </div>

          <div className="grid gap-4">
            {results.map(record => (
              <RecordCard key={record.id} record={record} />
            ))}
          </div>

          {total > results.length && (
            <p className="text-center text-xs text-neutral-400 py-2">
              Hiển thị {results.length}/{total} kết quả. Thu hẹp từ khóa để xem chính xác hơn.
            </p>
          )}
        </div>
      )}

      {/* EMPTY STATE */}
      {results === null && !isSearching && !error && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-100 p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <Globe className="w-8 h-8 text-blue-400" />
          </div>
          <h3 className="text-base font-semibold text-neutral-700 mb-1">Kết nối thư viện quốc tế</h3>
          <p className="text-sm text-neutral-400 max-w-md mx-auto">
            Chọn thư viện bên trên, nhập từ khóa rồi nhấn <b>Tìm kiếm</b>. Kết quả trả về bản ghi
            MARC21 — bạn có thể import trực tiếp vào thư viện của mình.
          </p>
          <div className="mt-5 grid grid-cols-3 gap-3 max-w-sm mx-auto text-xs text-neutral-500">
            {LIBRARIES.map(lib => (
              <div key={lib.id} className="bg-neutral-50 rounded-xl p-3 border border-neutral-100">
                <div className="text-base mb-1">{lib.flag}</div>
                <div className="font-medium">{lib.id.toUpperCase()}</div>
                <div className="text-neutral-400">{lib.searchMode === 'loc-sru' ? 'SRU' : 'Z39.50'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
