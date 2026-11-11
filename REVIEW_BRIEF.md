# YourFeed: review brief

For an independent reviewer. Read this first, then `CLAUDE.md` (detailed project notes, kept current), then the code.

## What it is
"Everything you follow, in one feed." A reader for websites (RSS/Atom/news sitemaps), YouTube, Reddit, podcasts, Google News topics, Bluesky, Mastodon, Lemmy and PeerTube, built by Apps For Us. No account, no tracking: sources, saved posts and settings stay on the device.

- **Website:** https://yourfeed.appsforus.co.uk (GitHub Pages, repo `JGSPL-dev/Tideline`, public).
- **Android app:** the same `index.html` wrapped with Capacitor 7 (`app/`), built by GitHub Actions (manual trigger only). Current test build: 0.2.41.
- **Service:** a Cloudflare Worker, `service/worker.js` (deployed as `yourfeed-service`, https://service.appsforus.co.uk), with a KV namespace `YF_CACHE` and a secret `YT_API_KEY`.
- Stage: private testing by one person (the owner), no public users yet. Not yet on the Play Store.

## Files
| Path | What |
|---|---|
| `index.html` (~6,200 lines) | The whole app: HTML, CSS and JS in one file. Same file runs as the website and inside the Android app. |
| `service/worker.js` (~520 lines) | The YourFeed service (Cloudflare Worker). |
| `app/native/MainActivity.java` | Android activity: full-screen video, drag to close, keyboard insets, system bar colours. Copied in by the build. |
| `app/plugins/media-session/` | Forked Capacitor media-session plugin (podcast background play, headphone skip). |
| `app/package.json`, `app/capacitor.config.json` | Capacitor set-up. |
| `.github/workflows/android.yml` | Android build (signed release APK, published to the `test-build` release). |
| `CLAUDE.md` | Living project notes: every feature, its function names and storage keys. The best map of the code. |

## Ground rules the code must keep (agreed with the owner)
1. **Only two kinds of network route:** the publisher itself (direct from the device), or our own service. No third-party relays, readers or feed services. (Google News is used only as a route to sites with no feed, and for topic feeds.)
2. **The service never relays web pages:** validated feeds, an allowlist of JSON APIs, or extracted facts only. CORS limited to our origins, per-IP rate limit, 5 MB cap, public-address check, sandbox CSP on replies.
3. **Private (paid) feed links** (Patreon, Supercast, Substack) never leave the device: no service route, not in reports, shares or exports (unless chosen).
4. **No secrets in the repo or app.** The YouTube API key lives only as a Worker secret; the signing keystore only in Actions secrets.
5. **Don't promise "no ads"** anywhere (ads may be part of the business model).
6. **Minimal data for the community list:** only a website's domain is sent, and only for pasted websites that worked; the service tells different people apart by a short one-way hash of IP + month, discarded once a site is approved.

## Recently changed (most worth a look)
Newest first; all in `index.html` unless noted.
- **Crash guard** (`crashCheck`, `yf.inflight`, `f.crashPaused`) and limits on very large or compressed feeds, added after build 0.2.40 closed itself a few seconds after opening. Root cause not proven; suspected an oversized news sitemap.
- **Community list**: app `shareSite`, `loadCommunity`; service `/community/add`, `/community/list`, `COMMUNITY_MIN` (3 for testing).
- **News sitemaps as feeds**: `isNewsSitemap`, `parseFeed` `urlset` branch, `findNewsSitemap`, `#only=/path/` section filter; 56 directory sites switched from Google News; worker `looksLikeFeed` accepts them. Existing sources migrate automatically.
- **Search restructure**: pills match feed types (`PILLS`, `pillOf`, `listFor`); Topics is a sixth type (`typeOf`); service bar under Conversations (`serviceBar`); publishers grouped only when searched by name (`groupPublishers`); results interleaved by publisher.
- **Social search clean-up** (`sortSocial`, `directFor`): bridge and bot mirrors become the publisher; Flipboard kept as articles; Lemmy, PeerTube and WordPress filed by type.
- **Reddit search** also uses Reddit's RSS search (`searchRedditRss`).
- **Directory** (`DIRECTORY`, ~670 entries) built partly from known URL patterns without live checks; an on-device checker (Settings → Service → Check search list / Find news sitemaps) was run once and fixes applied.
- **Duplicates** (`storyKey`, `linkKey`, `dupeIds`, date pinning in `mergeHistory`), **seen tracking** (`lookObs`, `markLooked`, Hide seen), **English-only topics** (`looksEnglish`).

## Questions we'd like answered
1. **Security and privacy:** does anything break the ground rules above? In particular: any path where a private feed URL could reach the service; the service's SSRF protections (`publicUrl`, redirects, the sitemap and discovery paths, `/community/add` fetching a domain); XSS from feed content (titles, summaries, HTML descriptions, sitemap titles, social bios); CORS and rate limits.
2. **Community list design:** is the IP + month hash an acceptable level of data minimisation? Can one person game the threshold (e.g. mobile data vs Wi-Fi, VPNs)? KV write costs at scale (free plan: 1,000 writes/day)?
3. **Robustness:** the 0.2.40 crash. Is the crash guard sound? Other ways a single source could hang or crash the app (huge feeds, regex on large text, DOMParser on big XML, unbounded loops)?
4. **Correctness hot spots:** `mergeHistory` (dedupe, id reuse, date pinning), `dupeIds` memoisation, `typeOf`/`platformOf`/`sourceType` consistency, `categorise`/`tagCategory`, `groupPublishers`, start-up migrations (order matters: one start-up error briefly broke the website on 10 Nov).
5. **Performance:** the single 6,200-line file, re-rendering on every change, `typeOf` doing `feedById` + regex per item, IntersectionObservers per card. Anything that will hurt with 300+ sources?
6. **Store readiness:** what's missing for a Play Store release (privacy policy page is outstanding; Content Security Policy for the page; pinned CI dependencies)?
7. **Terms:** use of Google News RSS, Reddit RSS/JSON, YouTube Data API (quota, display rules, no background play), reading news sitemaps.

## How to test
- No outside network in a typical sandbox: test with Playwright against mocked routes (publisher URLs with CORS headers, or a mocked service). The app runs from `index.html` opened directly; set `window.Capacitor` to simulate the app.
- The worker can be unit-tested in Node by importing it with a stubbed `fetch`, `caches.default` and a fake KV.
- Android builds: `gh workflow run android.yml --ref main` (manual only), APK in the `test-build` release.

## Out of scope / known open items
Privacy policy page; Content Security Policy; pinning CI dependencies by hash; X (Twitter) not supported (API cost); language beyond UK English; the Trending topic page and live discussion ideas.
