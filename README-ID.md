# SMART POS JATIBARANG — starter

Ini adalah kerangka awal aplikasi web React + Vite yang menggunakan Supabase Auth.
Kerangka ini belum mengaktifkan transaksi, produk, stok, atau integrasi pembayaran.

## 1. Konfigurasi lokal
1. Salin `.env.example` menjadi `.env.local`.
2. Isi `VITE_SUPABASE_URL` dengan Project URL dari Supabase.
3. Isi `VITE_SUPABASE_ANON_KEY` dengan Publishable Key (atau anon key lama).
4. Jangan pernah memasukkan `service_role` atau Secret Key ke aplikasi browser, GitHub, atau Vercel.

## 2. Menjalankan
```bash
npm install
npm run dev
```

## 3. Build untuk hosting
```bash
npm run build
```
Folder hasil build adalah `dist`.

## 4. Deploy Vercel
- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Tambahkan environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

## Catatan keamanan penting
Sebelum modul data bisnis diaktifkan, semua tabel yang dapat diakses melalui API harus memiliki RLS dan policy yang membatasi data berdasarkan keanggotaan bisnis/cabang. Jangan menonaktifkan RLS untuk membuat aplikasi terlihat berfungsi. Jangan menaruh service role key di frontend.
