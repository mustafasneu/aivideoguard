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

export const DEFAULTS = {
  enabled: true,
  apiKey: '',
  // Bos = Google'in resmi adresi. Kurumsal gateway/proxy icin degistirilebilir.
  apiEndpoint: '',

  // --- Anlamsal katman: kullanicinin dogal dille yazdigi konu ---
  topic: '',

  // --- Anlamsal capalar: her satir ayri bir anlam capasi (kelime eslesmesi DEGIL) ---
  anchors: '',

  // --- Literal kisayollar: normalize substring eslesmesi -> LLM'e hic sorma ---
  hardBlock: '',

  // --- Kanal listeleri ---
  channelBlock: '',
  channelAllow: '',

  // --- Esikler (kosinus benzerligi, [-1, 1]) ---
  //  score >= tBlock          -> anlamsal katman tek basina engeller
  //  tAsk <= score < tBlock   -> LLM'e sorulur
  //  score <  tAsk            -> gecer, LLM'e sorulmaz
  tBlock: 0.74,
  tAsk: 0.42,

  // LLM metin katmani bu guvenin altinda kalirsa gorsel katmana yukselir
  visionEscalateBelow: 0.75,

  // --- Katman anahtarlari ---
  useSemantic: true,
  useTextLlm: true,
  useVisionLlm: true,

  // --- Baglam katmani ---
  useChannelMemory: true,
  // Bir kanal icin karar verilmis video sayisi bu esigi gectiginde
  // kanal itibari baglamsal delil olarak kullanilir
  channelMemoryMinSamples: 4,
  // Kanalin engellenme orani bu esigi gecerse anlamsal skora katki eklenir
  channelMemoryBlockRatio: 0.6,
  // Kanal itibarinin anlamsal skora ekledigi en fazla katki
  channelMemoryBoost: 0.08,

  // --- Hata politikasi: API hatasi / kota / ag sorununda ne yapilsin ---
  // 'show' = icerigi goster (varsayilan), 'hide' = icerigi gizle
  onError: 'show',

  // --- Maliyet sinirlari ---
  maxRequestsPerMinute: 60,
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
export const EMBED_RELEVANT_KEYS = ['topic', 'anchors', 'modelEmbedding'];

/** Kullanicinin gorunur davranisini etkileyen alanlar — degisince onbellek gecersizlesir. */
export const CACHE_RELEVANT_KEYS = [
  ...EMBED_RELEVANT_KEYS,
  'hardBlock',
  'channelBlock',
  'channelAllow',
  'tBlock',
  'tAsk',
  'visionEscalateBelow',
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
