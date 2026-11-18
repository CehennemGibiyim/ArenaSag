# Ücretsiz keşif ve dinleme: veri sözleşmesi

**Kapsam:** Bir hesabın bir dizinde bulunması, şu an yayında olduğu, sandığı olduğu veya bir WebSocket'in onu dinlediği anlamına gelmez. Bu dört durum ayrı ölçülür. İncelenen kaynaklardan hiçbiri TikTok'un her ülkedeki tüm açık odalarını ücretsiz ve eksiksiz listelemiyor.

## İncelenen seçenekler

|Kaynak / kütüphane|Gerçekte sağladığı|Arena'daki kullanım|
|---|---|---|
|[CehennemGibiyim/TikTok yayıncı dizini](https://github.com/CehennemGibiyim/TikTok/blob/main/site/firsat/data/targets.json)|Geçmişte bulunan kullanıcı adları ve varsa ülke etiketleri. Canlılık veya güncel ödül kanıtı değil.|Sabit HTTPS kaynağı, saatte en fazla bir başarılı yenileme. Hesaplar tekilleştirilir; ülkeler arasında dönüşümlü 24 aday seçilir. Arşivdeki roomId, jeton, izleyici, sandık ve canlılık alanları kullanılmaz.|
|[TikWM ücretsiz uçları](https://github.com/AndreyQq/Tiktok-Video-No-Watermark)|`/api/region` desteklenen pazarlar; `/api/feed/list?region=…` trend **video** yazarları. Ülke filmdeki kişinin konumu değildir.|Katalog 24 saat, bölge yanıtı 15 dakika önbellekte. Tur başına en çok dört pazar; en az 1,5 sn istek aralığı. Otomatik tarama en eski sorgulanan pazardan devam eder. Hiçbir video izlenme/değer alanı canlı metriklere çevrilmez.|
|[Tik.Tools açık örnek liste](https://tik.tools/docs)|`/api/live/top-channels`: en fazla 10 yayın, IP başına beş dakikada bir çağrı. Rastgele örnek; küresel envanter değil.|Dolu, boş ve başarısız yanıtlar saklanır. Aynı kayıt ikinci kez yeni oda sayılmaz.|
|[TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector)|Bilinen hesap/oda için WebSocket ve olaylar. Tek başına ülke dizini değil. İmzalama servisinin kotasına tabi.|Kurulu Node istemcisi. `linkMicBattle.anchorsInfo[].value.user` içindeki diğer sunucular sonraki tura adaydır. İzleyiciler veya hediye veren hesaplar aday olarak kaydedilmez.|
|[TikTokLive (Python)](https://github.com/isaackogan/TikTokLive)|Bilinen hesaplarda olay dinleme, benzer imzalama bağımlılığı.|İkinci dilde aynı istemciyi eklemek global keşif sağlamadığından eklenmedi.|
|[GoTikTokLive](https://github.com/Davincible/gotiktoklive/blob/master/feed.go)|`NewFeed().Next()` tavsiye örneklemi; eksiksiz ülke kataloğu değil. Uç erişimi ortama göre değişir.|Bu ortamda anahtarsız testte kullanılabilir liste alınamadı; çalışıyormuş gibi etkinleştirilmedi.|
|[EulerStream bölge feed'i](https://www.eulerstream.com/docs/api/tiktok-live)|Bölge başına **örneklem**. Anahtar/plan gerektirebilir; yine kapsam garantisi yok.|**Varsayılan kapalı.** Yalnızca bilinçli sunucu opt-in'i: `ARENA_ENABLE_EULER_FEED=1` ve `EULER_API_KEY`. Bir hata üzerine ücretli kaynağa otomatik geçilmez.|

## Doğrulama ve rapor

- Otomasyon, sürekli çalışan Node sunucusundaki `instrumentation` ile başlar. Tarayıcı sekmesine veya düğmeye bağlı değildir. Varsayılan aralık 120 sn; **Ayarlar → Sandık radarı tarayıcısı** ile değişir. Duraklatılmış otomatik keşif ayarı korunur.
- Her hesap için handle → geçerli roomId okunur. `check_alive` en fazla 50 oda/istek ile toplu çalışır. Yalnız açık `alive:true` yanıtı ve geçerli oda eşleşmesi doğrulama üretir. Boş/hatalı doğrulama yanıtı **belirsiz**; pozitif kanıt yerine kullanılmaz. Bir turda en fazla 112 aday kontrol edilir. Tüm kaynakların ham toplamı tekil kontrol sayısına eşit olmak zorunda değildir.
- `newRooms` ilk defa oluşturulan `listener_jobs.room_id`; `repeatedRooms` aynı kimliğin yeniden doğrulanmasıdır. `firstHosts` daha önce bir dinleme işi olmayan yayıncının ilk doğrulanmış yayınını sayar. Tarihteki yeni oturum aynı yayıncıya ait olabilir. Sayfa yenilemesi veri eklemez. Tur kilidi ve 30 sn bekleme PostgreSQL'dedir.
- Oda sahibinden gelen ülke, açık liste etiketi, arşiv etiketi ve bölgesel keşif pazarı ayrı etiketlenir. Bilinmeyen ülke boş kalır. Önceki sürümde varsayılan olarak yazılmış `TR` doğrulanmış bilgi sayılmaz. Harita **kaynak etiketlerini** gösterir, gerçek zamanlı fiziksel konum tahmin etmez. Harita geometrisi: [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) (public domain).
- Açık ödül nesnesindeki kimlik, jeton, kontenjan ve açılış zamanı ayrı doğrulanır. Doğrulama sırasında oda bilgisi ödülü açıkça bildiriyorsa sıradaki oda için bile kayda girebilir. Hediye elması, video etkileşimi veya eski ödül sandık jetonu sayılmaz. Çanta yalnız desteklenen şema ve doğrulanmış alanlar gelirse kayda girer; istemci bunu iletmeyebilir.

## Eşzamanlı çalışma ve kota

**Tümünü hedefle** varsayılan olarak açıktır. Doğrulanmış her oda tekil kuyruğa alınır. Bu, hepsinin aynı anda bağlı olduğu anlamına gelmez. `connecting` kiralanan kapasiteyi gösterir; `listening` ancak `connect` başarılı, oda kimliği doğru ve lease geçerliyse kullanılır. Sağlıklı soketler bir tur bitti diye kapatılmaz. `retry` yeni bir keşif turuyla sıfırlanmaz.

- [Euler'in kota belgesi](https://www.eulerstream.com/docs/api/rate-limits): anahtarsız imzalama kotası `GET /webcast/rate_limits` ile okunur. `minute/hour/day.remaining` **istek sayısıdır, eşzamanlı soket sayısı değildir**. Panel son ölçümü ve zamanını gösterir. Kota alınamazsa muhafazakâr yerel sınırlar uygulanır; 429 ve izin hataları beklemeye neden olur.
- Yerel tavan: varsayılan **24 açık/bağlanmakta olan soket**, `ARENA_LISTENER_CEILING=1…64`. Sabit modda paneldeki `scanConcurrency` de üst sınırdır. Bu, satın alınmış veya sağlayıcının garanti ettiği kapasite değildir. Arena başlangıç bütçesi: **3/dk, 24/saat, 80/24 saat**, iki başlangıç arasında en az 20,5 saniye. Bildirilen daha düşük bütçe ve `Retry-After`/reset önceliklidir. Bir anahtarın kendi başına sınırsız erişim sağladığı varsayılmaz.
- Kira süresi 60 sn; 12 sn yenileme; her sahiplenme için ayrı rastgele anahtar. İşçi düşerse süresi geçen kira geri alınır. Kalıcı bütçe ve önbellek aynı veritabanını paylaşan süreçler için ortaktır. Başka uygulamaların aynı IP/kotayı kullanması dışarıdan engellenemez.
- Radar otomatik imza istemcisi varsayılan olarak anonimdir. İsteğe bağlı anahtarlı imzalama için ayrıca `ARENA_ENABLE_KEYED_SIGNING=1` gerekir. Anahtarlar istemciye gönderilmez. Sağlayıcıların ileride koşullarını değiştirmesi mümkündür.

## Uçlar ve çalışma

`GET /api/radar/network?region=TR&state=listening&page=1&q=…` (12 oda/sayfa; filtre yalnız gözlenen etiketlere uygulanır). `region=unknown` desteklenir. `GET /api/radar/scan?regions=list` desteklenen **pazarları** verir; sorgulanmış pazar sayısı değildir. `GET /api/radar/scan` güncel iş durumunu, `POST /api/radar/scan` tur raporunu verir. `report.markets[].requests/cached/state`, boş, önbellek ve hata ayrımını korur. Kaynaklar kısmen kullanılamasa da diğerleri çalışır.

Kurulum/güncelleme: `npx drizzle-kit push`, `npm run build`, normal Node üretim sunucusunu başlatın. Yeni anahtar veya ücretli plan gerekmez. Sürekli worker çalıştırmayan serverless ortamlarda arka plan dinlemesi garanti edilmez.
