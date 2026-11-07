# YourFeed service

A small Cloudflare Worker that does the few things a browser can't: read feeds from other websites, find a site's feed, and look up YouTube channels. It never relays web pages, needs no key, only answers the YourFeed website and app, and caps every answer at 5 MB.

## Deploy (about 5 minutes)

1. Cloudflare dashboard → Workers & Pages → Create → Create Worker. Name it `yourfeed-service` → Deploy.
2. Edit code → select everything → paste all of `worker.js` → Deploy.
3. Optional, recommended: Settings → Domains & Routes → add `service.appsforus.co.uk` (needs the domain on Cloudflare).
4. Recommended: Security → WAF → Rate limiting rules → limit each IP to 300 requests a minute on this hostname.
5. Put the address into YourFeed: Menu → Settings → YourFeed service → Test. Once it works, it can be built in as `SERVICE_DEFAULT` in `index.html`.

## Optional: the official YouTube Data API (recommended)

YouTube's own channel feeds have outages (all channels answer 404/500 for hours or days). With an API key, the service can fetch any channel's latest videos through YouTube's official API instead. Free: 10,000 units a day; each channel check costs 1 unit and is cached for 30 minutes for everyone.

1. Sign in at https://console.cloud.google.com with a Google account → Select a project → New project → name it `YourFeed` → Create.
2. APIs & Services → Library → search "YouTube Data API v3" → Enable.
3. APIs & Services → Credentials → Create credentials → API key. Copy it.
4. Click the new key → API restrictions → Restrict key → tick only "YouTube Data API v3" → Save. (Leave Application restrictions as None: Cloudflare's servers don't have fixed addresses.)
5. Cloudflare → Workers & Pages → `yourfeed-service` → Settings → Variables and Secrets → Add → Type: Secret, Name: `YT_API_KEY`, Value: the key → Deploy.
6. Check: open `<service address>/health`: it should say `"youtubeApi":true`.

## Endpoints

| Path | Returns |
| --- | --- |
| `/feed?url=` | The feed text, only if it is RSS, Atom, RDF or JSON Feed |
| `/json?url=` | JSON from Apple Podcasts, Reddit, Bluesky or Mastodon only |
| `/discover?url=` | `{feeds, title}` for a website |
| `/youtube/channel?url=` | `{id, title, avatar}` |
| `/youtube/search?q=` | `{channels:[{id, title, avatar}]}` |
| `/youtube/videos?id=UC…` | `{title, videos:[{id, title, date}]}` from the channel's Videos page (when YouTube's feeds are down) |
| `/youtube/latest?id=UC…` | `{title, videos}` via the YouTube Data API (needs `YT_API_KEY`) |
| `/health` | `{ok:true, youtubeApi}` |
