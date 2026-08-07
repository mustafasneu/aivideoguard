# AI Video Guard — proje durumu

Son güncelleme: 2026-08-07

## Nedir

Kullanıcının görmek istemediği konuyu YouTube akışından gizleyen Firefox + Chrome MV3 eklentisi. Eski `AI Video Guard Pro v9.0` sürümünün yerine sıfırdan yazıldı.

Ayırt edici tasarım kararı: filtreleme **anlamsal ve bağlamsal**, hibrit.

- Anlamsal — başlık/kanal metninin konuya anlam yakınlığı (gömü + kosinüs). Kelime eşleşmesi değil.
- Bağlamsal — kanal hafızası, meta veri, ve LLM'in dolaylı ilişki kurması (takma ad, kişinin rolü, ima, küçük resimdeki logo/yüz).

Kullanıcının yazdığı liste maddeleri de anlamsal çapa olarak gömülür. Düz metin eşleşmesi yalnızca "kesin engelle" kısayoludur, geçit değildir.

## Karar hattı

```
0 önbellek
1 kanal beyaz listesi     → geçir, hiçbir katman çalışmaz
2 kanal kara listesi      → engelle
3 literal kısayol         → engelle, LLM'e hiç sorma
4 ANLAMSAL                → vektör benzerliği + kanal itibarı katkısı
                            yüksek → engelle · düşük → geçir · orta → yükselt
5 BAĞLAMSAL metin LLM     → dolaylı ilişki
6 BAĞLAMSAL görsel LLM    → yalnızca metin katmanı kararsızsa
```

## Durum

| | |
|---|---|
| Derleme | `dist/firefox` + `dist/chrome` (+ `dist/chrome-test`) |
| Birim test | 25/25 geçiyor — `npm test` |
| Uçtan uca | 9/9 geçiyor — `node test/e2e/demo.mjs` |
| Gömülü sır | yok, doğrulandı |

## Komutlar

```bash
npm run build                    # firefox + chrome
node scripts/build.mjs --test    # yerel uç nokta izinli test paketi
npm test                         # birim testler
node test/e2e/demo.mjs           # GÖRÜNÜR Playwright demo (sahte API)
node test/e2e/demo.mjs --headless
GEMINI_API_KEY=... node test/e2e/demo.mjs --live   # gerçek Gemini
```

## Ortam tuzakları

- Node 18 kısıtı: Playwright 1.49.1'e sabit.
- Playwright'ın `headless: true` bayrağı **eski** headless kipini seçer; o kipte eklentiler hiç yüklenmez. `--headless=new` argümanı elle veriliyor.
- Playwright `context.route()` service worker'dan çıkan istekleri yakalamıyor. Bu yüzden sahte Gemini ağ katmanında değil, eklentinin `apiEndpoint` ayarıyla yönlendiriliyor. `dist/chrome-test` üretim paketiyle **kod olarak aynı**, yalnızca manifest'te yerel adres izni var.

## Açık iş

- [ ] Eski gömülü API anahtarının iptali — kullanıcı yapacak (AI Studio / `gcloud services api-keys delete`)
- [ ] Gerçek anahtarla `--live` koşumu — anlamsal kalitenin ölçülmesi
- [ ] Eşik kalibrasyonu: `tBlock` / `tAsk` varsayılanları doğrulanmadı, gerçek skor dağılımına bakılmalı
- [ ] Firefox tarafında uçtan uca demo (şu an yalnızca Chrome)

## Çok ajanlı inceleme — 2026-08-07

5 eksen paralel tarandı (tarayıcı API, YouTube DOM, güvenlik/gizlilik, maliyet/performans, karar mantığı). 63 ham bulgunun en ağır 15'i karşıt-doğrulamaya girdi: **14 onaylandı, 1 çürütüldü.**

Çürütülen: "Geri dönüştürülen YouTube düğümleri bir daha hiç değerlendirilmiyor" — IntersectionObserver ilk kayıttan sonra susmaz, her eşik geçişinde yeni kayıt üretir; `processCard` içindeki videoId karşılaştırması da eksik denilen korumayı zaten içeriyor.

Onaylananlar ve uygulama durumu aşağıda.

### Uygulandı

