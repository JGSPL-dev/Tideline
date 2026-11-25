"""Private (paid) feed links: on the website they go through our service only after the person allows it."""
import fixtures as fx
from conftest import CORS

PAT = "https://www.patreon.com/rss/creator?auth=abc123"

def test_website_asks_before_a_private_link_leaves_the_browser(app):
    seen = []
    def service(r):
        u = r.request.url; seen.append(u)
        if "/feed" in u and "private=1" in u:
            return r.fulfill(body=fx.rss("Patreon Show", [fx.item("Ep 1", "https://www.patreon.com/posts/1", 1)]), headers={**CORS, "content-type": "text/plain"})
        return r.abort()
    a = app(native=False, routes={"https://service.appsforus.co.uk/**": service}); p = a.page
    p.wait_for_timeout(1000)
    a.open_add(); p.fill("#addInput", PAT); p.click("#addBtn")
    p.locator("#addFolder button").wait_for()
    assert "never stored" in p.inner_text("#addFolder")
    assert not [u for u in seen if "patreon" in u], "nothing is sent before the person allows it"
    p.click("#addFolder button")
    p.wait_for_function("document.querySelector('#addMsg').textContent.startsWith('Added')", timeout=10000)
    sent = [u for u in seen if "patreon" in u]
    assert len(sent) == 1 and "private=1" in sent[0]
    saved = [f for f in p.evaluate("JSON.parse(localStorage.getItem('tl.feeds'))") if "patreon" in f["url"]]
    assert saved and saved[0].get("private") and saved[0].get("webOk")

def test_app_reads_private_links_itself(app):
    def patreon(r): return r.fulfill(body=fx.rss("Patreon Show", [fx.item("Ep 1", "https://www.patreon.com/posts/1", 1)]), headers=CORS)
    a = app(feeds=[], routes={"https://www.patreon.com/**": patreon}); p = a.page
    a.open_add(); p.fill("#addInput", PAT); p.click("#addBtn")
    p.wait_for_function("document.querySelector('#addMsg').textContent.startsWith('Added')", timeout=10000)
    assert not [u for u in a.requests if "service.appsforus" in u and "patreon" in u]
