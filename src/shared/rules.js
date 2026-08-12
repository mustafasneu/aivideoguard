/**
 * Kural kumesi — filtrenin tek dogruluk kaynagi.
 *
 * NEDEN TEK KONU YETMEDI: onceki surumde tek bir `topic` metni ve duz bir capa
 * listesi vardi. Kullanicinin gercek olcutleri boyle degil:
 *
 *  · Her olcutun kendi capalari var ("LoL" ile "magazin" ayni capa havuzunda
 *    olursa birbirlerini kirletirler).
 *  · Her olcutun kendi TUTUM politikasi var. "League of Legends" olcutunde
 *    oyunu elestiren video GECMELI; "dine hakaret" olcutunde ise engellenmesi
 *    gereken sey zaten elestiren/hakaret eden taraftir. Tek global anahtar
 *    bu ikisini ayni anda dogru yapamaz.
 *  · Bazi olcutler dar ve kesin, bazilari genis ve hatali ("normal bir insanin
 *    rahatsiz olacagi her sey"). Genis olanin engellemek icin daha yuksek
 *    guven istemesi gerekir, yoksa akisin yarisini yutar.
 */

/** Bir tutum karsisinda ne yapilacagi. */
export const ACTION = {
  BLOCK: 'block',
  ALLOW: 'allow',
};

/**
 * Varsayilan tutum politikasi.
 *
 * Kullanicinin acik kurali: "kelime gecse bile video o konuyu elestiriyorsa
 * engelleme". Bu yuzden `critical` varsayilan olarak GECER.
 */
export const DEFAULT_STANCE_POLICY = {
  destekleyici: ACTION.BLOCK,
  notr: ACTION.BLOCK,
  elestirel: ACTION.ALLOW,
};

/**
 * Tutumun olcutun TANIMINA girdigi durum.
 *
 * "Dine hakaret", "terör örgütünü öven", "ateizmi özendiren" gibi olcutlerde
 * yasaklanan sey konunun kendisi degil, konuya karsi alinan TUTUMDUR. Boyle
 * olcutlerde tarafsiz aktarim gecmeli, savunan/oven engellenmelidir.
 */
export const STANCE_SCOPED_POLICY = {
  destekleyici: ACTION.BLOCK,
  notr: ACTION.ALLOW,
  elestirel: ACTION.ALLOW,
};

/**
 * Hakaret olcutu: engellenecek olan ELESTIREL/asagilayici taraftir.
 * Konunun kendisi (din, kutsal degerler) engellenmez.
 */
export const HOSTILITY_POLICY = {
  destekleyici: ACTION.ALLOW,
  notr: ACTION.ALLOW,
  elestirel: ACTION.BLOCK,
};

/**
 * ONCE DETERMINISTIK, SONRA LLM.
 *
 * Her ölcut LLM gerektirmez. "Frikik verdi", "gogusleri muhtesem" gibi yem
 * baslik kaliplarinda tutum nuansi YOKTUR — kalibin kendisi zaten istenmeyen
 * seydir. Boyle bir olcutte her video icin modele sormak hem bosuna token
 * hem bosuna gecikmedir.
 *
 * Buna karsilik "League of Legends" olcutunde oyunu ELESTIREN video gecmeli;
 * orada karar ancak tutum okunarak verilebilir, yani LLM sart.
 *
 * `stanceSensitive` bu ayrimi tasir:
 *   false -> kesin eslesme TEK BASINA karar verir, LLM'e hic gidilmez
 *   true  -> eslesme yalnizca ADAY yapar, karari baglamsal katman verir
 */
export function makeRule(patch = {}) {
  return {
    id: patch.id || `r${Math.random().toString(36).slice(2, 9)}`,
    enabled: patch.enabled !== false,
    // Tutum bu olcutte karari degistirir mi?
    stanceSensitive: patch.stanceSensitive !== false,
    // Deterministik yakalama kaliplari (normalize edilmis substring).
    // `literals` ile ayni bicimde eslesir ama `stanceSensitive: false` olan
    // kurallarda DOGRUDAN engelleme yetkisi vardir.
    patterns: Array.isArray(patch.patterns) ? patch.patterns : [],
    // Kullanicinin kendi cumlesi — LLM'e bunu veriyoruz, capalari degil.
    // Kullanici kendi yazdigini gormeden kurali duzeltemez.
    description: patch.description || '',
    label: patch.label || '',
    // LLM tarafindan uretilir; kullanici duzenleyebilir.
    anchors: Array.isArray(patch.anchors) ? patch.anchors : [],
    // Hic LLM'e sorulmadan "aday" sayilacak ifadeler. Karar DEGIL, ipucu.
    literals: Array.isArray(patch.literals) ? patch.literals : [],
    stancePolicy: { ...DEFAULT_STANCE_POLICY, ...(patch.stancePolicy || {}) },
    // Genis/riskli olcutler daha yuksek guven ister.
    minConfidence: typeof patch.minConfidence === 'number' ? patch.minConfidence : 0.6,
    // Kullanicinin kendi yazdigi mi, LLM onerisi mi? Onay akisinda gerekli.
    origin: patch.origin || 'user',
  };
}

