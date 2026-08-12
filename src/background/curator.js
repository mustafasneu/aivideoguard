/**
 * KURAL YAZAN katman.
 *
 * LLM burada video yargilamaz; KURAL uretir ve bakimini yapar. Kullanicinin
 * duz cumlesi ("League of Legends ve onu animsatan kisaltmalar") tek basina
 * calisan bir filtre degildir — capalara, ipuclarina ve bir tutum politikasina
 * cevrilmesi gerekir. Bunu elle yazmak iki sebeple yanlis olurdu:
 *
 *   · Kullanicinin alanini bilen taraf model; "LCK", "MSI", "Rift", "Faker"
 *     gibi capalari bizim elle sayabilmemiz sansa kalir ve eksik kalir.
 *   · Kullanici sonradan "sunu da ekle" / "bu yanlis engellendi" dediginde
 *     kural kumesinin yeniden duzenlenmesi gerekir. Elle bakim yapilan
 *     kume kisa surede tutarsizlasir.
 *
 * ONAY ZORUNLU: bu modul hicbir seyi kendisi KAYDETMEZ. Yalnizca oneri
 * uretir; uygulamak kullanicinin onayina baglidir.
 */

import { MODELS } from '../shared/config.js';
import { callGemini } from './net.js';
import {
  makeRule,
  DEFAULT_STANCE_POLICY,
  STANCE_SCOPED_POLICY,
  HOSTILITY_POLICY,
} from '../shared/rules.js';

/**
 * Tutum turu -> politika.
 *
 * Modelden ham politika haritasi istemek yerine tur istiyoruz: uc secenek
 * arasindan secmek, dort alanli bir nesneyi dogru doldurmaktan cok daha
 * guvenilir ve denetlenebilir.
 */
const STANCE_KIND = {
  // Konunun kendisi istenmiyor. Elestiren icerik gecer.
  konu: DEFAULT_STANCE_POLICY,
  // Yasak olan sey konuya OVGU/ozendirme. Tarafsiz aktarim gecer.
  ovgu: STANCE_SCOPED_POLICY,
  // Yasak olan sey konuya HAKARET/asagilama. Konunun kendisi serbest.
  hakaret: HOSTILITY_POLICY,
};

const RULES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    rules: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          anchors: { type: 'ARRAY', items: { type: 'STRING' } },
          literals: { type: 'ARRAY', items: { type: 'STRING' } },
          patterns: { type: 'ARRAY', items: { type: 'STRING' } },
          stanceSensitive: { type: 'BOOLEAN' },
          stanceKind: { type: 'STRING', enum: Object.keys(STANCE_KIND) },
          breadth: { type: 'STRING', enum: ['dar', 'orta', 'genis'] },
          note: { type: 'STRING' },
        },
        required: ['label', 'anchors', 'stanceSensitive', 'stanceKind', 'breadth'],
      },
    },
  },
  required: ['rules'],
};

