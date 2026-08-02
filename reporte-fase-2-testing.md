# Reporte de testing — Fase 2 (Motor de geometría y parity TS/Rust)

Fecha de ejecución: **2026-08-01** · Estado final: **Fase 2 completa (2.7 incluida — retiro del motor JS)**

## 0. Estado de la Fase 2.7 (actualización del mismo día)

La validación A/B en la app real (`npm run tauri dev`, datos de producción) dio **GO**:

- **72+ comparaciones en sombra** (subdivide, subdivideManzano, computeManzanos, computeRoadNetworkNet): `sombra✗ = 0`.
- **`fallback = 0`** en las 6 operaciones (incluidas las batch, que se validaron por A/B manual ON/OFF: misma cantidad de features y áreas).
- Rendimiento medido en la A/B: `subdivideManzanoBatch` nativo **14 ms** vs JS 108 ms (~7.7x); `computeRoadNetworkNet` nativo **12 ms** vs JS 264 ms (~22x).

Con el GO se ejecutó el **retiro del motor JS**:

| Acción | Detalle |
|---|---|
| `geoWorkerClient.ts` | Reescrito: motor nativo como vía única (`requireNativeRuntime()`), sin fallback ni shadow. API pública intacta. |
| Eliminados | `geoWorker.ts`, `geoOperations.ts`, `geoEngineDiagnostics.ts`, `subdivisionAlgorithms.ts`, `subdivisionCabeceraCuerpo.ts`, `roadNetworkNet.ts`, `fragmentReconciliation.ts`, `nativeEngineStore.ts`, fuzz TS (`src/geo/__fuzz__/`), tests de parity TS↔JS y sus snapshots/generadores, `parity-sync.mjs`, `vitest.parity-sync.config.mjs`, `vitest.fuzz.config.mjs` (31 archivos). |
| Creados | `src/geo/subdivision/types.ts` y `src/geo/roads/types.ts` (tipos compartidos con la crate; antes vivían en el motor JS). |
| Dependencias | `jsts` y `polygon-clipping` fuera de `package.json` (lockfile limpio, 0 referencias). |
| Bundle | Main chunk 1,177 → **1,140 kB** (349 → 338 kB gzip); desaparecieron los chunks lazy del worker JS. |
| Fallback JS en `recomputeManzanos.ts` | Eliminado el recalculo local con `matchFragmentsToMembers` (hilo principal): ahora un fallo del motor nativo aborta la operación con error en consola. |
| CI | `parity.yml` queda solo con `rust-parity` (fixtures congelados en `tests/fixtures/` del crate, ya no se regeneran desde TS); `deploy-pages.yml` dispara solo desde `web-version` (main es desktop-only). |
| Web | La versión web (motor JS + persistencia de navegador) quedó congelada en el branch `web-version`. |

Regresión post-retiro: **todo verde** — `tsc` 0 errores, lint 0, `npm run build` OK, `cargo test -p geourban-geo` 70/70, `--features geos-backend` 77/77 (fuzz Rust incluido). `npm test` queda sin tests TS (los de parity eran TS↔JS) con `passWithNoTests`.

## 1. Resumen ejecutivo

**Todo verde.** La batería completa de tests (JS + Rust, fuzzing incluido) pasa en ~2.5 min. La Fase 2.6 quedó cerrada: los 8 cuelgues y 4 fallos detectados previamente están corregidos, y el motor Rust/GEOS queda como motor por defecto en desktop (Tauri), con JS como fallback automático.

| Suite | Resultado |
|---|---|
| Unit tests TS (Vitest) | 26/26 |
| Fuzz TS (236 casos, seed determinista `0xc0ffee`) | 236/236 |
| Rust sin `geos-backend` | 70/70 |
| Rust con `geos-backend` (GEOS real) | 77/77 |
| Typecheck (`tsc --noEmit`) | 0 errores |
| Lint (ESLint) | 0 errores |
| Build de producción (Vite) | OK (warning de chunk pre-existente) |
| `cargo check --workspace` | OK |

## 2. Batería completa ejecutada

| Comando | Resultado | Duración |
|---|---|---|
| `npm run test:fuzz` | 236 passed (1 archivo) | 17.97 s (transform 1.2 s, tests 9.9 s) |
| `npm test` | 26 passed (4 archivos) | 11.42 s (tests 628 ms) |
| `npm run lint` | exit 0 (warning pre-existente de "Reparsing as ES module") | — |
| `npx tsc --noEmit` | exit 0 | — |
| `npm run build` | `✓ built in 28.74s` | 28.74 s |
| `cargo test -p geourban-geo` (sin feature) | 70 passed | fuzz Rust: 17.10 s |
| `cargo test -p geourban-geo --features geos-backend` | 77 passed | fuzz Rust: 10.97 s |
| `cargo check --workspace` | OK | 22.66 s |

## 3. Desglose por suite