/** Kural kumesini dogrular; bozuk kayitlari atar, eksikleri tamamlar. */
export function normalizeRules(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const rule = makeRule(r);
    // Ne aciklama ne capa varsa kural degil, gurultu
    if (!rule.description.trim() && rule.anchors.length === 0 && rule.literals.length === 0) {
      continue;
    }
    if (seen.has(rule.id)) rule.id = `${rule.id}x`;
    seen.add(rule.id);
    out.push(rule);
  }
  return out;
}

/** Anlamsal katmanin gomecegi capalar — hangi kuraldan geldigi korunur. */
export function allAnchors(rules) {
  const out = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    for (const text of r.anchors) {
      if (text && text.trim()) out.push({ text: text.trim(), ruleId: r.id });
    }
  }
  return out;
}

/**
 * Deterministik kaliplar — kural kimligiyle birlikte.
 *
 * `literals`den farki: bu kaliplar TUTUM-DUYARSIZ kurallarda tek basina
 * karar verebilir. Ayri tutulmalari sart, cunku ayni listeyi iki farkli
 * yetkiyle kullanmak sessiz bir yanlis engelleme kaynagi olurdu.
 */
export function allPatterns(rules) {
  const out = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    for (const text of r.patterns) {
      if (text && text.trim()) out.push({ text: text.trim(), ruleId: r.id, rule: r });
    }
  }
  return out;
}

/** Literal ipuclari — kural kimligiyle birlikte. */
export function allLiterals(rules) {
  const out = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    for (const text of r.literals) {
      if (text && text.trim()) out.push({ text: text.trim(), ruleId: r.id });
    }
  }
  return out;
}

/**
 * Bir kuralin verdigi karar.
 *
 * `related` false ise kural hic devreye girmez. Guven, kuralin kendi
 * esiginin altindaysa da engellenmez — genis olcutlerin akisi yutmasini
 * engelleyen fren budur.
 */
export function ruleVerdict(rule, judgement) {
  if (!judgement?.related) return ACTION.ALLOW;
  if (judgement.confidence < rule.minConfidence) return ACTION.ALLOW;
  const action = rule.stancePolicy[judgement.stance];
  return action === ACTION.BLOCK ? ACTION.BLOCK : ACTION.ALLOW;
}

/**
 * Yargiyi ESLESEN KURALIN politikasina gore karara cevirir.
 *
 * Tasariminin can damari: ayni tutum, kurala gore farkli sonuc verir.
 *   · "League of Legends" kuralinda ELESTIREL video GECER
 *   · "Dine hakaret" kuralinda ELESTIREL olan tam da engellenecek seydir
 *   · "Teror orgutunu ovme" kuralinda TARAFSIZ haber gecer, oven engellenir
 *
 * SAF fonksiyon — tarayici API'sine bagli degil, dogrudan test edilebilir.
 * Karar hattinin en kritik parcasi burada durmali ki testi mumkun olsun.
 */
export function applyRules(judgement, rules) {
  if (!judgement?.related) return { verdict: ACTION.ALLOW, rule: null };

  const rule = rules.find((r) => r.id === judgement.ruleId);
  if (!rule) {
    // Model eslesen kurali soyleyemedi. Kural bilinmeden politika secilemez;
    // "engelle" demek keyfi olurdu. Gecirip iz birakiyoruz — sessizce yanlis
    // engellemekten iyidir.
    return { verdict: ACTION.ALLOW, rule: null };
  }

  return { verdict: ruleVerdict(rule, judgement), rule };
}

/**
 * ANAHTARSIZ mod karari — hicbir API cagrisi olmadan.
 *
 * Kullanicinin API anahtari yoksa anlamsal ve baglamsal katmanlar calisamaz.
 * Eklentinin bu durumda ise yaramaz hale gelmesi kabul edilemez: kurulan ama
 * calismayan bir filtre, hic kurulmamis gibidir.
 *
 * Bu kipte CAPALAR birebir eslestirilir. Capalar zaten dogru terimlerdir
 * ("LCK", "Riot Games", "summoner rift"); anahtarsiz kullanim icin ayrica
 * kelime listesi tutmak ayni veriyi iki yerde tutmak olurdu.
 *
 * Tutum okunamaz — model yok. Ama kullanicinin "elestiren video gecsin"
 * kurali burada da korunur: baslikta elestiri isareti varsa engellenmez.
 * Model olmadan yapilabilecek en iyi yaklasim budur ve sessizce yanlis
 * engellemekten iyidir.
 */
