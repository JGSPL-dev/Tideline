// YourFeed service: a small, locked-down helper the YourFeed website (and the app, as a fallback) uses
// for the few things a browser can't do itself. It never relays web pages: it returns feeds, JSON, or
// facts it has extracted (a feed address, a YouTube channel ID). No keys, no logs kept by this code.
//
//   GET /feed?url=…               → the feed's text, only if it really is RSS, Atom, RDF or JSON Feed
//   GET /json?url=…               → JSON from a short list of public APIs (Apple Podcasts, Reddit, Bluesky, Mastodon)
//   GET /discover?url=…           → {feeds:[…], title} found on a website
//   GET /youtube/channel?url=…    → {id, title, avatar} for a channel, @handle or video page
//   GET /youtube/search?q=…       → {channels:[{id, title, avatar}]}
//   GET /youtube/videos?id=UC…    → {title, videos:[{id, title, date}]} from the channel's Videos page
//                                   (a fallback for when YouTube's own channel feeds are down)
//   GET /youtube/latest?id=UC…    → {title, videos:[{id, title, date}]} via the official YouTube Data API
//                                   (needs the secret YT_API_KEY; 1 quota unit per call, cached 30 min)
//   GET/POST /websub/youtube?id=UC… → YouTube's push hub: confirms subscriptions and delivers new videos
//                                   (subscribed automatically for channels people follow; needs YF_CACHE + YT_API_KEY)
//   GET /health                   → {ok:true, youtubeApi:true|false}

const ALLOWED_ORIGINS = [
  "https://yourfeed.appsforus.co.uk",
  "https://jgspl-dev.github.io",
  "https://localhost",            // the Android app
  "capacitor://localhost",        // the iPhone app, later
  "http://localhost:8765"         // local testing
];
const JSON_HOSTS = ["itunes.apple.com", "www.reddit.com", "old.reddit.com", "public.api.bsky.app", "mastodon.social"];
const MAX_BYTES = 5 * 1024 * 1024;          // 5 MB per upstream answer
const TIMEOUT_MS = 12000;
const RATE = {perMinute: 120};              // per visitor IP, per worker instance (best effort; add a Cloudflare rate-limit rule too)
const UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const UA_FEEDS = "YourFeed/1.0 (+https://yourfeed.appsforus.co.uk; feed reader)";

const hits = new Map();
function limited(ip){
  const now = Date.now(), win = 60000;
  const h = hits.get(ip) || {t: now, n: 0};
  if (now - h.t > win){ h.t = now; h.n = 0; }
  h.n++; hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.n > RATE.perMinute;
}

function headers(origin, type){
  const h = new Headers({
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });
  if (origin && ALLOWED_ORIGINS.includes(origin)) h.set("Access-Control-Allow-Origin", origin);
  return h;
}
const json = (origin, obj, status = 200) => new Response(JSON.stringify(obj), {status, headers: headers(origin, "application/json; charset=utf-8")});
const fail = (origin, status, error) => json(origin, {error}, status);

// Only public web addresses: no private networks, no odd ports, no credentials
function publicUrl(raw){
  let u; try{ u = new URL(raw); }catch{ return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port && !["80", "443"].includes(u.port)) return null;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost") || !h.includes(".")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)){
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return null;
  }
  if (h.startsWith("[")) return null;                       // no raw IPv6 addresses
  return u;
}

async function fetchCapped(url, {ua = UA_FEEDS, cookie, accept} = {}){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try{
    const h = {"User-Agent": ua, "Accept": accept || "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.8, */*;q=0.5", "Accept-Language": "en-GB,en;q=0.9"};
    if (cookie) h.Cookie = cookie;
    const r = await fetch(url, {headers: h, redirect: "follow", signal: ctrl.signal, cf: {cacheTtl: 300, cacheEverything: true}});
    if (!publicUrl(r.url || url)) throw new Error("Redirected somewhere not allowed");
    const len = +r.headers.get("content-length") || 0;
    if (len > MAX_BYTES) throw new Error("Too large");
    const reader = r.body ? r.body.getReader() : null;
    const chunks = []; let size = 0;
    if (reader){
      for (;;){
        const {done, value} = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES){ ctrl.abort(); throw new Error("Too large"); }
        chunks.push(value);
      }
    }
    const buf = new Uint8Array(size); let o = 0; for (const c of chunks){ buf.set(c, o); o += c.length; }
    return {status: r.status, ok: r.ok, url: r.url || url, type: r.headers.get("content-type") || "", text: new TextDecoder().decode(buf)};
  } finally { clearTimeout(t); }
}

