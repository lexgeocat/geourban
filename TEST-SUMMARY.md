# Resumen de tests — GeoUrban

> Última verificación completa: **1 de agosto de 2026 — todo verde** (ver §6).
> Los números de este documento corresponden a esa corrida; los nombres de
> fixtures están tomados del código real (fuente única de verdad).

---

## 1. Cómo correr todo

Orden recomendado (la generación de snapshots SIEMPRE primero, porque los
tests de paridad de ambos lados leen esos archivos):

```bash
npm run parity:sync                     # 1. regenera snapshots desde el motor TS
npm run parity:check                    # 2. tests de paridad TS (4 suites, 26 tests)
npm test                                # 3. suite completa vitest (26 tests)
cd src-tauri
cargo test -p geourban-geo              # 4. Rust sin GEOS (64 unit + 2 parity)
cargo test -p geourban-geo --features geos-backend   # 5. con GEOS (70 unit + 4 parity)
```

| Comando | Alcance |
|---|---|
| `npm run parity:sync` | Corre los 4 tests **generadores** (motor TS) y copia los 4 snapshots a `src-tauri/crates/geourban-geo/tests/fixtures/` |
| `npm run parity:check` | Solo las 4 suites de paridad TS (`src/geo/subdivision/__parity__`, `src/geo/roads/__parity__`, `src/workers/__parity__`) |
| `npm test` | Todo vitest (`vitest run`) |
| `cargo test -p geourban-geo` | Unit tests + parity tests que no requieren GEOS |
| `cargo test -p geourban-geo --features geos-backend` | Agrega los módulos `boolean_ops`/`fragment_reconciliation` y sus parity tests GEOS |

---

## 2. Arquitectura de los tests de paridad

El proyecto tiene **dos motores del mismo algoritmo** (TS/JSTS + polygon-clipping
en el frontend, Rust/GEOS en el crate `geourban-geo`). Los tests de paridad
garantizan que ambos producen el mismo resultado:

```
motor TS (vitest) ──(genera)──> snapshot JSON ──(lee)──> motor TS (assert)
                                        │
                                        └──(copiado por parity:sync)──> motor Rust (assert)
```

- **Generadores** (`__generator__/*.test.ts`): corren el motor TS y escriben
  los snapshots. Solo los corre `parity:sync`.
- **Tests de paridad** (lado TS y lado Rust): leen el snapshot y comparan su
  output contra él con tolerancia. Si el snapshot no existe, **fallan a
  propósito** (no hay skip) para forzar `parity:sync` primero.
- Los fixtures del lado Rust (`fixture_inputs()` en cada `tests/parity_*.rs`)
  están **sincronizados a mano** con los fixtures TS — si se agrega una
  fixture a un lado, hay que agregarla al otro.

---

## 3. Suites de paridad TS (vitest) — 26 tests

### 3.1 `src/geo/subdivision/__parity__/subdivisionCabeceraCuerpo.parity.test.ts` — 5 tests

Algoritmo: `subdivideManzanoCabeceraCuerpo` (método `auto`, el default).
Snapshot: `paritySnapshot.json`. Tolerancias: área `1e-3 m²`, longitudes `1e-3 m`.
Compara: `count`, `totalArea`, `bboxArea`, `remnantCount`, `areas[]`,
`frontMs[]`, `depthMs[]` (además de invariantes: lotes > 0, áreas > 0).

| Fixture | Geometría | target / front | Particularidad |
|---|---|---|---|
| `rectangulo_100x60_target_600` | 100×60 m (6000 m²) | 600 / 10 | ~10 lotes, eje principal autodetectado |
| `rectangulo_angosto_200x40_target_400` | 200×40 m (8000 m²) | 400 / 10 | Manzano angosto → `is_narrow`, reparto por mitad |
| `trapecio_80x80_dir_x` | Trapecio 80×80, esquina sesgada | 500 / 12 | `dirPref` forzada en eje X — **el caso que destapó el bug de paridad del harness** |
| `cuadrado_40x40_target_200` | 40×40 m (1600 m²) | 200 / 8 | Min-area + camino cabeza/cuerpo con muchos lotes |
| `forma_L_dir_y` | Forma L (~2100 m²) | 300 / 10 | `dirPref` forzada en eje Y |

### 3.2 `src/geo/subdivision/__parity__/subdivisionExactModo2.parity.test.ts` — 10 tests

