# AI LibraryScanner

Ung dung React/Vite co backend Express, chay local va deploy duoc len Vercel Functions.

Du lieu tai khoan va sach duoc luu tam trong bo nho cua process. Tren Vercel, du lieu nay co the mat khi function cold start, scale sang instance khac, hoac redeploy. Cach luu nay phu hop demo/thu nghiem tam thoi, khong phu hop production can luu tru lau dai.

## Chay local

1. Cai dependencies:

   ```bash
   npm install
   ```

2. Tao file `.env` va dien bien moi truong can thiet:

   ```text
   GEMINI_API_KEY=your_gemini_api_key
   GOOGLE_BOOKS_API_KEY=optional_google_books_api_key
   ```

3. Chay app:

   ```bash
   npm run dev
   ```

Tai khoan co san:

```text
username: admin
password: admin123
```

## Deploy len Vercel

Trong Vercel Dashboard, vao **Project Settings -> Environment Variables** va them:

- `GEMINI_API_KEY`: API key dung cho Gemini.
- `GOOGLE_BOOKS_API_KEY`: tuy chon, giup Google Books API on dinh hon.

Khong can cau hinh database hay connection string.

Build command tren Vercel: `npm run build`

Output directory: `dist`

Sau khi deploy, cac route frontend nhu `/catalog`, `/library` se mo duoc truc tiep, con API se chay qua `/api/...`.
