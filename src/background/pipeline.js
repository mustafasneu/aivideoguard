/**
 * Karar hatti.
 *
 *   0. Onbellek        — daha once karar verildiyse hic hesaplama yok
 *   1. Kanal listeleri — kullanicinin KESIN iradesi, hicbir katman tartismaz
 *   2. ADAY ELEME      — literal ipucu VEYA anlamsal yakinlik; hicbiri yoksa gecir
 *   3. BAGLAMSAL metin — konu iliskisi + TUTUM
 *   4. BAGLAMSAL gorsel— kapaktaki logo/sembol/yuz
 *   5. KARAR           — iliski VE tutuma gore
 *
 * TASARIM: anlamsal katman ve literal eslesme KARAR VERMEZ, yalnizca aday secer.
 *
 * Iki sebep:
 *
 *  a) Kelime/konu eslesmesi tek basina engelleme sebebi degildir. Kullanici
 *     kacindigi konuyu ELESTIREN videoyu gormek isteyebilir; basligta konunun
 *     adinin gecmesi bunu ayirt etmez. Ayirt eden sey tutumdur, onu da ancak
 *     baglamsal katman okur.
 *
 *  b) Mutlak kosinus esigiyle karar vermek olculdu ve tutmadi: gercek gomu
 *     modelinde skorlar dar bir banda sikisiyor ve siralama bozulabiliyor.
 *     Anlamsal katmanin isi artik KACIRMAMAK (yuksek duyarlilik); hassasiyeti
 *     LLM veriyor.
 *
 * Maliyet buradan yonetilir: aday olmayan video hic LLM gormez.
 */

import { VERDICT, LAYER } from '../shared/config.js';
import { videoText, channelMatches, literalMatches, parseList, normalize } from '../shared/text.js';
import { bestMatch, dot, center } from '../shared/vector.js';
import { configHash, embedHash, channelBoost } from '../shared/scoring.js';
// NOT: ACTION ve VERDICT ayni dize degerlerini kullanir ('block'/'allow'),
// bu yuzden ruleVerdict ciktisi dogrudan verdict olarak kullanilabilir.
import { normalizeRules, allLiterals, ruleVerdict, applyRules, patternDecision } from '../shared/rules.js';
import { embed, getAnchors } from './embedder.js';
import { judgeText, judgeTextBatch, judgeVision, fetchThumbnail } from './llm.js';
import { isAllowedThumbnail } from '../shared/thumbnail.js';
import {
  getVerdict,
  putVerdict as _putVerdict,
  getChannelProfile,
  recordChannelOutcome as _recordChannelOutcome,
  bumpStats as _bumpStats,
} from './cache.js';
import { BudgetError } from './net.js';

function result(verdict, layer, extra = {}) {
  return { verdict, layer, ...extra };
}

