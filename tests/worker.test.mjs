// Service tests: the Cloudflare Worker run in Node with a fake network, edge cache and KV store.
// Run: node --test worker.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Edge cache and KV
const edge = new Map();
globalThis.caches = {default: {match: async k => edge.get(k.url)?.clone(), put: async (k, r) => { edge.set(k.url, r); }, delete: async k => edge.delete(k.url)}};
const kv = new Map(); let kvWrites = 0;
const KV = {get: async k => kv.has(k) ? JSON.parse(kv.get(k)) : null, put: async (k, v) => { kvWrites++; kv.set(k, v); }, delete: async k => kv.delete(k)};

// The outside world
const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>Good Food</title><item><title>a</title><link>https://bbcgoodfood.com/a</link></item></channel></rss>';
const PAGE_HTML = '<html><head><title>Good Food</title><link rel="alternate" type="application/rss+xml" href="/feed"></head><body>A web page</body></html>';
const asked = [];
globalThis.fetch = async (u) => {
  u = String(u && u.url || u); asked.push(u);
  if (u === "https://bigpod.example/feed") return new Response('<?xml version="1.0"?><rss version="2.0"><channel><title>Big</title>' + Array.from({length: 2000}, (_, i) => `<item><title>Ep ${2000 - i}</title><description>${"notes ".repeat(600)}</description></item>`).join("") + "</channel></rss>", {status: 200, headers: {"content-type": "application/rss+xml"}});
  if (/^https:\/\/(www\.)?bbcgoodfood\.com\/feed/.test(u)) return new Response(RSS, {status: 200, headers: {"content-type": "application/rss+xml"}});
  if (/^https:\/\/(www\.)?bbcgoodfood\.com\//.test(u)) return new Response(PAGE_HTML, {status: 200, headers: {"content-type": "text/html"}});
  return new Response("not found", {status: 404});
};

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), "yfw-"));
writeFileSync(path.join(tmp, "worker.mjs"), readFileSync(path.join(here, "../service/worker.js"), "utf8"));
const worker = (await import(pathToFileURL(path.join(tmp, "worker.mjs")).href)).default;
const env = {YT_API_KEY: "test-key", WEBSUB_SECRET: "websub-test", ADMIN_KEY: "owner-test-key", YF_CACHE: KV};
const ctx = {waitUntil: () => {}};
let ipN = 0;
const call = (p, {ip = "9.9.9." + (++ipN % 250), origin, method = "GET", body, auth} = {}) =>
  worker.fetch(new Request("https://service.example" + p, {method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: {"CF-Connecting-IP": ip, ...(origin ? {Origin: origin} : {}), ...(body !== undefined ? {"Content-Type": "application/json"} : {}), ...(auth ? {Authorization: "Bearer " + auth} : {})}}), env, ctx);
const add = async (ip, d = "bbcgoodfood.com") => { const r = await call("/community/add", {ip, method: "POST", body: {domain: d}}); return {status: r.status, ...(await r.json())}; };
const admin = async (body, auth = env.ADMIN_KEY) => { const r = await call("/community/admin", {method: "POST", body, auth}); return {status: r.status, ...(await r.json())}; };

test("health answers", async () => {
  const r = await call("/health");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {ok: true, youtubeApi: true, sharedStore: true});
});

test("other websites can't use the service", async () => {
  assert.equal((await call("/health", {origin: "https://evil.example"})).status, 403);
  assert.equal((await call("/health", {origin: "https://yourfeed.appsforus.co.uk"})).status, 200);
});

test("only GET", async () => {
  assert.equal((await call("/health", {method: "POST"})).status, 405);
});

test("feed route refuses private and odd addresses", async () => {
  for (const bad of ["http://127.0.0.1/feed", "http://localhost/feed", "http://10.0.0.1/x", "http://192.168.1.1/", "http://169.254.169.254/latest",
                     "http://[::1]/", "https://user:pw@bbcgoodfood.com/feed", "https://bbcgoodfood.com:8080/feed", "ftp://bbcgoodfood.com/feed", "http://intranet/feed"]){
    const before = asked.length;
    const r = await call("/feed?url=" + encodeURIComponent(bad));
    assert.equal(r.status, 400, bad);
    assert.equal(asked.length, before, "no request made for " + bad);
  }
});

