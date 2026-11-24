// Checks every feed in the search catalogue (DIRECTORY in index.html) the way the app reads it.
// Run on a machine with open internet (GitHub Actions: "Check catalogue" workflow): node tests/check-directory.mjs
// Prints one line per problem and a JSON report (directory-report.json).
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("const DIRECTORY = [");
const end = html.indexOf("\n];", start);
// Optional: a JSON file of [name, url, tags] to check instead (trying replacements); CONC = how many at once
const DIRECTORY = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : Function('"use strict";return ' + html.slice(start + "const DIRECTORY = ".length, end + 3))();
const CONC = +process.env.CONC || 8, GAP = +process.env.GAP || 0;

const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const DAY = 86400000, now = Date.now();
const unesc = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, "").trim();
const tag = (x, n) => { const m = x.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, "i")); return m ? unesc(m[1]) : ""; };

async function get(url){
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try{
    const r = await fetch(url, {headers: {"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5", "Accept-Language": "en-GB,en;q=0.9"}, redirect: "follow", signal: ctrl.signal});
    let text = "";
    if (/\.gz$/.test(new URL(url).pathname) && !/xml|text/.test(r.headers.get("content-type") || "")){
      const { gunzipSync } = await import("node:zlib");
      const buf = Buffer.from(await r.arrayBuffer());
      try{ text = gunzipSync(buf).toString("utf8"); }catch{ text = buf.toString("utf8"); }
    } else text = await r.text();
    return {status: r.status, finalUrl: r.url, text};
  } finally { clearTimeout(t); }
}

