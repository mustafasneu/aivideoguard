# AI Video Guard

Anlamsal ve bağlamsal YouTube içerik filtresi — Firefox, Chrome, Opera (MV3)

*[English below](#english)*

---

## Türkçe

### Ne yapar

Görmek istemediğiniz içerikleri YouTube akışınızdan gizler. Kelime listesi değildir: videonun konuya **nasıl yaklaştığına** bakar.

İki video düşünün:

- "League of Legends çok eğlenceli, oynayın"
- "League of Legends berbat olmuş, bıraktım"

İkisinde de aynı kelimeler geçer. Klasik bir engelleyici ikisini de gizler. Bu eklenti ikincisini geçirir — çünkü siz oyunu görmek istemiyorsunuz, oyunu eleştiren videoyu izleyebilirsiniz.

Aynı şekilde, ölçütün adı başlıkta hiç geçmese de yakalar: "LCK finalinde inanılmaz geri dönüş" başlığında oyunun adı yoktur ama LCK o oyunun ligidir.

### Karar hattı

Yukarıdan aşağı inildikçe maliyet artar. İş üst katmanlarda biterse hiçbir API çağrısı yapılmaz.

| # | Katman | Maliyet |
|---|---|---|
| 0 | Önbellek — daha önce karar verildi mi | yok |
| 1 | Kanal listesi — beyaz / kara | yok |
| 2 | Deterministik kalıp — yalnızca tutum-duyarsız ölçütlerde | yok |
| 3 | Anlamsal aday eleme — merkezlenmiş kosinüs | gömü (ucuz, toplu) |
| 4 | Kanal hafızası — kanal sürekli engelleniyorsa | yok |
| 5 | Bağlamsal katman — ilişki + **tutum** | 20 video / 1 istem |
| 6 | Kapak görseli — logo, amblem, sahne | varsayılan kapalı |

Karar, eşleşen kuralın **kendi** politikasıyla verilir:

| Videonun duruşu | "Konu" ölçütü | "Övgü" ölçütü | "Hakaret" ölçütü |
|---|---|---|---|
| Öven / özendiren | engelle | engelle | geçir |
| Tarafsız aktarım | engelle | geçir | geçir |
| Eleştiren | **geçir** | geçir | **engelle** |

Bu yüzden bir oyunu eleştiren video geçer, dine hakaret eden engellenir — tek bir genel anahtar ikisini aynı anda doğru yapamaz.

### Kurulum

```bash
npm install
npm run build      # dist/firefox, dist/chrome, dist/opera
```

**Firefox** — `about:debugging` → "Bu Firefox" → "Geçici Eklenti Yükle" → `dist/firefox/manifest.json`

**Chrome / Opera** — `chrome://extensions` → Geliştirici modu → "Paketlenmemiş öğe yükle" → `dist/chrome` (Opera için `dist/opera`)

### API anahtarı

Anlamsal ve bağlamsal katmanlar Google Gemini kullanır. [AI Studio](https://aistudio.google.com/apikey)'dan ücretsiz alınır, kart istemez.

Anahtarı ayarlar sayfasına girin. Yalnızca kendi tarayıcınızda saklanır, başka hiçbir yere gönderilmez.

Ücretsiz kademe sınırları (ölçüldü): gömü için dakikada 100, günde 1000 istek — ve bu kota **anahtar başına değil, Google Cloud projesi başına**. Aynı projede yeni anahtar üretmek kotayı artırmaz.

Anahtar girmezseniz eklenti çalışmaya devam eder, ama yalnızca kanal listeleri ve kesin kalıplar devrede kalır.

### Kurallar

Eklenti hazır bir kural setiyle gelir — kurulur kurulmaz çalışır, tek bir API çağrısı bile yapmadan.

Ayarlar sayfasından her kuralı düzenleyebilirsiniz: açıp kapatma, çapa ve kalıpları değiştirme, tutum politikası seçme, güven eşiği ayarlama, silme. "+ Kural ekle" ile sıfırdan kendi kuralınızı yazabilirsiniz.

Kendi ölçütlerinizi düz cümlelerle yazıp "Kuralları üret" derseniz, kısaltmaları ve jargonu sistem türetir. Ürettiği kurallar **öneri** olarak gösterilir; onaylamadan hiçbir şey kaydedilmez.

Kurallar tarayıcı hesabınızla senkronlanır — başka bir makinede yeniden üretilmez.

### Geliştirme

```bash
npm test                              # 58 birim testi, ağ gerekmez
node test/e2e/demo.mjs --mock         # Chrome uçtan uca, sahte API
GEMINI_API_KEY=... node test/e2e/demo.mjs      # gerçek model
node test/e2e/firefox.mjs --mock      # Firefox (geckodriver)
GEMINI_API_KEY=... node scripts/measure-stance.mjs   # tutum ölçümü, tek çağrı
```

### Gizlilik

Video başlıkları ve kanal adları değerlendirme için Google Gemini'ye gönderilir. Kapak görselleri yalnızca görsel katman açıksa gönderilir; varsayılan olarak kapalıdır.

Ücretsiz kademede Google gönderilen içeriği ürün geliştirmede kullanabilir. İzleme geçmişiniz, hesabınız veya kimliğiniz hiçbir şekilde gönderilmez.

---

## English

### What it does

Hides content you don't want to see from your YouTube feed. It is not a word list: it looks at **how a video treats** a subject.

Consider two videos:

- "League of Legends is great, you should play it"
- "League of Legends has gotten terrible, I quit"

Both contain the same words. A conventional blocker hides both. This extension lets the second one through — you don't want to see the game, but you may well want to watch someone criticise it.

It also catches videos where the subject is never named: "Incredible comeback in the LCK final" doesn't mention the game, but the LCK is that game's league.

### Decision pipeline

Cost rises as you go down. If a decision is reached in the upper layers, no API call is made at all.

| # | Layer | Cost |
|---|---|---|
| 0 | Cache — already decided? | none |
| 1 | Channel lists — allow / block | none |
| 2 | Deterministic patterns — stance-insensitive criteria only | none |
| 3 | Semantic shortlisting — centred cosine | embedding (cheap, batched) |
| 4 | Channel memory — consistently blocked channel | none |
| 5 | Contextual layer — relevance + **stance** | 20 videos / 1 prompt |
| 6 | Thumbnail — logo, emblem, scene | off by default |

The verdict comes from the matched rule's **own** policy:

| Video's stance | "Subject" rule | "Praise" rule | "Insult" rule |
|---|---|---|---|
| Praising / promoting | block | block | allow |
| Neutral reporting | block | allow | allow |
| Critical | **allow** | allow | **block** |

This is why a video criticising a game passes while one insulting a faith is blocked — a single global switch cannot get both right at once.

### Install

```bash
npm install
npm run build      # dist/firefox, dist/chrome, dist/opera
```

**Firefox** — `about:debugging` → This Firefox → Load Temporary Add-on → `dist/firefox/manifest.json`

**Chrome / Opera** — `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome` (or `dist/opera`)

### API key

The semantic and contextual layers use Google Gemini. Get a free key from [AI Studio](https://aistudio.google.com/apikey) — no card required.

Enter it on the options page. It is stored in your browser only and is never sent anywhere else.

Measured free-tier limits: 100 embedding requests per minute, 1000 per day — and this quota is **per Google Cloud project, not per key**. Creating additional keys in the same project does not raise it.

Without a key the extension still runs, but only channel lists and exact patterns remain active.

### Rules

The extension ships with a working rule set — it filters from the moment you install it, without a single API call.

Every rule is editable from the options page: enable or disable, change anchors and patterns, pick a stance policy, adjust the confidence threshold, delete. "+ Add rule" lets you write your own from scratch.

You can also write your criteria as plain sentences and press "Generate rules"; the system derives the abbreviations and jargon for you. Generated rules are shown as a **proposal** — nothing is saved until you approve it.

Rules sync with your browser account, so they are not regenerated on another machine.

### Development

```bash
npm test                              # 58 unit tests, no network
node test/e2e/demo.mjs --mock         # Chrome end-to-end, mock API
GEMINI_API_KEY=... node test/e2e/demo.mjs      # real model
node test/e2e/firefox.mjs --mock      # Firefox (geckodriver)
GEMINI_API_KEY=... node scripts/measure-stance.mjs   # stance measurement, one call
```

### Privacy

Video titles and channel names are sent to Google Gemini for evaluation. Thumbnails are sent only when the vision layer is enabled, which it is not by default.

On the free tier Google may use submitted content to improve its products. Your watch history, account and identity are never sent.

---

## Lisans / License

MIT — bkz. [LICENSE](LICENSE).

---

powered by Omer OZTURK
