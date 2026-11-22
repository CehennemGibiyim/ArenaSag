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
- `watch` nesnesi WebSocket zarf dinlemesini özetler: `requested` (istenen oda),
  `attempted` (bağlantı denemesi), `connected`/`connectedRooms` (bağlantı/benzersiz
  oda), `failed`, `seconds` (dinleme süresi), `envelopes` (yakalanan zarf),
  `roomInfoEnvelopeRooms` (yalnızca bağlantı anındaki oda verisinden zarf çıkan oda),
  `rateLimited`/`rateLimitHits` (imzalama kotası), `signedWithKey` (`EULER_API_KEY`
  kullanıldı mı), `messageTypes` (çözülen protokol mesajları). Her koşunun oda
  bazlı deneme/bağlantı/429/zarf sayaçları `watch.roomHistory` içinde taşınır;
  bunlar `roomMemory` olarak önceki yayınla birleştirilir. Matris modunda
  `shardCoverage` her shard için `attempted`, `connectedRooms` ve
  `roomInfoEnvelopeRooms` taşır; `health.wsShardCoverage` aynı dizidir.
  Kota beklemesi de görünürdür: `cooldownUntil` (yeniden deneme anı, ISO),
  `cooldownSeconds` (son bekleme penceresi) ve `cooldownWaits` (turda kaç kez beklendiği).
  Panel "kota doldu" demek yerine bu andan geri sayar; süre bitince beklemenin
  tamamlandığını yazar. `health.wsRooms/wsRequested/wsEnvelopes/wsMessages/wsSignedWithKey/wsRateLimited`
  ve `health.wsCooldownUntil/wsCooldownSeconds/wsCooldownWaits` aynı sayıların kısa
  hâlidir; tam kayıt `watch` nesnesidir. `health.wsRoomMemory` hatırlanan oda sayısıdır.
- `roomMemory`, oda kimliğine göre `attempts`, `connected`, `failed`, `rateLimitHits`,
  `envelopes` ve son deneme/bağlantı/429/zarf zamanlarını taşır. 45 günden eski
  kayıtlar budanır, en fazla 600 oda tutulur; sonraki shard seçimi bu geçmişi kullanır.
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
  uyarı üretilir. Bilinmeyen tipin maskeli ham karesi shard artifact'ındaki
  `watch.unknownSamples` altında, alan yolları ise `health.unknownEnvelopeSamples`
  içinde tutulur; `radar-schema` issue'su bu alan listesiyle açılır/güncellenir.
  Kimlikler, kullanıcı alanları ve URL'ler maskelenir.
- Her zarf tipi için ayrı son görülme anı ve gözlenen görülme aralığı tutulur.
  Sessizlik eşiği tipin kadansına göre **ortalama aralığın 3 katı** olarak hesaplanır;
  çok sık tipte gürültüyü önlemek için en az 30 dakika, çok seyrek tipte erken alarmı
  önlemek için en fazla 24 saat uygulanır. Kadans henüz gözlenmediyse 24 saatlik taban
  yalnızca ilk kurulum için kullanılır. Bir tip susarken başka bir zarf tipi akıyorsa
  uyarı `Başka zarf tipi akıyor: …` işaretiyle ayrıca belirtilir.
- `health.envelopeTypeActivity` tip başına `lastSeenAt`, `firstSeenAt`, `meanGapMs`,
  `gapCount`, `thresholdMs`, `silent` ve `silentWhileOtherFlows` alanlarını taşır.
  `health.envelopeSilentTypes` ve `health.envelopeSilentWhileOtherFlows` özet listelerdir.
  `health.envelopeLastSeenAt`, `health.envelopeTrackingSince`, `health.envelopeSampleType`
  ve `health.unknownEnvelopeTypes` geriye dönük uyumluluk için korunur; ilk çalıştırma
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
(şema sürüklenmesi/tip başına sessizlik uyarıları + `health.unknownEnvelopeTypes`)
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
| `ARENA_DISCORD_WEBHOOK_URL` | Discord kanal webhook'u; Telegram başarısız olursa yedek kanal |

