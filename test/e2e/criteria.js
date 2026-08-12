/**
 * KULLANICININ OLCUTLERI — tek dogruluk kaynagi.
 *
 * Bunlar kullanicinin kendi cumleleridir. Testlerin uydurma bir konu uzerinde
 * "gecti" demesi hicbir sey kanitlamaz; butun kosumlar bu listeyi kullanir.
 *
 * Capalar, kisaltmalar, jargon ve tutum politikasi BURADA YAZILMAZ — onlari
 * kural yazan katman (background/curator.js) turetir. Elle yazmak, sistemin
 * asil iddiasini (LLM kurallari kendisi kurar) test disi birakirdi.
 */

export const CRITERIA_LIST = [
  'League of Legends ve onu animsatan kisaltmalar, jargon ve oyuncu adlari',
  'Valorant',
  'cinsel icerik ve ciplaklik iceren veya ozendiren video, film, oyun, haber ve muzik klipleri',
  'cinsel cagrisimli yem baslikli videolar',
  'siddet iceren veya ozendiren video, oyun, haber ve filmler',
  'magazin haberleri',
  'agir kufur iceren komik videolar',
  'dine ve kutsal degerlere hakaret iceren videolar',
  'asparagas, kaynaksiz ve sansasyonel haber uslubu',
  'ateizmi ve Hristiyan misyonerligini oven veya ozendiren icerikler',
  'mide bulandiran yemek videolari',
  'mide bulandiran TikTok derlemeleri',
  'PKK ve PYD basta olmak uzere teror orgutlerini oven, ozendiren veya masum gosteren her tur icerik',
  'normal bir insanin begenmeyecegi, rahatsiz olacagi veya tiksinecegi her sey',
];

export const CRITERIA = CRITERIA_LIST.join('\n');