export async function evaluate(item, settings, opts = {}) {
  const hash = configHash(settings);

  // Kalibrasyon modu: karar hicbir yere yazilmaz, sadece skor ve katman dondurulur.
  const dry = opts.dryRun === true;
  const putVerdict = dry ? async () => {} : _putVerdict;
  const recordChannelOutcome = dry ? async () => {} : _recordChannelOutcome;
  const bumpStats = dry ? async () => {} : _bumpStats;

  if (!settings.enabled && !dry) return result(VERDICT.ALLOW, LAYER.DISABLED);

  // Etkin kurallar olmadan baglamsal katman calisamaz: LLM'e "olcut yok"
  // diyerek her video icin cagri gitmemeli, hem anlamsiz hem pahali.
  const rules = normalizeRules(settings.rules).filter((r) => r.enabled);
  const hasCriteria = rules.length > 0 || parseList(settings.channelBlock).length > 0;
  if (!hasCriteria) return result(VERDICT.ALLOW, LAYER.DISABLED);

  /* --- 0. Onbellek ------------------------------------------------ */
  const cached = dry ? null : await getVerdict(item.videoId, hash);
  if (cached) {
    // Gerekce de onbellekten geri verilir; aksi halde ikinci goruntulemede
    // kart "Gizlendi" der ama nedenini soyleyemezdi.
    return result(cached.v, LAYER.CACHE, {
      score: cached.s,
      cachedFrom: cached.l,
      reason: cached.r,
      rule: cached.k,
    });
  }

  const channelKey = normalize(item.channel);
  const text = videoText(item);

  /* --- 1/2. Kanal listeleri --------------------------------------- */
  // NOT: bu kararlar kanal hafizasina YAZILMAZ. Yazilsaydi liste kendi
  // istatistigini besler ve itibar sinyali anlamsizlasirdi.
  const allowHit = channelMatches(item.channel, parseList(settings.channelAllow));
  if (allowHit) {
    await putVerdict(item.videoId, hash, VERDICT.ALLOW, 0, LAYER.CHANNEL_ALLOW);
    return result(VERDICT.ALLOW, LAYER.CHANNEL_ALLOW, { matched: allowHit });
  }

  const blockHit = channelMatches(item.channel, parseList(settings.channelBlock));
  if (blockHit) {
    await putVerdict(item.videoId, hash, VERDICT.BLOCK, 1, LAYER.CHANNEL_BLOCK, `kanal: ${blockHit}`);
    await bumpStats({ blocked: 1 });
    return result(VERDICT.BLOCK, LAYER.CHANNEL_BLOCK, { matched: blockHit });
  }

  /* --- 2. Aday eleme ---------------------------------------------- */
  // Literal eslesme ARTIK ENGELLEMEZ. Kullanicinin yazdigi ifade basligta
  // gecse bile video o ifadeyi elestiriyor olabilir; bunu ancak baglamsal
  // katman ayirt eder. Literal eslesme buradan sonra sadece "bu videoya
  // dikkatli bak" sinyalidir.
  const literals = allLiterals(rules);
  const literalEntry = literals.find((l) => literalMatches(text, [l.text]));
  const literalHit = literalEntry?.text || null;

  let semanticScore = null;
  let matchedAnchor = null;
  const profile = await getChannelProfile(channelKey);
  const boost = channelBoost(profile, settings);

  // Anlamsal katmanin yakaladigi kurallar — LLM'e yalnizca bunlari sormak
  // istemi kisaltir ve modeli alakasiz olcutlerle mesgul etmez.
  let hintedRuleIds = new Set();

  if (settings.useSemantic) {
    // Capalar AYRI parmak izine baglidir: yalnizca esik degistiginde
    // yeniden gomdurmek gereksiz maliyet olurdu.
    const { anchors, bg } = await getAnchors(settings, embedHash(settings));
    if (anchors.length) {
      // Merkezleme karsilastirmanin HER IKI tarafina uygulanir; yalnizca bir
      // tarafa uygulanirsa vektorler farkli uzaylarda kalir ve kosinus
      // anlamini yitirir.
      const vec = center(await embed(text, settings), bg);
      const cAnchors = anchors.map((a) => (a?.vec ? { ...a, vec: center(a.vec, bg) } : a));

      const { score: sAnchor, anchor } = bestMatch(vec, cAnchors);
      semanticScore = Math.min(1, sAnchor + boost);
      matchedAnchor = anchor?.text || null;

      // Esigi gecen HER kural ipucu sayilir, yalnizca en iyisi degil: iki
      // farkli olcut ayni videoda gecerli olabilir.
      for (const a of cAnchors) {
        if (a?.vec && dot(vec, a.vec) + boost >= settings.tCandidate) hintedRuleIds.add(a.ruleId);
      }
    }
  }

  // Aday olmanin uc yolu: literal ipucu, anlamsal yakinlik, ya da kullanicinin
  // "her kapaga bak" tercihi.
  const semanticHit = semanticScore != null && semanticScore >= settings.tCandidate;
  const isCandidate = Boolean(literalHit) || semanticHit || settings.visionScope === 'all';

  if (!isCandidate) {
    await putVerdict(item.videoId, hash, VERDICT.ALLOW, semanticScore, LAYER.SEMANTIC);
    await recordChannelOutcome(channelKey, false);
    await bumpStats({ allowed: 1 });
    return result(VERDICT.ALLOW, LAYER.SEMANTIC, { score: semanticScore, boost });
  }

  /* --- 3. Baglamsal metin katmani --------------------------------- */
  // Literal ipucu veren kural da sorulacaklar arasina girer; anlamsal katman
  // onu kacirmis olabilir.
  if (literalEntry) hintedRuleIds.add(literalEntry.ruleId);

  // Ipucu veren kural yoksa (ornegin visionScope='all' ile gelindiyse) tum
  // kurallar sorulur — aksi halde model neye bakacagini bilemez.
  const askedRules = hintedRuleIds.size > 0 ? rules.filter((r) => hintedRuleIds.has(r.id)) : rules;

  const ctx = {
    rules: askedRules,
    title: item.title,
    channel: item.channel,
    durationText: item.durationText,
    surface: item.surface,
    badges: item.badges,
    channelProfile: profile,
    literalHit,
  };

  // Baglamsal katman kapaliysa tutum okunamaz. Bu durumda literal ifade
  // kullanicinin elindeki TEK acik talimattir; ona uyulur.
  if (!settings.useTextLlm) {
    if (literalHit) {
      await putVerdict(item.videoId, hash, VERDICT.BLOCK, 1, LAYER.LITERAL, `kural: ${literalHit}`);
      await recordChannelOutcome(channelKey, true);
      await bumpStats({ blocked: 1 });
      return result(VERDICT.BLOCK, LAYER.LITERAL, { matched: literalHit });
    }
    await bumpStats({ allowed: 1 });
    return result(VERDICT.ALLOW, LAYER.SEMANTIC, { score: semanticScore });
  }

  const textVerdict = await judgeText(ctx, settings);

  /* --- 4. Baglamsal gorsel katmani -------------------------------- */
  // Kapaga bakmanin iki sebebi olur: metin katmani kararsiz kaldi, ya da
  // kullanici her videonun kapagina bakilmasini istedi (logo/sembol
  // yakalamanin en genis hali).
  const textUnsure = textVerdict.confidence < settings.visionEscalateBelow;
  const wantVision = textUnsure || settings.visionScope === 'all';
  const canUseVision =
    settings.useVisionLlm &&
    wantVision &&
    settings.allowThumbnailUpload &&
    item.thumbnail &&
    // Alan adi burada da elenir: gecersiz adres icin bosuna cagri kurulmasin
    isAllowedThumbnail(item.thumbnail);

  if (canUseVision) {
    // Kapak alinamazsa gorsel katman DUSER, karar hatti coker degil: elimizde
    // zaten metin katmaninin kararsiz da olsa bir yargisi var.
    let vv = null;
    try {
      const { base64, mimeType } = await fetchThumbnail(item.thumbnail);
      vv = await judgeVision(ctx, base64, mimeType, settings);
    } catch (err) {
      vv = null;
      if (settings.debug) console.warn('[aivg] gorsel katman atlandi:', err.message);
    }

    if (vv) {
      const { verdict: v, rule } = applyRules(vv, rules);
      const why = vv.visualCue ? `${vv.reason} — kapakta: ${vv.visualCue}` : vv.reason;
      await putVerdict(item.videoId, hash, v, semanticScore, LAYER.VISION_LLM, why, rule?.label);
      await recordChannelOutcome(channelKey, v === VERDICT.BLOCK);
      await bumpStats(v === VERDICT.BLOCK ? { blocked: 1 } : { allowed: 1 });
      return result(v, LAYER.VISION_LLM, {
        score: semanticScore,
        confidence: vv.confidence,
        reason: why,
        stance: vv.stance,
        visualCue: vv.visualCue,
        rule: rule?.label,
        ruleId: rule?.id,
      });
    }
  }

  /* --- 5. Karar: metin katmaninin yargisi ------------------------- */
  const { verdict: v, rule } = applyRules(textVerdict, rules);
  await putVerdict(item.videoId, hash, v, semanticScore, LAYER.TEXT_LLM, textVerdict.reason, rule?.label);
  await recordChannelOutcome(channelKey, v === VERDICT.BLOCK);
  await bumpStats(v === VERDICT.BLOCK ? { blocked: 1 } : { allowed: 1 });
  return result(v, LAYER.TEXT_LLM, {
    score: semanticScore,
    confidence: textVerdict.confidence,
    reason: textVerdict.reason,
    stance: textVerdict.stance,
    rule: rule?.label,
    ruleId: rule?.id,
    lowConfidence: textUnsure,
  });
}

