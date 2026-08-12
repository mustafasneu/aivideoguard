/**
 * Tek dogruluk kaynagi: varsayilan ayarlar + esik degerleri.
 *
 * ESIKLER KALIBRE EDILMEMISTIR. Buradaki sayilar makul baslangic noktalaridir,
 * dogrulanmis degerler degil. Popup'taki "Kalibrasyon" paneli o an ekranda olan
 * videolarin gercek skorlarini gosterir; esikler oradaki dagilima bakilarak
 * kullanici tarafindan ayarlanmalidir.
 */

export const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

export const MODELS = {
  embedding: 'gemini-embedding-001',
  text: 'gemini-flash-lite-latest',
  vision: 'gemini-flash-latest',
};

export const EMBED_DIM = 768;

/**
 * Arka plan kulliyati — anizotropi merkezini hesaplamak icin.
 *
 * Bu cumleler hicbir konuya ait degildir; ortak yonleri yalnizca "kisa Turkce
 * video basligi" olmalaridir. Ortalamalari alindiginda tam olarak bu ortak
 * bileseni temsil eden bir vektor cikar. Her gomuden bu vektor cikarilinca
 * geriye metne OZGU yon kalir.
 *
 * Genis ve dengeli olmalidir: tek bir alana kayarsa (ornegin hepsi teknoloji)
 * merkez o alani da siler ve o alan yapay olarak dusuk skor alir.
 *
 * IKI DILLI OLMAK ZORUNDA: YouTube akisinda hem Turkce hem Ingilizce baslik
 * bulunur ve bu iki dil gomu uzayinda ayri bolgelere duser. Merkez yalnizca
 * Turkce metinlerden hesaplansaydi, Ingilizce basliklardan cikarilan yon
 * onlarin kendi ortak bileseni OLMAZDI; merkezleme duzeltmek yerine bozardi
 * ve Ingilizce icerik sistematik olarak yanlis skor alirdi.
 */
export const BACKGROUND_TEXTS = [
  // Turkce
  'Bu videoda size bir konuyu anlatıyorum',
  'Yeni bölümde neler var, birlikte bakalım',
  'Adım adım nasıl yapılır anlattım',
  'Haftanın öne çıkan gelişmeleri',
  'İlk kez deneyimledim ve şaşırdım',
  'Merak edilen soruları yanıtladım',
  'Kısa bir tanıtım ve değerlendirme',
  'Başlangıç seviyesi için rehber',
  'Karşılaştırma yaptım, sonuçlar şaşırtıcı',
  'Kamera arkası ve günlük kesitler',
  'Uzman görüşü ve yorumlar',
  'Canlı yayın tekrarı ve özet',
  // Ingilizce
  'In this video I walk you through the topic',
  'What is new in this episode, let us take a look',
  'Step by step guide on how to do it',
  'Highlights of the week you might have missed',
  'I tried it for the first time and was surprised',
  'Answering the most asked questions',
  'A short introduction and review',
  'A beginner friendly guide to get started',
  'I compared them and the results were surprising',
  'Behind the scenes and daily moments',
  'Expert opinion and commentary',
  'Live stream replay and recap',
];

