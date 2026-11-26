"""Videos keep the phone's screen on only while they play."""
import json
import fixtures as fx
from conftest import feeds_from

# A stand-in for YouTube's player: reports "playing", then "paused", then "playing" again, like the real one
PLAYER = """<!doctype html><script>
const say = s => parent.postMessage(JSON.stringify({event: "onStateChange", info: s}), "*");
setTimeout(() => say(1), 300); setTimeout(() => say(2), 1300); setTimeout(() => say(1), 2300);
</script>"""

def test_screen_stays_on_only_while_a_video_plays(app):
    heads = {"bbc": ["Black Friday: the best early deals"], "sky": ["Black Friday deals to avoid"], "which": ["Black Friday: 7 in 10 deals were cheaper before"]}
    feeds = feeds_from(heads)
    feeds.append({"id": "yt", "title": "Tech Deals TV", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC" + "D" * 22, "color": "#c00"})
    def yt(r):
        vids = [{"id": "VVVVVVVVVV" + str(i), "title": t, "date": int((fx.NOW - i * 3600) * 1000), "dur": 600} for i, t in enumerate(["Black Friday deals I'd buy", "Black Friday TV deals"])]
        return r.fulfill(body=json.dumps({"title": "Tech Deals TV", "videos": vids}), headers={"access-control-allow-origin": "*"})
    def player(r): return r.fulfill(body=PLAYER, content_type="text/html")
    a = app(feeds=feeds, routes={"**/youtube/latest**": yt, "https://www.youtube-nocookie.com/**": player}); p = a.page
    p.evaluate("window.YFNative = {calls: [], keepAwake(on){ this.calls.push(on); }}")
    p.locator(".tchip", has_text="Black Friday").first.click()
    p.locator(".tp-opt").first.click()
    p.wait_for_timeout(3000)
    assert p.evaluate("YFNative.calls") == [True, False, True], "on while playing, off when paused, on again"
    # Closing the player while it plays lets the screen dim again
    p.click(".tp-stop")
    p.wait_for_timeout(5500)
    assert p.evaluate("YFNative.calls")[-1] is False
    assert a.errors == []