export function offlineDecision(text, rules, matcher) {
  if (hasCriticalMarker(text)) return null;

  for (const r of rules) {
    if (!r.enabled) continue;
    for (const term of [...r.patterns, ...r.anchors]) {
      if (term && term.trim() && matcher(text, term)) {
        return { text: term, ruleId: r.id, rule: r };
      }
    }
  }
  return null;
}

/**
 * Deterministik kalip karari.
 *
 * ONCE KURAL, SONRA LLM: tutum-duyarsiz bir olcutte kalip eslesmesi TEK BASINA
 * engeller ve modele hic gidilmez. Tutum-duyarli olcutte bu yol KAPALIDIR —
 * orada eslesme yalnizca aday yapar.
 *
 * @returns eslesen kayit ya da null
 */
export function patternDecision(text, rules, matcher) {
  // EMNIYET KEMERI: kalip eslesse bile baslikta ELESTIRI isareti varsa
  // deterministik katman karar VERMEZ, baglamsal katmana devreder.
  //
  // Neden kod duzeyinde: `stanceSensitive` bayragini kural uretici LLM
  // koyuyor ve YANLIS koyabiliyor. Olculdu — "League of Legends" olcutu bir
  // kez tutum-duyarsiz isaretlendi ve "League of Legends artik eglenceli
  // degil, neden biraktim" videosu tutum hic okunmadan engellendi. Bu,
  // kullanicinin en acik kuralinin ("kelime gecse bile elestiren video
  // gecsin") cignenmesiydi.
  //
  // Bayragi duzeltmek yeterli degil: bir dahaki kural uretiminde model yine
  // yanlis isaretleyebilir. Bu kontrol, o hatanin kullaniciya yansimasini
  // model ne derse desin engeller. Maliyeti yok — yalnizca supheli baslikta
  // bir LLM cagrisi eklenir.
  if (hasCriticalMarker(text)) return null;

  // Kalip tuttuysa KARAR BURADA verilir — kural hangi olcut olursa olsun.
  //
  // Onceki surum bunu yalnizca `stanceSensitive: false` kurallara aciyordu ve
  // tasarimin onceligini tersine ceviriyordu: "League of Legends" kalibi
  // tutan bir video, kalip apacik oldugu halde LLM'e gidiyordu. Oysa amac
  // tam tersi — once kural, kural YETMEZSE LLM.
  //
  // Tutum korumasi bu yolu zaten guvenli kiliyor: elestiri isareti tasiyan
  // baslik yukarida elenir ve baglamsal katmana devredilir. Kalanlar, kalibin
  // apacik yakaladigi videolardir; onlari modele sormak hem bosuna maliyet
  // hem bosuna gecikmedir.
  for (const p of allPatterns(rules)) {
    if (matcher(text, p.text)) return p;
  }
  return null;
}

/**
 * Baslikta elestiri/birakma/pismanlik isareti var mi?
 *
 * Genis olmasi KASITLI: yanlis pozitifin bedeli yalnizca bir LLM cagrisi,
 * yanlis negatifin bedeli kullanicinin gormek istedigi videonun sessizce
 * gizlenmesi. Iki hata esit degil.
 */
export function hasCriticalMarker(text) {
  const t = (text || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g');

  return CRITICAL_MARKERS.some((m) => t.includes(m));
}

/** Turkce + Ingilizce elestiri/vazgecme belirtecleri. */
const CRITICAL_MARKERS = [
  // Turkce
  'biraktim', 'birakiyorum', 'neden biraktim', 'sildim', 'pisman',
  'artik oynamiyorum', 'artik izlemiyorum', 'berbat', 'rezalet',
  'begenmedim', 'elestiri', 'elestiriyorum', 'kotu oldu', 'bozdular',
  'uzak durun', 'tavsiye etmiyorum', 'nefret ediyorum', 'zarari',
  // Ingilizce
  'quit', 'stopped playing', 'why i left', 'uninstall', 'worst',
  'hate', 'ruined', 'is dead', 'dont play', "don't play", 'avoid',
  'regret', 'disappointed', 'critique', 'criticism',
];