1. **[high]** Kanal avatarı küçük resim sanılıp görsel katmana gönderiliyordu — `extract.js`. Karttaki en büyük `<img>` aranıyordu; avatarlar akışta tekrar ettiği için önbellekten yüklü gelir (alan > 0), video küçük resmi ise henüz yüklenmemiştir (alan = 0). Sonuç: düzenli olarak kanal logosu değerlendiriliyordu, üstelik yanlış karar hem önbelleğe hem kanal hafızasına yazılıyordu. Artık önce thumbnail konteyneri hedefleniyor, sonra alan adı doğrulanıyor; boyuta hiç güvenilmiyor.
2. **[high]** MutationObserver ikinci partiyi tamamen düşürüyordu — `content/index.js`. `if (scanScheduled) return;` o çağrının `records` dizisini kalıcı olarak kaybettiriyordu; MutationObserver her kaydı tam bir kez teslim eder, ertelemez. Kayıtlar artık biriktiriliyor.
3. **[high]** Mevcut kartın içi değiştiğinde yeniden değerlendirme yoktu — YouTube düğümü silip eklemek yerine içini değiştirerek başka videoya atar. Artık değişen düğümün üst kartı da yeniden değerlendiriliyor, `href` niteliği izleniyor.
4. **[high]** `yt-navigate-finish` yalnızca yeni düğümleri gözlemliyordu; zaten `observed` olan düğüm atlanıyor ve yeni sayfanın videosu hiç filtrelenmiyordu. Artık tam yeniden değerlendirme yapılıyor.
5. **[high]** `bumpStats` oku-değiştir-yaz yarışı — eş zamanlı 60 çağrı birbirinin yazmasını eziyor, günlük LLM bütçesi fiilen hiç dolmuyordu. Tek bellek kopyası üzerinde senkron artırım + gecikmeli yazma. Bütçe için ayrıca tek adımlı `reserveLlmCall` rezervasyonu.
6. **[high]** `recordChannelOutcome` her kararda tüm kanal haritasını yazıyor ve `storage.onChanged` ile tüm sekmelere yayın yapıyordu. Gecikmeli tek yazma + kapasite sınırı.
7. **[low]** API anahtarı içerik betiğine yükleniyor ve her ayar değişiminde YouTube sekmelerine yayınlanıyordu. Anahtar ayrı `secret:v1` deposuna taşındı; içerik betiği yalnızca `{onError, debug, enabled}` projeksiyonu görüyor.

8. **[high]** `fetchThumbnail`'de zaman aşımı yoktu; `Promise.all` ile beklenen 60 kartlık yanıtın tamamı tek asılı istek yüzünden sonsuza kadar bloke olabiliyordu. 5 sn `AbortController` eklendi.
9. **[high]** Gömü modeli değişimi çapa önbelleğini geçersizleştirmiyordu — farklı vektör uzayları karşılaştırılıyor, kosinüs skoru tamamen anlamsızlaşıyordu. Artık iki ayrı parmak izi var: `embedHash` (konu + çapa + gömü modeli) çapa paketi için, `configHash` (+ eşikler, katman anahtarları, diğer modeller) karar önbelleği için.
10. **[medium]** `fetchThumbnail` sayfa denetimindeki keyfi URL'yi çekiyordu. Artık `isAllowedThumbnail` ile https + `ytimg.com`/`img.youtube.com` allowlist'i zorunlu.
11. **[medium]** Çapa bağlamlandırması tüm çapaları konu vektörüne çekip ayırt ediciliği yok ediyordu — çapa başına ayrı anlam merkezi tutmanın amacı kayboluyordu. Konu enjeksiyonu kaldırıldı, yerine nötr `"<metin> konulu video"` şablonu.
12. **[medium]** Konu/çapa yokken metin LLM'i her video için "(belirtilmemiş)" konusuyla çağrılıyordu. `hasSemanticCriteria` kapısı eklendi.

### Sırada — henüz uygulanmadı

13. **[medium]** Firefox MV3'te host izinleri kurulumda verilmiyor; çalışma zamanı `permissions.request` akışı yok. Yapılacak: `gecko.strict_min_version`'ı 127.0'a çek + ayarlar sayfasında `permissions.contains` kontrolü ve kullanıcı tıklamasıyla istek.
14. **[low]** Ayarlar sayfasında model çıktısı ve API hata metni `innerHTML`'e kaçışsız yazılıyor (`options.js` `probe()` ve `populate()`). Yapılacak: `textContent` + `replaceChildren`.
15. **[görsel QC]** Önbellekten gelen kararlar gerekçeyi saklamıyor; kart etiketinde "Gizlendi [cache 1.000]" görünüyor, neden gizlendiği kayboluyor. Yapılacak: `putVerdict`'e `reason`/`matched` alanlarını ekle, `LAYER.CACHE` dönüşünde geri ver.

### Ayrıca gözden geçirilmeli

- Çapa şablonu şu an yalnızca çapaya uygulanıyor, video metnine uygulanmıyor. Tam simetri isteniyorsa video metnine de aynı kalıp uygulanmalı — ama bu gerçek gömüyle ölçülmeden karar verilmemeli (`--live` koşumu bekliyor).
- Her eksende bulguların yalnızca en ağır 3'ü doğrulamaya girdi (63 ham bulgu → 15 doğrulandı). Kalan ~48 bulgu incelenmedi.
