const LOCAL_BOOKS_KEY = 'ai_library_local_books';

function readBooks(): any[] {
  try {
    const raw = localStorage.getItem(LOCAL_BOOKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBooks(books: any[]): void {
  localStorage.setItem(LOCAL_BOOKS_KEY, JSON.stringify(books));
}

export function getLocalBooks(): any[] {
  return readBooks();
}

export function mergeWithLocalBooks(apiBooks: any[]): any[] {
  const merged = new Map<string, any>();
  for (const book of apiBooks) merged.set(String(book.id ?? book.Id ?? crypto.randomUUID()), book);
  for (const book of readBooks()) merged.set(String(book.id ?? book.Id), book);
  return [...merged.values()].sort((a, b) => Number(b.id ?? b.Id ?? 0) - Number(a.id ?? a.Id ?? 0));
}

export function saveLocalBook(input: any, id?: number): any {
  const book = {
    ...input,
    id: id ?? Date.now(),
    title: input.title || 'Khong ro',
    author: input.author || '',
    publishYear: input.year ? Number(input.year) : (input.publishYear ?? null),
    isbn: input.isbn || '',
    ddc: input.ddc || '',
    publisher: input.publisher || '',
    language: input.language || '',
    physical: input.physical || '',
    pageCount: input.pageCount || '',
    dimensions: input.dimensions || '',
    summary: input.summary || '',
    toc: input.toc || '',
    subjects: Array.isArray(input.subjects) ? input.subjects.join('; ') : (input.subjects || ''),
    rawMarc: input.rawOcrText || input.rawMarc || '',
    marcLeader: input.marcLeader || '',
    marcFields: Array.isArray(input.marcFields) ? input.marcFields : [],
  };
  const books = readBooks().filter(item => String(item.id ?? item.Id) !== String(book.id));
  books.push(book);
  writeBooks(books);
  return book;
}

export function deleteLocalBook(id: number): void {
  writeBooks(readBooks().filter(book => Number(book.id ?? book.Id) !== id));
}