Algoritmos: `subdivideManzanoExact` y `subdivideManzanoAuto` (métodos `exact`
y `modo2` del dispatcher). Snapshot: `paritySnapshotExactModo2.json`.
Mismas tolerancias y métricas que 3.1. Las 5 geometrías de 3.1 (rectángulo,
rectángulo angosto, trapecio con `dirPref` X, cuadrado, forma L con `dirPref` Y)
corridas con **cada método** (`exact` ×5, `modo2` ×5).

### 3.3 `src/geo/roads/__parity__/fragmentReconciliation.parity.test.ts` — 6 tests

Algoritmo: `matchFragmentsToMembers` (asignación greedy por mejor solapamiento,
`MATCH_MIN_RATIO = 0.35`). Snapshot: `fragRecParitySnapshot.json`.
Tolerancia de `overlapArea`: `1e-3 m²`. Compara el orden de assignments
(greedy descendente por overlap) y cada `fragmentIdx`/`memberIdx`/`overlapArea`.

| Fixture | Escenario |
|---|---|
| `caso_identidad` | Fragmento = miembro → match 100% |
| `caso_parcial` | Solapamiento parcial → match seguro |
| `caso_sin_match` | Fragmento separado → overlap 0, sin match |
| `caso_bajo_umbral` | Overlap 0.0025 < `MATCH_MIN_RATIO` → sin match |
| `caso_multi_fragmentos` | 2 fragmentos ↔ 2 miembros, match 1:1 |
| `caso_competencia` | 2 fragmentos compiten por 1 miembro → gana el de mayor overlap, el otro queda sin asignar |

### 3.4 `src/workers/__parity__/computeManzanos.parity.test.ts` — 5 tests

Algoritmo: `computeManzanos` (JSTS: union de la red vial + difference por
parcela + separación de componentes). Snapshot:
`computeManzanosParitySnapshot.json`. Tolerancia de áreas: **`1e-2 m²`**
(es la tolerancia deliberadamente más lava: JSTS y GEOS pueden redondear
vértices de intersección de forma ligeramente distinta). Compara:
`fragmentCount`, `totalArea`, `areasByParcel` (sorteadas).

| Fixture | Escenario |
|---|---|
| `single_road_bisects_square_parcel` | Una calle corta la parcela en 2 |
| `two_perpendicular_roads_grid` | Dos calles perpendiculares → **fragmentación MultiPolygon** (el caso crítico de redondeo JSTS vs GEOS) |
| `road_outside_parcel_leaves_parcel_intact` | Calle fuera de la parcela → intacta |
| `road_clips_a_single_corner` | Calle recorta solo una esquina |
| `two_parcels_one_shared_road` | 2 parcelas + 1 calle compartida |

---

## 4. Tests generadores de snapshots (TS) — 4 tests

Solo los ejecuta `npm run parity:sync` (vía `vitest.parity-sync.config.mjs`):

| Generador | Snapshot que escribe |
|---|---|
| `src/geo/subdivision/__parity__/__generator__/buildSnapshot.test.ts` | `subdivision/__parity__/paritySnapshot.json` |
| `src/geo/subdivision/__parity__/__generator__/buildSnapshotExactModo2.test.ts` | `subdivision/__parity__/paritySnapshotExactModo2.json` |
| `src/geo/roads/__parity__/__generator__/buildFragRecSnapshot.test.ts` | `roads/__parity__/fragRecParitySnapshot.json` |
| `src/workers/__parity__/__generator__/buildComputeManzanosSnapshot.test.ts` | `workers/__parity__/computeManzanosParitySnapshot.json` |

`scripts/parity-sync.mjs` copia los 4 a
`src-tauri/crates/geourban-geo/tests/fixtures/` con el mismo nombre.

---

## 5. Tests Rust (`cargo test -p geourban-geo`) — 64 + 6 con feature

### 5.1 Unit tests en el crate (64 sin feature, 70 con `geos-backend`)

