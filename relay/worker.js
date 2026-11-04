// tick/rss relay: a small Cloudflare Worker that fetches feeds and pages for the app.
// Paste this whole file into a new Cloudflare Worker and deploy it.
// Only requests that carry this key are served, so nobody else can use your relay.
const KEY = "PUT-YOUR-OWN-KEY-HERE";

const BROWSER_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return text("Only GET requests are supported", 405);

    const params = new URL(request.url).searchParams;
    if (params.get("key") !== KEY) return text("Wrong or missing key", 403);

    let target;
    try { target = new URL(params.get("url") || ""); } catch { return text("Add ?url= with a web address", 400); }
    if (!/^https?:$/.test(target.protocol)) return text("Only http and https addresses", 400);

    const headers = {
      "User-Agent": BROWSER_UA,
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.9, */*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    };
    const host = target.hostname;
    // Skip YouTube's cookie-consent page (UK/EU)
    if (/(^|\.)youtube\.com$/.test(host)) headers["Cookie"] = "SOCS=CAI; CONSENT=YES+1";
    // Reddit asks API clients to identify themselves
    if (/(^|\.)reddit\.com$/.test(host)) headers["User-Agent"] = "web:tickrss:1.0 (personal feed reader)";

    let upstream;
    try {
      upstream = await fetch(target.toString(), { headers, redirect: "follow", cf: { cacheTtl: 300, cacheEverything: true } });
    } catch (e) {
      return text("Couldn't reach " + host, 502);
    }
    const out = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    out.headers.delete("Set-Cookie");
    out.headers.delete("Content-Security-Policy");
    out.headers.set("Cache-Control", "public, max-age=300");
    return out;
  },
};

function text(msg, status) {
  return new Response(msg, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
}
