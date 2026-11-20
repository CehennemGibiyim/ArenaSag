# Arena Radar — Windows istemcisi

Tam panel veya PostgreSQL gerektirmez. Salt okunur web paneli `/panel/` altında dahildir; GitHub Actions'ın yayınladığı canlı veriyi okur.

## Geliştirme

```bat
node desktop\main.mjs
:: pano: http://127.0.0.1:4817
```

Tarayıcı açmadan arka planda: `node desktop\main.mjs --silent`

## Paketleme

```bash
node scripts/build-radar-package.mjs --node-exe /yol/node.exe
# çıktı: release/radar/
```

CI (`.github/workflows/windows-release.yml`) Node 22 `node.exe` dosyasını pakete gömer,
NSIS ile `ArenaRadar-Setup-<sürüm>.exe` üretir ve GitHub Release'e yükler.

## Davranış

- Veri: `raw.githubusercontent.com` → GitHub Pages yedeği, varsayılan 5 sn.
- Yeni sandık: oran ≥ 7 ve açılışa ≤ 180 sn kaldıysa Windows bildirimi + ses.
- Güncelleme: açılışta ve 10 dakikada bir GitHub Release denetimi; yeni sürüm indirilir,
  **Güncelle ve yeniden başlat** ile sessiz kurulum yapılır.
- Durum dosyaları: `%LOCALAPPDATA%\ArenaRadar\` (`config.json`, `radar.log`, `radar.pid`).
- Kapatma: `Durdur.bat` veya görev çubuğu. Başlangıçta `--silent` ile açılır.
