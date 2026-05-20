# AI LibraryScanner

Ứng dụng React/Vite có backend Express chạy local và chạy được trên Vercel Functions.

## Chạy local

1. Cài dependencies:

   ```bash
   npm install
   ```

2. Tạo file `.env` từ `.env.example`, rồi điền các biến:

   ```bash
   GEMINI_API_KEY=your_gemini_api_key
   SQL_CONNECTION_STRING=Server=tcp:localhost,1433;Initial Catalog=librarydb;User ID=sa;Password=your_password;Encrypt=True;TrustServerCertificate=True;
   ```

3. Chạy app:

   ```bash
   npm run dev
   ```

## Deploy lên Vercel

Vercel không truy cập được database `localhost` trên máy cá nhân. Để người khác mở website và dùng được dữ liệu, hãy dùng SQL Server/Azure SQL public hoặc database SQL Server có thể truy cập từ internet.

Trong Vercel Dashboard, vào **Project Settings → Environment Variables** và thêm:

- `GEMINI_API_KEY`: API key dùng cho Gemini.
- `SQL_CONNECTION_STRING`: connection string của SQL Server/Azure SQL public.
- `GOOGLE_BOOKS_API_KEY`: tùy chọn, giúp Google Books API ổn định hơn.

Ví dụ `SQL_CONNECTION_STRING` cho Azure SQL:

```text
Server=tcp:your-sql-server.database.windows.net,1433;Initial Catalog=librarydb;Persist Security Info=False;User ID=your_user;Password=your_password;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

Build command trên Vercel: `npm run build`

Output directory: `dist`

Sau khi deploy, các route frontend như `/catalog`, `/library` sẽ mở được trực tiếp, còn API sẽ chạy qua `/api/...`.