const EXPAND_PROMPT = [
  'Bir kullanici YouTube akisinda gormek ISTEMEDIGI seyleri kendi cumleleriyle yazdi.',
  'Her cumleyi calisir bir filtre kuralina cevir.',
  '',
  'HER KURAL ICIN URET:',
  '',
  'label    : kisa ad (2-4 kelime).',
  '',
  'anchors  : ANLAM capalari. Bunlar kelime listesi DEGIL, anlam merkezleridir;',
  '           gomu ile karsilastirilacaklar. Kullanicinin yazmadigi ama ayni',
  '           anlam alanina giren ifadeleri de ekle: kisaltmalar, jargon, takma',
  '           adlar, kisi/kurum adlari, o alanin tipik baslik kaliplari.',
  '           Ornek mantik: "League of Legends" denmisse capalara turnuva',
  '           kisaltmalarini, oyun ici terimleri, taninmis oyuncu adlarini,',
  '           sampiyon adlarini ve yayinci jargonunu da koy.',
  '           IKI DILLI URET: kullanicinin akisinda hem Turkce hem Ingilizce',
  '           baslik var. Her olcut icin capalarin bir kismi Turkce, bir kismi',
  '           Ingilizce olsun. Tek dilde birakirsan obur dildeki icerik kacar.',
  '           6-10 capa uret — fazlasi kota yakar, ayirt ediciligi artirmaz.',
  '',
  'literals : yalnizca gectiginde videonun MUTLAKA incelenmesi gereken kesin',
  '           ifadeler. Bunlar engelleme sebebi DEGILDIR, sadece inceleme',
  '           tetikleyicisidir. Yanlis tetiklemesi cok yuksek olacak genel',
  '           kelimeleri koyma. Emin degilsen bos birak.',
  '',
  'stanceSensitive: bu olcutte TUTUM karari degistirir mi?',
  '',
  '           TEK SORUYLA KARAR VER:',
  '           "Bu olcutu ELESTIREN, kotuleyen ya da birakmayi anlatan bir video',
  '            olabilir mi, ve kullanici onu gormek isteyebilir mi?"',
  '',
  '           EVET ise -> true. Olcut bir KONUYU adlandiriyorsa (bir oyun, bir',
  '                       inanc, bir kurum, bir orgut, bir kisi, bir urun)',
  '                       cevap neredeyse her zaman EVET olur. Ornek:',
  '                       "League of Legends" -> oyunu elestiren, "birakstim"',
  '                       diyen video vardir ve kullanici onu gorebilir.',
  '                       Bu olcutlerde stanceSensitive KESINLIKLE true.',
  '',
  '           HAYIR ise -> false. Olcut bir BICIMI/USLUBU tarif ediyorsa',
  '                        (yem baslik kalibi, mide bulandirici goruntu,',
  '                        sansasyonel uslup) tutum diye bir sey yoktur;',
  '                        kalibin kendisi zaten istenmeyen seydir.',
  '',
  '           Emin degilsen true ver. Gereksiz bir LLM cagrisi ucuzdur;',
  '           tutum okunmadan yapilan yanlis engelleme kullaniciyi kaybettirir.',
  '',
  'patterns : YALNIZCA stanceSensitive=false olan kurallar icin. Videoyu tek',
  '           basina engellemeye yetecek kadar KESIN ifadeler. Yanlis pozitifi',
  '           olacak genel kelime koyma; bunlar modele sorulmadan engeller.',
  '           stanceSensitive=true ise bos birak.',
  '',
  'stanceKind: kuralda yasak olan sey NE?',
  '           "konu"    = konunun kendisi istenmiyor. Konuyu ELESTIREN video gecer,',
  '                       ama tarafsiz aktarim da ENGELLENIR.',
  '           "ovgu"    = yasak olan YALNIZCA konuyu oven/ozendiren/masum gosteren',
  '                       icerik. Tarafsiz haber/aktarim GECER.',
  '           "hakaret" = yasak olan, konuya hakaret eden/asagilayan icerik.',
  '                       Konunun kendisi serbesttir.',
  '',
  '           SECIM TESTI: "Kullanici bu konunun KENDISINI, tarafsiz bir',
  '           anlatimla bile olsa, akisinda gormek ister mi?"',
  '             HAYIR -> "konu"  (tarafsiz aktarim da engellenir)',
  '             EVET  -> "ovgu"  (yalnizca oven/ozendiren engellenir)',
  '',
  '           "ovgu"yu YALNIZCA kullanicinin cumlesi yasagi acikca ovguyle',
  '           SINIRLADIGINDA sec — yani konunun kendisi serbest kalmali.',
  '           Ornek: "X\'i oven icerikler" -> ovgu; X hakkinda tarafsiz haber gecer.',
  '',
  '           SIK YAPILAN IKI HATA:',
  '           1) "X iceren VEYA ozendiren" -> bu "konu"dur. "Ozendiren"',
  '              kelimesini gorup "ovgu" secme; kullanici X\'i hic istemiyor.',
  '           2) Bir USLUP/BICIM olcutunde (asparagas haber, sansasyonel',
  '              baslik, mide bulandirici goruntu) "ovgu" secme. Boyle bir',
  '              olcutte "tarafsiz asparagas haber" diye bir sey yoktur —',
  '              usluben kendisi zaten istenmeyen seydir, yani "konu".',
  '',
  'breadth  : kuralin kapsami. "dar" = kesin sinirli konu. "genis" = oznel ve',
  '           sinirsiz olcut. Genis kurallar daha yuksek guven esigi alir.',
  '',
  'note     : kullaniciya gosterilecek tek cumlelik uyari; kural riskliyse',
  '           neyi yanlis engelleyebilecegini soyle. Risk yoksa bos birak.',
  '',
  'KURALLAR:',
  '- Kullanicinin her cumlesi icin BIR kural uret, sirasini koru.',
  '- Cumle birden fazla bagimsiz konu iceriyorsa yine tek kural uret ama',
  '  capalari her iki konuyu da kapsayacak sekilde yaz.',
  '- Uydurma yapma: kullanicinin kastetmedigi bir alani capalara sokma.',
].join('\n');