test("feed route passes feeds and never relays web pages", async () => {
  const ok = await call("/feed?url=" + encodeURIComponent("https://bbcgoodfood.com/feed"));
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /<rss/);
  const page = await call("/feed?url=" + encodeURIComponent("https://bbcgoodfood.com/recipes"));
  assert.equal(page.status, 422);
  assert.doesNotMatch(await page.text(), /A web page/);
});

test("huge feeds are cut to whole episodes, newest first, not refused", async () => {
  const r = await call("/feed?url=" + encodeURIComponent("https://bigpod.example/feed"));
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.ok(t.length <= 5 * 1024 * 1024 + 50);
  assert.match(t, /<\/item><\/channel><\/rss>$/);
  assert.match(t, /Ep 2000/);
});

test("json route only reaches allowed APIs", async () => {
  assert.equal((await call("/json?url=" + encodeURIComponent("https://bbcgoodfood.com/api.json"))).status, 400);
});

test("youtube routes check the channel ID", async () => {
  assert.equal((await call("/youtube/latest?id=nope")).status, 400);
});

test("discover finds a site's feed", async () => {
  const r = await call("/discover?url=" + encodeURIComponent("https://bbcgoodfood.com/"));
  assert.equal(r.status, 200);
  assert.match(JSON.stringify(await r.json()), /bbcgoodfood\.com\/feed/);
});

test("community list: pending after 3 different people, the same person or home counts once, then the owner approves", async () => {
  assert.equal((await call("/community/add?domain=bbcgoodfood.com")).status, 405, "GET no longer changes anything");
  assert.equal((await add("1.1.1.1")).pending, false);
  assert.ok(!(await add("1.1.1.1")).pending);
  // Three addresses in one home's IPv6 block count as one person
  await add("2a00:1:2:3::10"); await add("2a00:1:2:3:aaaa::20"); await add("2a00:0001:0002:0003:ffff:1:2:3");
  assert.equal(JSON.parse(kv.get("cm:bbcgoodfood.com")).n, 2);
  const third = await add("3.3.3.3");
  assert.equal(third.pending, true);
  assert.equal(third.listed, false, "not shown to anyone until approved");
  const rec = JSON.parse(kv.get("cm:bbcgoodfood.com"));
  assert.deepEqual(rec.h, []);
  assert.ok(!JSON.stringify(rec).includes("1.1.1.1"), "no IP addresses stored");
  assert.deepEqual((await (await call("/community/list")).json()).sites, []);
  assert.equal((await admin({action: "pending"}, "wrong")).status, 403);
  const pend = await admin({action: "pending"});
  assert.deepEqual(pend.pending.map(r => r.domain), ["bbcgoodfood.com"]);
  assert.equal((await admin({action: "approve", domain: "bbcgoodfood.com"})).ok, true);
  assert.deepEqual((await (await call("/community/list")).json()).sites, ["bbcgoodfood.com"]);
  assert.equal((await add("4.4.4.4")).listed, true);
  assert.equal((await admin({action: "deny", domain: "bbcgoodfood.com"})).ok, true);
  assert.deepEqual((await (await call("/community/list")).json()).sites, []);
  assert.equal((await add("5.5.5.5")).listed, false);
});

test("community list refuses non-websites and sites without a feed", async () => {
  assert.notEqual((await add("6.6.6.6", "www.youtube.com")).status, 200);
  assert.equal((await add("6.6.6.7", "nofeed.example")).status, 422);
  assert.equal((await add("6.6.6.8", "localhost")).status, 400);
  assert.equal((await add("6.6.6.9", "10.0.0.1")).status, 400);
  const before = kv.size; await add("6.6.6.10", "nofeed2.example");
  assert.equal(kv.size, before, "a site with no feed costs no write");
});

