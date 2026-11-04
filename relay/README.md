# tick/rss relay

A tiny Cloudflare Worker that fetches feeds and pages for tick/rss, so the app doesn't depend on free public relays.

1. Sign in at dash.cloudflare.com (a free account is enough).
2. Go to **Compute (Workers)** → **Create** → **Start with Hello World**, name it `tickrss-relay`, and deploy.
3. Click **Edit code**, replace everything with `worker.js`, change `KEY` to a private value, and click **Deploy**.
4. In tick/rss: **Menu → Settings → Your own relay**, paste `https://tickrss-relay.<your-subdomain>.workers.dev/?key=<your key>` and tap **Test**.

The free Workers plan allows 100,000 requests a day, far more than one person's feeds need.
Never commit your real key to this public repository.
