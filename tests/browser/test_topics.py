"""Trending topics and their pages."""
import json
from conftest import feeds_from

HEADS = {
    "vgc": ["The classic Wave Race Blue Storm is the 12th game added to the library", "Marquez clinches world title in the race at Portimao"],
    "gamingbolt": ["You can now play Wave Race on the new console", "Rachel Reeves says Budget will help families"],
    "netto": ["Nintendo adds Wave Race to its classics service", "Reeves defends tax rises"],
    "guardian": ["Trump must act now to stop a three-way nuclear arms race", "MCM London Comic Con returns", "Rachel Reeves to raise income tax", "London Broncos promoted to Super League"],
    "bbc": ["MCM London draws record crowds", "Eurostar cancels Paris-London trains", "Reeves faces backlash over Budget"],
    "sky": ["MCM London: the best cosplay", "Sadiq Khan puts London police on notice", "Space race comedy at the Royal Court"],
}

def topic_page(p, name):
    p.locator(".tchip", has_text=name).first.click()
    p.locator(".tp-bar").wait_for()
    stories = [t.split("\n")[-1].lower() for t in p.locator(".tp-item.news").all_inner_texts()]
    p.click(".tp-close")
    return stories

def test_topic_pages_match_the_whole_name(app):
    a = app(feeds=feeds_from(HEADS)); p = a.page
    p.locator(".tchip").first.wait_for(timeout=10000)
    wave = topic_page(p, "Wave Race")
    assert len(wave) == 3 and all("wave race" in s for s in wave), wave
    mcm = topic_page(p, "MCM London")
    assert len(mcm) == 3 and all("mcm london" in s for s in mcm), mcm
    # People: the surname on its own still counts
    reeves = topic_page(p, "Rachel Reeves")
    assert "reeves defends tax rises" in reeves and len(reeves) == 4
    assert a.errors == []

def test_topic_video_keeps_playing_through_a_refresh(app):
    import fixtures as fx
    heads = {"bbc": ["Black Friday: the best early deals"], "sky": ["Black Friday deals to avoid"], "which": ["Black Friday: 7 in 10 deals were cheaper before"]}
    feeds = feeds_from(heads)
    ch = "UC" + "D" * 22
    feeds.append({"id": "yt", "title": "Tech Deals TV", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=" + ch, "color": "#c00"})
    def yt(r):
        vids = [{"id": "VVVVVVVVVV" + str(i), "title": t, "date": int((fx.NOW - i * 3600) * 1000), "dur": 600} for i, t in enumerate(["Black Friday deals I'd buy", "Black Friday TV deals"])]
        return r.fulfill(body=json.dumps({"title": "Tech Deals TV", "videos": vids}), headers={"access-control-allow-origin": "*"})
    a = app(feeds=feeds, clock=True, routes={"**/youtube/latest**": yt}); p = a.page
    p.locator(".tchip", has_text="Black Friday").first.wait_for(timeout=15000)
    p.locator(".tchip", has_text="Black Friday").first.click()
    p.locator(".tp-opt").first.click()
    assert p.locator(".tp-player iframe").count() == 1
    fx.FEEDS["https://bbc.example/feed"] = fx.rss("bbc", [fx.item("Black Friday: brand new story", "https://bbc.example/new", 0), fx.item("Black Friday: the best early deals", "https://bbc.example/0", 1)])
    before = len([u for u in a.requests if "bbc.example" in u])
    # Jump 20 minutes once (the refresh timer fires), then let time run normally so requests aren't timed out early
    p.clock.fast_forward(20 * 60 * 1000)
    for _ in range(40):
        if len([u for u in a.requests if "bbc.example" in u]) > before and p.evaluate("!document.querySelector('#refresh').classList.contains('spin')"): break
        p.wait_for_timeout(250)
    assert len([u for u in a.requests if "bbc.example" in u]) > before, "the refresh ran"
    assert p.locator(".tp-player iframe").count() == 1, "the video is still playing"
    p.click(".tp-stop")
    for _ in range(20):
        if "brand new story" in p.text_content("#list").lower(): break
        p.wait_for_timeout(250)
    found = "brand new story" in p.text_content("#list").lower()
    assert found, ("new stories appear once the video is closed", [u for u in a.requests if "bbc.example" in u],
                   p.evaluate("JSON.parse(localStorage.getItem('tl.feeds')).filter(f => f.id === 'bbc')"), a.errors)
