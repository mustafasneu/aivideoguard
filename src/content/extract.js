/**
 * YouTube kart cikarimi.
 *
 * YouTube DOM'u sik degisir ve renderer dugumlerini GERI DONUSTURUR: ayni
 * <ytd-rich-item-renderer> dugumu kaydirma sirasinda baska bir videoya atanir.
 * Bu yuzden hicbir sey dugume kalici olarak isaretlenmez; her turda videoId
 * yeniden okunur ve degistiyse eski karar temizlenir.
 */

import { isAllowedThumbnail } from '../shared/thumbnail.js';

export const CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-playlist-video-renderer',
  'ytd-playlist-panel-video-renderer',
  'ytd-reel-item-renderer',
  'ytm-shorts-lockup-view-model',
  'yt-lockup-view-model',
].join(',');

function firstText(root, selectors) {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const t = (el.getAttribute('title') || el.textContent || '').trim();
    if (t) return t;
  }
  return '';
}

const THUMB_CONTAINER = [
  'ytd-thumbnail img',
  'ytd-playlist-video-thumbnail-renderer img',
  '.yt-thumbnail-view-model img',
  '.shortsLockupViewModelHostThumbnail img',
  'yt-image img',
].join(',');

export function pickThumbnail(card) {
  // 1) Once thumbnail konteynerinin icindekiler — avatar buraya giremez
  for (const img of card.querySelectorAll(THUMB_CONTAINER)) {
    const src = img.currentSrc || img.src || '';
    if (isAllowedThumbnail(src)) return src;
  }
  // 2) Konteyner secicileri tutmadiysa (YouTube DOM'u degistiyse) tum
  //    goruntulere bak ama alan adiyla ele — boyuta GUVENME, cunku
  //    yuklenmemis kucuk resmin alani 0, onbellekli avatarinki > 0'dir.
  for (const img of card.querySelectorAll('img')) {
    const src = img.currentSrc || img.src || '';
    if (isAllowedThumbnail(src)) return src;
  }
  return '';
}

/** Bir dugumun altindaki TUM farkli video kimlikleri. */
function videoIdsIn(card) {
  const ids = new Set();
  for (const a of card.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    let m = href.match(/[?&]v=([\w-]{11})/);
    if (m) {
      ids.add(m[1]);
      continue;
    }
    m = href.match(/\/shorts\/([\w-]{11})/);
    if (m) {
      ids.add(`s:${m[1]}`);
      continue;
    }
    m = href.match(/youtu\.be\/([\w-]{11})/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/**
 * Kartin videosu. Dugum birden fazla video BARINDIRIYORSA kart degil
 * KAPSAYICIDIR ve null doner.
 *
 * NEDEN: ana sayfada Shorts rafinin tamami tek bir `ytd-rich-item-renderer`
 * icinde durur. Ilk baglantiyi alip "bu kartin videosu" saymak, rafi tek bir
 * videoymus gibi degerlendirir; karar "engelle" cikinca RAFIN TAMAMI
 * gizlenir. Kullanicinin gordugu sey "Shorts komple engellendi" olur, oysa
 * yalnizca bir tanesi olcute giriyordu.
 *
 * Kapsayici atlanir; icindeki gercek kartlar (`ytm-shorts-lockup-view-model`)
 * zaten secicide oldugu icin tek tek degerlendirilir.
 */
export function extractVideoId(card) {
  const ids = videoIdsIn(card);
  if (ids.size !== 1) return null;
  return [...ids][0];
}

export function detectSurface() {
  const p = location.pathname;
  if (p === '/') return 'ana sayfa';
  if (p.startsWith('/results')) return 'arama sonuclari';
  if (p.startsWith('/watch')) return 'izleme sayfasi yan panel';
  if (p.startsWith('/shorts')) return 'shorts';
  if (p.startsWith('/feed/subscriptions')) return 'abonelikler';
  if (p.startsWith('/@') || p.startsWith('/channel') || p.startsWith('/c/')) return 'kanal sayfasi';
  return 'diger';
}

export function extractCard(card) {
  const videoId = extractVideoId(card);
  if (!videoId) return null;

  const title = firstText(card, [
    '#video-title',
    'a#video-title-link',
    'h3 a[title]',
    '.yt-lockup-metadata-view-model__title',
    'yt-formatted-string#video-title',
    '.shortsLockupViewModelHostMetadataTitle',
  ]);
  if (!title) return null;

  const channel = firstText(card, [
    'ytd-channel-name a',
    'ytd-channel-name #text',
    '#channel-name #text',
    '.yt-content-metadata-view-model__metadata-text',
    '#byline-container',
  ]);

  // Kucuk resim secimi.
  //
  // DIKKAT: karttaki en buyuk <img> aramak YANLIS. Kartta kanal avatari da
  // bulunur ve avatarlar akista tekrar ettigi icin genellikle onbellekten
  // yuklu gelir (alan > 0), video kucuk resmi ise henuz yuklenmemistir
  // (alan = 0). O yuzden "en buyuk" secimi duzenli olarak AVATARI secer ve
  // gorsel katman videoyu degil kanal logosunu degerlendirir.
  //
  // Cozum: once thumbnail konteynerini hedefle, sonra alan adiyla dogrula.
  const thumbnail = pickThumbnail(card);

  const durationText = firstText(card, [
    'ytd-thumbnail-overlay-time-status-renderer #text',
    '.badge-shape-wiz__text',
    '.ytd-thumbnail-overlay-time-status-renderer',
  ]);

  const badges = Array.from(card.querySelectorAll('ytd-badge-supported-renderer .badge, .badge-shape-wiz'))
    .map((b) => (b.textContent || '').trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    videoId,
    title,
    channel,
    thumbnail,
    durationText,
    badges,
    surface: detectSurface(),
  };
}
