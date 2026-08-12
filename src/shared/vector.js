/** Vektor yardimcilari. Gomuler L2-normalize edilerek saklanir, boylece kosinus = nokta carpimi. */

export function l2normalize(v) {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm === 0) return v.slice();
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** Normalize edilmiş vektorler icin kosinus benzerligi. */
export function dot(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * Anizotropi duzeltmesi: vektorden ortak yonu cikarir, sonra yeniden normalize eder.
 *
 * NEDEN GEREKLI: gomu modelleri vektorleri uzaya esit dagitmaz; hepsi ortak bir
 * yone bakar. Ciplak kosinus bu ortak bileseni de olctugu icin, birbiriyle hic
 * ilgisi olmayan iki Turkce baslik bile 0.75 civari skor alir. Olculen sey
 * konu iliskisi degil, "ikisi de ayni dilde kisa metin" olur.
 *
 * Merkez (arka plan kulliyatinin ortalama vektoru) cikarildiginda geriye metne
 * OZGU yon kalir ve skorlarin ayirt ediciligi acilir.
 */
export function center(vec, centroid) {
  if (!centroid || centroid.length === 0) return vec;
  const n = Math.min(vec.length, centroid.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = vec[i] - centroid[i];
  return l2normalize(out);
}

/** Vektor kumesinin ortalamasi — merkezleme icin arka plan yonu. */
export function centroid(vectors) {
  const usable = vectors.filter((v) => Array.isArray(v) && v.length > 0);
  if (usable.length === 0) return null;
  const dim = usable[0].length;
  const out = new Array(dim).fill(0);
  for (const v of usable) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= usable.length;
  return out;
}

/** Bir vektorun capa kumesine en yuksek benzerligi ve hangi capaya oldugu. */
export function bestMatch(vec, anchors) {
  let best = -1;
  let bestAnchor = null;
  for (const a of anchors) {
    if (!a || !a.vec) continue;
    const s = dot(vec, a.vec);
    if (s > best) {
      best = s;
      bestAnchor = a;
    }
  }
  return { score: best, anchor: bestAnchor };
}
