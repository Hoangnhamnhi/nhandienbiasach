type RawBook = Record<string, unknown>;

interface ExportField {
  header: string;
  width: number;
  getValue: (book: RawBook) => unknown;
}

const EXCEL_CELL_LIMIT = 32767;

function normalizeBook(raw: unknown): RawBook {
  if (!raw || typeof raw !== 'object') return {};

  const source = raw as RawBook;
  const out: RawBook = { ...source };

  for (const [key, value] of Object.entries(source)) {
    const lowerFirst = key.charAt(0).toLowerCase() + key.slice(1);
    if (out[lowerFirst] === undefined) out[lowerFirst] = value;
  }

  if (out.publishyear !== undefined && out.publishYear === undefined) {
    out.publishYear = out.publishyear;
  }
  if (out.year !== undefined && out.publishYear === undefined) {
    out.publishYear = out.year;
  }
  if (out.pagecount !== undefined && out.pageCount === undefined) {
    out.pageCount = out.pagecount;
  }

  return out;
}

const BOOK_EXPORT_FIELDS: ExportField[] = [
  { header: 'ID', width: 55, getValue: book => book.id ?? book.Id },
  { header: 'Tên sách (245)', width: 240, getValue: book => book.title },
  { header: 'Tác giả (100)', width: 180, getValue: book => book.author },
  { header: 'Năm xuất bản', width: 90, getValue: book => book.publishYear },
  { header: 'ISBN (020)', width: 140, getValue: book => book.isbn },
  { header: 'DDC (082)', width: 95, getValue: book => book.ddc },
  { header: 'Nơi sản xuất (260$a)', width: 160, getValue: book => book.productionPlace },
  { header: 'Nhà xuất bản', width: 180, getValue: book => book.publisher },
  { header: 'Ngôn ngữ (041)', width: 95, getValue: book => book.language },
  { header: 'Số trang', width: 85, getValue: book => book.pageCount },
  { header: 'Khổ sách', width: 95, getValue: book => book.dimensions },
  { header: 'Chủ đề (650)', width: 240, getValue: book => book.subjects },
  { header: 'Tóm tắt (520)', width: 320, getValue: book => book.summary },
];

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toCellText(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = Array.isArray(value) ? value.join('; ') : String(value);
  return text.length > EXCEL_CELL_LIMIT
    ? text.slice(0, EXCEL_CELL_LIMIT - 3) + '...'
    : text;
}

function createCell(value: unknown, styleId?: string): string {
  const style = styleId ? ` ss:StyleID="${styleId}"` : '';
  return `<Cell${style}><Data ss:Type="String">${escapeXml(toCellText(value))}</Data></Cell>`;
}

function formatDateForFile(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildExcelXml(rawBooks: unknown[]): string {
  const rows = rawBooks.map(normalizeBook);
  const columns = BOOK_EXPORT_FIELDS
    .map(field => `<Column ss:Width="${field.width}" />`)
    .join('');
  const headerRow = `<Row>${BOOK_EXPORT_FIELDS.map(field => createCell(field.header, 'Header')).join('')}</Row>`;
  const dataRows = rows
    .map(book => `<Row>${BOOK_EXPORT_FIELDS.map(field => createCell(field.getValue(book), 'Text')).join('')}</Row>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1" />
      <Interior ss:Color="#DBEAFE" ss:Pattern="Solid" />
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" />
      </Borders>
    </Style>
    <Style ss:ID="Text">
      <Alignment ss:Vertical="Top" ss:WrapText="1" />
    </Style>
  </Styles>
  <Worksheet ss:Name="Thu vien sach">
    <Table>${columns}${headerRow}${dataRows}</Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes />
      <FrozenNoSplit />
      <SplitHorizontal>1</SplitHorizontal>
      <TopRowBottomPane>1</TopRowBottomPane>
      <ActivePane>2</ActivePane>
    </WorksheetOptions>
  </Worksheet>
</Workbook>`;
}

export function exportBooksToExcel(rawBooks: unknown[]): void {
  if (!rawBooks.length) {
    throw new Error('Chưa có sách để xuất Excel.');
  }

  const workbookXml = buildExcelXml(rawBooks);
  const blob = new Blob([workbookXml], {
    type: 'application/vnd.ms-excel;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `thu-vien-sach-${formatDateForFile(new Date())}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
