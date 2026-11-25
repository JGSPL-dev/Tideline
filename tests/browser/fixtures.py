# Mocked feeds of every kind for the browser tests. Nothing here touches the real network.
import json, time
NOW=time.time()
import base64,zlib,struct
def _png(w,h,c):
  raw=b''.join(b'\x00'+bytes(c)*w for _ in range(h)); ch=lambda t,d: struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
  return b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')
IMGB=_png(320,180,(90,120,160))
IMGT=_png(300,400,(160,110,90))
def rfc(h): return time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime(NOW-h*3600))
def iso(h): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(NOW-h*3600))
IMG='https://img.example.com/p{}.jpg'
def rss(title, items, extra=''):
  return f'<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>{title}</title><link>https://site.example/</link>{extra}' + ''.join(items) + '</channel></rss>'
def item(t, link, h, img=None, audio=None, desc='Some summary text for this story that is long enough.', dur=None):
  x=f'<item><title>{t}</title><link>{link}</link><pubDate>{rfc(h)}</pubDate><description>{desc}</description>'
  if img: x+=f'<media:content url="{img}" medium="image" width="1200"/>'
  if audio: x+=f'<enclosure url="{audio}" type="audio/mpeg" length="1"/>'
  if dur: x+=f'<itunes:duration>{dur}</itunes:duration>'
  return x+'</item>'
FEEDS={
 'https://news.example/feed': rss('Example News',extra='<image><url>https://img.example.com/logoLOGO.png</url></image>',items=[item(f'News story {i}',f'https://news.example/s{i}',i+0.5,IMG.format(i)) for i in range(12)]),
 'https://pod.example/feed': rss('Example Pod',extra='<itunes:image href="https://img.example.com/artLOGO.jpg"/>',items=[item(f'Episode {i}',f'https://pod.example/e{i}',i*24+1,IMG.format(50+i),audio=f'https://pod.example/e{i}.mp3',dur='1:02:00' if i==0 else '2700') for i in range(5)]),
 'https://arseblog.example/feed': rss('Arseblog',[item(f'Blog post {i}',f'https://arseblog.example/b{i}',i*3+1,IMG.format(80+i),audio=('https://arseblog.example/a.mp3' if i==2 else None)) for i in range(8)]),
 'https://bsky.app/profile/did:plc:abc/rss': rss('@aarcaya.bsky.social - Nintendo64HD',[item('',f'https://bsky.app/profile/did:plc:abc/post/{i}',i+2,desc=f'Bluesky post number {i} about games and things.') for i in range(6)]),
}
REDDIT='<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><title>newest submissions : Gunners</title>'+''.join(f'<entry><title>Reddit post {i}</title><link href="https://www.reddit.com/r/Gunners/comments/{i}/x/"/><updated>{iso(i+1)}</updated><published>{iso(i+1)}</published><media:thumbnail url="https://b.thumbs.redditmedia.com/t{i}.jpg"/><content type="html">&lt;a href="https://i.redd.it/big{i}.jpeg"&gt;[link]&lt;/a&gt;</content></entry>' for i in range(6))+'</feed>'
INIT=[
 {'id':'n','title':'Example News','url':'https://news.example/feed','color':'#1971c2'},
 {'id':'p','title':'Example Pod','url':'https://pod.example/feed','color':'#2f9e44'},
 {'id':'a','title':'Arseblog','url':'https://arseblog.example/feed','color':'#e03131'},
 {'id':'b','title':'@aarcaya.bsky.social - Nintendo64HD','url':'https://bsky.app/profile/did:plc:abc/rss','color':'#7048e8'},
 {'id':'r','title':'newest submissions : Gunners','url':'https://www.reddit.com/r/Gunners/.rss','color':'#f08c00'},
 {'id':'y','title':'Chan','url':'https://www.youtube.com/feeds/videos.xml?channel_id=UC'+'A'*22,'color':'#c92a2a'},
]
