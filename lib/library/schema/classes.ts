/**
 * Triedne metadáta typov poznámok a pod-záznamov (port ClassVar pydantic z `assetin/schema/typy`, D-186 krok 4):
 * rámec noriem, hraničné pásma, popisky, ikony, poradie v ľavom paneli, stĺpce registra, sekcie tela.
 * JSON Schema ich nenesie; vznikli jednorazovým výpisom z Pythonu (assetin-library f7c103c) a odteraz sú pravdou v TS
 * (menia sa ručne a naraz s Pythonom, kým port trvá).
 */

export interface TriedaTypu {
  TYP?: string;
  DRUH?: string;
  SEKCIE?: string[];
  POD_ZAZNAMY?: string[];
  RAMEC?: string;
  PRIEREZOVE?: boolean;
  HRANICNE?: string[];
  HRANICNE_AK?: [string, string] | null;
  IKONA?: string;
  POPISOK?: string;
  POPISOK_EXPORT?: string;
  PORADIE_UI?: number;
  STLPCE?: string[];
  SEKCIA_PRECO?: string;
  ASPEKTY?: string[];
}

export const TYPE_CLASSES: Record<string, TriedaTypu> = {
  "GOAL": {
    "TYP": "GOAL",
    "SEKCIE": [
      "Popis"
    ],
    "POD_ZAZNAMY": [],
    "RAMEC": "19650-1",
    "PRIEREZOVE": false,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-target",
    "POPISOK": "Ciele",
    "POPISOK_EXPORT": "Ciele",
    "PORADIE_UI": 1,
    "STLPCE": [
      "nazov",
      "uroven",
      "zdroj_ir",
      "stav"
    ]
  },
  "UC": {
    "TYP": "UC",
    "SEKCIE": [
      "Zhrnutie",
      "Cieľ a rozsah",
      "Vymedzenie (čo use case nie je)",
      "Rámcové podmienky",
      "Prínosy",
      "Spúšťacia udalosť",
      "Aktéri",
      "Hierarchia",
      "Business context",
      "Business rules",
      "Fázy → ER"
    ],
    "POD_ZAZNAMY": [],
    "RAMEC": "29481",
    "PRIEREZOVE": false,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-route",
    "POPISOK": "Účely užitia",
    "POPISOK_EXPORT": "Účely užitia",
    "PORADIE_UI": 2,
    "STLPCE": [
      "nazov",
      "typ_ulohy",
      "faza_iso22263",
      "zrelost",
      "stav"
    ],
    "SEKCIA_PRECO": "Cieľ a rozsah"
  },
  "ER": {
    "TYP": "ER",
    "SEKCIE": [
      "Popis",
      "Informačné jednotky",
      "Prepisy pre túto výmenu"
    ],
    "POD_ZAZNAMY": [],
    "RAMEC": "29481",
    "PRIEREZOVE": false,
    "HRANICNE": [
      "29481",
      "7817"
    ],
    "HRANICNE_AK": null,
    "IKONA": "ti-arrows-exchange",
    "POPISOK": "Výmeny",
    "POPISOK_EXPORT": "Požiadavky na výmenu",
    "PORADIE_UI": 4,
    "STLPCE": [
      "nazov",
      "poskytovatel_predvoleny",
      "prijemca",
      "spustacia_udalost",
      "stav"
    ]
  },
  "IU-O": {
    "TYP": "IU-O",
    "SEKCIE": [
      "Členenie (iba výnimky voči STD-clenenie)",
      "Roly",
      "Trasovateľnosť",
      "Väzby"
    ],
    "POD_ZAZNAMY": [],
    "RAMEC": "7817",
    "PRIEREZOVE": false,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-box",
    "POPISOK": "Objekty",
    "POPISOK_EXPORT": "LOIN — typy objektov",
    "PORADIE_UI": 5,
    "STLPCE": [
      "nazov",
      "objekt.ifc_entita",
      "uroven",
      "pritomnost_v_modeli",
      "zavaznost_predvolena",
      "stav"
    ],
    "ASPEKTY": [
      "geometria",
      "alfanumerika",
      "dokumentacia"
    ]
  },
  "IU-C": {
    "TYP": "IU-C",
    "SEKCIE": [
      "Ukotvenie (povinné, ≥1)",
      "Obsah (M:N)",
      "Roly",
      "TIDP väzby",
      "Väzby"
    ],
    "POD_ZAZNAMY": [],
    "RAMEC": "7817",
    "PRIEREZOVE": false,
    "HRANICNE": [
      "29481",
      "7817"
    ],
    "HRANICNE_AK": null,
    "IKONA": "ti-file",
    "POPISOK": "Kontajnery",
    "POPISOK_EXPORT": "LOIN — kontajnery",
    "PORADIE_UI": 6,
    "STLPCE": [
      "nazov",
      "druh",
      "forma.format",
      "viaze_sa_na",
      "stav"
    ]
  },
  "STD": {
    "TYP": "STD",
    "SEKCIE": [],
    "POD_ZAZNAMY": [
      "pravidlo",
      "profil",
      "slovnik"
    ],
    "RAMEC": "",
    "PRIEREZOVE": true,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-ruler",
    "POPISOK": "Pravidlá a konvencie",
    "POPISOK_EXPORT": "Informačný štandard",
    "PORADIE_UI": 7,
    "STLPCE": [
      "nazov",
      "stav"
    ]
  },
  "PROP": {
    "TYP": "PROP",
    "SEKCIE": [
      "Popis"
    ],
    "POD_ZAZNAMY": [],
    "RAMEC": "",
    "PRIEREZOVE": true,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-tag",
    "POPISOK": "Vlastnosti",
    "POPISOK_EXPORT": "Vlastnosti",
    "PORADIE_UI": 10,
    "STLPCE": [
      "nazov",
      "datovy_typ",
      "jednotka",
      "velicina",
      "stav"
    ]
  },
  "DEF": {
    "TYP": "DEF",
    "SEKCIE": [
      "Poznámka"
    ],
    "POD_ZAZNAMY": [],
    "RAMEC": "",
    "PRIEREZOVE": true,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-ruler-measure",
    "POPISOK": "Definície",
    "POPISOK_EXPORT": "Definície a meracie pravidlá",
    "PORADIE_UI": 8,
    "STLPCE": [
      "nazov",
      "jednotka",
      "zaokruhlenie",
      "tolerancia",
      "stav"
    ]
  },
  "EV": {
    "TYP": "EV",
    "SEKCIE": [
      "Popis"
    ],
    "POD_ZAZNAMY": [],
    "RAMEC": "29481",
    "PRIEREZOVE": false,
    "HRANICNE": [
      "29481",
      "19650-2-eir"
    ],
    "HRANICNE_AK": [
      "typ_udalosti",
      "delivery"
    ],
    "IKONA": "ti-bolt",
    "POPISOK": "Spúšťacie udalosti",
    "POPISOK_EXPORT": "Udalosti",
    "PORADIE_UI": 3,
    "STLPCE": [
      "nazov",
      "typ_udalosti",
      "faza_iso22263",
      "planovana",
      "relativny_termin"
    ]
  },
  "ACT": {
    "TYP": "ACT",
    "SEKCIE": [
      "Popis"
    ],
    "POD_ZAZNAMY": [],
    "RAMEC": "",
    "PRIEREZOVE": true,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-users",
    "POPISOK": "Aktéri",
    "POPISOK_EXPORT": "Aktéri",
    "PORADIE_UI": 9,
    "STLPCE": [
      "nazov",
      "uroven",
      "strana",
      "klasifikacia_19650"
    ]
  },
  "PROT": {
    "TYP": "PROT",
    "SEKCIE": [],
    "POD_ZAZNAMY": [],
    "RAMEC": "19650-2-eir",
    "PRIEREZOVE": false,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-file-text",
    "POPISOK": "Protokoly",
    "POPISOK_EXPORT": "BIM protokol",
    "PORADIE_UI": 11,
    "STLPCE": [
      "nazov",
      "stav",
      "verzia"
    ]
  },
  "PROJ": {
    "TYP": "PROJ",
    "SEKCIE": [
      "Popis"
    ],
    "POD_ZAZNAMY": [],
    "RAMEC": "19650-2-eir",
    "PRIEREZOVE": false,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-briefcase",
    "POPISOK": "Projektové inštancie",
    "POPISOK_EXPORT": "EIR",
    "PORADIE_UI": 12,
    "STLPCE": [
      "nazov",
      "stav",
      "verzia"
    ]
  }
};