/**
 * LLM yargisini ESLESEN KURALIN politikasina gore karara cevirir.
 *
 * Burasi tasariminin can damari: ayni tutum, kurala gore farkli sonuc verir.
 *   · "League of Legends" kuralinda ELESTIREL video GECER (kullanici oyunu
 *     gormek istemiyor, oyunu yerin dibine sokan videoyu izleyebilir).
 *   · "Dine hakaret" kuralinda ELESTIREL olan tam da engellenecek seydir.
 *   · "Teror orgutunu ovme" kuralinda TARAFSIZ haber gecer, oven engellenir.
 *
 * Tek global anahtar bunlarin ucunu ayni anda dogru yapamaz; bu yuzden
 * politika kural basinadir.
 */
/* ------------------------------------------------------------------ */
/* TOPLU degerlendirme                                                 */
/* ------------------------------------------------------------------ */

/**
 * Ucuz katmanlar: onbellek, kanal listeleri, literal ipucu, anlamsal aday eleme.
 *
 * Ya kesin bir karar dondurur (`done: true`) ya da baglamsal katmana gidecek
 * "aday" kaydini. Hicbiri ag cagrisi GEREKTIRMEZ — gomuler mikro toplama
 * kuyrugunda zaten birlesir.
 */
async function prejudge(item, settings, rules) {
  const hash = configHash(settings);

  if (!settings.enabled) return { done: true, result: result(VERDICT.ALLOW, LAYER.DISABLED) };

  const hasCriteria = rules.length > 0 || parseList(settings.channelBlock).length > 0;
  if (!hasCriteria) return { done: true, result: result(VERDICT.ALLOW, LAYER.DISABLED) };

  const cached = await getVerdict(item.videoId, hash);
  if (cached) {
    return {
      done: true,
      result: result(cached.v, LAYER.CACHE, {
        score: cached.s,
        cachedFrom: cached.l,
        reason: cached.r,
        rule: cached.k,
      }),
    };
  }

  const channelKey = normalize(item.channel);
  const text = videoText(item);

  // Kanal listeleri kullanicinin KESIN iradesi — hicbir katman tartismaz.
  const allowHit = channelMatches(item.channel, parseList(settings.channelAllow));
  if (allowHit) {
    await _putVerdict(item.videoId, hash, VERDICT.ALLOW, 0, LAYER.CHANNEL_ALLOW);
    return { done: true, result: result(VERDICT.ALLOW, LAYER.CHANNEL_ALLOW, { matched: allowHit }) };
  }

  const blockHit = channelMatches(item.channel, parseList(settings.channelBlock));
  if (blockHit) {
    await _putVerdict(item.videoId, hash, VERDICT.BLOCK, 1, LAYER.CHANNEL_BLOCK, `kanal: ${blockHit}`);
    await _bumpStats({ blocked: 1 });
    return { done: true, result: result(VERDICT.BLOCK, LAYER.CHANNEL_BLOCK, { matched: blockHit }) };
  }

  /* --- 2. Deterministik kalip --------------------------------------
   *
   * ONCE KURAL, SONRA LLM. Tutum-duyarsiz olcutlerde kalibin kendisi zaten
   * istenmeyen seydir; her video icin modele sormak bosuna token ve bosuna
   * gecikmedir. Tutum-duyarli olcutlerde bu yol KAPALIDIR — orada karar
   * ancak tutum okunarak verilebilir.
   */
  const patternEntry = patternDecision(text, rules, (t, pat) => Boolean(literalMatches(t, [pat])));
  if (patternEntry) {
    await _putVerdict(
      item.videoId, hash, VERDICT.BLOCK, 1, LAYER.LITERAL,
      `kalip: ${patternEntry.text}`, patternEntry.rule.label,
    );
    await _recordChannelOutcome(channelKey, true);
    await _bumpStats({ blocked: 1 });
    return {
      done: true,
      result: result(VERDICT.BLOCK, LAYER.LITERAL, {
        matched: patternEntry.text,
        rule: patternEntry.rule.label,
        ruleId: patternEntry.ruleId,
      }),
    };
  }

  // Literal eslesme ENGELLEMEZ, yalnizca "dikkatli bak" sinyalidir.
  const literals = allLiterals(rules);
  const literalEntry = literals.find((l) => literalMatches(text, [l.text]));
  const literalHit = literalEntry?.text || null;

  const profile = await getChannelProfile(channelKey);
  const boost = channelBoost(profile, settings);
  const hintedRuleIds = new Set();
  let semanticScore = null;

  if (settings.useSemantic) {
    const { anchors, bg } = await getAnchors(settings, embedHash(settings));
    if (anchors.length) {
      const vec = center(await embed(text, settings), bg);
      const cAnchors = anchors.map((a) => (a?.vec ? { ...a, vec: center(a.vec, bg) } : a));
      const { score: sAnchor } = bestMatch(vec, cAnchors);
      semanticScore = Math.min(1, sAnchor + boost);
      for (const a of cAnchors) {
        if (a?.vec && dot(vec, a.vec) + boost >= settings.tCandidate) hintedRuleIds.add(a.ruleId);
      }
    }
  }

  if (literalEntry) hintedRuleIds.add(literalEntry.ruleId);

  /* --- 4. Kanal hafizasi -------------------------------------------
   *
   * Bir kanalin videolari yeterli ornekte ve yuksek oranda engellenmisse
   * yirmi birincisini modele sormak bosuna maliyettir. Bu katman ANCAK
   * kanal zaten bir olcute takilmisken (yani aday iken) karar verir;
   * aksi halde kanal kendi istatistigini besleyip geri donusu olmayan bir
   * donguye girerdi.
   */
  if (settings.useChannelMemory && hintedRuleIds.size > 0 && profile?.n) {
    const ratio = profile.blocked / profile.n;
    const settled =
      profile.n >= settings.channelMemoryDecideMinSamples &&
      ratio >= settings.channelMemoryDecideRatio;
    if (settled) {
      const rid = [...hintedRuleIds][0];
      const rule = rules.find((r) => r.id === rid);
      // Tutum-duyarli olcutte kanal gecmisi YETMEZ: ayni kanal konuyu
      // elestiren bir video da yayinlayabilir, bunu ancak model ayirir.
      if (rule && rule.stanceSensitive === false) {
        await _putVerdict(
          item.videoId, hash, VERDICT.BLOCK, semanticScore, LAYER.CHANNEL_BLOCK,
          `kanal gecmisi: ${profile.blocked}/${profile.n}`, rule.label,
        );
        await _recordChannelOutcome(channelKey, true);
        await _bumpStats({ blocked: 1 });
        return {
          done: true,
          result: result(VERDICT.BLOCK, LAYER.CHANNEL_BLOCK, {
            score: semanticScore,
            reason: `kanal gecmisi: ${profile.blocked}/${profile.n}`,
            rule: rule.label,
          }),
        };
      }
    }
  }

  const isCandidate =
    Boolean(literalHit) || hintedRuleIds.size > 0 || settings.visionScope === 'all';

  if (!isCandidate) {
    await _putVerdict(item.videoId, hash, VERDICT.ALLOW, semanticScore, LAYER.SEMANTIC);
    await _recordChannelOutcome(channelKey, false);
    await _bumpStats({ allowed: 1 });
    return { done: true, result: result(VERDICT.ALLOW, LAYER.SEMANTIC, { score: semanticScore }) };
  }

  // Baglamsal katman kapaliysa tutum okunamaz; literal tek acik talimattir.
  if (!settings.useTextLlm) {
    if (literalHit) {
      await _putVerdict(item.videoId, hash, VERDICT.BLOCK, 1, LAYER.LITERAL, `kural: ${literalHit}`);
      await _recordChannelOutcome(channelKey, true);
      await _bumpStats({ blocked: 1 });
      return { done: true, result: result(VERDICT.BLOCK, LAYER.LITERAL, { matched: literalHit }) };
    }
    await _bumpStats({ allowed: 1 });
    return { done: true, result: result(VERDICT.ALLOW, LAYER.SEMANTIC, { score: semanticScore }) };
  }

  return { done: false, hash, channelKey, semanticScore, literalHit, hintedRuleIds, profile };
}

