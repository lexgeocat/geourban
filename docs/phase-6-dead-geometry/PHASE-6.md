# Fase 6 — Eliminar código geométrico TS confirmado como muerto

**Estado: COMPLETADA.** El plan listaba 8 símbolos en `polygonEngine.ts` que la auditoría de Fase 1 confirmó como sin consumidores externos. Además, 2 helpers privados quedaron sin uso tras el borrado y también se eliminaron.

## Cambios aplicados

### Símbolos exportados borrados de `polygonEngine.ts`

| Símbolo | Tipo | Razón |
| --- | --- | --- |
| `SliceResult` | interface | Sin importadores. Los matches homónimos en Rust son tipos separados. |
| `CutResult` | interface | Idem. |
| `convexHull` | function | Sin importadores externos (solo `index_modelo.html` legacy). |
| `principalAxis` | function (PCA) | Idem. |
| `projectExtents` | function | Idem. |
| `clipHalfPlane` | function | Sin consumidores externos; solo lo usaba `clipToStrip` internamente. |
| `clipToStrip` | function | Sin importadores. |
| `buildCutPolys` | function | Sin importadores. |

### Helpers privados borrados (quedaron sin consumidores al sacar las funciones que los usaban)

| Helper | Consumía |
| --- | --- |
| `side` (cross product) | Solo `clipHalfPlane` y `clipToStrip` (líneas eliminadas). |
| `lineLineIntersect` | Solo `clipHalfPlane` (línea eliminada). |

### Sobreviven (todos con consumidores vivos)

`Pt`, `LotResult`, `polyArea`, `centroid`, `ringPerimeter`, `pathLength`, `pointInPoly`, `segmentIntersectsPoly`.

## Verificación

| Check | Resultado |
| --- | --- |
| `git grep` post-borrado de los 8 símbolos | 0 hits en `src/**/*.ts` y `src/**/*.tsx` |
| `npx tsc --noEmit -p tsconfig.json` | ✅ sin output |
| `npm run lint` | ✅ 0 errores / 3 warnings preexistentes |
| `npm test` (Vitest) | ✅ 146/146 passed (12 files, 7.01s) — incluye los 26 tests de Fase 3 y los 17 de Fase 9 que ejercitan `pointInPoly`/`segmentIntersectsPoly` indirectamente |
| `npm run build` | ✅ OK en 16.82s, bundle 1126.6 kB |

### Tamaño del archivo

- Antes de la fase: **288 líneas** (con 8 funciones/tipos muertos + 2 helpers privados)
- Después: **77 líneas**
- Δ: **−211 líneas (−73%)** de código borrado.

### Bundle JS

- Bundle de producción: **1,126.6 kB** (post-Fase 6).
- La reducción es marginal (~5-10 kB minificado) porque los símbolos eran pequeños, pero el código fuente queda mucho más limpio.

## Lo que la Fase 6 **no** toca (queda para Fase 13 o decisión de producto)

- `src/types/vendor.d.ts` y las deps `dxf-parser`/`dxf-writer`/`shpjs`/`shp-write`/`jszip` (Fase 13 — Fase 1.2 confirmó que tampoco tienen consumidores).
- Copy de UI en `StatusBar.tsx:324` y `ProjectSetupModal.tsx:56,70,99` que promete "exportar/importar DXF" — **decisión de producto pendiente** registrada en `docs/phase-1-audit/CHECKLIST.md`. Opciones: (A) borrar la copy, (B) implementar la feature, (C) cambiar a "próximamente".

## Riesgo y reversibilidad

- **Riesgo en runtime:** nulo. Los símbolos eliminados no tenían consumidores externos (verificado por `git grep` antes de borrar); los helpers privados eran internos a las funciones eliminadas. El plan advertía que el motor Rust (`geourban-geo`) es el único motor real desde Fase 2.7.
- **Reversibilidad:** trivial. `git revert` del único archivo tocado (`src/geo/math/polygonEngine.ts`) restaura todo. Los 146 tests de Vitest ejercitan el módulo indirectamente (vía `metrics.ts`, `recomputeManzanos.ts`, `subdivision/*`, etc.) — pasan con y sin los símbolos borrados.
- **Qué NO valida esta fase:** que la app real en Tauri (Rust/GEOS) no usara ninguno de estos símbolos por un camino indirecto no contemplado por la auditoría. La cobertura del test suite + la suite Rust de paridad debería ser evidencia suficiente — pero si el equipo descubre un uso oculto en runtime, es un `git revert` y a otra cosa.