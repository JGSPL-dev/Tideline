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

async function handle(req, url, origin, env){
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (p === "/health") return json(origin, {ok: true, youtubeApi: !!(env && env.YT_API_KEY)});

  if (p === "/youtube/latest"){
    const id = url.searchParams.get("id") || "";
    if (!/^UC[\w-]{22}$/.test(id)) return fail(origin, 400, "Not a YouTube channel ID");
    if (!env || !env.YT_API_KEY) return fail(origin, 501, "The YouTube Data API isn't set up on this service");
    // Cached for 30 minutes per channel, shared by everyone, so each channel costs at most 48 units a day
    const cache = caches.default, key = new Request("https://cache.yourfeed/yt-latest/" + id);
    const hit = await cache.match(key);
    if (hit){ const r = new Response(hit.body, hit); headers(origin, "application/json; charset=utf-8").forEach((v, k) => r.headers.set(k, v)); return r; }
    const api = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=20&playlistId=UU" + id.slice(2) + "&key=" + encodeURIComponent(env.YT_API_KEY);
    const r = await fetchCapped(api, {accept: "application/json"});
    let j; try{ j = JSON.parse(r.text); }catch{ return fail(origin, 502, "YouTube's API didn't send JSON"); }
    if (!r.ok){
      const reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || r.status;
      return fail(origin, reason === "quotaExceeded" ? 429 : 502, reason === "quotaExceeded" ? "Today's YouTube API allowance is used up" : "YouTube's API answered: " + reason);
    }
    const items = j.items || [];
    const videos = items.map(i => i.snippet).filter(s => s && s.resourceId && s.resourceId.videoId)
      .map(s => ({id: s.resourceId.videoId, title: s.title, date: Date.parse(s.publishedAt) || 0}));
    const title = (items[0] && items[0].snippet && items[0].snippet.channelTitle) || null;
    const out = new Response(JSON.stringify({title, videos}), {headers: {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "max-age=1800"}});
    await cache.put(key, out.clone());
    const res = new Response(out.body, {headers: headers(origin, "application/json; charset=utf-8")});
    return res;
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
    const r = await fetchCapped(target.href, {ua: UA_BROWSER});
    if (r.ok && looksLikeFeed(r.text)) return json(origin, {feeds: [r.url], title: null});
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
    return json(origin, {feeds: feeds.slice(0, 5), title});
  }

  if (p === "/youtube/channel"){
    const target = publicUrl(url.searchParams.get("url") || "");
    if (!target || !/(^|\.)youtube\.com$/.test(target.hostname)) return fail(origin, 400, "Not a YouTube address");
    const isVideo = target.pathname === "/watch";
    const r = await fetchCapped(ytPage(target.href), {ua: UA_BROWSER, cookie: YT_COOKIE, accept: "text/html"});
    const c = r.ok ? channelFrom(r.text, isVideo) : null;
    if (!c) return fail(origin, 404, "Couldn't find that YouTube channel");
    return json(origin, c);
  }

  if (p === "/youtube/search"){
    const q = (url.searchParams.get("q") || "").slice(0, 100).trim();
    if (!q) return fail(origin, 400, "Missing search words");
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
    return json(origin, {channels});
  }

  if (p === "/youtube/videos"){
    const id = url.searchParams.get("id") || "";
    if (!/^UC[\w-]{22}$/.test(id)) return fail(origin, 400, "Not a YouTube channel ID");
    const r = await fetchCapped(ytPage(`https://www.youtube.com/channel/${id}/videos`), {ua: UA_BROWSER, cookie: YT_COOKIE, accept: "text/html"});
    if (!r.ok) return fail(origin, 502, "YouTube answered with error " + r.status);
    const videos = videosFrom(r.text);
    if (!videos.length) return fail(origin, 404, "No videos found on the channel page");
    const title = ((r.text.match(/<meta property="og:title" content="([^"]+)"/) || [])[1]) || null;
    return json(origin, {title, videos});
  }

  return fail(origin, 404, "Unknown address");
}

export default {
  async fetch(req, env){
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS"){
      const h = headers(origin, "text/plain"); h.set("Access-Control-Allow-Methods", "GET"); h.set("Access-Control-Max-Age", "86400");
      return new Response(null, {status: 204, headers: h});
    }
    if (req.method !== "GET") return fail(origin, 405, "GET only");
    // Browsers on other websites can't use this service; apps and the YourFeed site can
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return fail(origin, 403, "Not allowed from this website");
    if (limited(req.headers.get("CF-Connecting-IP") || "?")) return fail(origin, 429, "Too many requests, try again in a minute");
    try{ return await handle(req, url, origin, env); }
    catch(e){ return fail(origin, 502, e && e.name === "AbortError" ? "The site took too long to answer" : String(e && e.message || "Failed")); }
  }
};
