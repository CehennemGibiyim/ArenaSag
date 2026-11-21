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
  Kota beklemesi de görünürdür: `cooldownUntil` (yeniden deneme anı, ISO),
  `cooldownSeconds` (son bekleme penceresi) ve `cooldownWaits` (turda kaç kez beklendiği).
  Panel "kota doldu" demek yerine bu andan geri sayar; süre bitince beklemenin
  tamamlandığını yazar. `health.wsRooms/wsRequested/wsEnvelopes/wsMessages/wsSignedWithKey/wsRateLimited`
  ve `health.wsCooldownUntil/wsCooldownSeconds/wsCooldownWaits` aynı sayıların kısa
  hâlidir; tam kayıt `watch` nesnesidir.
- Dinleyici odaya bağlanır bağlanmaz oda bilgisindeki (`room/info`) açık zarf
  alanlarını da okur; odaya girmeden önce açılmış sandık/mektup/çanta akışı
  beklemeden listeye girer. Bu okuma imzalama kotası harcamaz, altı saatten eski
  zarflar `envelopeReward` doğrulamasıyla reddedilir.
- `warnings` dizisi insan tarafından okunacak uyarıları taşır; `EULER_API_KEY` yoksa,
  dinleme kapalıysa veya kota dolduysa boş kalmaz. Panel bu satırları uyarı kutusu olarak gösterir;
  uyarı sessizce yutulmaz.
- Panel `/api/radar/watch` ucu başarılı yanıtı 60 saniye süreç içi önbellekte tutar;
  eşzamanlı sekmeler aynı isteği paylaşır, her sekme GitHub'a ayrı istek atmaz.
  Hata yanıtı önbelleğe alınmaz ki toparlanma hemen görünsün.
- Zarf şeması sürüklenmesi de `warnings` alanına düşer: bilinen tipler
  (`ENVELOPE_MESSAGE_TYPES`: `WebcastEnvelopeMessage`, `WebcastGoodyBagMessage`) dışında
  adı zarf ailesine benzeyen yeni bir tip görülürse **örnek mesaj tipi ve sayısıyla**
  uyarı üretilir. 24 saat boyunca hiç zarf/çanta tipi gelmezse de uyarı verilir; son
  görülen örnek tip `health.envelopeSampleType` alanında taşınır.
- `health.envelopeLastSeenAt`, `health.envelopeTrackingSince` ve
  `health.unknownEnvelopeTypes` şema takibinin yayınlar arası kaydıdır; ilk çalıştırma
  `envelopeTrackingSince` tabanını kurar.

## Veri sözleşmesi

`scripts/radar-contract.mjs` yayınlanan iki dosyanın zorunlu alanlarını tanımlar
(`schema`, `generatedAt`, `streams[].username/roomId`, `chests[].envelopeId/coins/opensAt`,
`roster.total/days/streamers`). Üretici (`radar-publish.mjs`) yayın öncesi doğrular;
`tests/radar-contract.test.mjs` sözleşmeyi CI'da kilitler. `watch` varsa
`cooldownUntil` (ISO ya da null), `cooldownSeconds` ve `cooldownWaits` zorunludur;
panellerin kota geri sayımı bu alanlara dayanır, alan sessizce kaybolamaz.
`schema` alanı büyütülürse web kütüphanesi ve Windows istemcisi aynı anda güncellenmelidir.
Tek dosya kontrolü: `node scripts/radar-contract.mjs web/data/arena-live.json`

## Yayın kapısı

Her tarama zaman damgalarını tazelediği için dosya hep farklı görünür. `scripts/data-changed.mjs`
canlı oda kümesi, sandık kümesi, üye defteri toplamı ve zarf şeması imzasını
(şema sürüklenmesi/24 saat sessizlik uyarıları + `health.unknownEnvelopeTypes`)
karşılaştırır; bunlardan biri değiştiğinde (ya da yayındaki veri 20 dakikayı geçtiğinde)
commit ve Pages deploy'u yapılır. Kota sayaçları gibi her turda değişen uyarı satırları
imzaya girmez. Böylece şema sürüklenmesi uyarısı, oda/sandık listesi değişmese bile panele ulaşır.
Gerekçe stderr'e yazılır, karar stdout'ta `true`/`false` olarak döner.

## Sağlık ve uyarı

- Radar işi düşerse `alert` işi `radar-alert` etiketli bir issue açar; ilk başarılı koşu kapatır.
- `health.json` yerine `version.json → health` kullanılır; böylece veri dalındaki dosya sayısı artmaz.

### Zarf bildirimi (Telegram/Discord)

Zarf yakalandığı anda `scripts/radar-notify.mjs` webhook gönderir; panel senkronu veya
Pages yayını beklenmez. Adres yalnızca Actions secret'ından okunur, dosyaya yazılmaz.

| Secret | Açıklama |
| --- | --- |
| `ARENA_TELEGRAM_BOT_TOKEN` + `ARENA_TELEGRAM_CHAT_ID` | Telegram bot bildirimi (ikisi birlikte gerekir) |
| `ARENA_DISCORD_WEBHOOK_URL` | Discord kanal webhook'u (Telegram tanımlıysa kullanılmaz) |

