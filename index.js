/**
 * Cloudflare Worker — Postback Receiver (multi-network)
 *
 * Endpoint yang dipasang di masing-masing platform:
 *   Trafee       -> https://your-worker.workers.dev/postback/trafee
 *   iMonetizeIt  -> https://your-worker.workers.dev/postback/imonetizeit
 *
 * Worker ini menormalisasi parameter tiap network ke satu skema,
 * lalu insert ke Supabase lewat REST API (pakai service_role key).
 *
 * ENV VARS yang harus di-set (lewat `wrangler secret put` atau dashboard CF):
 *   SUPABASE_URL          -> https://xxxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  -> service_role key (JANGAN dipakai di frontend!)
 */

// ---- Mapping parameter per network ----
// Nama param di bawah HARUS SAMA PERSIS dengan yang dipakai di URL postback
// yang kamu paste ke panel Trafee / iMonetizeIt (lihat README bagian "Postback URL final").
const NETWORK_PARSERS = {
  // Trafee memakai macro format {kurung_kurawal} — lihat Settings > Postbacks
  trafee: (url) => {
    const p = url.searchParams;
    return {
      network: "trafee",
      click_id: p.get("click_id"),              // <- diisi dari macro Trafee {track}
      offer_name: p.get("offer_name"),           // <- dari {name}
      payout: parseFloat(p.get("payout") || "0"),// <- dari {sum}
      currency: p.get("currency") || "USD",      // <- dari {currency}
      country: (p.get("country") || "").toUpperCase() || null, // <- dari {country}
      status: p.get("status") || "approved",
      device: null,
      browser: null,
      // field ekstra spesifik Trafee, tersimpan di raw_payload otomatis
    };
  },

  // iMonetizeIt memakai macro format <kurung_siku> — lihat halaman Postback URL / S2S
  imonetizeit: (url) => {
    const p = url.searchParams;
    return {
      network: "imonetizeit",
      click_id: p.get("click_id"),               // <- dari <click_id>
      offer_name: null,
      payout: parseFloat(p.get("payout") || "0"),// <- dari <payout>
      currency: "USD",
      country: (p.get("country") || "").toUpperCase() || null, // <- dari <country>
      status: p.get("status") || "approved",
      device: p.get("os"),                        // <- dari <os>
      browser: p.get("traffic_type"),              // <- dari <traffic_type> (dipakai ulang kolom browser)
    };
  },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["postback", "trafee"]

    if (parts[0] !== "postback" || !parts[1]) {
      return new Response("Not found", { status: 404 });
    }

    const network = parts[1].toLowerCase();
    const parser = NETWORK_PARSERS[network];

    if (!parser) {
      return new Response(`Unknown network: ${network}`, { status: 400 });
    }

    try {
      const data = parser(url);

      // Ambil IP asli visitor dari header Cloudflare
      data.ip = request.headers.get("CF-Connecting-IP") || null;

      // Validasi minimal: click_id wajib ada, kalau tidak, tolak
      if (!data.click_id) {
        return new Response("Missing click_id", { status: 400 });
      }

      // Simpan semua parameter asli buat debugging
      data.raw_payload = Object.fromEntries(url.searchParams.entries());

      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/conversions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("Supabase insert error:", errText);
        return new Response("DB insert failed", { status: 502 });
      }

      // Banyak network expect respons simple "OK" / "1" sebagai tanda sukses
      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Worker error:", err);
      return new Response("Internal error", { status: 500 });
    }
  },
};
