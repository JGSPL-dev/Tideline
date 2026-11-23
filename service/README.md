# YourFeed service

A small Cloudflare Worker that does the few things a browser can't: read feeds from other websites, find a site's feed, and look up YouTube channels. It never relays web pages, needs no key, only answers the YourFeed website and app, and caps every answer at 5 MB.

## Deploy (about 5 minutes)

1. Cloudflare dashboard → Workers & Pages → Create → Create Worker. Name it `yourfeed-service` → Deploy.
2. Edit code → select everything → paste all of `worker.js` → Deploy.
3. Optional, recommended: Settings → Domains & Routes → add `service.appsforus.co.uk` (needs the domain on Cloudflare).
4. Recommended: your domain (appsforus.co.uk) → Security → WAF → Rate limiting rules → Create rule: name `yourfeed-service`; if incoming requests match Hostname equals `service.appsforus.co.uk`; with the same characteristics IP; when rate exceeds 100 requests per 10 seconds; then Block for 10 seconds → Deploy. (The free plan allows one rule with a 10-second period; the service also limits each visitor to 120 requests a minute itself.)
5. Put the address into YourFeed: Menu → Settings → YourFeed service → Test. Once it works, it can be built in as `SERVICE_DEFAULT` in `index.html`.

## Optional: the official YouTube Data API (recommended)

YouTube's own channel feeds have outages (all channels answer 404/500 for hours or days). With an API key, the service can fetch any channel's latest videos through YouTube's official API instead. Free: 10,000 units a day; each channel check costs 1 unit and is cached for 30 minutes for everyone.

1. Sign in at https://console.cloud.google.com with a Google account → Select a project → New project → name it `YourFeed` → Create.
2. APIs & Services → Library → search "YouTube Data API v3" → Enable.
3. APIs & Services → Credentials → Create credentials → API key. Copy it.
4. Click the new key → API restrictions → Restrict key → tick only "YouTube Data API v3" → Save. (Leave Application restrictions as None: Cloudflare's servers don't have fixed addresses.)
5. Cloudflare → Workers & Pages → `yourfeed-service` → Settings → Variables and Secrets → Add → Type: Secret, Name: `YT_API_KEY`, Value: the key → Deploy.
6. Check: open `<service address>/health`: it should say `"youtubeApi":true`.

## Shared store (recommended)

Remembers YouTube results, channel lookups and found feeds for everyone, so outside services are asked as rarely as possible.

1. Cloudflare → Storage & Databases → KV: a namespace called `yourfeed-cache` (create it if missing).
2. `yourfeed-service` → Settings → Bindings → Add → KV namespace → Variable name `YF_CACHE`, namespace `yourfeed-cache` → Deploy.
3. `/health` should show `"sharedStore":true`.

## YouTube push updates (automatic)

With the API key and the shared store set up, the service subscribes each followed channel to YouTube's push hub (pubsubhubbub.appspot.com). YouTube then sends new videos to `/websub/youtube` as they're published, so stored channels stay current; they are still re-checked through the API every hour as a safety net (every 15 minutes for channels without push). Subscriptions renew themselves while people follow the channel.

Deliveries are signed with a secret of your own: add a Secret named `WEBSUB_SECRET` (any long random text, 40+ characters, from a password manager). Older subscriptions signed the old way keep working until they renew.

## Owner key (community list approvals)

Add a Secret named `ADMIN_KEY` (another long random text, different from `WEBSUB_SECRET`). In the app: Settings → Service → Community list approvals → enter the same key. Only you can then approve or turn away sites people have added. Optional plain variable `COMMUNITY_MIN` (default 3) = how many different people must add a site before it's offered to you; raise it (e.g. 10) at launch.

## Checking it

Open `https://service.appsforus.co.uk/health`. Everything set up looks like:
`{"ok":true,"version":"2026-11-23","youtubeApi":true,"sharedStore":true,"pushSigning":true,"ownerKey":true,"rateLimiter":false,"communityMin":3}`
(`rateLimiter` stays false unless you deploy with Wrangler and a `ratelimits` binding; the WAF rule below does the same job.)

## Endpoints

| Path | Returns |
| --- | --- |
| `/feed?url=` | The feed text, only if it is RSS, Atom, RDF or JSON Feed |
| `/json?url=` | JSON from Apple Podcasts, Bluesky or Mastodon only |
| `/discover?url=` | `{feeds, title}` for a website |
| `/youtube/channel?url=` | `{id, title, avatar}` |
| `/youtube/search?q=` | `{channels:[{id, title, avatar}]}` |
| `/youtube/videos?id=UC…` | `{title, videos:[{id, title, date}]}` from the channel's Videos page (when YouTube's feeds are down) |
| `/youtube/latest?id=UC…` | `{title, videos}` via the YouTube Data API (needs `YT_API_KEY`) |
| `/health` | which settings are present (yes/no only) |
| `/websub/youtube` | YouTube's push hub only |
| `/community/add`, `/community/list`, `/community/admin` | community list (POST add, daily list, owner approvals) |
