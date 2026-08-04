# Changelog

Bitácora de hitos del proyecto GeoUrban. Antes estos hitos vivían como
comentarios `// Fase N.M — ...` dispersos por el código (mezclando "qué
hizo" con "por qué"), lo que hacía ilegible cada archivo. La Fase 5 del
plan de optimización los extrajo a este archivo; el código ahora solo
conserva el "por qué" atemporal de cada invariante.

Las fases 0–4 también tienen documentos detallados en `docs/`:
- Fase 0 (baseline) → `docs/phase-0-baseline/BASELINE.md`
- Fase 1 (auditoría código muerto) → `docs/phase-1-audit/CHECKLIST.md`
- Fase 2 (gateo de debug/benchmark) → `docs/phase-2-debug-gating/PHASE-2.md`
- Fase 3 (consolidar resolución de capas) → `docs/phase-3-layer-resolution/PHASE-3.md`
- Fase 4 (refactor `recomputeManzanos.ts`) → `docs/phase-4-recompute-manzanos/PHASE-4.md`

---

## Hitos previos (extraídos de comentarios y git history)

### Motor de geometría

- **Fase 2.7** — Retiro del motor JS (jsts/polygon-clipping). El motor
  Rust/GEOS vía Tauri IPC pasa a ser la única vía de cálculo geométrico.
  Los fixtures de paridad TS↔JS quedaron congelados en
  `src-tauri/crates/geourban-geo/tests/fixtures/`. El script `npm run
  parity:sync` ya no existe (los fixtures se editan a mano).

- **Fase 2.2 / 2.3 / 2.4** — Subdivisión, union/difference GEOS, y la
  pasada incremental de reconciliación de fragmentos. Pipeline base del
  recompute de manzanos.

### Estabilidad de render y datos

- **Fase 3.4** — BUGFIX crítico en `mapStore.loadGeoJson`: se omitía
  `dataProjection` y el default de `ol/format/GeoJSON` (EPSG:4326)
  reinterpretaba las coordenadas como lon/lat, produciendo NaN/Infinity
  tras la proyección Mercator. Con datasets grandes (100k+) eso rompía
  RBush (bboxes no-finitos) y `View.fit()` (extent infinito → "se cuelga").
  Fix: no se reproyecta; se asume que las features ya vienen en el plano
  del proyecto (`dataProjection === featureProjection`).

  En el mismo hito se introdujo `isFiniteExtent()` y se usó en
  `fitToProject()` para validar cada componente del extent (antes solo
  se chequeaba `ext[0] === ±Infinity`; un NaN o un Infinity en
  `ext[1..3]` pasaba y contaminaba el extent combinado).

### CRS y proyección afín

- **Fase 5** — Hardening del CRS afín: mosaico UTM + plano local. Se
  añadió corrección cuadrática de segundo orden al residuo afín (49
  puntos de control) para reducir el error acumulado en extent grandes
  (caso real de ~11km × ~1km donde antes daba err=300.20mm). Tests en
  `affineApprox.test.ts`, `affineCache.test.ts`, `affineCacheTiled.test.ts`.

- **Fase 5.2** — Invalidación explícita de `affineCache` al
  fijar/cambiar el modo de CRS (`projectCrsStore.setMode`). Antes la
  matriz afín cacheada quedaba stale hasta que el próximo cálculo la
  detectara por key mismatch.

- **Fase 5.3** — Soporte para modo CRS "none" (plano local sin EPSG) en
  `fitLocalTangentPlane`. Tests en `affineApprox.test.ts`.

### Benchmarks y datasets sintéticos (DebugPanel)

- **Fase 6.1** — Dataset urbano avanzado: calles con ancho variable +
  avenidas diagonales + rotondas mixtas + perímetro irregular.
  `generateSyntheticUrbanLayout` con seed fija (`Mulberry32`) — es
  determinista. A diferencia del dataset de lotes rectangulares
  precomputados como GeoJSON, este exige el pipeline completo:
  GEOS union/difference → reconciliación de fragmentos → subdivisión.

- **Fase 6.2** — Monitoreo de memoria del proceso nativo (RSS Rust).
  Objetivo: <2GB con 1M features.

- **Fase 6.4** — Carga concurrente: comandos nativos en paralelo
  (subdivisión batch ∥ red vial ∥ dibujo). `concurrencyStressBenchmark`.

- **Fase 4.1 / 4.2** — Comparación rstar nativo vs RBush JS.

- **Fase 3.4 (benchmarks)** — Undo de un trazo vs. undo del proyecto
  entero. Corrida con 500k features.

### UI / estilos

- **Fase 8** — Accesibilidad: reset CSS + foco visible para controles.

- **Fase 2 (UI)** — Consolida estilos CAD de form controls y panel
  header en `src/index.css`.

### Stores y arquitectura

- **Fase 3** — Las 4 funciones de resolución de capa activa
  (`resolveLayerId`, `requireLayerForKind`, `resolveOrCreateLayerForKind`,
  `resolveLoteLayerId`) se consolidan en una sola
  `pickLayerId({ kind, override?, requireKindMatch?, autoCreate? })`.
  Bugfix: `resolveLoteLayerId` usaba la capa activa sin validar que su
  kind coincidiera con `'lote'` (las otras 3 ya lo validaban). Detalle
  en `PHASE-3.md`.

- **Fase 4** — Refactor de `recomputeManzanos.ts`: extracción de
  `computeRoadFingerprintDelta` (función pura testeable) y
  `applyRelotTasks` (helper interno). Detalle en `PHASE-4.md`.

### Tests

- **Fase 3** — Tests de caracterización de `pickLayerId` (26 tests en
  `layerResolution.test.ts`).

- **Fase 4** — Tests unitarios de `computeRoadFingerprintDelta`
  (8 tests en `recomputeManzanos.test.ts`).

- **Fase 5** — Tests de CRS afín (`affineApprox.test.ts`,
  `affineCache.test.ts`, `affineCacheTiled.test.ts`).

---

## Cómo usar este archivo

- Antes de cambiar un comportamiento que toca un invariante protegido
  por un comentario "atemporal" en el código, buscá la fase
  correspondiente acá para entender el contexto histórico completo.
- Para agregar un nuevo hito, preferí un commit con mensaje
  convencional (`feat(scope): ...`, `fix(scope): ...`, etc.) y una
  entrada acá si cambia comportamiento observable. El código no debería
  seguir refiriéndose a "Fase N" — eso era el problema que esta fase
  justamente vino a corregir.