/**
 * VARSAYILAN KURAL SETI — eklentiyle birlikte gelir.
 *
 * Kullanici ilk acilista hicbir sey uretmeden calisan bir filtre bulur:
 * tek bir LLM cagrisi yapilmadan kurallar hazirdir.
 *
 * Bu set SABITTIR. Her acilista yeniden uretmek hem token yakar hem de
 * kararlari oynak yapar — olculdu: ayni olcutlerle uc ayri uretim 11/14,
 * 13/14 ve 12/14 verdi, cunku her uretimde capalar ve tutum politikalari
 * degisiyordu. Kural seti artik gozden gecirilmis bir URUN parcasi.
 *
 * Kullanici bunlari ayarlar sayfasindan duzenler: ekler, cikarir, kapatir,
 * capa ve esiklerini degistirir. Duzenlenmis set kullanicinin deposunda
 * yasar; bu dosya yalnizca baslangic noktasidir.
 */

export const DEFAULT_RULES = [
  {
    "anchors": [
      "League of Legends",
      "LoL",
      "Riot Games",
      "summoner rift",
      "espor",
      "esports",
      "moba",
      "faker",
      "champ select"
    ],
    "description": "League of Legends ve onu animsatan kisaltmalar, jargon ve oyuncu adlari",
    "enabled": true,
    "id": "r1",
    "label": "League of Legends",
    "literals": [
      "League of Legends"
    ],
    "minConfidence": 0.55,
    "origin": "llm",
    "patterns": [
      "league of legends",
      "lol gameplay",
      "lol montaj",
      "summoner's rift",
      "teamfight tactics",
      "tft gameplay",
      "lck highlights",
      "lec highlights",
      "lcs highlights",
      "turkiye sampiyonluk ligi",
      "lol highlights",
      "urf mode lol",
      "aram highlights"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "Valorant",
      "Riot FPS",
      "agent",
      "vandal",
      "phantom",
      "radiant",
      "fps game",
      "taktikselnis",
      "valorant clips"
    ],
    "description": "Valorant",
    "enabled": true,
    "id": "r2",
    "label": "Valorant",
    "literals": [
      "Valorant"
    ],
    "minConfidence": 0.55,
    "origin": "llm",
    "patterns": [
      "valorant",
      "valorant gameplay",
      "valorant montaj",
      "valorant highlights",
      "valorant clips",
      "valorant clutch",
      "valorant lineup",
      "radiant gameplay",
      "vct highlights",
      "valorant crosshair"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "cinsel icerik",
      "ciplaklik",
      "nsfw",
      "adult content",
      "explicit",
      "erotizm",
      "sensual",
      "adult video"
    ],
    "description": "cinsel icerik ve ciplaklik iceren veya ozendiren video, film, oyun, haber ve muzik klipleri",
    "enabled": true,
    "id": "r3",
    "label": "Cinsel Icerik ve Ciplaklik",
    "literals": [],
    "minConfidence": 0.8,
    "origin": "llm",
    "patterns": [
      "porno",
      "pornography",
      "nsfw video",
      "sex tape",
      "naked girls",
      "ciplak kadinlar",
      "yetiskin film",
      "adult movie",
      "erotic scene",
      "erotik film izle",
      "hentai gameplay",
      "porno izle",
      "sex scene",
      "full nude"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "clickbait",
      "thumbnail",
      "cinsel cagrisim",
      "dikkat cekici kapak",
      "yem baslik",
      "sex sells",
      "tahrik edici"
    ],
    "description": "cinsel cagrisimli yem baslikli videolar",
    "enabled": true,
    "id": "r4",
    "label": "Cinsel Cagrisimli Yem Basliklar",
    "literals": [],
    "minConfidence": 0.65,
    "origin": "llm",
    "patterns": [
      "frikik verdi",
      "bikini try on haul",
      "try on haul nude",
      "bacak sov",
      "soyunma videosu",
      "gogus dekoltesi",
      "unseen wardrobe malfunction",
      "oops moment hot",
      "frikik izle",
      "gece kulubunde yakalandi"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": false
  },
  {
    "anchors": [
      "siddet",
      "violence",
      "kavga",
      "dovus",
      "gore",
      "kan",
      "fight",
      "brutality"
    ],
    "description": "siddet iceren veya ozendiren video, oyun, haber ve filmler",
    "enabled": true,
    "id": "r5",
    "label": "Siddet Iceren Icerikler",
    "literals": [],
    "minConfidence": 0.8,
    "origin": "llm",
    "patterns": [
      "kavga ani",
      "fena dayak",
      "gore video",
      "brutal fight",
      "street fight knockout",
      "sokak kavgasi dehset",
      "darp ani",
      "behead video",
      "execution video"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "magazin",
      "gossip",
      "unluler",
      "celebrity",
      "paparatzi",
      "magazin bulteni",
      "skandal",
      "showbiz"
    ],
    "description": "magazin haberleri",
    "enabled": true,
    "id": "r6",
    "label": "Magazin Haberleri",
    "literals": [],
    "minConfidence": 0.8,
    "origin": "llm",
    "patterns": [
      "magazin haberleri",
      "unlu oyuncunun son hali",
      "sevgilisinden ayrildi mi",
      "sevgilisiyle yakalandi",
      "magazin dunyasi",
      "celebrity gossip",
      "hollywood drama",
      "bosanma iddiasi",
      "ask iddialarina cevap"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "agir kufur",
      "cussing",
      "profanity",
      "komik video",
      "funny moments",
      "shoutcast",
      "rage compilation"
    ],
    "description": "agir kufur iceren komik videolar",
    "enabled": true,
    "id": "r7",
    "label": "Agir Kufurlu Komik Videolar",
    "literals": [],
    "minConfidence": 0.65,
    "origin": "llm",
    "patterns": [
      "kufurlu montaj",
      "kufurlu komediler",
      "kufurlu tepki",
      "kufurlu yayinci komik",
      "funny swearing compilation",
      "kufurlu troll"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "din",
      "kutsal",
      "religion",
      "sacrilege",
      "blasphemy",
      "kuran",
      "islam",
      "hristiyanlik",
      "teoloji"
    ],
    "description": "dine ve kutsal degerlere hakaret iceren videolar",
    "enabled": true,
    "id": "r8",
    "label": "Dine ve Kutsal Degerlere Hakaret",
    "literals": [],
    "minConfidence": 0.8,
    "origin": "llm",
    "patterns": [
      "dine hakaret",
      "kuran yakma",
      "camide saygisizlik",
      "allah'a kufur",
      "peygambere hakaret",
      "insulting islam",
      "insulting christianity",
      "quran burning",
      "kutsal degerlere hakaret"
    ],
    "stancePolicy": {
      "destekleyici": "allow",
      "elestirel": "block",
      "notr": "allow"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "asparagas",
      "yellow journalism",
      "clickbait news",
      "sansasyonel",
      "yalan haber",
      "fake news",
      "sansasyon"
    ],
    "description": "asparagas, kaynaksiz ve sansasyonel haber uslubu",
    "enabled": true,
    "id": "r9",
    "label": "Asparagas ve Sansasyonel Haber",
    "literals": [],
    "minConfidence": 0.65,
    "origin": "llm",
    "patterns": [
      "sok gelisme",
      "flas haber",
      "inanamayacaksiniz",
      "dunyanin sonu geldi",
      "kimse bunu beklemiyordu",
      "gercek ortaya cikti",
      "shocking truth revealed",
      "you won't believe what happened",
      "secret exposed"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": false
  },
  {
    "anchors": [
      "ateizm",
      "hristiyan misyonerligi",
      "atheism",
      "missionary",
      "din degistirme",
      "tablig",
      "inanis"
    ],
    "description": "ateizmi ve Hristiyan misyonerligini oven veya ozendiren icerikler",
    "enabled": true,
    "id": "r10",
    "label": "Ateizm ve Misyonerlik Ovulmesi",
    "literals": [],
    "minConfidence": 0.65,
    "origin": "llm",
    "patterns": [
      "ateizmin ustunlugu",
      "why christianity is true",
      "jesus is the only way",
      "hristiyanlik gercegi",
      "ateist olmanin faydalari",
      "join christianity",
      "incil gercegi",
      "misyonerlik sohbetleri"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "allow"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "mide bulandiran",
      "asiri yemek",
      "mukbang gross",
      "disgusting food",
      "garip yemekler",
      "weird eating",
      "kusma"
    ],
    "description": "mide bulandiran yemek videolari",
    "enabled": true,
    "id": "r11",
    "label": "Mide Bulandiran Yemek Videolari",
    "literals": [],
    "minConfidence": 0.65,
    "origin": "llm",
    "patterns": [
      "mide bulandiran yemekler",
      "gross food challenge",
      "eating live worms",
      "canli bocek yeme",
      "igrenc yemek tarifleri",
      "disgusting food challenge",
      "eating raw brain",
      "mide bulandiran tarifler",
      "igrenc sokak lezzetleri"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "TikTok compilation",
      "tik tok derleme",
      "cringe",
      "mide bulandiran",
      "garip akimlar",
      "weird trends",
      "tiktok challenge"
    ],
    "description": "mide bulandiran TikTok derlemeleri",
    "enabled": true,
    "id": "r12",
    "label": "Mide Bulandiran TikTok Derlemeleri",
    "literals": [],
    "minConfidence": 0.65,
    "origin": "llm",
    "patterns": [
      "cringe tiktok derlemesi",
      "igrenc tiktok videolari",
      "gross tiktok compilation",
      "mide bulandiran tiktok",
      "disgusting tiktok compilation",
      "cringe tiktok compilation",
      "utanc verici tiktoklar"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "PKK",
      "PYD",
      "teror orgutu",
      "terrorist organization",
      "sode",
      "ozgurluk savuscusu",
      "pkk propagandasi"
    ],
    "description": "PKK ve PYD basta olmak uzere teror orgutlerini oven, ozendiren veya masum gosteren her tur icerik",
    "enabled": true,
    "id": "r13",
    "label": "Teror Orgutleri Ovulmesi",
    "literals": [
      "PKK",
      "PYD"
    ],
    "minConfidence": 0.55,
    "origin": "llm",
    "patterns": [
      "pkk gerillalari",
      "pkk marsi",
      "pyd savunmasi",
      "ypg gerilla",
      "pkk propaganda",
      "free pkk",
      "pkk belgeseli",
      "gerilla tv",
      "ypg propaganda"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "allow"
    },
    "stanceSensitive": true
  },
  {
    "anchors": [
      "tiksindirici",
      "disturbing",
      "rahatsiz edici",
      "bizarre",
      "garip olaylar",
      "gore footage",
      "tiksinme"
    ],
    "description": "normal bir insanin begenmeyecegi, rahatsiz olacagi veya tiksinecegi her sey",
    "enabled": true,
    "id": "r14",
    "label": "Rahatsiz Edici Icerikler",
    "literals": [],
    "minConfidence": 0.8,
    "origin": "llm",
    "patterns": [
      "try not to gag",
      "popping huge pimple",
      "sivilce patlatma dehset",
      "parasite removal",
      "igrenc yaratiklar",
      "gross cyst extraction",
      "try not to feel uncomfortable",
      "mide bulandiran anlar",
      "disturbing videos"
    ],
    "stancePolicy": {
      "destekleyici": "block",
      "elestirel": "allow",
      "notr": "block"
    },
    "stanceSensitive": true
  }
];
