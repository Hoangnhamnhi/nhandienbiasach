# AI LibraryScanner

Ung dung React/Vite co backend Express, chay duoc local va deploy duoc len Vercel Functions.

## Chay local

1. Cai dependencies:

   ```bash
   npm install
   ```

2. Tao file `.env` tu `.env.example`, roi dien cac bien can thiet.

3. Chay app:

   ```bash
   npm run dev
   ```

## Chay SQL Server local bang Docker

Docker setup nay dung SQL Server 2022 container, phu hop de phat trien local truoc khi deploy production len Azure SQL/Vercel.

1. Chay database:

   ```bash
   npm run db:up
   ```

2. Dung connection string nay trong file `.env`:

   ```text
   SQL_CONNECTION_STRING=Server=localhost,14333;Initial Catalog=librarydb;User ID=sa;Password=NhandienBiasach_12345!;Encrypt=True;TrustServerCertificate=True;Connection Timeout=30;
   ```

3. Xem log database neu can:

   ```bash
   npm run db:logs
   ```

4. Dung database:

   ```bash
   npm run db:down
   ```

Luu y: Docker database tren may ca nhan chi dung cho local. Vercel van can `SQL_CONNECTION_STRING` cua Azure SQL hoac SQL Server public.

## Demo nhanh tren Vercel khong can database

Neu chi can cho nguoi khac xem va thu vai lan, co the bat demo mode. Khi `DEMO_MODE=true`, app se dung bo nho tam cua Vercel Function cho auth/books thay vi SQL Server.

Trong Vercel Dashboard, vao **Project Settings -> Environment Variables** va them:

- `DEMO_MODE=true`
- `GEMINI_API_KEY=your_gemini_api_key`
- `GOOGLE_BOOKS_API_KEY=optional_google_books_api_key`

Khong can them `SQL_CONNECTION_STRING` cho demo mode.

Tai khoan co san:

```text
username: demo
password: demo123
```

Luu y: du lieu demo co the mat khi Vercel cold start, scale function, hoac redeploy. Cach nay chi phu hop demo tam thoi, khong dung cho production.

## Deploy len Vercel

Vercel khong truy cap duoc database `localhost` tren may ca nhan. De nguoi khac mo website va dung duoc du lieu, hay dung Azure SQL Database hoac SQL Server public.

Trong Vercel Dashboard, vao **Project Settings -> Environment Variables** va them:

- `GEMINI_API_KEY`: API key dung cho Gemini.
- `SQL_CONNECTION_STRING`: connection string cua Azure SQL/SQL Server public.
- `GOOGLE_BOOKS_API_KEY`: tuy chon, giup Google Books API on dinh hon.

Vi du `SQL_CONNECTION_STRING` cho Azure SQL:

```text
Server=tcp:your-sql-server.database.windows.net,1433;Initial Catalog=librarydb;Persist Security Info=False;User ID=your_user;Password=your_password;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

Build command tren Vercel: `npm run build`

Output directory: `dist`

Sau khi deploy, cac route frontend nhu `/catalog`, `/library` se mo duoc truc tiep, con API se chay qua `/api/...`.
