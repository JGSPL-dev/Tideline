# TickRSS (formerly Tideline)

Single-file RSS and YouTube feed reader. Everything lives in `index.html` and is served by GitHub Pages at https://jgspl-dev.github.io/Tideline/ (the path is case-sensitive). Every push to `main` goes live.

## How it works
- Feeds are fetched in the browser. Three routes run at once and their results are combined: Feedly's public stream API (`fetchViaFeedly`, up to 100 items, no key), the rss2json service (10 items without a key, up to 100 with the user's key) and a set of free CORS relays (often failing).
- Finding a feed from a site or YouTube channel also runs several routes at once, including Feedly's feed search (`feedlyLookup`). Search results add their feed address directly (`addFeed(url, true)`).
- Stories are kept for 7 days per feed (`KEEP_DAYS`, `mergeHistory`), stored in the browser's localStorage.
- Tapping a story opens it on the website. The in-app viewer and Reader view are switched off (`READER_ENABLED = false`); their code is kept for later.
- The hamburger button (top left) opens a left-hand drawer with two tabs: Your feeds (search/add, edit, remove) and Settings (look options, "Keep links in the browser" (Android intent trick), the rss2json key and a custom proxy).
- Browser storage keys still use the old `tl.` prefix so existing feeds and settings carry over; keep them.

## When checking or adding a publisher
The user wants every publisher checked for the same issues that came up with BBC, the Guardian and Time Extension:
1. **Image sharpness.** Feeds usually send small thumbnails, which look blurry in Magazine layout. Look at the image addresses in the publisher's feed and, if there's a bigger version, add a rule to `IMAGE_RULES` (or a special case in `imageCandidates` when the address is signed, as with the Guardian). Every rewrite must keep the fallback to the feed's own image.
2. **Feed discovery.** Make sure pasting the site address, the feed link and (for YouTube) @handle, channel link or a video link all add the feed.
3. **Story count.** Check how many items the feed holds versus what Tideline shows.
4. **Links opening apps.** Note if the site's own pages push visitors to an app.

## Testing
- The cloud sandbox can't reach outside sites, so test with Playwright against mocked responses (route the relay, rss2json and image hosts).
- After pushing, the live site can be checked in the Claude desktop app's built-in browser when that is available.