test("private-looking links are never fetched by the service", async () => {
  for (const u of ["https://feeds.example.com/show?auth_token=abc", "https://feeds.example.com/show?rss_token=x", "https://feeds.example.com/feed/u/0123456789abcdef0123456789abcdef",
                   "https://feeds.example.com/s?t=a8f7d6e5c4b3a2918f7e", "https://www.patreon.com/rss/creator?auth=x", "https://pod.example/private/feed.xml"]){
    const before = asked.length;
    assert.equal((await call("/feed?url=" + encodeURIComponent(u))).status, 403, u);
    assert.equal(asked.length, before, "no request made for " + u);
  }
  // Ordinary public addresses still work
  for (const u of ["https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pIUWlnQVAB?hl=en-GB",
                   "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv", "https://example.com/search/feed?keyword=football"])
    assert.notEqual((await call("/feed?url=" + encodeURIComponent(u))).status, 403, u);
});

test("discovery isn't stored per query string, nor for addresses that are already feeds", async () => {
  const w0 = kvWrites;
  for (let i = 0; i < 5; i++) await call("/discover?url=" + encodeURIComponent("https://bbcgoodfood.com/?x=" + i));
  assert.equal(kvWrites - w0, 0, "already remembered from the earlier discover test");
  await call("/discover?url=" + encodeURIComponent("https://bbcgoodfood.com/feed"));
  assert.equal(kvWrites - w0, 0);
});

test("YouTube push: only confirms subscriptions we asked for, only accepts signed deliveries", async () => {
  const id = "UC" + "B".repeat(22), topic = "https://www.youtube.com/xml/feeds/videos.xml?channel_id=" + id;
  const confirm = () => worker.fetch(new Request(`https://service.example/websub/youtube?id=${id}&hub.mode=subscribe&hub.topic=${encodeURIComponent(topic)}&hub.challenge=abc&hub.lease_seconds=864000`), env, ctx);
  const w0 = kvWrites;
  assert.equal((await confirm()).status, 404, "never asked");
  assert.equal(kvWrites, w0, "no write for an unasked confirmation");
  kv.set("push:" + id, JSON.stringify({asked: Date.now(), until: 0}));
  const ok = await confirm();
  assert.equal(ok.status, 200); assert.equal(await ok.text(), "abc");
  const unsub = await worker.fetch(new Request(`https://service.example/websub/youtube?id=${id}&hub.mode=unsubscribe&hub.topic=${encodeURIComponent(topic)}&hub.challenge=abc`), env, ctx);
  assert.equal(unsub.status, 404);
  // Unsigned and wrongly signed deliveries change nothing
  kv.set("ytl:" + id, JSON.stringify({at: Date.now(), title: "T", videos: []}));
  const xml = `<feed><entry><yt:videoId>AAAAAAAAAAA</yt:videoId><yt:channelId>${id}</yt:channelId><title>New</title><published>2026-11-11T00:00:00Z</published></entry></feed>`;
  const post = sig => worker.fetch(new Request(`https://service.example/websub/youtube?id=${id}`, {method: "POST", body: xml, headers: sig ? {"X-Hub-Signature": "sha1=" + sig} : {}}), env, ctx);
  await post(); await post("0".repeat(40));
  assert.equal(JSON.parse(kv.get("ytl:" + id)).videos.length, 0);
});

test("made-up YouTube channels don't spend API units twice or start push subscriptions", async () => {
  const id = "UC" + "Z".repeat(22); const w0 = kvWrites; let api = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (String(u).includes("googleapis.com")){ api++; return new Response(JSON.stringify({error: {errors: [{reason: "playlistNotFound"}]}}), {status: 404}); } return real(u, o); };
  try{
    assert.equal((await call("/youtube/latest?id=" + id)).status, 404);
    assert.equal((await call("/youtube/latest?id=" + id)).status, 404);
  } finally { globalThis.fetch = real; }
  assert.equal(api, 1);
  assert.equal(kvWrites, w0);
  assert.ok(!kv.has("push:" + id));
});

test("rate limit per connection", async () => {
  let last;
  for (let i = 0; i < 200; i++){ last = await call("/health", {ip: "8.8.4.4"}); if (last.status === 429) break; }
  assert.equal(last.status, 429);
});
