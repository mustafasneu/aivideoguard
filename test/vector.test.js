import { test } from 'node:test';
import assert from 'node:assert/strict';
import { l2normalize, dot, bestMatch } from '../src/shared/vector.js';

test('l2normalize birim uzunluk uretir', () => {
  const v = l2normalize([3, 4]);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-12);
  assert.ok(Math.abs(v[0] - 0.6) < 1e-12);
});

test('l2normalize sifir vektorde patlamaz', () => {
  assert.deepEqual(l2normalize([0, 0, 0]), [0, 0, 0]);
});

test('dot normalize vektorlerde kosinus verir', () => {
  const a = l2normalize([1, 0]);
  const b = l2normalize([0, 1]);
  const c = l2normalize([1, 1]);
  assert.ok(Math.abs(dot(a, a) - 1) < 1e-12);
  assert.ok(Math.abs(dot(a, b)) < 1e-12);
  assert.ok(Math.abs(dot(a, c) - Math.SQRT1_2) < 1e-12);
});

test('bestMatch en yakin capayi ve skorunu dondurur', () => {
  const v = l2normalize([1, 0]);
  const anchors = [
    { text: 'uzak', vec: l2normalize([0, 1]) },
    { text: 'yakin', vec: l2normalize([0.9, 0.1]) },
  ];
  const { score, anchor } = bestMatch(v, anchors);
  assert.equal(anchor.text, 'yakin');
  assert.ok(score > 0.9);
});

test('bestMatch bos capa kumesinde -1 dondurur (engellemez)', () => {
  const { score, anchor } = bestMatch(l2normalize([1, 0]), []);
  assert.equal(score, -1);
  assert.equal(anchor, null);
});

test('bestMatch bozuk capalari atlar', () => {
  const anchors = [null, { text: 'x' }, { text: 'iyi', vec: l2normalize([1, 0]) }];
  const { anchor } = bestMatch(l2normalize([1, 0]), anchors);
  assert.equal(anchor.text, 'iyi');
});