function parse(text, only){
  const head = text.slice(0, 3000);
  let kind, entries, title = "";
  if (/<rss\b|<rdf:RDF\b/i.test(head)){
    kind = "rss"; title = tag(text.split(/<item\b/i)[0], "title");
    entries = [...text.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m => ({title: tag(m[0], "title"), link: tag(m[0], "link"), date: Date.parse(tag(m[0], "pubDate") || tag(m[0], "dc:date")) || 0}));
  } else if (/<feed\b/i.test(head)){
    kind = "atom"; title = tag(text.split(/<entry\b/i)[0], "title");
    entries = [...text.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map(m => ({title: tag(m[0], "title"), link: (m[0].match(/<link\b[^>]*href="([^"]+)"/i) || [])[1] || "", date: Date.parse(tag(m[0], "published") || tag(m[0], "updated")) || 0, onlyUpdated: !/<published\b/i.test(m[0])}));
  } else if (/<urlset\b/i.test(head)){
    kind = "sitemap";
    entries = [...text.matchAll(/<url>[\s\S]*?<\/url>/gi)].map(m => ({title: tag(m[0], "news:title"), link: tag(m[0], "loc"), date: Date.parse(tag(m[0], "news:publication_date") || tag(m[0], "lastmod")) || 0}));
    title = tag(text, "news:name");
    const all = entries.length;
    if (only) entries = entries.filter(e => (e.link.match(/^https?:\/\/[^/]+(\/.*)$/) || [])[1]?.startsWith(only));
    return {kind, title, entries, all};
  } else if (/<sitemapindex\b/i.test(head)) return {kind: "sitemapindex", title: "", entries: []};
  else if (/<html|<!doctype html/i.test(head)) return {kind: /Just a moment|cf-chl|captcha|Access denied/i.test(text) ? "blocked" : "html", title: "", entries: []};
  else return {kind: "unknown", title: "", entries: []};
  return {kind, title, entries};
}

function words(s){ return new Set((s || "").toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/).filter(w => w.length > 2 && !/^(the|and|news|feed|rss|latest|from|with|for|all|top|stories|blog|google|uk)$/.test(w))); }

async function check([name, rawUrl, tags]){
  const only = decodeURIComponent((rawUrl.match(/#only=([^&]+)/) || [])[1] || "");
  const url = rawUrl.split("#")[0];
  const res = {name, url: rawUrl, problems: [], notes: []};
  let r;
  try{ r = await get(url); }catch(e){ res.problems.push("UNREACHABLE " + (e.name === "AbortError" ? "timeout" : e.message)); return res; }
  res.status = r.status;
  if (r.status >= 400){ res.problems.push("HTTP " + r.status); return res; }
  if (r.finalUrl && r.finalUrl.split("#")[0] !== url) res.notes.push("redirects to " + r.finalUrl);
  const p = parse(r.text, only);
  res.kind = p.kind; res.feedTitle = p.title; res.count = p.entries.length;
  if (!/^(rss|atom|sitemap)$/.test(p.kind)){ res.problems.push("NOT A FEED (" + p.kind + ") starts: " + JSON.stringify(r.text.slice(0, 160))); return res; }
  if (only) res.notes.push(`filter ${only}: ${p.entries.length} of ${p.all}`);
  if (!p.entries.length){ res.problems.push(only ? `EMPTY AFTER FILTER ${only} (sitemap has ${p.all})` : "EMPTY"); return res; }
  const dated = p.entries.filter(e => e.date);
  if (!dated.length){ const sample = (r.text.match(/<(item|entry)\b[\s\S]{0,600}/i) || [""])[0].replace(/\s+/g, " "); res.problems.push("NO DATES sample: " + JSON.stringify(sample.slice(0, 400))); return res; }
  const newest = Math.max(...dated.map(e => e.date));
  res.newest = new Date(newest).toISOString(); res.ageDays = Math.round((now - newest) / DAY);
  if (newest > now + DAY) res.problems.push("FUTURE DATES");
  if (now - newest > 90 * DAY) res.problems.push(`STALE (newest ${res.ageDays} days old)`);
  else if (now - newest > 30 * DAY) res.notes.push(`quiet (newest ${res.ageDays} days old)`);
  if (p.entries.some(e => e.onlyUpdated)) res.notes.push("atom without <published>: times are last-edited");
  // Posts sharing one minute
  const byMin = new Map(); dated.forEach(e => { const k = Math.floor(e.date / 60000); byMin.set(k, (byMin.get(k) || 0) + 1); });
  const most = Math.max(...byMin.values()); if (most >= 4) res.notes.push(`${most} posts in one minute`);
  // Does the feed seem to be about the named publisher/section?
  if (!/news\.google\.com/.test(url) && p.title){
    const a = words(name), b = words(p.title);
    if (a.size && b.size && ![...a].some(w => b.has(w))) res.notes.push(`title "${p.title}" vs name "${name}"`);
  }
  return res;
}

const out = []; let i = 0;
async function worker(){ while (i < DIRECTORY.length){ const e = DIRECTORY[i++]; out.push(await check(e)); if (GAP) await new Promise(r => setTimeout(r, GAP)); } }
await Promise.all(Array.from({length: CONC}, worker));
out.sort((a, b) => DIRECTORY.findIndex(e => e[1] === a.url) - DIRECTORY.findIndex(e => e[1] === b.url));
fs.writeFileSync("directory-report.json", JSON.stringify(out, null, 1));
const bad = out.filter(r => r.problems.length), noted = out.filter(r => !r.problems.length && r.notes.length);
console.log(`CHECKED ${out.length} · PROBLEMS ${bad.length} · NOTES ${noted.length}`);
bad.forEach(r => console.log(`PROBLEM | ${r.name} | ${r.url} | ${r.problems.join("; ")}${r.notes.length ? " | " + r.notes.join("; ") : ""}`));
noted.forEach(r => console.log(`NOTE | ${r.name} | ${r.url} | ${r.notes.join("; ")}`));
if (process.argv[2]) out.filter(r => !r.problems.length).forEach(r => console.log(`OK | ${r.name} | ${r.url} | ${r.count} items, newest ${r.ageDays} d, "${r.feedTitle}"`));
