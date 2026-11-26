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

def test_website_asks_for_a_private_link_pasted_without_https(app):
    seen = []
    def service(r):
        u = r.request.url; seen.append(u)
        if "/feed" in u and "private=1" in u:
            return r.fulfill(body=fx.rss("Second Show", [fx.item("Ep 1", "https://www.patreon.com/posts/2", 1)]), headers={**CORS, "content-type": "text/plain"})
        return r.abort()
    a = app(native=False, feeds=[], routes={"https://service.appsforus.co.uk/**": service}); p = a.page
    a.open_add(); p.fill("#addInput", "www.patreon.com/rss/second?auth=xyz789"); p.click("#addBtn")
    p.locator("#addFolder button").wait_for()
    assert not [u for u in seen if "patreon" in u]
    p.click("#addFolder button")
    p.wait_for_function("document.querySelector('#addMsg').textContent.startsWith('Added')", timeout=10000)
    saved = [f for f in p.evaluate("JSON.parse(localStorage.getItem('tl.feeds'))") if "patreon" in f["url"]]
    assert saved[0]["url"].startswith("https://") and saved[0].get("private") and saved[0].get("webOk")
    assert a.errors == []

def test_website_two_private_feeds_in_a_row(app):
    def service(r):
        u = r.request.url
        if "/feed" in u and "private=1" in u:
            return r.fulfill(body=fx.rss("Show", [fx.item("Ep " + u[-6:], "https://www.patreon.com/posts/" + u[-6:], 1)]), headers={**CORS, "content-type": "text/plain"})
        return r.abort()
    a = app(native=False, feeds=[], routes={"https://service.appsforus.co.uk/**": service}); p = a.page
    a.open_add()
    for link in ["https://www.patreon.com/rss/one?auth=aaa111", "https://www.patreon.com/rss/two?auth=bbb222"]:
        p.fill("#addInput", link); p.click("#addBtn")
        p.locator("#addFolder button").wait_for()
        p.click("#addFolder button")
        p.wait_for_function("document.querySelector('#addMsg').textContent.startsWith('Added')", timeout=10000)
    assert len([f for f in p.evaluate("JSON.parse(localStorage.getItem('tl.feeds'))") if f.get("webOk")]) == 2
