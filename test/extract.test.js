/**
 * Kart cikarimi — Shorts rafi gibi KAPSAYICI dugumler.
 *
 * Gercek DOM yerine asgari bir taklit kullanilir: burada sinanan sey
 * tarayici davranisi degil, "bu dugum tek bir videoyu mu temsil ediyor"
 * kararidir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoId } from '../src/content/extract.js';

/** querySelectorAll('a[href]') cagrisini karsilayan asgari dugum. */
const node = (hrefs) => ({
  querySelectorAll: () => hrefs.map((h) => ({ getAttribute: () => h })),
});

test('tek videolu kart kimligini dondurur', () => {
  assert.equal(extractVideoId(node(['/watch?v=abcdefghij1', '/watch?v=abcdefghij1'])), 'abcdefghij1');
});

test('KRITIK: Shorts rafi TEK VIDEO sayilmaz', () => {
  // Ana sayfada Shorts rafinin tamami bir `ytd-rich-item-renderer` icinde
  // durur. Ilk baglantiyi alip kartin videosu saymak, tek bir Short olcute
  // girdiginde RAFIN TAMAMINI gizliyordu.
  const raf = node(['/shorts/aaaaaaaaaa1', '/shorts/bbbbbbbbbb2', '/shorts/cccccccccc3']);
  assert.equal(extractVideoId(raf), null, 'kapsayici dugum atlanmali');
});

test('tek Shorts karti normal sekilde degerlendirilir', () => {
  assert.equal(extractVideoId(node(['/shorts/aaaaaaaaaa1'])), 's:aaaaaaaaaa1');
});

test('videosuz dugum null doner', () => {
  assert.equal(extractVideoId(node(['/feed/subscriptions', '/@kanal'])), null);
});
