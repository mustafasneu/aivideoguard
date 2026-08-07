/**
 * Kucuk resim adresi dogrulamasi. Saf — hem icerik betigi hem arka plan kullanir.
 *
 * Adres SAYFADAN gelir; sayfa baglami guvenilmezdir (youtube.com'da bir XSS,
 * baska bir uzanti, ya da YouTube'un degisen DOM'u). Dogrulama olmadan arka
 * plan, sayfanin sectigi herhangi bir adrese uzanti yetkileriyle istek atardi.
 *
 * Kanal avatarlarinin sunuldugu ggpht.com / googleusercontent.com BILEREK
 * disaridadir: gorsel katman videonun kucuk resmini degerlendirmeli,
 * kanal logosunu degil.
 */
const THUMB_HOST = /(^|\.)(ytimg\.com|img\.youtube\.com)$/;

export function isAllowedThumbnail(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && THUMB_HOST.test(u.hostname);
  } catch {
    return false;
  }
}
