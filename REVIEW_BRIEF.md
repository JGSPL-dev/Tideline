# YourFeed: review brief

For an independent reviewer. Read this first, then `CLAUDE.md` (detailed project notes, kept current), then the code. Updated 25 Nov 2026.

## What it is
"Everything you follow, in one feed." A reader for websites (RSS/Atom/news sitemaps), YouTube, Reddit, podcasts, Google News topics, Bluesky, Mastodon, Lemmy and PeerTube, built by Apps For Us. No account, no tracking: sources, saved posts and settings stay on the device. Trending topics are worked out on the device from the headlines of the sources you follow.

- **Website:** https://yourfeed.appsforus.co.uk (GitHub Pages, repo `JGSPL-dev/Tideline`).
- **Android app:** the same `index.html` wrapped with Capacitor 7 (`app/`), targeting Android 16 (API 36), built by GitHub Actions (manual trigger). Each build gives a signed APK (testers) and an AAB (Google Play). Current test build: 0.2.93.
- **iPhone app:** planned for launch (same code, Capacitor iOS); not built yet.
- **Service:** a Cloudflare Worker, `service/worker.js` (https://service.appsforus.co.uk, version 2026-11-25b), with a KV namespace `YF_CACHE` and secrets `YT_API_KEY`, `WEBSUB_SECRET`, `ADMIN_KEY`.
- **Stage:** private testing (a handful of Android testers and one iPhone tester on the website). Preparing for Google Play.

## Files
| Path | What |
|---|---|
| `index.html` (~7,700 lines) | The app: HTML, CSS (~118 KB) and JS (~430 KB) in one file. The same file runs as the website and inside the app. A small first script handles start-up and crash recovery; the main script is one wrapping function. |
| `catalogue.js` | The search catalogue: 871 hand-picked feeds (`window.YF_CATALOGUE`), loaded before the main script. |
| `service/worker.js` (~700 lines) | The YourFeed service (Cloudflare Worker). |
| `app/native/MainActivity.java` | Android activity: full-screen video, drag to close, keyboard insets, system bar colours. Copied in by the build. |
| `app/plugins/media-session/` | Forked Capacitor media-session plugin (background podcast play, lock-screen and headphone controls). |
| `.github/workflows/android.yml` | Android build: signed APK + AAB, target SDK 36 checked by `aapt2`, published to the `test-build` release. |
| `.github/workflows/checks.yml` | Every push: code check, start-up test, service tests, browser tests. |
| `tests/` | `smoke.mjs` (start-up from saved data of every era), `worker.test.mjs` (service, 17 tests), `browser/` (pytest + Playwright, 8 tests), `check-directory.mjs` (live check of the catalogue, run by its own workflow). |
| `tools/lint.mjs` | Code check: ESLint core correctness rules on the main script (line numbers kept) and the service. |
| `CLAUDE.md` | Living project notes: every feature, its function names and storage keys. The best map of the code. |

## Ground rules the code must keep (agreed with the owner)
1. **Only two kinds of network route:** the publisher itself (direct from the device), or our own service. No third-party relays, readers or feed services. (Google News is used as a route to sites with no feed, and for topic feeds.)
2. **The service never relays web pages:** validated feeds, an allowlist of JSON APIs, or extracted facts only. CORS limited to our origins, per-IP rate limit, 5 MB cap, public-address check, sandbox CSP and `no-store` on replies.
3. **Private (paid) feed links** (Patreon, Supercast, Substack and links with keys in them): the app reads them only from the phone. The website can't (browsers can't read other sites' feeds), so it asks the person first, per feed; only then is the link sent to the service, marked `private=1`, used for that one request and never stored, cached or logged. Private links are never in reports, shares or exports (unless chosen), and every other service route refuses them.
4. **No secrets in the repo or app.** API keys are Worker secrets only; the signing keystore lives only in Actions secrets.
5. **Don't promise "no ads"** anywhere (ads may be part of the business model).
6. **Minimal data for the community list:** only a website's domain is sent, only for pasted websites that worked, and only with consent; the service tells people apart by a short one-way hash of IP + month, discarded once a site is approved.

## Conventions
- An empty `catch{}` means the failure is expected and harmless and the code carries on (storage full, an address that doesn't parse, an optional phone feature, one of several routes failing while the next is tried). Stated at the top of the main script and the service; all 88 were reviewed on 25 Nov 2026.
- Article HTML from publishers is cleaned by our own allowlist cleaner (`basicSanitize`, `cleanArticle`); no outside library.
- One layout in two tones, Colourful and Basic (`data-tone`). The old Classic layout was removed on 25 Nov 2026; CSS selectors still start with `:root[data-look="offgrid"]` because the attribute is always set.

## Recently changed (most worth a look)
Newest first; all in `index.html` unless noted.
- **Clean-up (25 Nov):** Classic layout removed (~1,500 lines of code and styles, no visible change: before/after screenshots compared); unreachable and unused code removed with a parser; catalogue moved to `catalogue.js`; code check and browser tests run on every push.
- **Topic pages** match the topic's whole name; a surname alone counts only for people (`FIRST_NAMES`). Trending uses a 48-hour window against the previous five days (`t.spike`), publisher tags (`withTags`) and name rules (`trendTopics`).
- **Videos survive refreshes** (`videoInList`, `state.listStale`).
- **Website private feeds by consent** (`privOffer`, `privateViaService`, `f.webOk`; service `/feed` `private=1`).
- **Google News limits:** cooling after refusals (`gnRefused`, `gnCooling`), at most 20 per round, never "healed" to another address.
- **Feed discovery** follows subdomains, known feed hosts, icon links and links in page scripts (`feedLinksIn`, `followFeedLinks`), mirrored in the service's `/discover`.
- **Crash guard** (`crashCheck`, `yf.inflight`, `f.crashPaused`) and limits on very large or compressed feeds.
- **Community list**: app `shareSite`, `loadCommunity`; service `/community/add`, `/community/list`, `COMMUNITY_MIN` (3 for testing; raise at launch).

## Questions we'd like answered
1. **Security and privacy:** does anything break the ground rules above? In particular: the website's private-feed consent path (could a private link reach the service any other way?); the service's SSRF protections (`publicUrl`, redirects, sitemap and discovery paths, `/community/add`); XSS from feed content (titles, summaries, HTML descriptions, sitemap titles, social bios) and `basicSanitize`; CORS and rate limits.
2. **Community list design:** is the IP + month hash an acceptable level of data minimisation? Can one person game the threshold? KV write costs at scale (free plan: 1,000 writes/day)?
3. **Robustness:** is the crash guard sound? Other ways a single source could hang or crash the app (huge feeds, regex on large text, DOMParser on big XML, unbounded loops)?
4. **Correctness hot spots:** `mergeHistory` (dedupe, id reuse, date pinning), `trendTopics`, `typeOf`/`platformOf`/`sourceType` consistency, start-up migrations (`MIGRATIONS`, order matters).
5. **Structure and performance:** the single large file (we plan to split it into modules joined by a build step), re-rendering on every change, IntersectionObservers per card. Anything that will hurt with 300+ sources?
6. **Store readiness:** Google Play (privacy policy page outstanding, Data safety form, background playback declaration) and Apple guideline 4.2 for the iPhone app.
7. **Terms:** use of Google News RSS, Reddit RSS/JSON, YouTube Data API (quota, display rules), reading news sitemaps.

## How to test
- `node tools/lint.mjs` (needs ESLint 9), `node tests/smoke.mjs`, `node --test tests/worker.test.mjs`, `python -m pytest tests/browser` (needs `pip install -r tests/browser/requirements.txt` and `python -m playwright install chromium`). All run offline with mocks; the same run on every push.
- The browser tests serve the app from a test address and answer every request with mocks; set `native=True` to simulate the app (`window.Capacitor`).
- Android builds: `gh workflow run android.yml --ref main` (manual only); APK and AAB in the `test-build` release.

## Out of scope / known open items
Splitting `index.html` into modules; privacy policy page; Content Security Policy for the page; pinning CI dependencies by hash; X (Twitter) not supported (API cost); Reddit search (the search code was disconnected earlier and has been removed; following subreddits works); languages beyond UK English.
