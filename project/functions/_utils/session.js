// Utility sign/verify session token pakai HMAC-SHA256 (Web Crypto, tersedia native di Cloudflare Workers/Pages).
// Tidak butuh database tambahan — token berisi expiry, ditandatangani pakai SESSION_SECRET.

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Buat token baru, valid selama `hours` jam
export async function createSessionToken(secret, hours = 12) {
  const exp = Date.now() + hours * 60 * 60 * 1000;
  const payload = btoa(JSON.stringify({ exp }));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

// Verifikasi token: cek tanda tangan valid DAN belum kedaluwarsa
export async function verifySessionToken(secret, token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expectedSig = await hmac(secret, payload);
  if (sig !== expectedSig) return false; // tanda tangan tidak cocok -> token palsu/diubah
  try {
    const { exp } = JSON.parse(atob(payload));
    return Date.now() < exp; // false kalau sudah kedaluwarsa
  } catch {
    return false;
  }
}
