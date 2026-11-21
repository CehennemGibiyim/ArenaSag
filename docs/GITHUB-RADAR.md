# GitHub Radar — sürekli tarama, web paneli ve Windows istemcisi

Arena Radar üç parçadan oluşur:

1. **GitHub Actions taraması** (`scripts/radar-publish.mjs`) — panel açık olmasa da çalışır.
2. **GitHub Pages web paneli** (`web/`) — taramanın yayınladığı JSON'u okur.
3. **Windows Radar uygulaması** (`desktop/`) — aynı JSON'u 5 saniyede bir çeker ve bildirim gönderir.

```
GitHub Actions (cron */5)
  ├─ aday toplama: Tik.Tools, TikWM bölge örnekleri, yayıncı dizini, önceki odalar
  ├─ doğrulama: user/room → check_alive → room/info
  ├─ sandık zarfı: room/info envelopeInfo + WebSocket WebcastEnvelopeMessage
  └─ web/data/arena-live.json + version.json  → commit
                                                ├─ GitHub Pages
                                                └─ Windows Radar (raw.githubusercontent)
```

## Veri sözleşmesi

`web/data/arena-live.json`

```json
{
  "schema": 1,
  "source": "github-radar",
  "generatedAt": "2026-11-18T20:00:00.000Z",
  "scanSeconds": 74,
  "stats": { "candidates": 80, "checked": 61, "live": 23, "chests": 9, "errors": 2 },
  "streams": [
    {
      "username": "ornek",
      "nickname": "Örnek",
      "title": "yayın başlığı",
      "roomId": "7300000000000000000",
      "viewers": 1200,
      "region": "TR",
      "avatar": "https://...",
      "thumb": "https://...",
      "verifiedAt": "2026-11-18T20:00:00.000Z",
      "openUrl": "https://www.tiktok.com/@ornek/live",
      "deepLink": "snssdk1233://live?room_id=7300000000000000000"
    }
  ],
  "chests": [
    {
      "envelopeId": "7300000000000000001",
      "kind": "chest",
      "variant": "gold",
      "coins": 500,
      "slots": 20,
      "ratio": 25,
      "viewers": 1200,
      "username": "ornek",
      "title": "yayın başlığı",
      "opensAt": "2026-11-18T20:02:30.000Z",
      "detectedAt": "2026-11-18T19:59:00.000Z",
      "openUrl": "https://www.tiktok.com/@ornek/live"
    }
  ],
  "errors": []
}
```

- `opensAt` mutlak zamandır; istemciler kalan süreyi kendileri hesaplar.
- `ratio = coins / slots`.
- `variant`: `normal`, `gold`, `hanging`, `l0` (çanta).
- Yalnızca kamuya açık Webcast yanıtlarında **açıkça** bildirilen zarf alanları kullanılır. Hediye elması veya tahmin sandık sayılmaz.
- `version.json` içindeki `dataVersion`, verinin üretim zamanıdır; Windows uygulaması değişikliği buradan algılar.
- `stale`, `dataAgeMinutes` ve `health` alanları verinin tazeliğini bildirir. Tarama
  boş/hatalıysa devre kesici son iyi veriyi `stale: true` ile 24 saate kadar yayında tutar.
- `watch` nesnesi WebSocket zarf dinlemesini özetler: `requested` (denenen oda),
  `connected` (bağlanan oda), `failed`, `seconds` (dinleme süresi), `envelopes`
  (yakalanan zarf), `rateLimited`/`rateLimitHits` (imzalama kotası), `signedWithKey`
  (`EULER_API_KEY` kullanıldı mı), `messageTypes` (çözülen protokol mesajları).
  `health.wsRooms/wsRequested/wsEnvelopes/wsMessages/wsSignedWithKey/wsRateLimited`
  `version.json` için aynı sayıların kısa hâlidir; tam kayıt `watch` nesnesidir.
- `warnings` dizisi insan tarafından okunacak uyarıları taşır; `EULER_API_KEY` yoksa,
  dinleme kapalıysa veya kota dolduysa boş kalmaz. Panel bu satırları uyarı kutusu olarak gösterir;
  uyarı sessizce yutulmaz.

## Veri sözleşmesi

`scripts/radar-contract.mjs` yayınlanan iki dosyanın zorunlu alanlarını tanımlar
(`schema`, `generatedAt`, `streams[].username/roomId`, `chests[].envelopeId/coins/opensAt`,
`roster.total/days/streamers`). Üretici (`radar-publish.mjs`) yayın öncesi doğrular;
`tests/radar-contract.test.mjs` sözleşmeyi CI'da kilitler. `schema` alanı büyütülürse
web kütüphanesi ve Windows istemcisi aynı anda güncellenmelidir.
Tek dosya kontrolü: `node scripts/radar-contract.mjs web/data/arena-live.json`

## Yayın kapısı

Her tarama zaman damgalarını tazelediği için dosya hep farklı görünür. `scripts/data-changed.mjs`
canlı oda kümesi, sandık kümesi ve üye defteri toplamını karşılaştırır; yalnızca bunlar
değiştiğinde (ya da yayındaki veri 20 dakikayı geçtiğinde) commit ve Pages deploy'u yapılır.
Gerekçe stderr'e yazılır, karar stdout'ta `true`/`false` olarak döner.

