import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  BookMarked,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Database,
  ExternalLink,
  Globe,
  Hash,
  Layers,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Tag,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { saveLocalBook } from '../lib/demo-books';

interface Library {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  description: string;
  flag: string;
  searchMode: 'z3950' | 'nlv-opac';
}

interface MarcSubfield {
  code: string;
  value: string;
}

interface MarcField {
  tag: string;
  ind1?: string;
  ind2?: string;
  value?: string;
  subfields?: MarcSubfield[];
  raw: string;
}

interface MarcRecord {
  id: string;
  marcLeader?: string;
  marcFields?: MarcField[];
  title: string;
  subtitle?: string;
  author: string;
  year: string;
  isbn: string;
  isbn10?: string;
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
  infoLink?: string;
  canonicalVolumeLink?: string;
  thumbnail?: string;
  rawMarc: string;
  source: string;
}

type SearchType = 'title' | 'author' | 'isbn' | 'keyword';
type ImportStatus = 'idle' | 'importing' | 'success' | 'error';

const LIBRARIES: Library[] = [
  {
    id: 'nlv-opac',
    name: 'Thư viện Quốc gia Việt Nam',
    host: 'opac.nlv.gov.vn',
    port: 443,
    database: 'opac',
    description: 'Tra cứu trực tiếp OPAC và tải bản ghi MARC21',
    flag: 'VN',
    searchMode: 'nlv-opac',
  },
  {
    id: 'loc-z3950',
    name: 'Thư viện Quốc hội Mỹ Z39.50',
    host: 'lx2.loc.gov',
    port: 210,
    database: 'LCDB',
    description: 'Tra cứu MARC21 qua Z39.50',
    flag: 'US',
    searchMode: 'z3950',
  },
];

const LANG_MAP: Record<string, string> = {
  vie: 'Tiếng Việt',
  eng: 'Tiếng Anh',
  fre: 'Tiếng Pháp',
  ger: 'Tiếng Đức',
  jpn: 'Tiếng Nhật',
  chi: 'Tiếng Trung',
  kor: 'Tiếng Hàn',
  rus: 'Tiếng Nga',
};

function langLabel(code: string): string {
  return LANG_MAP[code?.toLowerCase()] ?? code ?? '';
}

function libraryModeLabel(lib: Library): string {
  return lib.searchMode === 'nlv-opac' ? 'NLV OPAC' : 'Z39.50';
}

function physicalDescription(record: Pick<MarcRecord, 'physical' | 'pageCount' | 'dimensions'>): string {
  const physical = record.physical?.trim();
  const dimensions = record.dimensions?.trim();

  if (physical) {
    return dimensions && !physical.toLowerCase().includes(dimensions.toLowerCase())
      ? `${physical}; ${dimensions}`
      : physical;
  }

  return [
    record.pageCount ? `${record.pageCount} trang` : '',
    dimensions,
  ].filter(Boolean).join('; ');
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 flex-shrink-0 text-neutral-400">{icon}</span>
      <span className="min-w-[72px] flex-shrink-0 text-neutral-500">{label}:</span>
      <span className="break-words leading-relaxed text-neutral-800">{value}</span>
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
      <ExternalLink className="h-3 w-3" />
      {label}
    </a>
  );
}

