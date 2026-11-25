"""The app starts, reads every kind of feed, and adding and editing feeds work."""
import fixtures as fx

def test_starts_and_reads_feeds(app):
    a = app(); p = a.page
    p.locator("article.card:not(.skel)").first.wait_for(timeout=10000)
    feeds = "JSON.parse(localStorage.getItem('tl.feeds')).filter(f => 'npab'.includes(f.id))"   # news, podcast, blog, Bluesky
    p.wait_for_function(feeds + ".every(f => f.lastFetched || f.error)", timeout=15000)
    broken = p.evaluate(feeds + ".filter(f => f.error).map(f => f.title + ': ' + f.error)")
    assert broken == []
    assert "news story 0" in p.inner_text("#list").lower()
    assert a.errors == []

def test_add_a_feed_by_address(app):
    a = app(feeds=[]); p = a.page
    a.open_add(); p.fill("#addInput", "https://news.example/feed"); p.click("#addBtn")
    p.wait_for_function("document.querySelector('#addMsg').textContent.startsWith('Added')", timeout=10000)
    assert "Example News" in p.inner_text("#addMsg")
    assert a.errors == []

def _open_all_categories(p):
    while p.locator('.ogf-cathead[aria-expanded="false"]').count():
        p.locator('.ogf-cathead[aria-expanded="false"]').first.click()

def test_podcast_start_point_is_set_per_show(app):
    a = app(); p = a.page
    p.locator("article.card:not(.skel)").first.wait_for(timeout=10000)
    p.click("#filterBtn"); _open_all_categories(p)
    p.locator('.ogf-feed:has(.ogf-kind:text-is("Listen")) .ogf-edit').first.click()
    sa = p.locator(".ef-startat"); sa.wait_for()
    sa.locator('button:text-is("3:00")').click()
    saved = p.evaluate("JSON.parse(localStorage.getItem('tl.feeds')).filter(f => f.startAt).map(f => f.startAt)")
    assert saved == [180]
    p.click(".ef-cancel")
    # Articles have no start point
    p.locator('.ogf-feed:has(.ogf-kind:text-is("Read")) .ogf-edit').first.click()
    p.locator(".ef-cancel").wait_for()
    assert p.locator(".ef-startat").count() == 0
    assert a.errors == []

def test_catalogue_search(app):
    # The catalogue lives in catalogue.js; searching it works before any web results arrive
    a = app(feeds=[]); p = a.page
    assert p.evaluate("Array.isArray(window.YF_CATALOGUE) && window.YF_CATALOGUE.length > 500")
    a.open_add(); p.fill("#addInput", "bbc sport"); p.click("#addBtn")
    p.wait_for_function("document.querySelector('#searchResults').innerText.toUpperCase().includes('BBC SPORT')", timeout=10000)
    assert a.errors == []
