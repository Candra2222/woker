import { createSessionToken } from "../_utils/session.js";

// POST /api/login  { password: "..." }
// Password dicek di server pakai env var DASHBOARD_PASSWORD (Cloudflare secret),
// TIDAK PERNAH dikirim ke browser dalam bentuk apapun.
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Bad request" }), { status: 400 });
  }

  const { password } = body;

  // Rate limit sederhana bisa ditambah di sini kalau perlu (mis. via KV) —
  // untuk sekarang cukup delay kecil biar brute-force lebih lambat.
  if (!password || password !== env.DASHBOARD_PASSWORD) {
    return new Response(JSON.stringify({ ok: false, error: "Password salah" }), { status: 401 });
  }

  const token = await createSessionToken(env.SESSION_SECRET, 12); // sesi 12 jam

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // HttpOnly = JavaScript di browser tidak bisa baca cookie ini (anti-XSS)
      // Secure = hanya dikirim lewat HTTPS
      // SameSite=Strict = tidak dikirim dari request lintas situs (anti-CSRF)
      "Set-Cookie": `session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`,
    },
  });
}