/** Tek istemde sorulacak en fazla video. */
const JUDGE_BATCH = 20;

/**
 * Bir grup videoyu degerlendirir — LLM cagrisi TOPLU yapilir.
 *
 * Video basina cagri olceklenmiyordu: gercek YouTube akisinda tek kaydirmada
 * 60+ kart var ve ucretsiz kademede her cagri siraya giriyor. Olculdu: 14
 * es zamanli istek ~50 sn. Ayni videolari tek istemde sormak hem gecikmeyi
 * hem kota tuketimini bir buyukluk mertebesi dusuruyor.
 *
 * Ucuz katmanlar (onbellek, kanal listeleri, anlamsal aday eleme) yine video
 * basina calisir; bunlar zaten ag cagrisi gerektirmez ya da gomuler mikro
 * toplama kuyrugunda birlesir.
 */
export async function evaluateAll(items, settings) {
  const rules = normalizeRules(settings.rules).filter((r) => r.enabled);

  // 1) Ucuz katmanlar — her video icin ya kesin karar ya "aday" kaydi
  const settled = new Array(items.length).fill(null);
  const pending = [];

  await Promise.all(
    items.map(async (item, idx) => {
      try {
        const pre = await prejudge(item, settings, rules);
        if (pre.done) settled[idx] = pre.result;
        else pending.push({ idx, item, ...pre });
      } catch (err) {
        settled[idx] = errorResult(err, settings);
      }
    }),
  );

  // 2) Adaylari gruplayip TEK istemde sor
  for (let i = 0; i < pending.length; i += JUDGE_BATCH) {
    const chunk = pending.slice(i, i + JUDGE_BATCH);
    // Istemde yalnizca ipucu veren olcutler yer alsin: tum kurallari her
    // partide gondermek hem token israfi hem de modeli alakasiz olcutlerle
    // mesgul etmek olurdu.
    // TUM kurallar sorulur, yalnizca ipucu verenler degil.
    //
    // Olculdu: sorulan kural alt kumesi karttan karta degisince ISTEM de
    // degisiyor ve model ayni videoya farkli kosumlarda farkli cevap
    // veriyordu (ayni olcutlerle 11/14, 13/14, 12/14). Sicaklik 0 olmasi
    // bunu cozmuyor — degisen sey istemin kendisi.
    //
    // Kural listesi kisa (birkac satir) oldugu icin tumunu gondermenin
    // maliyeti onemsiz; karsiligi kararli karar.
    const askedRules = rules;

    let verdicts;
    try {
      verdicts = await judgeTextBatch(
        askedRules,
        chunk.map((c) => ({
          title: c.item.title,
          channel: c.item.channel,
          literalHit: c.literalHit,
          channelProfile: c.profile,
        })),
        settings,
      );
    } catch (err) {
      for (const c of chunk) settled[c.idx] = errorResult(err, settings);
      continue;
    }

    await Promise.all(
      chunk.map(async (c, k) => {
        const v = verdicts[k];
        if (!v) {
          // Model bu kaydi dondurmedi. Uydurmak yerine gecirilir ve iz birakilir.
          settled[c.idx] = result(VERDICT.ALLOW, LAYER.TEXT_LLM, {
            score: c.semanticScore,
            reason: 'model bu video icin karar dondurmedi',
            lowConfidence: true,
          });
          return;
        }

        /* --- 6. Icerik katmani: kapak gorseli ------------------------
         *
         * Kullanicinin acik kurali: "baslikta hic gecmese bile kapaktaki
         * logo/sembol yakalansin". Metin katmani kararsiz kaldiginda ya da
         * kullanici her kapaga bakilmasini istediginde gorsele bakilir.
         */
        const unsure = v.confidence < settings.visionEscalateBelow;
        const wantVision = unsure || settings.visionScope === 'all';
        const canVision =
          settings.useVisionLlm &&
          wantVision &&
          settings.allowThumbnailUpload &&
          c.item.thumbnail &&
          isAllowedThumbnail(c.item.thumbnail);

        if (canVision) {
          try {
            const { base64, mimeType } = await fetchThumbnail(c.item.thumbnail);
            const vv = await judgeVision(
              { rules: askedRules, title: c.item.title, channel: c.item.channel,
                channelProfile: c.profile, literalHit: c.literalHit },
              base64, mimeType, settings,
            );
            settled[c.idx] = await commitVerdict(c, vv, LAYER.VISION_LLM, settings, rules);
            return;
          } catch (err) {
            // Kapak alinamadi: karar hatti COKMEZ, elimizde metin yargisi var.
            if (settings.debug) console.warn('[aivg] gorsel katman atlandi:', err.message);
          }
        }

        settled[c.idx] = await commitVerdict(c, v, LAYER.TEXT_LLM, settings, rules);
      }),
    );
  }

  return settled.map((r) => r || result(VERDICT.ALLOW, LAYER.DISABLED));
}

