# YourFeed (by Apps For Us), formerly tick/rss and Tideline

"Everything you follow, in one feed." One feed for websites, YouTube, Reddit, podcasts, Google News topics, Bluesky and Mastodon. No account, no tracking; data stays on the device. Do not promise "no ads" anywhere (decided 7 Nov 2026: ads may be part of the business model).

Brand: wordmark "Your" + "Feed" in orange (`--brand`: #d9480f light, #ff8a4c dark), Bricolage Grotesque 800. Icon: Feed Check (two lines and a tick on an orange rounded square).

Everything lives in `index.html`, served by GitHub Pages at https://jgspl-dev.github.io/Tideline/ now at https://yourfeed.appsforus.co.uk (CNAME file; DNS-only CNAME yourfeed → jgspl-dev.github.io on Cloudflare). The same file is the Android app (`app/`, Capacitor 7, app ID `uk.co.appsforus.yourfeed`).

## Privacy and security rules (agreed Nov 2026)
- Only two kinds of network route: the publisher itself (direct from the device) and our own **YourFeed service** (`service/worker.js`). Never add third-party relays, readers or feed services (removed: allorigins, codetabs, whateverorigin, corsproxy.io, cors.lol, rss2json, Feedly, Jina).
- The service never relays web pages: feeds (validated), allowlisted JSON APIs, or extracted facts only. Sandbox CSP + nosniff on every reply, 5 MB cap, public-address check, CORS limited to our origins, per-IP limits. Its address: `SERVICE_DEFAULT` in index.html (empty until deployed) or Settings → YourFeed service (`yf.service`).
- The service keeps a shared store: edge cache per location plus KV (`YF_CACHE`, namespace yourfeed-cache) for YouTube API results (30 min fresh, written only on change or every 6 h, served stale if the API fails), channel lookups (30 days), searches (1 day), found feeds (7 days). The app asks the service first for YouTube lookups, search and videos (route `ytapi`, then the phone reads YouTube's feed, uploads feed, Videos page). YouTube WebSub push: `ensurePush` subscribes channels at pubsubhubbub.appspot.com (secret derived from YT_API_KEY), `/websub/youtube` verifies and takes HMAC-signed deliveries into KV; while pushing, API freshness is 6 h.
- In the app, feeds are fetched with If-None-Match / If-Modified-Since (`feed.http` per URL); 304 = unchanged.
- The app fetches directly (`IS_APP`, CapacitorHttp) and only falls back to the service. The website needs the service for most feeds.
- No third-party loads at startup: fonts self-hosted in `fonts/`, no CDN scripts.
- Android release builds are signed with the private key in Actions secrets `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD` (alias `yourfeed`). Never commit a keystore. HTTPS only (no cleartext), WebView debugging off.
- Saved posts, folders and sources are local only; export/import via OPML (Settings → Your sources).

## How it works
- Fetch layer: `feedDirect`, `feedViaService`, `fetchFeedText`, `getJSON` (direct then service `/json`), `pageDirect` (app only), `discoverFeed`, `findChannel`. `loadOneFeed` records each route's answer in `feed.routes` (shown in the source's edit form with Check now). Reddit: in the app, one `/new/.rss` request from the phone, spaced 1.1 s apart, browser user agent.
- Each feed has its own schedule (`everyMin`, `nextCheck`, `isDue`): feed ttl / sy:update hints, else 15 min (podcasts 60), clamped 10 min–6 h; failures back off 5→60 min.
- History: 7 days per feed, at least the 20 newest (`KEEP_DAYS`, `MIN_PER_FEED`, max age 180 days).
- Top bar: type tabs (Everything, Articles, Videos, Reddit, Podcasts, Social, Saved) with new counts; status line with source health; Filter box (Unread, Sources, From, Sort). Picking a source or folder resets to Everything.
- Menu: Needs attention, Everything, Organise by Category (folders) or Platform, channels A–Z. Settings: look, stacking, Your sources (import/export), YourFeed service, connection check, version.
- Cards: one stretched link per card (`.cardlink`), Save and Share buttons above it. Saved posts in `yf.saved`.
- Onboarding: welcome screen when there are no sources, interest picker → folders (`INTERESTS`), spotlight tour (`TOUR`). `suggestFolder` proposes a folder when adding.
- Podcasts: shared player `pod`, mini player, Media Session; in the app a forked media-session plugin (`app/plugins/media-session`) runs a foreground service, with back/forward as Android 13+ system media controls. Stall guard `checkPod`.
- YouTube is touchy about bursts from one connection (it blocks it with 404/500 for hours): requests go one at a time 1.5 s apart (app fetch wrapper), channels are checked every 30 min with a per-source jitter, at most 10 per refresh round, and `ytRefused`/`ytCooling` pause all YouTube requests 30 min→6 h after 4 refusals in a row. Fallbacks (uploads-playlist feed, channel Videos page) only for one-off failures. Imports by name look up one channel at a time.
- Android back button (`goBack`): closes the open layer, then returns to Everything, then minimises the app.
- Storage keys keep the old `tl.` prefix (new ones use `yf.`); keep them.

## When checking or adding a publisher
1. Image sharpness: add `IMAGE_RULES` for bigger images, always keeping the feed's own image as a fallback.
2. Feed discovery: site address, feed link and (YouTube) @handle, channel and video links must all work.
3. Story count vs what the feed holds.
4. Links that push visitors to an app.

## Testing
- The sandbox can't reach outside sites: test with Playwright against mocked routes (direct publisher URLs with CORS headers, or a mocked service). `service/worker.js` can be unit-tested in Node with a stubbed `fetch`.
- Android builds run in GitHub Actions (`.github/workflows/android.yml`) and publish the `test-build` release (`yourfeed.apk`). Settings shows the build number. Builds are manual only (workflow_dispatch): do not trigger one until Josh asks; batch small changes into one release.

## Open items
Plans and reviews: https://claude.ai/artifact/KFWjpUnf8CTK1y6PNBPHeU (cost, data and security review). Still to do: deploy the service and set `SERVICE_DEFAULT`; custom domain; Content Security Policy; pin CI dependencies by hash; privacy policy; Trending topic page; live-ish discussion (newest Reddit/Bluesky/Mastodon posts for a topic); X API review; commercial options.
