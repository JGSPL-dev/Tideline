"""Browser tests: the real index.html in Chromium, with every network request answered by mocks.

Run:  pip install pytest playwright && python -m playwright install chromium && python -m pytest tests/browser
"""
import json, os, sys, pytest
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
import fixtures as fx

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# The app is served from a made-up address (answered from the repo below), so the page has normal web storage
ORIGIN = "https://app.yourfeed.test"
INDEX = ORIGIN + "/index.html"
TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png",
         ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json"}
CORS = {"access-control-allow-origin": "*"}

@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(); yield b; b.close()

class App:
    """One page of the app. `feeds` is the followed list; `native` pretends to be the Android app."""
    def __init__(self, browser, feeds=None, storage=None, native=True, clock=False, routes=None):
        self.page = browser.new_page(viewport={"width": 390, "height": 844})
        self.errors = []; self.requests = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("request", lambda r: self.requests.append(r.url))
        ls = {"yf.onboarded": "true", "yf.thumbAsked": "1", "tl.feeds": json.dumps(feeds if feeds is not None else fx.INIT)}
        ls.update(storage or {})
        js = ("window.Capacitor={isNativePlatform:()=>true,Plugins:{}};" if native else "")
        # Seed storage only on the first load of this page (a reload keeps what the app saved)
        js += "if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');" + "".join(f"localStorage.setItem({json.dumps(k)},{json.dumps(v)});" for k, v in ls.items()) + "}"
        self.page.add_init_script(js)
        if clock: self.page.clock.install()
        self.page.route("**/*", self._route)
        for pattern, handler in (routes or {}).items(): self.page.route(pattern, handler)
        self.page.goto(INDEX)

    def _route(self, r):
        u = r.request.url
        if u.startswith(ORIGIN + "/"):
            path = os.path.normpath(os.path.join(ROOT, u[len(ORIGIN) + 1:].split("?")[0]))
            if path.startswith(ROOT) and os.path.isfile(path):
                return r.fulfill(path=path, headers={"content-type": TYPES.get(os.path.splitext(path)[1], "application/octet-stream")})
            return r.fulfill(status=404, body="")
        if u in fx.FEEDS: return r.fulfill(body=fx.FEEDS[u], headers={**CORS, "content-type": "application/rss+xml"})
        if "reddit.com/r/Gunners" in u and ".rss" in u: return r.fulfill(body=fx.REDDIT, headers=CORS)
        if "img.example.com" in u or "ytimg" in u or "redd" in u: return r.fulfill(body=fx.IMGB, headers={**CORS, "content-type": "image/png"})
        return r.abort()

    def open_add(self):
        self.page.click("#filterBtn"); self.page.click("#ogAdd")

    def close(self): self.page.close()

@pytest.fixture
def app(browser):
    made = []
    def make(**kw):
        a = App(browser, **kw); made.append(a); return a
    yield make
    for a in made: a.close()

def feeds_from(heads):
    """{'bbc': ['headline', …]} → followed feeds, with their mocked RSS registered."""
    out = []
    for k, hs in heads.items():
        url = f"https://{k}.example/feed"
        out.append({"id": k, "title": k.capitalize() + " Site", "url": url, "color": "#345"})
        fx.FEEDS[url] = fx.rss(k, [fx.item(t, f"https://{k}.example/{i}", i + 1) for i, t in enumerate(hs)])
    return out