/** `breadth` -> engellemek icin gereken en dusuk guven. */
const CONFIDENCE_BY_BREADTH = { dar: 0.55, orta: 0.65, genis: 0.8 };

function toRule(raw, description, index) {
  const kind = STANCE_KIND[raw.stanceKind] ? raw.stanceKind : 'konu';
  // Belirsizlikte TUTUM-DUYARLI tarafa dus: gereksiz bir LLM cagrisi,
  // sessizce yanlis engellemekten ucuzdur.
  const stanceSensitive = raw.stanceSensitive !== false;
  return makeRule({
    id: `r${index + 1}`,
    label: String(raw.label || '').slice(0, 60) || `Kural ${index + 1}`,
    description,
    anchors: (raw.anchors || []).map((a) => String(a).trim()).filter(Boolean).slice(0, 30),
    literals: (raw.literals || []).map((a) => String(a).trim()).filter(Boolean).slice(0, 20),
    // Kalip yetkisi yalnizca tutum-duyarsiz kurallarda anlamlidir; duyarli
    // kuralda kalip tasimak, tutum okunmadan engelleme kapisi acardi.
    patterns: stanceSensitive
      ? []
      : (raw.patterns || []).map((a) => String(a).trim()).filter(Boolean).slice(0, 30),
    stanceSensitive,
    stancePolicy: STANCE_KIND[kind],
    minConfidence: CONFIDENCE_BY_BREADTH[raw.breadth] ?? 0.65,
    origin: 'llm',
  });
}

/**
 * Kullanicinin duz cumlelerini kural kumesine cevirir.
 *
 * Donen sey ONERIDIR. Cagiran taraf kullaniciya gosterip onay almadan
 * kaydetmemelidir.
 *
 * @param {string[]} descriptions kullanicinin kendi cumleleri, sirasiyla
 * @returns {Promise<{rules: Array, notes: string[]}>}
 */
export async function expandCriteria(descriptions, settings) {
  const clean = descriptions.map((d) => String(d || '').trim()).filter(Boolean);
  if (clean.length === 0) return { rules: [], notes: [] };

  const model = settings.modelText || MODELS.text;
  const json = await callGemini(
    model,
    'generateContent',
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `${EXPAND_PROMPT}\n\nKULLANICININ CUMLELERI:\n` +
                clean.map((d, i) => `${i + 1}. ${d}`).join('\n'),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: RULES_SCHEMA,
        // Capa uretimi uzun cikti; metin katmanindaki 200 sinirini burada
        // uygulamak kurallari yarida keserdi.
        maxOutputTokens: 4096,
      },
    },
    settings,
  );

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Kural uretilemedi: model cikti vermedi');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Kural uretilemedi: gecersiz JSON');
  }

  const raws = Array.isArray(parsed.rules) ? parsed.rules : [];
  // Model cumle sayisini tutturamayabilir; kullanicinin cumlesi kaybolmasin
  // diye eslesmeyenler bos capayla da olsa kural olarak durur.
  const rules = clean.map((description, i) =>
    toRule(raws[i] || { label: '', anchors: [], stanceKind: 'konu', breadth: 'orta' }, description, i),
  );

  const notes = raws.map((r, i) => (r?.note ? `${i + 1}. ${r.note}` : '')).filter(Boolean);
  return { rules, notes };
}

const AUDIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['ortusme', 'cok-genis', 'eksik', 'celiski'] },
          ruleIds: { type: 'ARRAY', items: { type: 'STRING' } },
          message: { type: 'STRING' },
          suggestion: { type: 'STRING' },
        },
        required: ['kind', 'message'],
      },
    },
  },
  required: ['findings'],
};

/**
 * Kural kumesinin bakimini yapar: ortusen kurallar, akisi yutacak kadar genis
 * olanlar, birbiriyle celisenler ve eksik kalan alanlar.
 *
 * Yine ONERI uretir, degisiklik uygulamaz.
 */
