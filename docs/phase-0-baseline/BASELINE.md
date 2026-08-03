# Fase 0 — Baseline

Snapshot del estado del repo al cierre de la Fase 0, antes de empezar la Fase 1 (auditoría, solo lectura) y la Fase 2 (sacar debug de producción).

Todos los artefactos de esta fase viven en `docs/phase-0-baseline/` y son reproducibles: los comandos exactos están al pie de este archivo. La Fase 2 los reusa para medir impacto (tamaño de bundle, tiempo de frame), y la Fase 9 los usa como red de seguridad al introducir tests.

## Entorno

| Item                | Valor                                       |
| ------------------- | ------------------------------------------- |
| OS                  | Windows (PowerShell 5.1)                    |
| Branch base         | `chore/cleanup` (desde `main` @ `9e24caa`)  |
| Node                | v24.16.0                                    |
| npm                 | 11.13.0                                     |
| Cargo               | 1.97.1                                      |
| `git grep`          | disponible (verificado con comando vacío)   |
| `git` user.name/email | Cristian Ruiz / cristianruiz.10.cr40@gmail.com |

`docs/phase-0-baseline/` se versiona en git. Es la **red de seguridad** de las fases siguientes, no un artefacto de un solo uso.

## Comandos del baseline

| # | Comando                                                                         | Resultado                                       | Artefacto                                  |
| - | ------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------ |
| 1 | `git checkout -b chore/cleanup`                                                 | branch creado desde `main` (`9e24caa clean`)    | (rama git)                                 |
| 2 | `npm run lint`                                                                  | **2 errors, 3 warnings**                        | `docs/phase-0-baseline/lint.txt`           |
| 3 | `npm test`                                                                      | **50/50 passed** (7 test files, 8.38s)          | `docs/phase-0-baseline/vitest.txt`         |
| 4 | `npm run build`                                                                 | OK en 21.48s, bundle 1.20 MB                    | `docs/phase-0-baseline/build.txt`          |
| 5 | `cargo test -p geourban-geo` (workdir `src-tauri/`, sin feature)                | PASS (1.97s últimos 4 binaries)                 | `docs/phase-0-baseline/cargo-test-no-geos.txt` |
| 6 | `cargo test -p geourban-geo --features geos-backend` (workdir `src-tauri/`)     | PASS (incluye 3 tests sintéticos)               | `docs/phase-0-baseline/cargo-test-geos.txt` |

## Resumen ejecutivo del baseline

- **Lint:** 2 errores (`no-empty` en bloques vacíos) y 3 warnings (`react-hooks/exhaustive-deps`). No son bugs nuevos del plan; son el estado actual de la base. La Fase 7 los va a tocar de forma indirecta al endurecer el tipado, pero los warnings de hooks **no** entran en el alcance de este plan salvo que aparezcan al refactorizar.
- **Tests TS (Vitest):** 50/50 verdes. Cobertura concentrada en `geo/crs/*` y `geo/debug/*` (los benchmarks). Confirma lo que dice el plan: la lógica de producto (`commands/core`, `store/entities`, `geo/recomputeManzanos`) no tiene tests TS hoy.
- **Build de producción:** 1 chunk JS de **1,196,965 bytes** (≈ 1.17 MB sin gzip; 356.22 kB gzip) + 21,983 bytes de CSS. Total `dist/`: 1,220,600 bytes (1.16 MB). El warning de Vite ">500 kB" sale tal cual; **no** es un problema de este plan.
- **Tests Rust (sin GEOS):** todos los binaries de paridad y sintéticos pasan. El plan detectó (Fase 11.1) que algunos asserts de los tests de paridad referencian un script `npm run parity:sync` que no existe — esto se corrige en la Fase 11, no en esta.
- **Tests Rust (con GEOS):** pasa, incluyendo los 3 tests sintéticos de subdivisión/reconciliación que son los más sensibles a la paridad TS↔Rust.

## Tamaño del bundle (referencia para Fase 2)

