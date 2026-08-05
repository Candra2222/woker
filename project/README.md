# Realtime Conversion Dashboard (Trafee + iMonetizeIt)

Stack: **Cloudflare Worker** (penerima postback) + **Supabase** (database + realtime) + **Cloudflare Pages** (dashboard statis).

## Struktur folder
```
supabase/schema.sql        -> Skema database, jalankan di Supabase SQL Editor
worker/                    -> Cloudflare Worker, endpoint penerima postback
public/index.html          -> Dashboard (dilindungi login)
public/login.html          -> Halaman login (publik)
functions/_middleware.js   -> Cek sesi login di setiap request, sebelum HTML terkirim
functions/api/login.js     -> Validasi password di server + buat cookie sesi
functions/api/logout.js    -> Hapus cookie sesi
functions/_utils/session.js -> Sign/verify token sesi (HMAC)
```

---

## 1. Setup Supabase

1. Buat project baru di https://supabase.com
2. Buka **SQL Editor** → paste isi `supabase/schema.sql` → Run
3. Buka **Project Settings → API**, catat:
   - `Project URL` → dipakai di Worker & Dashboard
   - `anon public key` → dipakai di Dashboard (`public/index.html`)
   - `service_role key` → dipakai di Worker saja (JANGAN pernah taruh di frontend!)
4. Pastikan Realtime aktif: **Database → Replication** → tabel `conversions` harus ON.

## 2. Setup Cloudflare Worker (penerima postback)

```bash
cd worker
npm install -g wrangler   # kalau belum ada
wrangler login
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler deploy
```

Setelah deploy, kamu dapat URL seperti:
`https://postback-receiver.<subdomain>.workers.dev`

Endpoint yang tersedia:
- `https://postback-receiver.xxx.workers.dev/postback/trafee`
- `https://postback-receiver.xxx.workers.dev/postback/imonetizeit`

### Pasang di masing-masing platform

Ganti `postback-receiver.xxx.workers.dev` di bawah dengan domain Worker kamu sendiri (muncul setelah `wrangler deploy`).

**Trafee** — Settings → Postbacks → field "Postback URL", paste:
```
https://postback-receiver.xxx.workers.dev/postback/trafee?click_id={track}&payout={sum}&country={country}&currency={currency}&offer_name={name}&status=approved
```
Macro `{track}`, `{sum}`, `{country}`, `{currency}`, `{name}` diambil dari daftar "Available tracking parameters" yang ada di panel Trafee kamu — nilainya otomatis diisi Trafee saat konversi terjadi.

**iMonetizeIt** — halaman Postback URL (di bawah field Click ID), aktifkan toggle **Active**, isi "S2S postback URL 1":
```
https://postback-receiver.xxx.workers.dev/postback/imonetizeit?click_id=<click_id>&payout=<payout>&country=<country>&os=<os>&traffic_type=<traffic_type>
```
Macro `<click_id>`, `<payout>`, dst sesuai daftar "Available placeholders" di panel iMonetizeIt kamu.

✅ Kedua format di atas sudah dicocokkan dengan macro asli dari panel Trafee & iMonetizeIt kamu (bukan asumsi generik lagi). `NETWORK_PARSERS` di `worker/src/index.js` sudah disesuaikan supaya membaca nama parameter (`click_id`, `payout`, `country`, dst) persis seperti di URL di atas.

> 💡 Catatan keamanan kecil: di screenshot Trafee kamu, field "S2S postback URL 1" yang lama berisi token bot Telegram dalam bentuk plain text (`https://api.telegram.org/bot<TOKEN>/sendMessage`). Kalau screenshot itu pernah dibagikan ke tempat lain, sebaiknya regenerate token bot itu di BotFather — token yang bocor di URL bisa dipakai orang lain untuk kontrol bot kamu.

## 3. Setup Dashboard (Cloudflare Pages)

Sekarang password TIDAK ditulis di file HTML — dicek di server lewat Cloudflare Pages Functions,
supaya tidak bisa dilihat siapapun lewat "View Page Source". Alurnya:

```
Browser buka "/" ─→ _middleware.js cek cookie session
                       │
              belum login (cookie kosong/invalid)
                       ▼
              redirect ke /login.html ─→ submit password ─→ POST /api/login
                                                                    │
                                                    cocok dengan env.DASHBOARD_PASSWORD?
                                                                    │
                                                     ya → set cookie HttpOnly (12 jam) → redirect ke "/"
```

1. Edit `public/index.html`, isi HANYA bagian Supabase (anon key ini memang aman dipakai di frontend):
   ```js
   const SUPABASE_URL = "https://xxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "isi-anon-key-kamu";
   ```

2. Set 2 secret di Cloudflare Pages (bukan ditulis di kode, tapi lewat CLI/dashboard):
   ```bash
   cd project   # folder root yang berisi public/ dan functions/
   wrangler pages secret put DASHBOARD_PASSWORD --project-name=conversion-dashboard
   # masukkan password dashboard kamu saat diminta

   wrangler pages secret put SESSION_SECRET --project-name=conversion-dashboard
   # masukkan string acak panjang (mis. hasil dari: openssl rand -hex 32)
   ```
   `SESSION_SECRET` dipakai untuk menandatangani cookie sesi — bukan password dashboard, cukup sekali diisi lalu tidak perlu diingat.

