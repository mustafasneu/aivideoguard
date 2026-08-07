import browser from 'webextension-polyfill';

/**
 * Eklentinin calisabilmesi icin gereken kaynak izinleri.
 *
 * NEDEN CALISMA ZAMANINDA?
 * Chrome'da `host_permissions` kurulumda verilir. Firefox MV3'te ise bunlar
 * ISTEGE BAGLIDIR: kullanici eklenti yonetiminden acikca vermedikce verilmez.
 * Verilmediginde fetch cagrilari sessizce basarisiz olur ve kullanici
 * filtrenin neden calismadigini goremez.
 *
 * Bu yuzden ayarlar sayfasi izinleri kontrol eder ve eksikse kullanici
 * tiklamasiyla ister.
 */
export const REQUIRED_ORIGINS = [
  '*://*.youtube.com/*',
  '*://*.ytimg.com/*',
  'https://generativelanguage.googleapis.com/*',
];

/** Tum gerekli izinler verilmis mi? */
export async function hasRequiredOrigins() {
  if (!browser.permissions?.contains) return true; // API yoksa denetlenemez
  try {
    return await browser.permissions.contains({ origins: REQUIRED_ORIGINS });
  } catch {
    return true; // Kontrol edilemiyorsa kullaniciyi bosuna uyarma
  }
}

/**
 * Izinleri ister.
 *
 * DIKKAT: bu cagri kullanici hareketinden (tiklama) DOGRUDAN yapilmalidir.
 * Araya `await` girerse tarayici hareket baglamini kaybeder ve istegi reddeder.
 * Bu yuzden fonksiyon Promise dondurur ama icinde on-await yapmaz.
 */
export function requestRequiredOrigins() {
  if (!browser.permissions?.request) return Promise.resolve(false);
  return browser.permissions.request({ origins: REQUIRED_ORIGINS });
}
