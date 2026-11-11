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
  if (/^https:\/\/(www\.)?bbcgoodfood\.com\/feed/.test(u)) return new Response(RSS, {status: 200, headers: {"content-type": "application/rss+xml"}});
  if (/^https:\/\/(www\.)?bbcgoodfood\.com\//.test(u)) return new Response(PAGE_HTML, {status: 200, headers: {"content-type": "text/html"}});
  return new Response("not found", {status: 404});
};

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), "yfw-"));
writeFileSync(path.join(tmp, "worker.mjs"), readFileSync(path.join(here, "../service/worker.js"), "utf8"));
const worker = (await import(pathToFileURL(path.join(tmp, "worker.mjs")).href)).default;
const env = {YT_API_KEY: "test-key", YF_CACHE: KV};
const ctx = {waitUntil: () => {}};
let ipN = 0;
const call = (p, {ip = "9.9.9." + (++ipN % 250), origin, method = "GET"} = {}) =>
  worker.fetch(new Request("https://service.example" + p, {method, headers: {"CF-Connecting-IP": ip, ...(origin ? {Origin: origin} : {})}}), env, ctx);

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

test("community list: listed after 3 different people, the same person counts once, codes dropped", async () => {
  const add = async (ip, d = "bbcgoodfood.com") => (await call("/community/add?domain=" + d, {ip})).json();
  assert.equal((await add("1.1.1.1")).listed, false);
  assert.equal((await add("1.1.1.1")).listed, false);
  assert.equal(JSON.parse(kv.get("cm:bbcgoodfood.com")).n, 1);
  assert.equal((await add("2.2.2.2")).listed, false);
  assert.equal((await add("3.3.3.3")).listed, true);
  const rec = JSON.parse(kv.get("cm:bbcgoodfood.com"));
  assert.deepEqual(rec.h, []);
  assert.ok(!JSON.stringify(rec).includes("1.1.1.1"), "no IP addresses stored");
  const list = await (await call("/community/list")).json();
  assert.deepEqual(list.sites, ["bbcgoodfood.com"]);
});

test("community list refuses non-websites and sites without a feed", async () => {
  assert.notEqual((await call("/community/add?domain=www.youtube.com")).status, 200);
  assert.equal((await call("/community/add?domain=nofeed.example")).status, 422);
  assert.equal((await call("/community/add?domain=localhost")).status, 400);
});

test("rate limit per connection", async () => {
  let last;
  for (let i = 0; i < 200; i++){ last = await call("/health", {ip: "8.8.4.4"}); if (last.status === 429) break; }
  assert.equal(last.status, 429);
});
