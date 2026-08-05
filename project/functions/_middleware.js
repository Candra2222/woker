import { verifySessionToken } from "./_utils/session.js";

// Path yang TIDAK perlu login (halaman login itu sendiri + endpoint auth)
const PUBLIC_PATHS = ["/login.html", "/api/login", "/api/logout"];

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);

  const isPublic = PUBLIC_PATHS.some((p) => url.pathname === p) ||
    url.pathname.startsWith("/assets/"); // css/js/gambar publik boleh lewat, kalau ada

  if (isPublic) return next();

  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/session=([^;]+)/);
  const token = match ? match[1] : null;

  const valid = await verifySessionToken(env.SESSION_SECRET, token);

  if (!valid) {
    return Response.redirect(new URL("/login.html", request.url), 302);
  }

  return next();
}
