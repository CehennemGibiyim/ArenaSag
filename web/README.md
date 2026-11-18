# Arena Web Library

TikTok LIVE overlay & metrik widget'ları. **Zero dependency**, GitHub Pages uyumlu, OBS browser source ile çalışır.
Arena Live OS panel API'sine bağlanır: `GET /api/live/feed?username=...`

## Dosyalar
- `arena-widget.js` — kütüphane (vanilla JS)
- `index.html` — demo sayfası (GitHub Pages ana sayfası)
- `overlay.html` — OBS şeffaf overlay
- `sandik.html` — GitHub Pages sandık radarı (panel API'sinden filtre + sıralama)

## GitHub Pages yayını
1. Bu klasörü bir GitHub deposuna push edin.
2. Settings → Pages → Deploy from a branch → main / (root) veya GitHub Actions.
3. `https://KULLANICI.github.io/DEPO/` adresini açın.

## Widget tipleri
```html
<div data-arena="goal" data-username="elif_live" data-goal="5000"></div>
<div data-arena="top-gifters" data-username="elif_live" data-rows="5"></div>
<div data-arena="chat" data-username="elif_live" data-rows="8"></div>
<div data-arena="alert" data-username="elif_live"></div>
<div data-arena="stats" data-username="elif_live"></div>
<script src="arena-widget.js"></script>
```

Panel adresi farklıysa: `<script>window.ARENA_API_BASE="https://panel.ornek.com"</script>`

## OBS
Sources → Browser → `overlay.html?username=elif_live&type=all` → 1920x1080, arka plan şeffaf.

MIT License · Arena Live OS