export const SUB_RECORD_CLASSES: Record<string, TriedaTypu> = {
  "pravidlo": {
    "DRUH": "pravidlo",
    "RAMEC": "",
    "PRIEREZOVE": true,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-ruler",
    "POPISOK": "Pravidlá",
    "POPISOK_EXPORT": "Pravidlá informačného štandardu",
    "PORADIE_UI": 99,
    "STLPCE": [
      "nazov",
      "rozsah",
      "plati",
      "overenie",
      "zavaznost"
    ]
  },
  "profil": {
    "DRUH": "profil",
    "RAMEC": "",
    "PRIEREZOVE": true,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-ruler-measure",
    "POPISOK": "Profily geometrie",
    "POPISOK_EXPORT": "LOIN — geometria",
    "PORADIE_UI": 99,
    "STLPCE": [
      "nazov",
      "vhodne_pre",
      "dictionary"
    ]
  },
  "slovnik": {
    "DRUH": "slovnik",
    "RAMEC": "",
    "PRIEREZOVE": true,
    "HRANICNE": [],
    "HRANICNE_AK": null,
    "IKONA": "ti-list",
    "POPISOK": "Slovníky",
    "POPISOK_EXPORT": "Slovníky a číselníky",
    "PORADIE_UI": 99,
    "STLPCE": [
      "nazov",
      "system",
      "vzor",
      "odvodene_z"
    ]
  }
};

/** `uc.POPISKY_TYPU_ULOHY`. */
export const POPISKY_TYPU_ULOHY: Record<string, string> = {"delivery": "dodanie", "utilization": "použitie a prevzatie"};
