# Stabilny turbo hash: presun per-commit premennych do tasku viewera

## Problem
Vercel projekt `ifc-lite-viewer` (fork Menezeris/ifc-lite) platil okolo 40 USD za Build CPU. Kazde zostavenie trvalo ~7 min (Enhanced stroj) a vsetkych 57 turbo uloh bolo "cache miss", aj `@ifc-lite/wasm` (Rust cez wasm-pack, ~3 min), hoci "Remote caching enabled".

## Pricina (overena)
V koreni `turbo.json` bol v `tasks.build.env` zoznam `VERCEL_GIT_COMMIT_SHA`, `VERCEL_DEPLOYMENT_ID`, `VERCEL_SKEW_PROTECTION_ENABLED`, `GITHUB_SHA`. `env` vstupuje do hashu KAZDEJ build ulohy, takze kazdy commit zmenil hash vsetkych balikov. Porovnanie dvoch po sebe iducich produkcnych buildov cez Vercel API (660ebd8 vs 625cabd): z 57 uloh nema ani jedna rovnaky hash (napr. wasm 0198f0c2... vs iny). Tieto premenne cita iba `apps/viewer/vite.config.ts` (`__BUILD_SHA__`, `assetsDir`).

Hlaska "Turbo Remote Cache NOT configured" v `scripts/vercel-build.sh` bola zavadzajuca: Vercel Remote Cache sa na Vercel builde zapina sam, bez TURBO_TOKEN.

## Zmena (upstream subory, vsetko v AIM-FORK blokoch)
- `turbo.json`: 4 premenne odstranene z root `build.env` (komentar v bloku AIM-FORK).
- `apps/viewer/turbo.json` (novy): `extends: ["//"]`, `build.env` = `$TURBO_EXTENDS$` (zachova VITE_*) + tie 4 premenne. Viewer bundle sa teda dalej zostavi pri kazdom commite a nesie spravny SHA / deployment ID.
- `scripts/vercel-build.sh`: pravdivá hlaska o Remote Cache.

Rezim CI podla `docs/FORK_MAINTENANCE.md`: zmena mimo `apps/viewer/` blokov = `upstream` (rychla cesta, na main iba v release davke `release/aim-*`). Nemeni Rust ani build pipeline.

## Odhad usetreny
Z logu buildu 660ebd8: clone 18 s, install ~20 s, wasm 2m57s, ostatne balicky ~1,5 min (tsc), viewer vite 2m01s, celkom 7 min. Pri commite bez zmeny Rust/balickov sa wasm a 56 uloh trafi do cache, ostane viewer (~2 min) + clone/install: cca 3 min namiesto 7, teda **~55-60 % minut** (z ~40 USD na ~17 USD pri rovnakom poctu buildov). Prvy build po nasadeni je este miss (nove hashe), az druhy trafi cache. Build, ktory meni Rust alebo balicek, prebuilda len dotknute ulohy a ich zavislych.

## Ako vyskusat
```bash
git clone https://github.com/Menezeris/ifc-lite && cd ifc-lite
git checkout 660ebd8635496c3f0150f29a8f009adcaa761e7c
git am /cesta/k/fork-turbo-cache.patch    # sha256 v README.md
# dry run, dva rozne "commity" (len SHA a deployment ID sa lisia)
VERCEL_GIT_COMMIT_SHA=aaaa VERCEL_DEPLOYMENT_ID=dpl_1 npx turbo@2.11.7 run build --filter='@ifc-lite/viewer...' --dry=json > a.json
VERCEL_GIT_COMMIT_SHA=bbbb VERCEL_DEPLOYMENT_ID=dpl_2 npx turbo@2.11.7 run build --filter='@ifc-lite/viewer...' --dry=json > b.json
# porovnaj hashe: ocakavane je, ze sa lisi iba @ifc-lite/viewer#build
python3 -c "import json;f=lambda p:{t['taskId']:t['hash'] for t in json.load(open(p))['tasks']};a,b=f('a.json'),f('b.json');print([k for k in a if a[k]!=b[k]])"
```
Namerane: bez patchu 0/57 stabilnych hashov, s patchom 56/57 (zmenil sa iba `@ifc-lite/viewer#build`; `@ifc-lite/wasm#build` stabilny).

Po nasadeni: v logu druheho buildu hladaj `cache hit, replaying logs` pri `@ifc-lite/wasm:build` a "Cached: 56 cached, 57 total".

## Neoverene / dalsie kroky
- Realnu cache na Verceli nemam ako overit bez nasadenia (dry run overuje len hash).
- Volitelne (nerobene, vacsi zasah): `vercel-install.sh` hlada tag `@ifc-lite/wasm@10.4.0` vo forku, kde neexistuje, takze pri kazdom builde instaluje Rust toolchain (~20 s) aj ked turbo wasm prebuilduje z cache. Ak by sa tag bral z upstreamu LTplus-AG, odpadne aj to a pri zmene Rustu by islo prebuilt cestou.

Tento PR nemenil produkcne modely ani viewer naživo.
