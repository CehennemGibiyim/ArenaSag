# Arena Web Library — GitHub Radar + overlay kütüphanesi

Bu klasör GitHub Pages'e olduğu gibi yayınlanır. Ana sayfa ve sandık radarı, GitHub Actions'ın
`data/arena-live.json` dosyasından beslenir; panel veya veritabanı gerekmez.

## Dosyalar

- `index.html` — canlı radar ana sayfası (sandıklar, yayınlar, Windows kurulumu)
- `sandik.html` — sandık radarı: sekmeler, filtre, sıralama, geri sayım, tek tık canlıya giriş
- `arena-data.js` — veri katmanı (GitHub JSON + opsiyonel panel API)
- `overlay.html` — OBS şeffaf overlay
- `arena-widget.js` — sıfır bağımlılıklı overlay widget seti
- `data/arena-live.json` — GitHub Actions tarafından güncellenen canlı veri
- `data/version.json` — veri sürümü (Windows uygulaması değişiklik algılar)

## Veri kaynağı

Varsayılan sıra:

1. `data/arena-live.json` (bu klasör / GitHub Pages)
2. `https://raw.githubusercontent.com/CehennemGibiyim/ArenaSag/main/web/data/arena-live.json`

Özel adres: `?data=https://.../arena-live.json`
Panel API'si: `?panel=https://panel.ornek.com` (tarayıcıda **Panel** düğmesi)

## Yayın

1. Depo → Settings → Pages → **GitHub Actions**.
2. `Arena Radar Scan` iş akışı veriyi günceller ve Pages'e yayınlar.
3. Adres: `https://KULLANICI.github.io/ArenaSag/`

Detay: [../docs/GITHUB-RADAR.md](../docs/GITHUB-RADAR.md)

## Overlay

```html
<script src="arena-widget.js"></script>
<div data-arena="goal" data-username="elif_live" data-goal="5000"></div>
<div data-arena="top-gifters" data-username="elif_live" data-rows="5"></div>
<div data-arena="chat" data-username="elif_live" data-rows="8"></div>
<div data-arena="alert" data-username="elif_live"></div>
<div data-arena="stats" data-username="elif_live"></div>
```

Panel adresi farklıysa: `<script>window.ARENA_API_BASE = "https://panel.ornek.com"</script>`

OBS: Sources → Browser → `overlay.html?username=elif_live&type=all` → 1920x1080, arka plan şeffaf.

MIT License · Arena Live OS · TikTok resmi API'si değildir.
