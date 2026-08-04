# `geo/debug/` — herramientas de desarrollo y benchmarks

> **Solo dev.** Nada de lo que vive acá es lógica de producto.

Esta carpeta contiene generadores de datasets sintéticos y suites de benchmarks pensados para correr desde el `DebugPanel` (atajo `Ctrl+Shift+D` en desktop, disponible solo en builds de dev). Todos los consumidores en el código de producto son componentes del debug panel (`src/components/debug/DebugPanel.tsx`, `src/components/debug/Fase6AutoValidator.tsx`) y se cargan con `React.lazy()` + `import.meta.env.DEV` desde la Fase 2 — fuera de dev/build de release, este grafo no se empaqueta.

## Qué hay acá

| Archivo | Rol |
| --- | --- |
| `syntheticDataset.ts` | Genera manzanas/lotes aleatorios en grilla (rápido, sin red vial). Usado por `DebugPanel` para el botón "1k/10k/100k features". |
| `syntheticUrbanLayout.ts` | Genera el layout urbano completo (calles + rotondas + manzanas irregulares) con `Mulberry32` para determinismo. Usado por la suite `syntheticUrbanBenchmark`. |
| `syntheticUrbanBenchmark.ts` | Suite que mide el pipeline completo: `generateSyntheticUrbanLayout` → motor Rust (`compute_manzanos`) → reconciliación → subdivisión. Aserciones de consistencia del `StructuralDiff`. |
| `undoRedoBenchmark.ts` | Micro-bench de `CommandStack` con trazos consecutivos. |
| `spatialIndexBenchmark.ts` | Comparación de RBush (JS) vs rstar (Rust) para hit-testing. |
| `concurrencyStressBenchmark.ts` | Carga concurrente de comandos (subdivisión batch ∥ red vial ∥ dibujo). |
| `affineAccuracyBenchmark.ts` | Validación de error acumulado del CRS afín vs. referencia exacta, sobre el dataset sintético completo. |
| `*.test.ts` | Tests de los generadores (determinismo con seed fija). Corren en la suite normal de Vitest. |

## Por qué `debug/` y no `__dev-tools__/` o similar

Consideramos renombrar la carpeta (convención `__dev-tools__` o `tools/`) pero la renombradura movería muchos imports relativos y rompería el grep de Fase 2 que confirma "este grafo no se empaqueta en release". El README cumple la misma función: deja explícito el contrato. Si en el futuro se quiere reforzar, renombrar es un PR de tipo `git mv`.

## Por qué hay tests acá

Los tests (`*.test.ts`) verifican que los generadores sean deterministas (la misma seed produce el mismo layout) y que las suites de benchmark arrojen resultados dentro de tolerancia. Esos tests **sí corren en CI** — son cobertura de las herramientas, no de producto. La separación "dev-only" aplica al runtime, no al tiempo de build de tests.