### 3.1 Fuzz TS — `src/geo/__fuzz__/degenerateGeometry.fuzz.test.ts`
- **236/236 casos** (seed `0xc0ffee`), corriendo bajo `scripts/run-vitest-with-watchdog.mjs` (mata el proceso si se cuelga, timeout 120 s).
- **Historial:** pre-fix había **8 cuelgues + 4 fallos**. Causas raíz: coordenadas `huge` (×1e5–1e8) en método `auto` que colgaban los loops, y geometrías no-finitas (`convex#26`, `bowtie#55`) en `exact`/`modo2` que producían resultados no-finitos.
- **Fixes aplicados:** guardas de escala (rechazo de rings inviables) + saneo de entrada `sanitizeRing`/`sanitizeScale` en `subdivideManzano` (TS) y en el motor Rust (política alineada en ambos motores).
- **Regresión:** el fuzz TS comparte corpus con el fuzz Rust (`tests/fuzz_degenerate_geometry.rs`), que pasó en ambas configuraciones.

### 3.2 Unit tests TS — `npm test`
- **26/26 passed, 4 archivos**, incluidos los tests de parity contra fixtures:
  - `computeManzanos.parity.test.ts` (5 tests) — parity con motor Rust vía worker.
- `npm run parity:sync` (regenera fixtures desde Rust) verificado previamente: deja el repo limpio (gate de CI: `git diff --exit-code`).

### 3.3 Rust — `geourban-geo` sin feature GEOS
- **70/70:** 66 unit (lib) + 2 fuzz + 1 `parity_cabecera_cuerpo` + 1 `parity_exact_modo2`.
- `parity_compute_manzanos` y `parity_fragment_reconciliation` quedan en 0 tests (feature-gated).

### 3.4 Rust — con `--features geos-backend` (GEOS real)
- **77/77:** 72 unit (lib) + 2 fuzz + 1 `parity_cabecera_cuerpo` + 1 `parity_compute_manzanos` + 1 `parity_exact_modo2` + 1 `parity_fragment_reconciliation`.
- Fuzz Rust con hard timeout (falla si un caso tarda > ~30 s): 10.97 s en esta corrida.

## 4. Fixes quirúrgicos aplicados en esta sesión

| Fix | Archivo | Detalle |
|---|---|---|
| Closure `area_up_to` faltante | `src-tauri/crates/geourban-geo/src/subdivision_cabecera_cuerpo.rs` (~931, `hb_build_body_zone`) | Compilaba solo por feature-gating; ahora compila en ambos modos. |
| Errores E0499 (borrows múltiples de `rng`) | `src-tauri/crates/geourban-geo/tests/fuzz_degenerate_geometry.rs` (108-113) | Extracción de locales antes de las llamadas. |
| `parity.yml` CI | `.github/workflows/parity.yml` | Job `rust-parity`: instalación de `libgeos-dev` + `pkg-config`; override de `PKG_CONFIG`/`PKG_CONFIG_PATH`/`PKG_CONFIG_LIBDIR` a rutas de Linux (el `.cargo/config.toml` de `src-tauri` inyecta rutas vcpkg/Windows con `force=false`, lo que rompía `geos-sys` en Ubuntu). Nuevo job `fuzz` corriendo `npm run test:fuzz`. |

## 5. Estado del motor dual

- **Rust/GEOS** (`geos-backend`, ON por defecto en `src-tauri/Cargo.toml`): **motor único desde la Fase 2.7** (se retiró el fallback JS tras validar paridad con datos reales). Requiere libgeos: local Windows vcpkg `x64-windows-static`; CI Ubuntu `libgeos-dev`.
- **JS** (`jsts` + `polygon-clipping`): **retirado** (deps, worker, algoritmos y tests eliminados). Sin runtime Tauri no hay motor: la versión web quedó congelada en el branch `web-version`.
- **Parity TS↔Rust:** los fixtures quedaron congelados en `src-tauri/crates/geourban-geo/tests/fixtures/` (ya no se regeneran desde TS); los tests Rust los siguen validando en ambas configuraciones.

## 6. Pendientes (fuera de esta corrida)

1. ~~Fase 2.7~~ — **completada** (ver §0).
2. Web: la versión web congelada en `web-version` (motor JS + persistencia IndexedDB/archivo) queda como producto web; `main` es desktop-only. Si en el futuro se quiere web actualizada, hay que re-crearla desde `main` con un adaptador no-Tauri — fuera de alcance actual.

## 7. Cómo reproducir

```powershell
# JS
npm ci
npm run test:fuzz      # ~18 s, watchdog anti-cuelgue
npm test               # 26 tests, incl. parity
npm run parity:sync    # regenera fixtures (debe dejar el repo limpio)
npm run lint
npx tsc --noEmit
npm run build

# Rust (requiere libgeos: vcpkg en Windows, libgeos-dev en Ubuntu)
cd src-tauri
cargo test -p geourban-geo                 # 70 tests
cargo test -p geourban-geo --features geos-backend   # 77 tests
cargo check --workspace
```
