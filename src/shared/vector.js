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