export async function auditRules(rules, settings) {
  if (!rules.length) return [];

  const model = settings.modelText || MODELS.text;
  const summary = rules
    .map(
      (r) =>
        `${r.id} | ${r.label} | kapsam: "${r.description}" | capalar: ${r.anchors.slice(0, 12).join(', ')}` +
        ` | guven esigi: ${r.minConfidence}`,
    )
    .join('\n');

  const json = await callGemini(
    model,
    'generateContent',
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                'Asagida bir YouTube icerik filtresinin kural kumesi var.',
                'Kumeyi denetle ve YALNIZCA gercek sorunlari bildir.',
                '',
                'ARADIKLARIN:',
                '- ortusme  : iki kural ayni icerigi yakaliyor, biri gereksiz.',
                '- cok-genis: kural o kadar genis ki akisin buyuk kismini yutar.',
                '- celiski  : bir kural digerinin gecirdigini engelliyor.',
                '- eksik    : kullanicinin acik niyetine gore bariz bir bosluk var.',
                '',
                'Sorun yoksa bos dizi dondur. Uydurma sorun cikarma.',
                'message ve suggestion Turkce, kisa.',
                '',
                'KURALLAR:',
                summary,
              ].join('\n'),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: AUDIT_SCHEMA,
        maxOutputTokens: 1500,
      },
    },
    settings,
  );

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return [];
  try {
    return JSON.parse(text).findings || [];
  } catch {
    return [];
  }
}

const REVISE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    addAnchors: { type: 'ARRAY', items: { type: 'STRING' } },
    removeAnchors: { type: 'ARRAY', items: { type: 'STRING' } },
    addLiterals: { type: 'ARRAY', items: { type: 'STRING' } },
    minConfidence: { type: 'NUMBER' },
    stanceKind: { type: 'STRING', enum: Object.keys(STANCE_KIND) },
    explanation: { type: 'STRING' },
  },
  required: ['explanation'],
};

/**
 * Kullanici geri bildirimine gore kurali revize eder.
 *
 * Tipik kullanim: kart uzerinde "bu yanlis engellendi" / "bu kacti" denince
 * cagrilir. Donen sey uygulanmis degil, ONERILEN degisikliktir.
 *
 * @param {object} rule revize edilecek kural
 * @param {{videoTitle: string, channel: string, wrongly: 'blocked'|'allowed'}} feedback
 */
export async function reviseRule(rule, feedback, settings) {
  const model = settings.modelText || MODELS.text;
  const json = await callGemini(
    model,
    'generateContent',
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                'Bir icerik filtresi kurali yanlis karar verdi. Kurali duzeltecek',
                'EN KUCUK degisikligi oner. Asiri duzeltme yapma: tek bir ornege',
                'bakip kurali daraltip genisletmek, baska videolarda yeni hatalar uretir.',
                '',
                `KURAL     : ${rule.label}`,
                `KAPSAM    : ${rule.description}`,
                `CAPALAR   : ${rule.anchors.join(', ')}`,
                `GUVEN ESIGI: ${rule.minConfidence}`,
                '',
                `HATA      : bu video ${feedback.wrongly === 'blocked' ? 'YANLISLIKLA ENGELLENDI' : 'KACTI, engellenmeliydi'}`,
                `VIDEO     : ${feedback.videoTitle}`,
                `KANAL     : ${feedback.channel || '(yok)'}`,
                '',
                'explanation alanina degisikligin gerekcesini tek cumleyle yaz.',
              ].join('\n'),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: REVISE_SCHEMA,
        maxOutputTokens: 800,
      },
    },
    settings,
  );

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Revizyon onerisi alinamadi');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Revizyon onerisi gecersiz JSON');
  }

  // Onerilen kuralin ONIZLEMESI — cagiran taraf bunu kullaniciya gosterip
  // onay alacak. Burada hicbir sey kaydedilmez.
  const next = {
    ...rule,
    anchors: [
      ...rule.anchors.filter((a) => !(parsed.removeAnchors || []).includes(a)),
      ...(parsed.addAnchors || []).filter((a) => !rule.anchors.includes(a)),
    ],
    literals: [...rule.literals, ...(parsed.addLiterals || []).filter((a) => !rule.literals.includes(a))],
    minConfidence:
      typeof parsed.minConfidence === 'number'
        ? Math.max(0, Math.min(1, parsed.minConfidence))
        : rule.minConfidence,
    stancePolicy: STANCE_KIND[parsed.stanceKind] || rule.stancePolicy,
  };

  return { next, explanation: parsed.explanation || '', diff: parsed };
}
