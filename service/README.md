# YourFeed service

A small Cloudflare Worker that does the few things a browser can't: read feeds from other websites, find a site's feed, and look up YouTube channels. It never relays web pages, needs no key, only answers the YourFeed website and app, and caps every answer at 5 MB.

## Deploy (about 5 minutes)

1. Cloudflare dashboard → Workers & Pages → Create → Create Worker. Name it `yourfeed-service` → Deploy.
2. Edit code → select everything → paste all of `worker.js` → Deploy.
3. Optional, recommended: Settings → Domains & Routes → add `service.appsforus.co.uk` (needs the domain on Cloudflare).
4. Recommended: Security → WAF → Rate limiting rules → limit each IP to 300 requests a minute on this hostname.
5. Put the address into YourFeed: Menu → Settings → YourFeed service → Test. Once it works, it can be built in as `SERVICE_DEFAULT` in `index.html`.

## Endpoints

| Path | Returns |
| --- | --- |
| `/feed?url=` | The feed text, only if it is RSS, Atom, RDF or JSON Feed |
| `/json?url=` | JSON from Apple Podcasts, Reddit, Bluesky or Mastodon only |
| `/discover?url=` | `{feeds, title}` for a website |
| `/youtube/channel?url=` | `{id, title, avatar}` |
| `/youtube/search?q=` | `{channels:[{id, title, avatar}]}` |
| `/health` | `{ok:true}` |