Spam koruması: aynı `envelopeId` bir kez bildirilir (önceki yayındaki sandıklar ve koşu içi
kayıtlar), koşu başına en fazla 4 mesaj gider, mesajlar arasında 1,5 sn beklenir, açılışı
geçmiş zarf gönderilmez. Geçici hata (ağ, 408/429/5xx) aynı kanalda iki kez yeniden denenir;
kalıcı hata veya tükenen denemelerde sıradaki kanal yedek olarak kullanılır. Kanal tanımlı
değilse koşu log'una tek satır "bildirim kapalı" yazılır ve panel uyarısı üretilir.
Bildirim hatası taramayı düşürmez; hata metni token/adres içerseydi maskelenir.

Teslimat sayaçları (`sent`, `failed`, `retries`, `fallbackSent`, kanal bazlı `sent/failed` ve
`lastError`) shard artifact'ından `version.json → health.notifications` alanına taşınır.
Başarısız teslimat veya yedek kanal kullanımı `warnings` içinde de görünür; web radar şeridi
ve Windows Radar paneli bu uyarıyı gösterir, böylece sessiz kayıp olmaz.

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
  │     önceki arena-live.json'dan kendine düşen 15 odayı dinler
  │     (anahtarlı modda 30) · tam pencere · sonuç: envelope-shard-<n>.json
  └─ scan (needs: shard)             artifact'ları birleştirir
        ARENA_SHARD_DIR=web/data/shards · yerel WS dinleyici kapalı
        arena-live.json + roster.json + version.json yazar, yayınlar
```

- Oda listesi önceki yayından alınır; shard'lar birbirini beklemez. Oda seçimi
  `scripts/envelope-shards.mjs → shardRooms` (ücretsiz modda `15 × 4 = 60`,
  anahtarlı modda `30 × 4 = 120` oda kapasitesi; aynı oda iki runner'da kota
  harcamaz). Önceki `roomMemory` varsa odalar bağlantı başarısına, 429 oranına ve
  zarf getirisine göre sıralanır; eşit puanda izleyici sırası korunur. Hafıza yoksa
  seçim eskisi gibi izleyici sırasıyla yapılır.
- Bağlantı anında connector'ın `fetchRoomInfoOnConnect` ile getirdiği oda verisi
  okunur; ayrı bir `fetchRoomInfo` isteği yapılmaz. Ücretsiz imzalama kotası
  bağlantı sayısını sınırlar: aynı 12 odada tam pencere 4 oda bağlarken kısa
  bağlantı da 4 oda bağladı, üstelik kota reddi üretti. Bu yüzden ücretsiz modda
  az oda bağlanır ve kalan pencere aynı odalarda dinlemeye ayrılır; anahtarlı
  modda 30 oda tam pencere dinlenir.
- Her shard odaları 5'erli turlara bölüp kendi süresini dinler. `--hold`
  varsayılan olarak `0`dır (tüm tur); pozitif değer bağlantıyı erken kapatır,
  fakat kısa bağlantı ek oda bağlamadığı için üretimde kullanılmaz.
- Shard `arena-live.json` yazmaz, git'e dokunmaz. Birleştirme (`mergeShardWatches`)
  sayaçları ve oda geçmişini toplar, zarfları kimliğe göre tekilleştirir;
  `signedWithKey` ancak tüm shard'lar anahtarlıysa true olur. Birleşik oda
  geçmişi `radar-publish.mjs` tarafından `roomMemory` olarak yayınlanır.
- Artifact yoksa yayın durmaz; `warnings` alanına "matris dinleme artifact'ı
  bulunamadı" satırı düşer.
- Ayarlar: ücretsiz modda `--rooms 15`, anahtarlı modda `--rooms 30`;
  ikisinde de `--batch 5 --seconds 300` ve varsayılan `--hold 0`
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
