# YourFeed

**Everything you follow, in one feed.** By Apps For Us.

Websites, YouTube channels, podcasts, Google News topics, Bluesky and Mastodon, side by side in one simple feed. No account and no tracking: your list of sources stays on your device.

- `index.html`: the app (website and Android app share it); `catalogue.js`: the search catalogue. Fonts ship in `fonts/`.
- `app/`: the Android app (Capacitor). Built by GitHub Actions when started by hand (Actions → Android build). Every push runs the code check and the start-up, service and browser tests (`tests/`, `tools/lint.mjs`).
- `service/`: the YourFeed service, a small locked-down Cloudflare Worker the website uses to read feeds.

Reviewers: start with `REVIEW_BRIEF.md`.

Fonts are under the SIL Open Font License (see `fonts/`). The media-session plugin in `app/plugins/media-session` is a fork of [jofr/capacitor-media-session](https://github.com/jofr/capacitor-media-session) (MIT).
