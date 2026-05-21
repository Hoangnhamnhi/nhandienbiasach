import React, { useState, useRef } from 'react';
import { UploadCloud, BookOpen, Save, Loader2, X, Edit2, Eye, CheckCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { ExtractedData } from '../App';
import { saveLocalBook } from '../lib/demo-books';

export default function ScannerPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []) as File[];
    if (selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...selectedFiles]);
      setPreviewUrls(prev => [...prev, ...selectedFiles.map(f => URL.createObjectURL(f))]);
      setExtractedData(null);
      setEditMode(false);
      setSavedId(null);
    }
  };

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => {
      const urls = [...prev];
      URL.revokeObjectURL(urls[index]);
      urls.splice(index, 1);
      return urls;
    });
  };

  const handleExtract = async () => {
    if (files.length === 0) return;
    setIsExtracting(true);
    setExtractedData(null);
    setEditMode(false);
    setSavedId(null);

    const formData = new FormData();
    files.forEach(file => { formData.append('images', file); });

    try {
      const res = await fetch('/api/extract', { method: 'POST', body: formData });
      let data;
      let rawText = '';
      try {
        rawText = await res.text();
        data = JSON.parse(rawText);
      } catch (e) {
        throw new Error(`Lỗi máy chủ (Không thể đọc phản hồi): ${rawText}`);
      }
      if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');

      setExtractedData({
        title: data.title || '',
        author: data.author || '',
        year: data.year ? String(data.year) : '',
        publisher: data.publisher || '',
        isbn: data.isbn || '',
        ddc: data.ddc || '',
        language: data.language || '',
        physical: data.physical || '',
        pageCount: data.pageCount || '',
        dimensions: data.dimensions || '',
        summary: data.summary || '',
        subjects: data.subjects || [],
        rawOcrText: data.rawOcrText,
      });
      // Sau khi trích xuất xong → ở chế độ xem, chưa cho chỉnh sửa
      setEditMode(false);
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!extractedData) return;
    setIsSaving(true);
    try {
      const payload = {
        title: extractedData.title,
        author: extractedData.author,
        year: extractedData.year ? parseInt(extractedData.year, 10) : null,
        publisher: extractedData.publisher,
        isbn: extractedData.isbn,
        ddc: extractedData.ddc,
        language: extractedData.language,
        physical: extractedData.physical,
        pageCount: extractedData.pageCount,
        dimensions: extractedData.dimensions,
        summary: extractedData.summary,
        subjects: extractedData.subjects,
        rawOcrText: extractedData.rawOcrText,
      };
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Lỗi khi lưu sách');
      const data = await res.json();
      saveLocalBook(payload, data.id);
      setSavedId(data.id);
      setEditMode(false);
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const resetAll = () => {
    setFiles([]);
    setPreviewUrls([]);
    setExtractedData(null);
    setEditMode(false);
    setSavedId(null);
  };

  // Component hiển thị thông tin (chế độ xem)
  const ViewField = ({ label, value }: { label: string; value?: string | null }) => {
    if (!value) return null;
    return (
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-neutral-800 leading-relaxed">{value}</p>
      </div>
    );
  };

  return (
    <div className="grid lg:grid-cols-12 gap-8 items-start max-w-6xl mx-auto">
      {/* Cột 1: Tải ảnh */}
      <section className="lg:col-span-4 bg-white p-6 rounded-3xl shadow-sm border border-neutral-200 flex flex-col sticky top-24">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-neutral-900 tracking-tight">Quét bìa sách</h2>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          {previewUrls.map((url, index) => (
            <div key={index} className="relative group rounded-xl overflow-hidden aspect-[3/4] bg-neutral-100 border border-neutral-200 shadow-sm">
              <img src={url} alt={`Preview ${index}`} className="w-full h-full object-cover" />
              <button
                onClick={(e) => { e.preventDefault(); handleRemoveFile(index); }}
                className="absolute top-2 right-2 bg-white p-1.5 rounded-full text-red-600 opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md hover:bg-red-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <label className={cn(
          'relative group flex flex-col items-center justify-center w-full border-2 border-dashed rounded-2xl transition-all cursor-pointer overflow-hidden mb-6 bg-neutral-50/50 hover:border-blue-500 hover:bg-blue-50/30 border-neutral-300',
          previewUrls.length === 0 ? 'h-64' : 'h-32'
        )}>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileSelect}
          />
          <div className="flex flex-col items-center justify-center p-6 text-center z-10">
            <div className={cn(
              'rounded-full bg-white shadow-sm border border-neutral-100 flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform duration-300',
              previewUrls.length === 0 ? 'w-14 h-14 mb-4' : 'w-10 h-10 mb-2'
            )}>
              <UploadCloud className={previewUrls.length === 0 ? 'h-6 w-6' : 'h-5 w-5'} />
            </div>
            <p className="text-sm font-semibold text-neutral-900">
              {previewUrls.length === 0 ? 'Tải lên ảnh sách' : 'Thêm ảnh khác'}
            </p>
            <p className="text-xs text-neutral-500 mt-1">
              Bìa trước, tóm tắt mặt sau, mục lục...
            </p>
          </div>
        </label>

        <div className="flex gap-3 mt-auto pt-2 border-t border-neutral-100">
          {files.length > 0 && (
            <button
              onClick={(e) => { e.preventDefault(); setFiles([]); setPreviewUrls([]); }}
              className="px-4 py-2.5 text-sm font-semibold text-neutral-600 bg-white border border-neutral-200 rounded-xl hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
              disabled={isExtracting}
            >
              Xóa tất cả
            </button>
          )}
          <button
            onClick={handleExtract}
            disabled={files.length === 0 || isExtracting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all disabled:opacity-60 disabled:hover:bg-blue-600 disabled:cursor-not-allowed shadow-sm shadow-blue-600/20 active:scale-[0.98]"
          >
            {isExtracting ? <><Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý...</> : 'Nhận diện ngay'}
          </button>
        </div>
      </section>

      {/* Cột 2: Kết quả */}
      <section className="lg:col-span-8 bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-neutral-200 min-h-[500px]">
        {/* Header kết quả */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-neutral-900">Kết quả trích xuất</h2>
          {extractedData && !savedId && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditMode(e => !e)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl border transition-colors',
                  editMode
                    ? 'bg-neutral-100 text-neutral-600 border-neutral-200 hover:bg-neutral-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                )}
              >
                {editMode ? <Eye className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                {editMode ? 'Xem lại' : 'Sửa thông tin'}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || editMode}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-neutral-900 text-white rounded-xl hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Lưu sách
              </button>
            </div>
          )}
        </div>

        {/* Trạng thái trống */}
        {!extractedData && !isExtracting && (
          <div className="h-full flex flex-col items-center justify-center text-neutral-400 text-center py-24">
            <BookOpen className="h-12 w-12 mb-3 opacity-20" />
            <p>Thông tin sách sẽ hiển thị ở đây<br />sau khi AI nhận diện hoàn tất.</p>
          </div>
        )}

        {/* Đang xử lý */}
        {isExtracting && (
          <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-center py-24">
            <Loader2 className="h-12 w-12 mb-3 text-blue-600 animate-spin" />
            <p className="font-medium animate-pulse">AI đang phân tích ảnh và tự động tìm kiếm...</p>
            <p className="text-sm mt-2 text-neutral-400">Tiến trình này kết hợp nhận diện hình ảnh và Google Search để lấy đầy đủ chi tiết nhất có thể.</p>
          </div>
        )}

        {/* Đã lưu thành công */}
        {savedId && extractedData && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">Đã lưu vào thư viện (ID: #{savedId})</p>
                <p className="text-xs text-emerald-600 mt-0.5">{extractedData.title}</p>
              </div>
              <button onClick={resetAll} className="ml-auto text-xs text-emerald-700 hover:underline font-medium">Quét sách mới</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-neutral-50 rounded-2xl border border-neutral-100">
              <ViewField label="Tên sách (245)" value={extractedData.title} />
              <ViewField label="Tác giả (100)" value={extractedData.author} />
              <ViewField label="ISBN" value={extractedData.isbn} />
              <ViewField label="Nhà xuất bản" value={extractedData.publisher} />
              <ViewField label="Năm XB" value={extractedData.year} />
              <ViewField label="DDC" value={extractedData.ddc} />
            </div>
          </div>
        )}

        {/* Kết quả đã trích xuất — chế độ xem */}
        {extractedData && !savedId && !editMode && (
          <div className="space-y-4">

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 p-5 bg-neutral-50 rounded-2xl border border-neutral-100">
              <ViewField label="Tên sách (245)" value={extractedData.title} />
              <ViewField label="Tác giả (100)" value={extractedData.author} />
              <ViewField label="ISBN (020)" value={extractedData.isbn} />
              <ViewField label="Nhà xuất bản (260$b)" value={extractedData.publisher} />
              <ViewField label="Năm XB (260$c)" value={extractedData.year} />
              <ViewField label="Phân loại DDC (082)" value={extractedData.ddc} />
              <ViewField label="Ngôn ngữ (041)" value={extractedData.language} />
              <ViewField label="Mô tả vật lý (300)" value={[extractedData.pageCount ? extractedData.pageCount + ' trang' : '', extractedData.dimensions].filter(Boolean).join('; ')} />
              {extractedData?.subjects && extractedData.subjects.length > 0 && (
                <div className="sm:col-span-2 space-y-0.5">
                  <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Chủ đề (650)</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {extractedData.subjects.map((s, i) => (
                      <span key={i} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {extractedData.summary && (
                <div className="sm:col-span-2 space-y-0.5">
                  <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Tóm tắt (520)</p>
                  <p className="text-sm text-neutral-700 leading-relaxed whitespace-pre-wrap">{extractedData.summary}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Kết quả — chế độ chỉnh sửa */}
        {extractedData && !savedId && editMode && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-700">
              <Edit2 className="w-4 h-4 flex-shrink-0" />
              <span>Chỉnh sửa thông tin bên dưới. Sau khi xong, nhấn <b>Xem lại</b> rồi mới <b>Lưu sách</b>.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium text-neutral-700">Tên sách (245)</label>
                <input type="text" value={extractedData.title || ''} onChange={e => setExtractedData({...extractedData, title: e.target.value})} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-neutral-700">Tác giả (100)</label>
                <input type="text" value={extractedData.author || ''} onChange={e => setExtractedData({...extractedData, author: e.target.value})} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-neutral-700">ISBN (020)</label>
                <input type="text" value={extractedData.isbn || ''} onChange={e => setExtractedData({...extractedData, isbn: e.target.value})} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-neutral-700">Nhà xuất bản (260$b)</label>
                <input type="text" value={extractedData.publisher || ''} onChange={e => setExtractedData({...extractedData, publisher: e.target.value})} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-neutral-700">Năm XB (260$c)</label>
                <input type="number" value={extractedData.year || ''} onChange={e => setExtractedData({...extractedData, year: e.target.value || ''})} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-neutral-700">Phân loại DDC (082)</label>
                <input type="text" value={extractedData.ddc || ''} onChange={e => setExtractedData({...extractedData, ddc: e.target.value})} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-neutral-700">Ngôn ngữ (041)</label>
                <input type="text" value={extractedData.language || ''} onChange={e => setExtractedData({...extractedData, language: e.target.value})} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium text-neutral-700">Mô tả vật lý (300)</label>
                <input type="text" value={extractedData.physical || ''} onChange={e => setExtractedData({...extractedData, physical: e.target.value})} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Ví dụ: 300 trang ; 24 cm" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium text-neutral-700">Chủ đề (650)</label>
                <input type="text" value={extractedData.subjects?.join('; ') || ''} onChange={e => setExtractedData({...extractedData, subjects: e.target.value.split(';').map(s => s.trim()).filter(Boolean)})} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Cách nhau bằng dấu chấm phẩy (;)" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium text-neutral-700">Tóm tắt (520)</label>
                <textarea value={extractedData.summary || ''} onChange={e => setExtractedData({...extractedData, summary: e.target.value})} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none min-h-[100px]" />
              </div>
            </div>
            <div className="pt-2">
              <button
                onClick={() => setEditMode(false)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors"
              >
                <Eye className="h-4 w-4" /> Xem lại trước khi lưu
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