const looksLikeFeed = t => {
  const s = t.slice(0, 3000).trimStart();
  if (/^\{/.test(s) && /"version"\s*:\s*"https:\/\/jsonfeed\.org/.test(s)) return true;
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(s);
};
const blocked = t => /Just a moment|cf-chl|challenge-platform|Attention Required|captcha/i.test(t.slice(0, 5000));

const YT_COOKIE = "SOCS=CAI; CONSENT=YES+1";
function ytPage(url){
  const u = new URL(url); u.searchParams.set("hl", "en"); u.searchParams.set("gl", "GB"); u.searchParams.set("ucbcb", "1"); return u.href;
}
function channelFrom(html, isVideo){
  const pats = isVideo
    ? [/"channelId":"(UC[\w-]{22})"/, /itemprop="channelId" content="(UC[\w-]{22})"/]
    : [/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/, /"externalId":"(UC[\w-]{22})"/, /channel_id=(UC[\w-]{22})/, /"browseId":"(UC[\w-]{22})"/];
  let id = null; for (const p of pats){ const m = html.match(p); if (m){ id = m[1]; break; } }
  if (!id) return null;
  const title = isVideo ? null : ((html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || null);
  const avatar = isVideo ? null : ((html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || null);
  return {id, title, avatar};
}

// Shared store, so each outside service is asked as rarely as possible:
//  - edge cache (caches.default): per Cloudflare location, free, unlimited, may be dropped early
//  - KV (binding YF_CACHE, optional): one copy for every location; free plan allows 1,000 writes a day,
//    so it is only written when something changed (or every 6 h)
async function edgeGet(key){
  try{ const r = await caches.default.match(new Request("https://cache.yourfeed/" + encodeURIComponent(key))); return r ? await r.text() : null; }catch{ return null; }
}
async function edgePut(key, text, seconds){
  try{ await caches.default.put(new Request("https://cache.yourfeed/" + encodeURIComponent(key)), new Response(text, {headers: {"Cache-Control": "max-age=" + seconds}})); }catch{}
}
async function kvGet(env, key){
  if (!env || !env.YF_CACHE) return null;
  try{ return await env.YF_CACHE.get(key, {type: "json", cacheTtl: 300}); }catch{ return null; }
}
async function kvPut(env, key, value, seconds){
  if (!env || !env.YF_CACHE) return;
  try{ await env.YF_CACHE.put(key, JSON.stringify(value), {expirationTtl: seconds}); }catch{}
}
const sendJson = (origin, text, extra) => { const h = headers(origin, "application/json; charset=utf-8"); if (extra) for (const k in extra) h.set(k, extra[k]); return new Response(text, {headers: h}); };

// ---- YouTube push (WebSub): YouTube tells us when a channel posts, so we hardly ever need to ask ----
const HUB = "https://pubsubhubbub.appspot.com/subscribe";
const topicFor = id => "https://www.youtube.com/xml/feeds/videos.xml?channel_id=" + id;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
async function pushSecret(env, id){
  // Per-channel secret the hub signs deliveries with; derived from the API key, so nothing extra to set up
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("yourfeed-websub:" + env.YT_API_KEY + ":" + id))).slice(0, 40);
}
async function hmacSha1(secret, body){
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name: "HMAC", hash: "SHA-1"}, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, body));
}
// Subscribe (or renew) a channel; called in the background when someone asks for it
async function ensurePush(env, id, self){
  if (!env || !env.YF_CACHE || !env.YT_API_KEY) return;
  const rec = await kvGet(env, "push:" + id);
  if (rec && rec.until - Date.now() > 86400000) return;                       // active for at least another day
  if (rec && rec.asked && Date.now() - rec.asked < 6 * 3600000) return;       // asked recently, waiting for the hub
  const body = new URLSearchParams({
    "hub.mode": "subscribe", "hub.topic": topicFor(id), "hub.callback": self + "/websub/youtube?id=" + id,
    "hub.verify": "async", "hub.secret": await pushSecret(env, id), "hub.lease_seconds": "864000"
  });
  try{ await fetch(HUB, {method: "POST", body}); }catch{}
  await kvPut(env, "push:" + id, {...(rec || {}), asked: Date.now(), until: rec ? rec.until : 0}, 30 * 86400);
}
async function handlePush(req, url, env){
  const id = url.searchParams.get("id") || "";
  const plain = (t, status = 200) => new Response(t, {status, headers: {"Content-Type": "text/plain"}});
  if (!/^UC[\w-]{22}$/.test(id) || !env || !env.YF_CACHE || !env.YT_API_KEY) return plain("no", 404);
  if (req.method === "GET"){
    // The hub checks we really asked for this subscription
    const mode = url.searchParams.get("hub.mode"), topic = url.searchParams.get("hub.topic"), challenge = url.searchParams.get("hub.challenge") || "";
    if (topic !== topicFor(id) || !/^(subscribe|unsubscribe)$/.test(mode || "")) return plain("no", 404);
    if (mode === "subscribe"){
      const lease = Math.min(864000, +url.searchParams.get("hub.lease_seconds") || 432000);
      await kvPut(env, "push:" + id, {until: Date.now() + lease * 1000}, 30 * 86400);
    }
    return plain(challenge.slice(0, 200));
  }
  if (req.method !== "POST") return plain("no", 405);
  const body = await req.arrayBuffer();
  if (body.byteLength > 1024 * 1024) return plain("too big", 413);
  // Only deliveries signed with our secret are accepted
  const sig = (req.headers.get("X-Hub-Signature") || "").replace(/^sha1=/, "");
  if (!sig || sig !== await hmacSha1(await pushSecret(env, id), body)) return plain("ok");   // ignore, but don't help guessers
  const xml = new TextDecoder().decode(body);
  const kv = await kvGet(env, "ytl:" + id);
  if (!kv) return plain("ok");                                                  // nobody has asked for this channel yet
  let videos = kv.videos || [];
  for (const m of xml.matchAll(/<at:deleted-entry[^>]*ref="yt:video:([\w-]{11})"/g)) videos = videos.filter(v => v.id !== m[1]);
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)){
    const e = m[1];
    const vid = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    const ch = (e.match(/<yt:channelId>(UC[\w-]{22})<\/yt:channelId>/) || [])[1];
    if (!vid || ch !== id) continue;
    const title = ((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    const date = Date.parse((e.match(/<published>([^<]+)<\/published>/) || [])[1] || "") || Date.now();
    const old = videos.find(v => v.id === vid);
    videos = [{id: vid, title: title || (old && old.title) || "", date: old ? old.date : date}, ...videos.filter(v => v.id !== vid)];
  }
  videos.sort((a, b) => b.date - a.date);
  videos = videos.slice(0, 20);
  await kvPut(env, "ytl:" + id, {at: Date.now(), top: videos[0] && videos[0].id, title: kv.title, videos, pushed: true}, 14 * 86400);
  try{ await caches.default.delete(new Request("https://cache.yourfeed/" + encodeURIComponent("ytl:" + id))); }catch{}
  return plain("ok");
}

function agoToMs(t){
  const m = String(t || "").match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return 0;
  const unit = {second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6}[m[2].toLowerCase()];
  return Date.now() - (+m[1]) * unit;
}
function videosFrom(t){
  const out = [], seen = new Set();
  const unesc = x => x.replace(/\\u0026/g, "&").replace(/\\"/g, '"').replace(/\\\//g, "/");
  for (const m of t.matchAll(/"videoRenderer":\{"videoId":"([\w-]{11})"/g)){
    const near = t.slice(m.index, m.index + 6000);
    const title = (near.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)+)"/) || near.match(/"title":\{"simpleText":"((?:[^"\\]|\\.)+)"/) || [])[1];
    const when = (near.match(/"publishedTimeText":\{"simpleText":"([^"]+)"/) || [])[1];
    if (title && !seen.has(m[1])){ seen.add(m[1]); out.push({id: m[1], title: unesc(title), date: agoToMs(when)}); }
  }
  for (const m of t.matchAll(/"lockupViewModel":\{"contentImage".{0,3000}?"contentId":"([\w-]{11})"/g)){
    if (seen.has(m[1])) continue;
    const near = t.slice(m.index, m.index + 8000);
    const title = (near.match(/"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)+)"/) || [])[1];
    const when = (near.match(/"content":"(\d+\s*(?:second|minute|hour|day|week|month|year)s?\s+ago)"/i) || [])[1];
    if (title){ seen.add(m[1]); out.push({id: m[1], title: unesc(title), date: agoToMs(when)}); }
  }
  return out.slice(0, 30);
}

async function handle(req, url, origin, env, ctx){
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (p === "/health") return json(origin, {ok: true, youtubeApi: !!(env && env.YT_API_KEY), sharedStore: !!(env && env.YF_CACHE)});

  if (p === "/youtube/latest"){
    const id = url.searchParams.get("id") || "";
    if (!/^UC[\w-]{22}$/.test(id)) return fail(origin, 400, "Not a YouTube channel ID");
    // While YouTube is pushing this channel's new videos to us, the stored copy stays current on its
    // own, so it's only re-checked every 6 hours (as a safety net); otherwise every 30 minutes
    const push = await kvGet(env, "push:" + id);
    const pushing = push && push.until > Date.now();
    if (ctx && !pushing) ctx.waitUntil(ensurePush(env, id, url.origin));
    else if (ctx && push && push.until - Date.now() < 86400000) ctx.waitUntil(ensurePush(env, id, url.origin));
    const FRESH = pushing ? 6 * 3600000 : 30 * 60000;
    // 1. This location's copy (30 min)
    const edge = await edgeGet("ytl:" + id);
    if (edge) return sendJson(origin, edge, {"X-YourFeed-Cache": "edge"});
    // 2. The shared copy, if it's recent enough
    const kv = await kvGet(env, "ytl:" + id);
    if (kv && Date.now() - kv.at < FRESH){
      const text = JSON.stringify({title: kv.title, videos: kv.videos});
      await edgePut("ytl:" + id, text, Math.max(60, Math.round((FRESH - (Date.now() - kv.at)) / 1000)));
      return sendJson(origin, text, {"X-YourFeed-Cache": "shared"});
    }
    // 3. Ask YouTube's API (1 unit)
    if (!env || !env.YT_API_KEY){
      if (kv) return sendJson(origin, JSON.stringify({title: kv.title, videos: kv.videos, stale: true}), {"X-YourFeed-Cache": "stale"});
      return fail(origin, 501, "The YouTube Data API isn't set up on this service");
    }
    const api = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=20&playlistId=UU" + id.slice(2) + "&key=" + encodeURIComponent(env.YT_API_KEY);
    let r, j;
    try{ r = await fetchCapped(api, {accept: "application/json"}); j = JSON.parse(r.text); }catch{ r = null; }
    if (!r || !r.ok){
      // API down or today's allowance used up: an older copy is better than nothing
      if (kv) return sendJson(origin, JSON.stringify({title: kv.title, videos: kv.videos, stale: true}), {"X-YourFeed-Cache": "stale"});
      const reason = j && j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
      return fail(origin, reason === "quotaExceeded" ? 429 : 502, reason === "quotaExceeded" ? "Today's YouTube API allowance is used up" : "YouTube's API answered: " + (reason || (r ? r.status : "no answer")));
    }
    const items = j.items || [];
    const videos = items.map(i => i.snippet).filter(s => s && s.resourceId && s.resourceId.videoId)
      .map(s => ({id: s.resourceId.videoId, title: s.title, date: Date.parse(s.publishedAt) || 0}));
    const title = (items[0] && items[0].snippet && items[0].snippet.channelTitle) || (kv && kv.title) || null;
    const text = JSON.stringify({title, videos});
    await edgePut("ytl:" + id, text, 1800);
    // Write the shared copy only when there's a new video, or every 6 hours (KV writes are limited)
    const top = videos[0] && videos[0].id;
    if (!kv || kv.top !== top || Date.now() - kv.at > 6 * 3600000) await kvPut(env, "ytl:" + id, {at: Date.now(), top, title, videos}, 14 * 86400);
    return sendJson(origin, text, {"X-YourFeed-Cache": "fresh"});
  }

  if (p === "/feed"){
    const target = publicUrl(url.searchParams.get("url") || "");
    if (!target) return fail(origin, 400, "Not a public web address");
    const isReddit = /(^|\.)reddit\.com$/.test(target.hostname);
    const r = await fetchCapped(target.href, {ua: isReddit ? UA_FEEDS : UA_BROWSER});
    if (!r.ok) return fail(origin, 502, "The site answered with error " + r.status);
    if (!looksLikeFeed(r.text)) return fail(origin, 422, blocked(r.text) ? "Blocked by the site's bot protection" : "That address isn't a feed");
    return new Response(r.text, {headers: headers(origin, "text/plain; charset=utf-8")});
  }

  if (p === "/json"){
    const target = publicUrl(url.searchParams.get("url") || "");
    if (!target || !JSON_HOSTS.includes(target.hostname)) return fail(origin, 400, "Not an allowed API");
    const r = await fetchCapped(target.href, {accept: "application/json"});
    if (!r.ok) return fail(origin, 502, "The service answered with error " + r.status);
    try{ JSON.parse(r.text); }catch{ return fail(origin, 502, "The service didn't send JSON"); }
    return new Response(r.text, {headers: headers(origin, "application/json; charset=utf-8")});
  }

  if (p === "/discover"){
    const target = publicUrl(url.searchParams.get("url") || "");
    if (!target) return fail(origin, 400, "Not a public web address");
    const dkey = "disc:" + target.href.toLowerCase();
    const known = await kvGet(env, dkey);
    if (known) return json(origin, known);
    const r = await fetchCapped(target.href, {ua: UA_BROWSER});
    if (r.ok && looksLikeFeed(r.text)){ await kvPut(env, dkey, {feeds: [r.url], title: null}, 7 * 86400); return json(origin, {feeds: [r.url], title: null}); }
    const feeds = [];
    let title = null;
    if (r.ok){
      title = ((r.text.match(/<title[^>]*>([^<]{1,200})<\/title>/i) || [])[1] || "").trim() || null;
      for (const m of r.text.matchAll(/<link\b[^>]*>/gi)){
        const tag = m[0];
        if (!/rel=["']?[^"'>]*alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
        const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
        if (href){ try{ const f = new URL(href.replace(/&amp;/g, "&"), r.url).href; if (publicUrl(f) && !feeds.includes(f)) feeds.push(f); }catch{} }
      }
    }
    if (!feeds.length){
      for (const g of ["/feed", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/feeds/posts/default"]){
        try{ const t = await fetchCapped(new URL(g, target.origin).href); if (t.ok && looksLikeFeed(t.text)){ feeds.push(t.url); break; } }catch{}
      }
    }
    if (!feeds.length) return fail(origin, 404, r.ok ? "No feed found on that site" : "The site answered with error " + r.status);
    await kvPut(env, dkey, {feeds: feeds.slice(0, 5), title}, 7 * 86400);
    return json(origin, {feeds: feeds.slice(0, 5), title});
  }

  if (p === "/youtube/channel"){
    const target = publicUrl(url.searchParams.get("url") || "");
    if (!target || !/(^|\.)youtube\.com$/.test(target.hostname)) return fail(origin, 400, "Not a YouTube address");
    const isVideo = target.pathname === "/watch";
    // Handles and channel pages rarely change: remember them for 30 days (videos: 7 days)
    const key = "ytc:" + (target.pathname + (isVideo ? "?v=" + target.searchParams.get("v") : "")).toLowerCase();
    let known = await edgeGet(key);
    if (!known){ const k = await kvGet(env, key); if (k){ known = JSON.stringify(k); await edgePut(key, known, 86400); } }
    if (known) return sendJson(origin, known, {"X-YourFeed-Cache": "hit"});
    const r = await fetchCapped(ytPage(target.href), {ua: UA_BROWSER, cookie: YT_COOKIE, accept: "text/html"});
    const c = r.ok ? channelFrom(r.text, isVideo) : null;
    if (!c) return fail(origin, 404, "Couldn't find that YouTube channel");
    const text = JSON.stringify(c);
    await edgePut(key, text, 86400);
    await kvPut(env, key, c, (isVideo ? 7 : 30) * 86400);
    return sendJson(origin, text, {"X-YourFeed-Cache": "fresh"});
  }

  if (p === "/youtube/search"){
    const q = (url.searchParams.get("q") || "").slice(0, 100).trim();
    if (!q) return fail(origin, 400, "Missing search words");
    const skey = "yts:" + q.toLowerCase();
    const cached = await edgeGet(skey);
    if (cached) return sendJson(origin, cached, {"X-YourFeed-Cache": "edge"});
    const page = ytPage("https://www.youtube.com/results?sp=EgIQAg%3D%3D&search_query=" + encodeURIComponent(q));
    const r = await fetchCapped(page, {ua: UA_BROWSER, cookie: YT_COOKIE, accept: "text/html"});
    if (!r.ok) return fail(origin, 502, "YouTube answered with error " + r.status);
    const channels = [], seen = new Set();
    for (const m of r.text.matchAll(/"channelRenderer":\{"channelId":"(UC[\w-]{22})","title":\{"simpleText":"([^"]+)"/g)){
      if (seen.has(m[1])) continue; seen.add(m[1]);
      const pic = (r.text.slice(m.index, m.index + 3000).match(/"thumbnails":\[\{"url":"([^"]+)"/) || [])[1];
      channels.push({id: m[1], title: m[2], avatar: pic ? pic.replace(/^\/\//, "https://") : null});
      if (channels.length >= 20) break;
    }
    const stext = JSON.stringify({channels});
    if (channels.length) await edgePut(skey, stext, 86400);
    return sendJson(origin, stext, {"X-YourFeed-Cache": "fresh"});
  }

  if (p === "/youtube/videos"){
    const id = url.searchParams.get("id") || "";
    if (!/^UC[\w-]{22}$/.test(id)) return fail(origin, 400, "Not a YouTube channel ID");
    const vkey = "ytv:" + id;
    const cached = await edgeGet(vkey);
    if (cached) return sendJson(origin, cached, {"X-YourFeed-Cache": "edge"});
    const r = await fetchCapped(ytPage(`https://www.youtube.com/channel/${id}/videos`), {ua: UA_BROWSER, cookie: YT_COOKIE, accept: "text/html"});
    if (!r.ok) return fail(origin, 502, "YouTube answered with error " + r.status);
    const videos = videosFrom(r.text);
    if (!videos.length) return fail(origin, 404, "No videos found on the channel page");
    const title = ((r.text.match(/<meta property="og:title" content="([^"]+)"/) || [])[1]) || null;
    const vtext = JSON.stringify({title, videos});
    await edgePut(vkey, vtext, 1800);
    return sendJson(origin, vtext, {"X-YourFeed-Cache": "fresh"});
  }

  return fail(origin, 404, "Unknown address");
}

export default {
  async fetch(req, env, ctx){
    const url = new URL(req.url);
    // YouTube's push hub: no Origin, POSTs, and must not be rate-limited
    if (url.pathname === "/websub/youtube"){
      try{ return await handlePush(req, url, env); }catch{ return new Response("error", {status: 500}); }
    }
    const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS"){
      const h = headers(origin, "text/plain"); h.set("Access-Control-Allow-Methods", "GET"); h.set("Access-Control-Max-Age", "86400");
      return new Response(null, {status: 204, headers: h});
    }
    if (req.method !== "GET") return fail(origin, 405, "GET only");
    // Browsers on other websites can't use this service; apps and the YourFeed site can
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return fail(origin, 403, "Not allowed from this website");
    if (limited(req.headers.get("CF-Connecting-IP") || "?")) return fail(origin, 429, "Too many requests, try again in a minute");
    try{ return await handle(req, url, origin, env, ctx); }
    catch(e){ return fail(origin, 502, e && e.name === "AbortError" ? "The site took too long to answer" : String(e && e.message || "Failed")); }
  }
};
