# Testovacie kontajnery ICDD

- `aim-small.icdd` - zložený exportným kódom AIM (`lib/icdd/audit-fixture.test.ts`), obnova:
  `ICDD_FIXTURE_UPDATE=1 npx vitest run lib/icdd/audit-fixture.test.ts`.
- `11_Garage_Binary.icdd` - bez zmeny z repozitára
  [philhag/icdd-shacl-validation](https://github.com/philhag/icdd-shacl-validation) (`datasets/1/icdd/`, commit b15113f),
  licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Autori: P. Hagedorn, P. Pauwels, M. König,
  "Semantic rule checking of cross-domain building data in information containers for linked document delivery
  using the shapes constraint language", Automation in Construction 156 (2023) 105106,
  https://doi.org/10.1016/j.autcon.2023.105106. Slúži ako nezávisle vyrobený kontajner (ICDD Platform RUB) pre
  `etl/tests/test_icdd_audit.py`.