3. Deploy (folder `functions/` otomatis ke-detect oleh Cloudflare Pages):
   ```bash
   wrangler pages deploy public --project-name=conversion-dashboard
   ```

**Kenapa ini lebih aman dari sebelumnya:**
- Password tidak pernah ada di HTML/JS yang dikirim ke browser → tidak bisa dilihat lewat View Source atau DevTools
- Cookie session pakai `HttpOnly` (JavaScript di browser tidak bisa baca/curi cookie ini) + `Secure` (hanya lewat HTTPS) + `SameSite=Strict` (anti-CSRF)
- Middleware (`functions/_middleware.js`) mengecek sesi di edge Cloudflare SEBELUM `index.html` dikirim — orang tanpa sesi valid otomatis di-redirect, tidak sempat lihat isi dashboard sama sekali
- Cookie kedaluwarsa otomatis setelah 12 jam (bisa diubah di `functions/api/login.js`)

**Yang perlu tetap kamu sadari:**
- `SUPABASE_ANON_KEY` di `index.html` memang publik/terlihat siapa saja — itu memang desainnya (dibatasi read-only oleh RLS policy di `schema.sql`). Password gate ini melindungi TAMPILAN dashboard, bukan data di Supabase itu sendiri. Kalau data di tabel `conversions` sangat sensitif, pertimbangkan RLS yang lebih ketat atau proxy semua query lewat Worker yang juga cek sesi.
- Jangan commit folder `.wrangler` atau file berisi secret ke Git/GitHub publik.

---

## 4. Testing

Simulasikan postback manual pakai curl/browser sebelum pasang ke network beneran:
```bash
curl "https://postback-receiver.xxx.workers.dev/postback/trafee?click_id=TEST123&payout=5.00&country=ID"
curl "https://postback-receiver.xxx.workers.dev/postback/imonetizeit?click_id=TEST456&payout=3.50&country=PH"
```
Kalau berhasil: Worker balas `OK`, dan baris baru langsung muncul di dashboard (kalau dashboard sedang dibuka) tanpa refresh.

---

## Troubleshooting

| Gejala | Kemungkinan Penyebab | Solusi |
|---|---|---|
| Worker balas `Missing click_id` | Network kirim parameter dengan nama beda | Cek query string asli (lihat log Worker `wrangler tail`), sesuaikan `NETWORK_PARSERS` |
| Worker balas `DB insert failed` | Service key salah / RLS nolak / kolom tidak cocok | Cek `wrangler tail` untuk lihat error detail dari Supabase |
| Data masuk ke DB tapi dashboard tidak update realtime | Realtime replication belum aktif di tabel | Supabase → Database → Replication → aktifkan untuk tabel `conversions` |
| Dashboard blank / error di console | anon key salah, atau RLS policy select belum ada | Cek ulang `SUPABASE_ANON_KEY`, cek policy `Public read access` di schema.sql sudah jalan |
| Network kirim postback tapi tidak pernah sampai ke Worker | URL postback di panel network salah / belum disimpan | Test dulu manual pakai curl ke endpoint Worker sebelum menyalahkan network |
| Ingin lihat log request masuk secara live | - | `wrangler tail` di folder `worker/` sambil kirim test postback |
| Login selalu gagal / "Password salah" terus padahal benar | Secret `DASHBOARD_PASSWORD` belum ke-set atau typo saat `wrangler pages secret put` | Cek: `wrangler pages secret list --project-name=conversion-dashboard`, set ulang kalau perlu |
| Setelah login sukses tapi langsung ke-redirect balik ke /login.html | `SESSION_SECRET` beda antara saat sign (login.js) dan saat verify (_middleware.js), atau belum di-set | Pastikan `wrangler pages secret put SESSION_SECRET` sudah dijalankan; secret otomatis sama untuk semua function di project yang sama |
| Redirect loop (halaman terus reload) | `login.html` ikut ke-block middleware karena tidak masuk `PUBLIC_PATHS` | Cek `functions/_middleware.js`, pastikan path `/login.html` ada di daftar `PUBLIC_PATHS` |

### Cara melihat log Worker secara real-time (paling berguna buat debug)
```bash
cd worker
wrangler tail
```
Semua request masuk & error akan tampil di sini secara live.

---

## Rencana pengembangan lanjutan (opsional)
- Tambah kolom `sub_id2`, `sub_id3` dst kalau butuh tracking lebih detail
- Halaman "Reports" agregat (pakai view `daily_performance` yang sudah ada di schema.sql)
- Autentikasi lebih aman: pindahkan password check ke Cloudflare Pages Function (server-side), bukan hardcode di JS
- Rate limiting di Worker supaya endpoint tidak disalahgunakan pihak luar untuk spam insert