function errorResult(err, settings) {
  const budget = err instanceof BudgetError;
  return result(settings.onError === 'hide' ? VERDICT.BLOCK : VERDICT.ALLOW, LAYER.ERROR_POLICY, {
    error: String(err.message || err),
    budgetExhausted: budget,
  });
}

/** LLM yargisini karara cevirir, onbellege ve kanal hafizasina yazar. */
async function commitVerdict(c, v, layer, settings, rules) {
  const { verdict, rule } = applyRules(v, rules);
  const why = v.visualCue ? `${v.reason} — kapakta: ${v.visualCue}` : v.reason;
  await _putVerdict(c.item.videoId, c.hash, verdict, c.semanticScore, layer, why, rule?.label);
  await _recordChannelOutcome(c.channelKey, verdict === VERDICT.BLOCK);
  await _bumpStats(verdict === VERDICT.BLOCK ? { blocked: 1 } : { allowed: 1 });
  return result(verdict, layer, {
    score: c.semanticScore,
    confidence: v.confidence,
    reason: why,
    stance: v.stance,
    rule: rule?.label,
    ruleId: rule?.id,
  });
}

// Karar mantigi `shared/rules.js` icinde SAF olarak durur; oradan dogrudan
// test edilebiliyor. Burada kopyasini tutmak iki surumun sessizce birbirinden
// ayrilmasi demekti.
export { applyRules };

/**
 * Hata politikasini uygular. Kararlar ASLA sessizce "gecir"e duşmez —
 * hata durumu ayri bir katman olarak isaretlenir ve istatistige yazilir,
 * boylece kullanici filtrenin calisip calismadigini gorebilir.
 */
export async function evaluateSafe(item, settings, opts = {}) {
  try {
    return await evaluate(item, settings, opts);
  } catch (err) {
    const budget = err instanceof BudgetError;
    if (!opts.dryRun) await _bumpStats({ errors: budget ? 0 : 1 });
    const verdict = settings.onError === 'hide' ? VERDICT.BLOCK : VERDICT.ALLOW;
    return result(verdict, LAYER.ERROR_POLICY, {
      error: String(err.message || err),
      budgetExhausted: budget,
    });
  }
}