| Módulo | Tests | Qué cubren |
|---|---|---|
| `math` | 19 | Área, perímetro, centroide, convex hull, proyección sobre ejes, eje principal (unit vector con `ux >= 0`), clip a strip, corte en 2, intersección punto/segmento-polígono, path length, casos vacíos/degenerados |
| `roads` | 13 | Offset de polilínea (miter/straight), fillet (radio según ángulo y ancho, con tope), chamfer vs fillet, `round_ring_reflex` (none/fillet/chamfer), `point_on_ring`, construcción de rings de red vial (con/sin rotondas, anchos inválidos) |
| `roundabout` | 11 | Anillo circular (segmentos por defecto/específicos), ngon, isla (con/sin según radio), área vial, validación de params (radio, lados, ancho vs radio) |
| `sanitize` | 10 | Limpieza de rings: no-finito, <3 puntos, área bajo umbral, colineales espurios, dedupe que colapsa todo, batch con descarte de inválidos, passthrough de no-polygon |
| `types` | 5 | Serialización JSON de `Pt`, `SubdivisionOptions` (opcionales → null), kebab/lowercase de métodos (`exact`, `modo2`, `auto`) — alineados con el TS |
| `geojson` | 3 | Roundtrip de ring, rechazo de array corto, ignorar Z |
| `subdivision_cabecera_cuerpo` (smoke) | 2 | Lotes en rectángulo simple + idempotencia sobre 5 manzanos |
| `boolean_ops` (solo con feature) | 2 | Smoke de GEOS: unión y diferencia de rectángulos |
| `fragment_reconciliation` (solo con feature) | 4 | Asignación greedy por mayor solapamiento, sin competición tras asignar, sin asignar bajo `MATCH_MIN_RATIO`, fragmento huérfano |
| `scaffolding_tests` | 1 | El crate compila y expone `crate_version()` |

### 5.2 Tests de paridad de integración (tests/parity_*.rs) — 4 tests

Cada uno lee un snapshot de `tests/fixtures/` y replica los fixtures TS
localmente (assert de "fixture desconocida" si el snapshot trae una que no
existe en el código Rust):

| Archivo | Snapshot | Requiere `geos-backend` | Cobertura |
|---|---|---|---|
| `parity_cabecera_cuerpo.rs` | `paritySnapshot.json` | no | Las 5 fixtures de subdivisión `auto` (área `1e-3`, longitudes `1e-3`) |
| `parity_exact_modo2.rs` | `paritySnapshotExactModo2.json` | no | Las 10 fixtures `exact`/`modo2` |
| `parity_fragment_reconciliation.rs` | `fragRecParitySnapshot.json` | **sí** | Las 6 fixtures de `matchFragmentsToMembers` (área `1e-3`) |
| `parity_compute_manzanos.rs` | `computeManzanosParitySnapshot.json` | **sí** | Las 5 fixtures de `computeManzanos` (área **`1e-2`**) |

---

## 6. Estado verificado (1 de agosto de 2026)

```
npm run parity:sync   ✔  4 generadores ok, 4 snapshots copiados
npm test              ✔  4 suites, 26 tests
cargo test -p geourban-geo              ✔  64 unit + 2 parity (cabecera_cuerpo, exact_modo2)
cargo test -p geourban-geo --features geos-backend   ✔  70 unit + 4 parity
```

Observaciones de esa corrida:

- `parity_compute_manzanos` **pasó** — incluyendo `two_perpendicular_roads_grid`
  (fragmentación MultiPolygon): las diferencias de área JSTS vs GEOS quedaron
  dentro de `1e-2` con la precisión actual, por lo que **no hace falta afinar
  `UNION_PRECISION` todavía**. Si en el futuro ese test fallara con diferencias
  > 1e-2, es la señal de que la Fase 2.3 necesita ajustar el snapping de
  intersección — no asumir que el fixture está mal.
- Warning menor (no bloqueante): campo `ring_area` nunca leído en
  `parity_exact_modo2.rs:43`.

---

## 7. Convenciones

- **Nuevo fixture de paridad** → agregarlo en 4 lugares: fixtures TS + test
  TS (si aplica), `fixture_inputs()` en el `parity_*.rs` correspondiente, y
  regenerar con `npm run parity:sync`.
- **Los tests de paridad fallan a propósito sin snapshot** — nunca hacer
  skip; la primera corrida después de un cambio de fixture tiene que pasar
  por `parity:sync`.
- **Tolerancias**: subdivisión y reconciliación usan `1e-3` (área m² y
  longitudes m); computeManzanos usa `1e-2` (deliberado, por redondeo de
  vértices de intersección entre motores).