export const DEFAULTS = {
  enabled: true,
  apiKey: '',
  // Bos = Google'in resmi adresi. Kurumsal gateway/proxy icin degistirilebilir.
  apiEndpoint: '',

  // --- Kural kumesi (bkz. shared/rules.js) ---
  //
  // Kullanicinin her olcutu AYRI bir kuraldir: kendi capalari, kendi tutum
  // politikasi ve kendi guven esigiyle. Onceki tek `topic` + duz `anchors`
  // semasi bunu tasiyamiyordu — farkli olcutlerin capalari ayni havuzda
  // birbirini kirletiyor, ve "LoL'u elestiren gecsin" ile "dine hakaret eden
  // engellensin" ayni anda dogru kurulamiyordu.
  rules: [],

  // Kullanicinin duz cumleleri — kurallarin kaynagi. LLM bunlari capalara
  // cevirir; kullanici kendi yazdigini gormeden kurali duzeltemez diye saklanir.
  criteriaText: '',

  // --- Kanal listeleri ---
  channelBlock: '',
  channelAllow: '',

  // --- Aday esigi (merkezlenmis kosinus) ---
  //
  // ANLAMSAL KATMAN ARTIK KARAR VERMEZ, YALNIZCA ADAY SECER.
  //
  // Eski tasarimda `tBlock` ustundeki skor tek basina engelliyordu. Gercek
  // gomuyle olculdugunde bunun tutmadigi gorüldü: skorlar dar bir banda
  // sikisiyor ve siralama bozuluyor (spor basligi, siyaset basligindan yuksek
  // skor alabiliyor). Mutlak esikle karar vermek bu yuzden birakildi.
  //
  //  score >= tCandidate -> aday, baglamsal LLM katmanina gider
  //  score <  tCandidate -> gecer (ucuz eleme)
  //
  // Esik YUKSEK DUYARLILIK icin secilir: kacirmamak onemli, yanlis aday
  // maliyeti dusuk cunku hassasiyeti LLM veriyor.
  tCandidate: 0.25,

  // LLM metin katmani bu guvenin altinda kalirsa gorsel katmana yukselir
  visionEscalateBelow: 0.75,

  // NOT: `blockCritical` / `blockNeutral` KALDIRILDI. Tutum politikasi artik
  // kural basinadir (shared/rules.js stancePolicy). Tek global anahtar
  // "LoL'u elestiren gecsin" ile "dine hakaret edeni engelle"yi ayni anda
  // dogru yapamiyordu. Alanlar arayuzde duruyor ama hicbir yerde
  // okunmuyordu — yaniltici ayar, eksik ayardan kotudur.

  // --- Gorsel katmanin kapsami ---
  // 'candidates' = yalnizca aday videolarda kapaga bakilir (ucuz)
  // 'all'        = metin hic ipucu vermese de her videonun kapagina bakilir;
  //                logo/sembol yakalama en genis olur ama maliyet ~10 kat artar
  visionScope: 'candidates',

  // --- Katman anahtarlari ---
  useSemantic: true,
  useTextLlm: true,
  // KAPALI — kullanici kapak/logo katmanini simdilik ertelemis durumda.
  // Kod yolu duruyor ve calisir halde; acildiginda metin katmani kararsiz
  // kaldiginda kapaga bakar. Olculdu: acikken yanlis engelleme uretiyor
  // (ilgisiz bir yemek videosu kapaktan engellendi), yani acilmadan once
  // kendi dogrulugunun olculmesi gerekiyor.
  useVisionLlm: false,

  // --- Baglam katmani ---
  useChannelMemory: true,
  // Bir kanal icin karar verilmis video sayisi bu esigi gectiginde
  // kanal itibari baglamsal delil olarak kullanilir
  channelMemoryMinSamples: 4,
  // Kanalin engellenme orani bu esigi gecerse anlamsal skora katki eklenir
  channelMemoryBlockRatio: 0.6,
  // Kanal itibarinin anlamsal skora ekledigi en fazla katki
  channelMemoryBoost: 0.08,

  // --- Kanal hafizasinin TEK BASINA karar verme esigi ---
  // Katki vermek ile karar vermek ayri yetkilerdir; ikincisi cok daha yuksek
  // delil ister. Yalnizca tutum-duyarsiz olcutlerde ve yalnizca kanal zaten
  // bir olcute takilmisken uygulanir.
  channelMemoryDecideMinSamples: 12,
  channelMemoryDecideRatio: 0.9,

  // --- Hata politikasi: API hatasi / kota / ag sorununda ne yapilsin ---
  // 'show' = icerigi goster (varsayilan), 'hide' = icerigi gizle
  onError: 'show',

  // --- Maliyet sinirlari ---
  //
  // ONCEKI DEGER 60'TI VE YANLISTI: ucretsiz kademenin dakikalik istek siniri
  // bunun cok altinda. Olculdu — bir partide arka arkaya cagri yapildiginda
  // API 429 donuyor, karar hatti hataya dusuyor ve hata politikasi geregi
  // TUM videolar geciyordu. Yani filtre sessizce kapaniyordu.
  //
  // Toplu yargilama sayesinde 60 kartlik bir kaydirma zaten birkac cagriya
  // iniyor; dusuk sinir gecikme yaratmiyor.
  // Olculdu: ucretsiz kademede gomu kotasi dakikada 100 istek, gunde 1000.
  // Toplu gomudeki HER METIN ayri istek sayilir, dolayisiyla bu sinir metin
  // basina uygulanir. 80 guvenli pay birakir.
  maxRequestsPerMinute: 80,
  dailyLlmBudget: 500,

  // --- Gizlilik ---
  // Kucuk resimler Google'a gonderilir. Kapatilirsa gorsel katman devre disi kalir.
  allowThumbnailUpload: true,

  // --- Gelistirme ---
  debug: false,
};

/**
 * Capa gomulerini belirleyen alanlar.
 *
 * `modelEmbedding` BURADA OLMAK ZORUNDA: farkli gomu modelleri farkli vektor
 * uzaylari uretir. Model degistiginde eski capa vektorleri saklanip yeni video
 * vektorleriyle karsilastirilirsa kosinus skoru tamamen anlamsizlasir.
 */
export const EMBED_RELEVANT_KEYS = ['rulesAnchors', 'modelEmbedding'];

/** Kullanicinin gorunur davranisini etkileyen alanlar — degisince onbellek gecersizlesir. */
export const CACHE_RELEVANT_KEYS = [
  ...EMBED_RELEVANT_KEYS,
  // Tum kural kumesi: capalarin yani sira tutum politikasi ve guven esikleri
  // de karari degistirir, dolayisiyla onbellegi gecersizlemelidir.
  'rules',
  'channelBlock',
  'channelAllow',
  'tCandidate',
  'visionEscalateBelow',
  'visionScope',
  'useSemantic',
  'useTextLlm',
  'useVisionLlm',
  'useChannelMemory',
  'allowThumbnailUpload',
  'modelText',
  'modelVision',
];

export const VERDICT = {
  ALLOW: 'allow',
  BLOCK: 'block',
  ERROR: 'error',
};

/** Karari hangi katman verdi — hem hata ayiklama hem kalibrasyon icin. */
export const LAYER = {
  CHANNEL_ALLOW: 'channel-allow',
  CHANNEL_BLOCK: 'channel-block',
  LITERAL: 'literal',
  SEMANTIC: 'semantic',
  TEXT_LLM: 'text-llm',
  VISION_LLM: 'vision-llm',
  CACHE: 'cache',
  ERROR_POLICY: 'error-policy',
  DISABLED: 'disabled',
};
