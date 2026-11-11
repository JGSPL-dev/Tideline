// Start-up smoke test: opens index.html with saved data from different eras and checks it starts cleanly.
// No network: every outside request is refused, as if offline. Run: node smoke.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PAGE = process.env.PAGE || "file://" + path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.html");
const now = Date.now(), H = 3600000;
const feed = (id, title, url, extra = {}) => ({id, title, url, color: "#1971c2", ...extra});
const story = (feedId, n, extra = {}) => ({id: `${feedId}|https://site.example/${feedId}/${n}`, feedId, title: `Story ${n} from ${feedId}`,
  link: `https://site.example/${feedId}/${n}`, date: now - n * H, seen: now - n * H, summary: "Summary text. ".repeat(80), ...extra});

const OLD_FEEDS = [
  feed("a", "Example News", "https://news.example/feed"),
  feed("g", "Some Site via Google", "https://news.google.com/rss/search?q=site:some.example&hl=en-GB&gl=GB&ceid=GB:en"),
  feed("r", "newest submissions : Gunners", "https://www.reddit.com/r/Gunners/.rss"),
  feed("y", "Chan", "https://www.youtube.com/feeds/videos.xml?channel_id=UC" + "A".repeat(22), {folder: "Videos"}),
  feed("p", "Example Pod", "https://pod.example/feed", {folder: "Podcasts"}),
];
const OLD_ITEMS = [...Array(40)].map((_, n) => story(["a", "g", "r", "p"][n % 4], n, n % 4 === 3 ? {audioUrl: "https://pod.example/e.mp3"} : {}));

const BIG_FEEDS = [...Array(300)].map((_, n) => feed("f" + n, "Source " + n, `https://s${n}.example/feed`, {folder: "Folder " + (n % 12), lastFetched: now, nextCheck: now + 1e10}));
const BIG_ITEMS = [...Array(3000)].map((_, n) => story("f" + (n % 300), n));

const STATES = {
  "first run (nothing saved)": {ls: {}, expect: {cards: 0}},
  "before November 2026 (stories in localStorage, old flags, no migrations run)": {
    ls: {"yf.onboarded": true, "tl.feeds": OLD_FEEDS, "tl.items": OLD_ITEMS, "tl.read": [OLD_ITEMS[0].id], "tl.folders": ["Videos", "Podcasts"],
         "tl.updated": now - 2 * H, "tl.view": {source: "all", type: "all"}, "yf.lookedMig": true},
    expect: {cards: 1, migrated: 3, legacyGone: true}},
  "300 sources, 3,000 stories": {ls: {"yf.onboarded": true, "tl.feeds": BIG_FEEDS, "tl.items": BIG_ITEMS, "tl.updated": now}, expect: {cards: 1, migrated: 3}},
};

let failed = 0;
const browser = await chromium.launch();
for (const app of [false, true]){
  for (const [name, {ls, expect}] of Object.entries(STATES)){
    const label = `${app ? "app" : "website"} · ${name}`;
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.addInitScript(([ls, app]) => {
      if (app) window.Capacitor = {isNativePlatform: () => true, Plugins: {}};
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, JSON.stringify(v));
    }, [ls, app]);
    await page.route("**/*", r => r.request().url().startsWith("file:") ? r.continue() : r.abort());
    const t0 = Date.now();
    await page.goto(PAGE);
    let done = false;
    try{ await page.waitForFunction(() => window.__yfBoot && window.__yfBoot.done, null, {timeout: 15000}); done = true; }catch{}
    const ms = Date.now() - t0;
    const problems = [];
    if (!done) problems.push("start-up didn't finish within 15 s");
    if (await page.locator("#bootFail").count()) problems.push("rescue screen shown: " + await page.locator("#bootErr").innerText());
    if (errors.length) problems.push("errors: " + errors.join(" | "));
    const cards = await page.locator("#list .card").count();
    if (expect.cards && !cards) problems.push("no stories shown");
    if (expect.migrated){ const m = await page.evaluate(() => localStorage.getItem("yf.migrated")); if (Number(m) !== expect.migrated) problems.push("migrations at " + m); }
    if (expect.legacyGone){
      await page.waitForTimeout(500);
      if (await page.evaluate(() => localStorage.getItem("tl.items") !== null)) problems.push("old stories still in localStorage");
    }
    // Reload: everything must come back from storage the same way
    if (done && expect.cards){
      await page.reload();
      try{ await page.waitForFunction(() => window.__yfBoot && window.__yfBoot.done, null, {timeout: 15000}); }catch{ problems.push("second start didn't finish"); }
      if (!await page.locator("#list .card").count()) problems.push("no stories after reopening");
    }
    console.log(`${problems.length ? "FAIL" : "ok  "} ${label} (${ms} ms, ${cards} cards)${problems.length ? "\n     " + problems.join("\n     ") : ""}`);
    if (problems.length) failed++;
    await page.close();
  }
}
await browser.close();
if (failed){ console.log(`\n${failed} start-up check(s) failed`); process.exit(1); }
console.log("\nAll start-up checks passed");