function MarcFieldList({ leader, fields }: { leader?: string; fields?: MarcField[] }) {
  if (!leader && (!fields || fields.length === 0)) return null;

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">
          Tất cả trường MARC21
        </span>
        <span className="text-[10px] text-neutral-400">{fields?.length ?? 0} trường</span>
      </div>
      {leader && (
        <div className="mb-1 grid grid-cols-[44px_1fr] gap-2 text-xs">
          <span className="font-mono font-bold text-blue-600">LDR</span>
          <span className="break-all font-mono text-neutral-700">{leader}</span>
        </div>
      )}
      <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {(fields ?? []).map((field, index) => (
          <div key={`${field.tag}-${index}`} className="grid grid-cols-[44px_1fr] gap-2 text-xs">
            <span className="font-mono font-bold text-blue-600">{field.tag}</span>
            <span className="break-words text-neutral-700">
              {field.value ? (
                <span className="font-mono">{field.value}</span>
              ) : (
                <>
                  <span className="mr-2 font-mono text-neutral-400">
                    [{field.ind1 || ' '}{field.ind2 || ' '}]
                  </span>
                  {(field.subfields ?? []).map((sub, subIndex) => (
                    <span key={`${sub.code}-${subIndex}`} className="mr-2">
                      <span className="font-mono text-neutral-500">${sub.code}</span> {sub.value}
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

function ImportButton({ status, onImport }: { status: ImportStatus; onImport: () => void }) {
  if (status === 'success') {
    return (
      <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
        <CheckCircle className="h-4 w-4" />
        Đã import
      </div>
    );
  }

  if (status === 'error') {
    return (
      <button
        onClick={onImport}
        className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
      >
        <AlertCircle className="h-3.5 w-3.5" />
        Thử lại
      </button>
    );
  }

  if (status === 'importing') {
    return (
      <div className="flex items-center gap-1.5 text-xs font-medium text-blue-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Đang lưu...
      </div>
    );
  }

  return (
    <button
      onClick={onImport}
      className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
    >
      <Pencil className="h-3.5 w-3.5" />
      Sửa &amp; Import
    </button>
  );
}

function cleanIsbn(value: string): string {
  return value.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function validateIsbn10(value: string): boolean {
  const isbn = cleanIsbn(value);
  if (isbn.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(isbn[i]);
  sum += isbn[9] === 'X' ? 10 : Number(isbn[9]);
  return sum % 11 === 0;
}

function validateIsbn13(value: string): boolean {
  const isbn = cleanIsbn(value);
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

function isbnStatus(value: string): { ok: boolean; msg: string } {
  if (!value.trim()) return { ok: true, msg: '' };
  const clean = cleanIsbn(value);
  if (clean.length === 10) {
    return validateIsbn10(clean)
      ? { ok: true, msg: 'ISBN-10 hợp lệ' }
      : { ok: false, msg: 'ISBN-10 sai checksum' };
  }
  if (clean.length === 13) {
    return validateIsbn13(clean)
      ? { ok: true, msg: 'ISBN-13 hợp lệ' }
      : { ok: false, msg: 'ISBN-13 sai checksum' };
  }
  return { ok: false, msg: `ISBN phải có 10 hoặc 13 ký tự, hiện có ${clean.length}` };
}

function ddcStatus(value: string): { ok: boolean; msg: string } {
  if (!value.trim()) return { ok: true, msg: '' };
  const clean = value.trim().replace(/[/\\].*$/, '').trim();
  return /^\d{3}(\.\d{1,7})?$/.test(clean)
    ? { ok: true, msg: 'DDC hợp lệ' }
    : { ok: false, msg: 'DDC cần dạng 3 chữ số, ví dụ 895.9223' };
}

function normalizeSubject(value: string): string {
  const normalized = value
    .trim()
    .replace(/\s*--+\s*/g, ' -- ')
    .replace(/\s*—\s*/g, ' -- ')
    .replace(/\.(?!\S)$/, '');

  return normalized
    .split(' -- ')
    .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
    .filter(Boolean)
    .join(' -- ');
}

function subjectErrors(subjects: string[]): string[] {
  return subjects.map(subject => {
    if (!subject.trim()) return '';
    if (subject.trim().length < 2) return 'Chủ đề quá ngắn';
    if (/[,;]/.test(subject)) return 'Dùng " -- " để phân cấp chủ đề';
    return '';
  });
}

interface EditImportModalProps {
  record: MarcRecord;
  onClose: () => void;
  onSave: (edited: MarcRecord) => void;
  saving: boolean;
}

function EditImportModal({ record, onClose, onSave, saving }: EditImportModalProps) {
  const [draft, setDraft] = useState<MarcRecord>({ ...record });
  const [subjectInput, setSubjectInput] = useState((record.subjects ?? []).join('\n'));
  const [triedSave, setTriedSave] = useState(false);

  const isbn = isbnStatus(draft.isbn ?? '');
  const ddc = ddcStatus(draft.ddc ?? '');
  const subjects = draft.subjects ?? [];
  const subjectErrs = subjectErrors(subjects);
  const hasSubjectError = subjectErrs.some(Boolean);
  const canSave = isbn.ok && ddc.ok && !hasSubjectError;

  const setField = (field: keyof MarcRecord, value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
  };

  const handleSubjectChange = (raw: string) => {
    setSubjectInput(raw);
    setDraft(current => ({
      ...current,
      subjects: raw.split('\n').map(normalizeSubject).filter(Boolean),
    }));
  };

  const handleSubjectBlur = () => {
    const normalized = subjectInput.split('\n').map(normalizeSubject).filter(Boolean);
    setSubjectInput(normalized.join('\n'));
    setDraft(current => ({ ...current, subjects: normalized }));
  };

  const handleSaveClick = () => {
    setTriedSave(true);
    if (canSave) onSave(draft);
  };

  const Field = ({
    label,
    field,
    multiline = false,
  }: { label: string; field: keyof MarcRecord; multiline?: boolean }) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-neutral-500">{label}</label>
      {multiline ? (
        <textarea
          rows={3}
          value={(draft[field] as string) ?? ''}
          onChange={event => setField(field, event.target.value)}
          className="resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      ) : (
        <input
          type="text"
          value={(draft[field] as string) ?? ''}
          onChange={event => setField(field, event.target.value)}
          className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-neutral-800">Kiểm tra &amp; chỉnh sửa trước khi import</h2>
          </div>
          <button onClick={onClose} className="text-neutral-400 transition-colors hover:text-neutral-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <Field label="Nhan đề (245)" field="title" />
          <Field label="Phụ đề" field="subtitle" />
          <Field label="Tác giả (100)" field="author" />
          <Field label="Năm xuất bản" field="year" />

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">ISBN (020)</label>
            <input
              type="text"
              value={draft.isbn ?? ''}
              onChange={event => setField('isbn', event.target.value)}
              className={cn(
                'rounded-lg border bg-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2',
                triedSave && !isbn.ok
                  ? 'border-red-400 focus:ring-red-400'
                  : isbn.ok && draft.isbn
                    ? 'border-emerald-400 focus:ring-emerald-400'
                    : 'border-neutral-200 focus:ring-blue-500',
              )}
            />
            {draft.isbn && (
              <p className={cn('text-xs', isbn.ok ? 'text-emerald-600' : 'text-red-500')}>
                {isbn.msg}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-500">DDC (082)</label>
              <input
                type="text"
                value={draft.ddc ?? ''}
                onChange={event => setField('ddc', event.target.value)}
                className={cn(
                  'rounded-lg border bg-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2',
                  triedSave && !ddc.ok
                    ? 'border-red-400 focus:ring-red-400'
                    : ddc.ok && draft.ddc
                      ? 'border-emerald-400 focus:ring-emerald-400'
                      : 'border-neutral-200 focus:ring-blue-500',
                )}
              />
              {draft.ddc && (
                <p className={cn('text-xs', ddc.ok ? 'text-emerald-600' : 'text-red-500')}>
                  {ddc.msg}
                </p>
              )}
            </div>
            <Field label="Ngôn ngữ (041)" field="language" />
          </div>

          <Field label="Nhà xuất bản (260$b)" field="publisher" />
          <Field label="Mô tả vật lý (300)" field="physical" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Số trang" field="pageCount" />
            <Field label="Kích thước" field="dimensions" />
          </div>
          <Field label="Tóm tắt (520)" field="summary" multiline />

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-500">Chủ đề (650), mỗi dòng một chủ đề</label>
              <span className="text-xs text-neutral-400">{subjects.length} chủ đề</span>
            </div>
            <textarea
              rows={Math.max(3, subjects.length + 1)}
              value={subjectInput}
              onChange={event => handleSubjectChange(event.target.value)}
              onBlur={handleSubjectBlur}
              className={cn(
                'resize-none rounded-lg border bg-neutral-50 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2',
                triedSave && hasSubjectError ? 'border-red-400 focus:ring-red-400' : 'border-neutral-200 focus:ring-blue-500',
              )}
            />
            {subjects.length > 0 && (
              <div className="mt-1 flex flex-col gap-1">
                {subjects.map((subject, index) => (
                  <div key={`${subject}-${index}`} className="flex items-start gap-2">
                    <span
                      className={cn(
                        'inline-flex flex-shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-xs',
                        subjectErrs[index]
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-teal-100 bg-teal-50 text-teal-700',
                      )}
                    >
                      <Tag className="h-2.5 w-2.5" />
                      {subject}
                    </span>
                    {subjectErrs[index] && (
                      <span className="mt-0.5 text-xs text-red-500">{subjectErrs[index]}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-5 py-4">
          <div className="text-xs text-red-500">
            {!canSave && triedSave ? 'Vui lòng sửa các trường lỗi trước khi lưu' : ''}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-neutral-600 transition-colors hover:text-neutral-800 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              onClick={handleSaveClick}
              disabled={saving || !canSave}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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

  const subjects = record.subjects ?? [];
  const detailLink = record.infoLink || record.canonicalVolumeLink;

  const handleSave = async (edited: MarcRecord) => {
    setSaving(true);
    setImportStatus('importing');

    try {
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: edited.title || 'Không rõ',
          subtitle: edited.subtitle || '',
          author: edited.author || '',
          year: edited.year ? Number.parseInt(edited.year, 10) : null,
          isbn: edited.isbn || '',
          isbn10: edited.isbn10 || '',
          ddc: edited.ddc || '',
          publisher: edited.publisher || '',
          language: edited.language || '',
          physical: edited.physical || '',
          pageCount: edited.pageCount || '',
          dimensions: edited.dimensions || '',
          summary: edited.summary || '',
          searchSnippet: edited.searchSnippet || '',
          subjects: edited.subjects || [],
          mainCategory: edited.mainCategory || '',
          infoLink: edited.infoLink || '',
          canonicalVolumeLink: edited.canonicalVolumeLink || '',
          thumbnail: edited.thumbnail || '',
          rawOcrText: edited.rawMarc || '',
          rawMarc: edited.rawMarc || '',
          marcLeader: edited.marcLeader || '',
          marcFields: edited.marcFields || [],
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      saveLocalBook({ ...edited, rawOcrText: edited.rawMarc }, data.id);
      setImportStatus('success');
      setShowModal(false);
    } catch (error) {
      console.error('Import lỗi:', error);
      setImportStatus('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className={cn(
        'overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-md',
        importStatus === 'success' ? 'border-emerald-200' : 'border-neutral-200',
      )}>
        <div className={cn(
          'h-1 w-full',
          importStatus === 'success'
            ? 'bg-gradient-to-r from-emerald-400 to-teal-500'
            : 'bg-gradient-to-r from-blue-500 to-blue-700',
        )} />

        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-28 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-100">
                {record.thumbnail ? (
                  <img
                    src={record.thumbnail}
                    alt={record.title ? `Bìa ${record.title}` : 'Bìa sách'}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <BookOpen className="h-6 w-6 text-neutral-300" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold leading-snug text-neutral-900">
                  {record.title || <span className="italic text-neutral-400">Không có tiêu đề</span>}
                </h3>
                {record.subtitle && <p className="mt-0.5 text-xs text-neutral-500">{record.subtitle}</p>}
                {(record.author || record.year) && (
                  <p className="mt-1 text-sm text-neutral-500">
                    {[record.author, record.year].filter(Boolean).join(' · ')}
                  </p>
                )}
                {(record.searchSnippet || record.summary) && (
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-neutral-600">
                    {record.searchSnippet || record.summary}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-3">
                  <LinkRow label="Thông tin nguồn" href={detailLink} />
                </div>
              </div>
            </div>
            <div className="flex-shrink-0">
              <ImportButton status={importStatus} onImport={() => setShowModal(true)} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {record.year && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                <Calendar className="h-3 w-3" />
                {record.year}
              </span>
            )}
            {record.isbn && (
              <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 font-mono text-xs text-neutral-600">
                <Hash className="h-3 w-3" />
                {record.isbn}
              </span>
            )}
            {record.ddc && (
              <span className="inline-flex items-center gap-1 rounded-full border border-purple-100 bg-purple-50 px-2 py-0.5 text-xs text-purple-700">
                <Layers className="h-3 w-3" />
                DDC {record.ddc}
              </span>
            )}
            {record.language && (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                <Globe className="h-3 w-3" />
                {langLabel(record.language)}
              </span>
            )}
            {(record.marcFields?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                <Database className="h-3 w-3" />
                MARC21 {record.marcFields?.length} trường
              </span>
            )}
          </div>

          <button
            onClick={() => setExpanded(value => !value)}
            className="mt-3 flex items-center gap-1 text-xs text-neutral-400 transition-colors hover:text-neutral-600"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? 'Thu gọn' : 'Chi tiết MARC21'}
          </button>

          {expanded && (
            <div className="mt-3 space-y-1.5 border-t border-neutral-100 pt-3">
              <InfoRow icon={<Building2 className="h-3 w-3" />} label="Nhà xuất bản" value={record.publisher} />
              <InfoRow icon={<Calendar className="h-3 w-3" />} label="Năm XB" value={record.year} />
              <InfoRow icon={<Hash className="h-3 w-3" />} label="ISBN-10" value={record.isbn10} />
              <InfoRow icon={<BookMarked className="h-3 w-3" />} label="Mô tả vật lý" value={physicalDescription(record)} />
              <InfoRow icon={<Tag className="h-3 w-3" />} label="Danh mục" value={record.mainCategory} />
              {record.summary && (
                <div className="mt-2 rounded-lg bg-neutral-50 p-2.5 text-xs leading-relaxed text-neutral-600">
                  <span className="font-medium text-neutral-700">Tóm tắt: </span>
                  {record.summary}
                </div>
              )}
              {subjects.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {subjects.slice(0, 8).map((subject, index) => (
                    <span key={`${subject}-${index}`} className="inline-flex items-center gap-1 rounded border border-teal-100 bg-teal-50 px-1.5 py-0.5 text-xs text-teal-700">
                      <Tag className="h-2.5 w-2.5" />
                      {subject}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-3">
                <LinkRow label="Thông tin nguồn" href={detailLink} />
              </div>
              <MarcFieldList leader={record.marcLeader} fields={record.marcFields} />
              <div className="mt-2 truncate font-mono text-xs text-neutral-400">Nguồn: {record.source}</div>
            </div>
          )}
        </div>
      </div>

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

export default function CatalogPage() {
  const [selectedLibrary, setSelectedLibrary] = useState<Library>(LIBRARIES[0]);
  const [searchType, setSearchType] = useState<SearchType>('title');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<MarcRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query || isSearching) return;

    setIsSearching(true);
    setError(null);
    setResults(null);

    try {
      const url = selectedLibrary.searchMode === 'nlv-opac'
        ? `/api/catalog/search-nlv-opac?searchType=${encodeURIComponent(searchType)}&query=${encodeURIComponent(query)}`
        : `/api/catalog/search?host=${encodeURIComponent(selectedLibrary.host)}&port=${selectedLibrary.port}&database=${encodeURIComponent(selectedLibrary.database)}&searchType=${encodeURIComponent(searchType)}&query=${encodeURIComponent(query)}`;

      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Lỗi HTTP ${res.status}`);

      setResults(data.records ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi kết nối tới thư viện');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleLibraryChange = (library: Library) => {
    setSelectedLibrary(library);
    setResults(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-blue-700 to-blue-900 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Globe className="h-5 w-5" />
              Biên mục từ Thư viện Quốc tế
            </h2>
            <p className="mt-1 text-sm text-blue-200">Tìm kiếm &amp; import bản ghi MARC21 qua NLV OPAC / Z39.50</p>
          </div>
          {results !== null && (
            <div className="text-right text-sm text-blue-200">
              <div className="text-2xl font-bold text-white">{total}</div>
              <div className="text-xs">kết quả</div>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LIBRARIES.map(library => (
            <button
              key={library.id}
              onClick={() => handleLibraryChange(library)}
              className={cn(
                'rounded-xl border p-3 text-left transition-all',
                selectedLibrary.id === library.id
                  ? 'border-white bg-white text-blue-800 shadow-lg'
                  : 'border-white/20 bg-white/10 text-white hover:bg-white/20',
              )}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="text-base font-bold">{library.flag}</span>
                <span className="leading-tight">{library.name}</span>
              </div>
              <div className={cn('mt-1 text-xs', selectedLibrary.id === library.id ? 'text-blue-500' : 'text-blue-200')}>
                {library.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={searchType}
            onChange={event => setSearchType(event.target.value as SearchType)}
            className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-44"
          >
            <option value="title">Nhan đề (245)</option>
            <option value="author">Tác giả (100)</option>
            <option value="isbn">ISBN (020)</option>
            <option value="keyword">Từ khóa</option>
          </select>

          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') handleSearch();
              }}
              placeholder="Nhập từ khóa tìm kiếm..."
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-4 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setResults(null);
                  setError(null);
                  inputRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <button
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim()}
            className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {isSearching ? 'Đang tìm...' : 'Tìm kiếm'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
          <span className="flex items-center gap-1">
            <Database className="h-3.5 w-3.5" />
            <b className="text-neutral-600">{selectedLibrary.name}</b>
          </span>
          <span>{libraryModeLabel(selectedLibrary)}</span>
        </div>
      </div>

      {isSearching && (
        <div className="rounded-2xl border border-neutral-100 bg-white p-12 text-center shadow-sm">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm font-medium text-neutral-600">
            Đang kết nối tới <b>{selectedLibrary.name}</b>...
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {libraryModeLabel(selectedLibrary)} • {selectedLibrary.host}:{selectedLibrary.port}/{selectedLibrary.database}
          </p>
        </div>
      )}

      {error && !isSearching && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-700">Lỗi kết nối</p>
              <p className="mt-1 text-xs text-red-600">{error}</p>
              <button onClick={handleSearch} className="mt-3 flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-800">
                <RefreshCw className="h-3.5 w-3.5" />
                Thử lại
              </button>
            </div>
          </div>
        </div>
      )}

      {results !== null && results.length === 0 && !isSearching && !error && (
        <div className="rounded-2xl border border-neutral-100 bg-white p-12 text-center shadow-sm">
          <BookOpen className="mx-auto mb-3 h-10 w-10 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-500">Không tìm thấy kết quả</p>
          <p className="mt-1 text-xs text-neutral-400">Thử từ khóa khác hoặc đổi loại tìm kiếm</p>
        </div>
      )}

      {results && results.length > 0 && !isSearching && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium text-neutral-700">
                Tìm thấy <b>{total}</b> kết quả từ <b>{selectedLibrary.name}</b>
              </span>
            </div>
            <span className="hidden text-xs text-neutral-400 sm:inline">Nhấn "Import" để lưu bản ghi vào thư viện</span>
          </div>

          <div className="grid gap-4">
            {results.map(record => (
              <RecordCard key={record.id} record={record} />
            ))}
          </div>

          {total > results.length && (
            <p className="py-2 text-center text-xs text-neutral-400">
              Hiển thị {results.length}/{total} kết quả. Thu hẹp từ khóa để xem chính xác hơn.
            </p>
          )}
        </div>
      )}

      {results === null && !isSearching && !error && (
        <div className="rounded-2xl border border-neutral-100 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
            <Globe className="h-8 w-8 text-blue-400" />
          </div>
          <h3 className="mb-1 text-base font-semibold text-neutral-700">Kết nối thư viện quốc tế</h3>
          <p className="mx-auto max-w-md text-sm text-neutral-400">
            Chọn nguồn, nhập từ khóa rồi tìm kiếm. Kết quả trả về bản ghi MARC21 để import vào thư viện của bạn.
          </p>
        </div>
      )}
    </div>
  );
}