```
dist/assets/index-Bb5Ic5-0.js   1,196,965 bytes (gzip 356,224)
dist/assets/index-D4kTKiQE.css     21,983 bytes (gzip   5,376)
dist/                            1,220,600 bytes total
```

> Nota: el hash del archivo (`Bb5Ic5-0`, `D4kTKiQE`) cambia con cada build por el content-hash de Vite. El nombre no es estable entre fases; el **tamaño en bytes** sí lo es.

## Errores y warnings de lint (detalle)

Líneas exactas de `docs/phase-0-baseline/lint.txt`:

```
  678:3  warning  React Hook useMemo has unnecessary dependencies: 'roundabouts', 'streets', and 'tick'. ...  react-hooks/exhaustive-deps
  114:3  warning  React Hook useMemo has an unnecessary dependency: 'tick'. ...                                  react-hooks/exhaustive-deps
  397:6  warning  React Hook useEffect has missing dependencies: 'baseMapId', 'viewConfig.center', and 'viewConfig.zoom'. ...  react-hooks/exhaustive-deps
   29:11 error    Empty block statement                                                                          no-empty
   58:11 error    Empty block statement                                                                          no-empty
✖ 5 problems (2 errors, 3 warnings)
```

Los 2 errores `no-empty` no están en los 3 archivos congelados del plan; se arreglan en la Fase 7 junto con el endurecimiento de tipado, si tocan esos archivos, o quedan para una fase posterior si no. **No se tocan en esta fase.**

## Archivos congelados (no trabajar sobre ellos hasta que se llegue a su fase)

Estos 3 archivos se tocan en más de una fase del plan (Fases 3, 4 y 9). La Fase 0 los "congela" en el sentido de que **no se les hace trabajo paralelo** mientras se ejecutan las fases siguientes, para que cada fase pueda basarse en su estado al final de la anterior:

| Archivo                                          | Fases que lo tocan | Estado al cierre de Fase 0 |
| ------------------------------------------------ | ------------------ | -------------------------- |
| `src/geo/recomputeManzanos.ts`                   | 3, 4, 8            | sin cambios vs `main`      |
| `src/store/ui/layerPickerStore.ts`               | 3, 9               | sin cambios vs `main`      |
| `src/store/entities/layerAutoCreate.ts`          | 3, 9               | sin cambios vs `main`      |

Verificado con `git diff --stat HEAD -- <archivos>` → vacío.

## Reproducir este baseline

```powershell
# desde F:\lexgeocat-geourban
git checkout main
git checkout -b chore/cleanup

mkdir docs\phase-0-baseline -Force

# 1) lint
npm run lint 2>&1 | Tee-Object -FilePath docs\phase-0-baseline\lint.txt

# 2) vitest
npm test 2>&1 | Tee-Object -FilePath docs\phase-0-baseline\vitest.txt

# 3) build + tamaño
npm run build 2>&1 | Tee-Object -FilePath docs\phase-0-baseline\build.txt
Get-ChildItem dist\assets -File |
  Select-Object Name, Length |
  Out-File -FilePath docs\phase-0-baseline\bundle-sizes.txt -Encoding utf8

# 4) Rust sin GEOS
cd src-tauri
cargo test -p geourban-geo 2>&1 | Tee-Object -FilePath ..\docs\phase-0-baseline\cargo-test-no-geos.txt

# 5) Rust con GEOS
cargo test -p geourban-geo --features geos-backend 2>&1 | Tee-Object -FilePath ..\docs\phase-0-baseline\cargo-test-geos.txt
```

## Próximos pasos

- **Fase 1** (auditoría, solo lectura) puede arrancar de inmediato. No toca código, solo lee y grepea.
- **Fase 2** (sacar debug de producción) reusa `dist/assets/*` y `vitest.txt` para medir impacto.
- **Fase 11** (CI: mensajes rotos + gate) puede arrancar en paralelo con la Fase 2; apalanca todo lo demás.
