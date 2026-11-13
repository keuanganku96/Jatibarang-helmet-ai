SMART POS JATIBARANG — PAKET AWAL

STRUKTUR:
- index.html
- package.json
- .env.example
- .gitignore
- src/App.jsx
- src/main.jsx
- src/style.css
- src/supabase.js

PENTING:
1. Paket ini adalah fondasi aplikasi (login Supabase, dashboard responsif, dan kerangka menu).
2. Modul kasir, produk, stok, pembelian, laporan, dan pengaturan belum dihubungkan ke tabel database. Jangan gunakan untuk transaksi toko sebelum modul tersebut selesai diuji.
3. Jangan pernah memasukkan Supabase service_role/secret key ke aplikasi.
4. Publishable key boleh dipakai di browser dengan Row Level Security (RLS) yang benar.
5. Untuk Vercel, isi Environment Variables:
   VITE_SUPABASE_URL = https://pagwjxppmivetfkenfvb.supabase.co
   VITE_SUPABASE_ANON_KEY = publishable key milik Anda
6. Jangan unggah file .env yang berisi kredensial. Gunakan .env.example hanya sebagai contoh.

BUILD:
npm install
npm run build