## Sağlık ve uyarı

- Radar işi düşerse `alert` işi `radar-alert` etiketli bir issue açar; ilk başarılı koşu kapatır.
- `health.json` yerine `version.json → health` kullanılır; böylece veri dalındaki dosya sayısı artmaz.

## Veri dalı bakımı ve yedek

`data` dalı ayda bir `Data Branch Maintenance` işiyle tek commit'e sıkıştırılır
(`--force-with-lease`; eşzamanlı yayın varsa üç kez yeniden dener). İçerik aynı kalır.
PostgreSQL yedeği için [BACKUP.md](BACKUP.md).

## GitHub kurulumu

1. Depo → **Settings → Pages → Build and deployment → GitHub Actions**.
2. Depo → **Settings → Actions → General → Workflow permissions** → *Read and write permissions*.
3. **Actions → Arena Radar Scan → Run workflow** ile ilk taramayı başlat.
4. `https://KULLANICI.github.io/ArenaSag/` ve `.../sandik.html` adreslerini aç.
5. Windows için: **Actions → Windows Radar Release** çalıştıktan sonra
   `https://github.com/KULLANICI/ArenaSag/releases/latest/download/ArenaRadar-Setup.exe`.

Zamanlanmış işler GitHub'da en kısa 5 dakikada bir çalışır ve yoğun saatlerde birkaç dakika gecikebilir; bu depo 10 dakikalık kadans kullanır. Depo 60 gün hareketsiz kalırsa GitHub zamanlanmış işleri durdurur; herhangi bir push veya manuel çalıştırma sayacı sıfırlar.

## Yerel çalıştırma

```bash
node scripts/radar-publish.mjs
# web/data/arena-live.json güncellenir

python -m http.server 8080 --directory web
# http://localhost:8080/sandik.html
```

Windows istemcisi:

```bat
node desktop\main.mjs
:: http://127.0.0.1:4817
```

İstemci, paket içindeki `scripts/radar-publish.mjs` dosyasını `ARENA_OUT_DIR=%LOCALAPPDATA%\ArenaRadar\data` ile çalıştırır.
Böylece GitHub cron'u gecikse bile yerel keşif turu yeni odaları ve sandıkları bulur; iki kaynağın en yeni verisi gösterilir.
Yerel turu panelden **Yerel tara** düğmesiyle veya `POST /api/discover` ile hemen başlatabilirsin.

Statik panel sayfaları: `index.html` (yayın merkezi), `yayinlar.html`, `sandik.html`, `yardim.html`, `ayarlar.html`.

## Windows uygulaması

| Özellik | Ayrıntı |
| --- | --- |
| Veri kaynağı | Önce `raw.githubusercontent.com`, sonra GitHub Pages |
| Tazeleme | Varsayılan 5 sn (3–120 sn arası ayarlanabilir) |
| Yerel sandık taraması | Canlı odaların zarf bilgisi 20 sn'de bir doğrudan TikTok'tan okunur (GitHub turunu beklemez) |
| Yerel keşif turu | Paket içindeki `scripts/radar-publish.mjs` varsayılan 5 dakikada bir kendi IP'nden çalışır; GitHub verisiyle birleştirilir |
| Bildirim | Oran eşiği + açılış penceresi; Windows balon bildirimi |
| Güncelleme | Açılışta ve 10 dakikada bir GitHub Release denetimi; otomatik indirme |
| Değişiklik algılama | `version.json` her 60 sn, veri her 5 sn |
| Kurulum | `%LOCALAPPDATA%\Programs\Arena Radar`, yönetici gerekmez |
| Başlangıç | Başlangıç klasörü kısayolu (`--silent`), arka planda çalışır |
| Kaldırma | Ayarlar → Uygulamalar → Arena Radar |

Otomatik jeton toplama TikTok tarafından sunulmaz. Uygulama sandığı açılmadan önce gösterir, ses/bildirim üretir ve canlıya tek tıkla götürür.

## Ayarlar

Windows uygulamasında **Ayarlar**:

- `pollSeconds` — veri tazeleme (varsayılan 5)
- `alertRatio` — bildirim için minimum oran (varsayılan 7)
- `alertSeconds` — açılışa kalan süre penceresi (varsayılan 180)
- `discoverMinutes` — yerel keşif turu sıklığı (varsayılan 5)
- `discoverChecks` / `discoverRooms` — keşifte doğrulanacak aday ve sandık için taranacak oda
- `notifyDesktop`, `sound`, `autoUpdate`

Ayarlar `%LOCALAPPDATA%\ArenaRadar\config.json` dosyasında tutulur ve güncellemelerde korunur.

## Sınırlar

- Ücretsiz hiçbir kaynak dünyadaki **tüm** yayınların listesini vermez. Tarama; açık örnekleri, bölgesel trendleri ve önceki doğrulanmış odaları kullanır.
- TikTok uçları veri merkezi IP'lerini zaman zaman sınırlayabilir. Betik hata durumunda elindeki doğrulanmış veriyi korur ve `errors` alanına yazar.
- GitHub Pages, özel kurumsal ağlarda engellenebilir; uygulama önce ham GitHub adresini dener.