Spam koruması: aynı `envelopeId` bir kez bildirilir (önceki yayındaki sandıklar ve koşu içi
kayıtlar), koşu başına en fazla 4 mesaj gider, mesajlar arasında 1,5 sn beklenir, açılışı
geçmiş zarf gönderilmez. Kanal tanımlı değilse koşu log'una tek satır "bildirim kapalı" yazılır.
Bildirim hatası taramayı düşürmez; hata metni token/adres içerseydi maskelenir.

```bash
# Yerel deneme: adresi komut geçmişine yazmadan oku, sonra taramayı çalıştır.
read -rs ARENA_DISCORD_WEBHOOK_URL && export ARENA_DISCORD_WEBHOOK_URL
node scripts/radar-publish.mjs
```

## Zarf replay testi

`tests/fixtures/webcast-envelope-message.json` gerçek bir TikTok `WebcastEnvelopeMessage`
kaydından alınıp maskelenmiş karedir (kaynak ve maskeleme listesi dosyanın `source`
alanında). `tests/envelope-replay.test.mjs` bu kareyi kotasız/çevrimdışı olarak
`envelopeReward → applyChestReward` zincirinden geçirir ve aynı koşuda sandık kaydının
(jeton, kişi, oran, açılış, `kind: chest`) oluştuğunu doğrular.

- Kimlikler (`msgId`, `roomId`, `envelopeId`, `sendUserId`, `sendUserName`, avatar)
  taklit değerlerdir; `diamondCount`, `peopleCount`, `skinId`, `businessType` ve
  zaman damgaları gerçektir.
- Kare gerçek zaman damgasını korur; test yalnızca `unpackAt` alanını çalıştığı ana
  taşır, çünkü parser altı saatten eski zarfı (doğru şekilde) reddeder.
- Yeni kare kaydetmek için canlı dinleyici `--capture` ile çalıştırılır; ilk gerçek
  `WebcastEnvelopeMessage` maskelenip hedef fixture'a yazılır, sonraki kareler yok sayılır:

  ```bash
  node scripts/envelope-watch.mjs --from web/data/arena-live.json --rooms 12 \
    --seconds 120 --capture tests/fixtures/webcast-envelope-message.json
  ```

  `scripts/envelope-capture.mjs` kimlikleri, kullanıcı adlarını, avatarları ve URL'leri
  maskeler; `diamondCount`, `peopleCount`, `skinId`, `businessType` ve zaman damgalarına
  dokunmaz. Zarf gelmezse dosya değişmez ve komut bunu log'da söyler. Replay testi
  değerleri fixture'dan okuduğu için yeni kareyle güncellenmesi gerekmez.

## Matris zarf dinlemesi

WebSocket zarf dinlemesi tek runner'ın ücretsiz imzalama kotasına sığmadığı için
iş GitHub Actions matrisine bölünür:

```
radar.yml
  ├─ shard (matrix: 0..3, paralel)   her runner kendi IP'si + kendi kotası
  │     önceki arena-live.json'dan kendine düşen 30 odayı dinler
  │     5'erli turlar, oda başına 30 sn (--hold) · sonuç: envelope-shard-<n>.json
  └─ scan (needs: shard)             artifact'ları birleştirir
        ARENA_SHARD_DIR=web/data/shards · yerel WS dinleyici kapalı
        arena-live.json + roster.json + version.json yazar, yayınlar
```

- Oda listesi önceki yayından alınır; shard'lar birbirini beklemez. Oda seçimi
  `scripts/envelope-shards.mjs → shardRooms` (izleyiciye göre ilk `30 × 4 = 120` oda,
  sırayla bölünür; aynı oda iki runner'da kota harcamaz).
- Bağlantı anında oda bilgisindeki zarflar okunur; oda başına kalma süresi
  `--hold 30` ile sınırlıdır. Sandığı zaten odada duran oda için uzun beklemek
  gerekmez; bağlantı kısa tutulduğu için aynı pencerede daha çok oda dolaşılır.
- Her shard odaları 5'erli turlara bölüp kendi süresini dinler; `--hold` süresi
  dolunca bağlantı kapanır ve sıradaki tura geçilir, böylece 30 oda 5 dakikada
  dolaşılır. Kota reddi gelirse dinleyici odaları bekletip yeniden dener.
- Shard `arena-live.json` yazmaz, git'e dokunmaz. Birleştirme (`mergeShardWatches`)
  sayaçları toplar, zarfları kimliğe göre tekilleştirir; `signedWithKey` ancak tüm
  shard'lar anahtarlıysa true olur.
- Artifact yoksa yayın durmaz; `warnings` alanına "matris dinleme artifact'ı
  bulunamadı" satırı düşer.
- Ayarlar: `shard --rooms 30 --batch 5 --seconds 300 --hold 30 --shards 4`
  (iş dosyasında), yerel deneme için `ARENA_SHARD_*` ortam değişkenleri.

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
