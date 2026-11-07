# YourFeed

**Everything you follow, in one feed.** By Apps For Us.

Websites, YouTube channels, subreddits, podcasts, Google News topics, Bluesky and Mastodon, side by side in one simple feed. No account and no tracking: your list of sources stays on your device.

- `index.html`: the whole app (website and Android app share it). Fonts ship in `fonts/`.
- `app/`: the Android app (Capacitor). Built by GitHub Actions on every push.
- `service/`: the YourFeed service, a small locked-down Cloudflare Worker the website uses to read feeds.

Fonts are under the SIL Open Font License (see `fonts/`). The media-session plugin in `app/plugins/media-session` is a fork of [jofr/capacitor-media-session](https://github.com/jofr/capacitor-media-session) (MIT).
