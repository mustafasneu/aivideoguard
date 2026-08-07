/**
 * Kademeli karar hatti.
 *
 *   0. Onbellek           — daha once karar verildiyse hic hesaplama yok
 *   1. Kanal beyaz liste  — guvenli kanal, hicbir katman calismaz
 *   2. Kanal kara liste   — kesin engel
 *   3. Literal kisayol    — normalize substring, LLM'e hic sorma
 *   4. ANLAMSAL katman    — vektor benzerligi + kanal hafizasi katkisi
 *                           yuksek -> engelle, dusuk -> gecir, orta -> yukselt
 *   5. BAGLAMSAL metin    — LLM dolayli iliskiyi kurar
 *   6. BAGLAMSAL gorsel   — metin katmani kararsizsa kucuk resme bakar
 *
 * Her katman bir sonrakine yalnizca gerektiginde devreder. Amac: kararlarin
 * buyuk cogunlugunu ag trafigi olmadan vermek.
 */

import { VERDICT, LAYER } from '../shared/config.js';
import { videoText, channelMatches, literalMatches, parseList, normalize } from '../shared/text.js';
import { bestMatch, dot } from '../shared/vector.js';
import { configHash, embedHash, channelBoost } from '../shared/scoring.js';
import { embed, getAnchors } from './embedder.js';
import { judgeText, judgeVision, fetchThumbnail } from './llm.js';
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

  // Anlamsal/baglamsal katmanlarin calisabilmesi icin bir KONU gerekir.
  // Yalnizca kanal listesi tanimlayan kullanicida LLM'e "(belirtilmemis)"
  // konusuyla her video icin cagri gitmemeli — hem anlamsiz hem pahali.
  const hasSemanticCriteria = Boolean(
    (settings.topic || '').trim() || parseList(settings.anchors).length,
  );
  const hasCriteria =
    hasSemanticCriteria ||
    parseList(settings.hardBlock).length ||
    parseList(settings.channelBlock).length;
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

  /* --- 3. Literal kisayol ----------------------------------------- */
  const literalHit = literalMatches(text, parseList(settings.hardBlock));
  if (literalHit) {
    await putVerdict(item.videoId, hash, VERDICT.BLOCK, 1, LAYER.LITERAL, `kural: ${literalHit}`);
    await recordChannelOutcome(channelKey, true);
    await bumpStats({ blocked: 1 });
    return result(VERDICT.BLOCK, LAYER.LITERAL, { matched: literalHit });
  }

  /* --- 4. Anlamsal katman ----------------------------------------- */
  let semanticScore = null;
  let matchedAnchor = null;
  const profile = await getChannelProfile(channelKey);
  const boost = channelBoost(profile, settings);

  if (settings.useSemantic) {
    // Capalar AYRI parmak izine baglidir: yalnizca esik degistiginde
    // yeniden gomdurmek gereksiz maliyet olurdu.
    const { topicVec, anchors } = await getAnchors(settings, embedHash(settings));
    if (topicVec || anchors.length) {
      const vec = await embed(text, settings);
      const sTopic = topicVec ? dot(vec, topicVec) : -1;
      const { score: sAnchor, anchor } = bestMatch(vec, anchors);
      const raw = Math.max(sTopic, sAnchor);
      semanticScore = Math.min(1, raw + boost);
      matchedAnchor = sAnchor >= sTopic ? anchor?.text : '(konu)';

      if (semanticScore >= settings.tBlock) {
        await putVerdict(item.videoId, hash, VERDICT.BLOCK, semanticScore, LAYER.SEMANTIC, matchedAnchor);
        await recordChannelOutcome(channelKey, true);
        await bumpStats({ blocked: 1 });
        return result(VERDICT.BLOCK, LAYER.SEMANTIC, {
          score: semanticScore, matched: matchedAnchor, boost,
        });
      }
      if (semanticScore < settings.tAsk) {
        await putVerdict(item.videoId, hash, VERDICT.ALLOW, semanticScore, LAYER.SEMANTIC);
        await recordChannelOutcome(channelKey, false);
        await bumpStats({ allowed: 1 });
        return result(VERDICT.ALLOW, LAYER.SEMANTIC, { score: semanticScore, boost });
      }
    }
  }

  /* --- 5. Baglamsal metin katmani --------------------------------- */
  const anchorTexts = parseList(settings.anchors);
  const ctx = {
    topic: settings.topic,
    anchorTexts,
    title: item.title,
    channel: item.channel,
    durationText: item.durationText,
    surface: item.surface,
    badges: item.badges,
    channelProfile: profile,
    semanticScore,
  };

  let textVerdict = null;
  if (settings.useTextLlm && hasSemanticCriteria) {
    textVerdict = await judgeText(ctx, settings);
    const decisive = textVerdict.confidence >= settings.visionEscalateBelow;
    if (decisive) {
      const v = textVerdict.related ? VERDICT.BLOCK : VERDICT.ALLOW;
      await putVerdict(item.videoId, hash, v, semanticScore, LAYER.TEXT_LLM, textVerdict.reason);
      await recordChannelOutcome(channelKey, textVerdict.related);
      await bumpStats(textVerdict.related ? { blocked: 1 } : { allowed: 1 });
      return result(v, LAYER.TEXT_LLM, {
        score: semanticScore, confidence: textVerdict.confidence, reason: textVerdict.reason,
      });
    }
  }

  /* --- 6. Baglamsal gorsel katmani -------------------------------- */
  const canUseVision =
    settings.useVisionLlm &&
    hasSemanticCriteria &&
    settings.allowThumbnailUpload &&
    item.thumbnail &&
    // Alan adi burada da elenir: gecersiz adres icin bosuna cagri kurulmasin
    isAllowedThumbnail(item.thumbnail);

  if (canUseVision) {
    const { base64, mimeType } = await fetchThumbnail(item.thumbnail);
    const vv = await judgeVision(ctx, base64, mimeType, settings);
    const v = vv.related ? VERDICT.BLOCK : VERDICT.ALLOW;
    await putVerdict(item.videoId, hash, v, semanticScore, LAYER.VISION_LLM, vv.reason);
    await recordChannelOutcome(channelKey, vv.related);
    await bumpStats(vv.related ? { blocked: 1 } : { allowed: 1 });
    return result(v, LAYER.VISION_LLM, {
      score: semanticScore, confidence: vv.confidence, reason: vv.reason,
    });
  }

  /* --- Gorsel katman yoksa metin katmaninin kararsiz sonucu ------- */
  if (textVerdict) {
    const v = textVerdict.related ? VERDICT.BLOCK : VERDICT.ALLOW;
    await putVerdict(item.videoId, hash, v, semanticScore, LAYER.TEXT_LLM, textVerdict.reason);
    await recordChannelOutcome(channelKey, textVerdict.related);
    await bumpStats(textVerdict.related ? { blocked: 1 } : { allowed: 1 });
    return result(v, LAYER.TEXT_LLM, {
      score: semanticScore, confidence: textVerdict.confidence, reason: textVerdict.reason,
      lowConfidence: true,
    });
  }

  // Hicbir karar katmani calismadi (hepsi kapali) — gecir
  await bumpStats({ allowed: 1 });
  return result(VERDICT.ALLOW, LAYER.SEMANTIC, { score: semanticScore });
}

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
