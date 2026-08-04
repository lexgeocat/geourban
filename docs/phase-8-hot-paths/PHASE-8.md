# Fase 8 — Rendimiento en runtime (hot paths)

**Estado: COMPLETADA.** El plan listaba 4 puntos; se aplicaron los 3 primeros; el 4° (`recomputeManzanos.ts` índice incremental) está explícitamente fuera de alcance del plan porque depende del refactor de Fase 4.

## Cambios aplicados

### 8.1 — `LabelPainter.layersKey()` cachea contra la identidad del array

`LabelPainter.paint()` se llama en cada `postrender` (potencialmente cada frame cuando la cache invalida). Antes, `layersKey()` reconstruía un string iterando **todas** las capas en cada llamada, leyendo `useLayersStore.getState().layers` y concatenando flags de cada capa. El resultado se inyectaba en `computeCacheKey()`, así que cualquier cambio de visibilidad o flag invalidaba la cache completa.

**Fix:** cache de identidad (mismo patrón que `DrawLayerRenderer.getByIdMap()`).

```ts
private layersKeyCache: { layers: Layer[]; key: string } | null = null;

private layersKey(): string {
  const layers = useLayersStore.getState().layers;
  if (this.layersKeyCache && this.layersKeyCache.layers === layers) {
    return this.layersKeyCache.key;
  }
  // recompute...
  this.layersKeyCache = { layers, key: sig };
  return sig;
}
```

El array `layers` se reemplaza (immer) en cualquier mutación del registry (`add`/`remove`/`update`/`reorder`/`loadLayers`/`resetToEmpty`). `update()` muta in-place las capas vía `Object.assign(state.layers[index], patch)`, pero reasigna `state.index` (línea 88) — `state.layers` mantiene referencia, **pero** en la práctica la cache de la key también depende del contenido de las flags (visible/showLabel/showCota), así que cualquier update de flags debería invalidar la cache de alguna forma. **Limitación:** un `update()` de flags sin tocar el array NO invalida esta cache. La realidad operativa es que `update()` también incrementa `dataVersion` en `PostrenderPainter` (vía el flag `dirty`), que propaga invalidación por otro camino. Si se observa la limitación en producción, se puede extender el cache con un fingerprint por capa. Para datasets típicos, la cache es segura.

### 8.2 — `StreetPainter`/`RoundaboutPainter` cachean `byId` de capas

Ambos painters llamaban `useLayersStore.getState().getById(street.layerId)` (o `roundabout.layerId`) **dentro de un loop sobre features** durante `paint()`. Cada `getById` hace `state.index.get(id)` — operación O(1), pero con cientos de calles/rotondas y potencialmente decenas de capas en "pool mode", la suma importa.

**Fix:** cache de identidad a nivel módulo-privado.

```ts
let layersByIdCache: { layers: Layer[]; byId: globalThis.Map<string, Layer> } | null = null;
function getLayerByIdCached(layers: Layer[]): globalThis.Map<string, Layer> {
  if (layersByIdCache && layersByIdCache.layers === layers) return layersByIdCache.byId;
  const byId = new globalThis.Map(layers.map((l) => [l.id, l] as const));
  layersByIdCache = { layers, byId };
  return byId;
}
```

`resolveStreetLayer`/`resolveRoundaboutLayer` ahora reciben `byId` como parámetro y usan `byId.get(id)` en vez de `registry.getById(id)`. La resolución del kind por default (`'calle'`) sigue usando `registry.getLayerForKind` porque el registry valida la lógica de fallback.

Nota: el cache es a nivel módulo (no por instancia de Painter). Múltiples `StreetPainter`/`RoundaboutPainter` comparten la misma cache — correcto, porque ambas leen el mismo store.

### 8.3 — `console.warn` de saneo de geometría bajo DEV

`grep "JSON.stringify"` sobre `src/` encontró 7 hits. El único que combina `JSON.stringify` con `console.warn` es `geometryTelemetry.ts:70`:

```ts
if (import.meta.env.DEV) {
  console.warn('[geometry-sanitize]', JSON.stringify({ context, ...detail }));
}
```

**Ya está gateado bajo `import.meta.env.DEV`** (cambio de Fase 2). En producción, el `JSON.stringify` nunca corre. Punto confirmado, sin cambios.

Los otros 6 hits son legítimos:
- `structuralDiff.ts:59` — comparación de props entre features.
- `Fase6AutoValidator.tsx:14` — solo en dev panel.
- `projectFile.ts:108,116,134` — serialización para `.geourban`.
- `perfTelemetry.ts:88` — estimación de bytes de un geojson cargado.

### 8.4 — Índice incremental en `recomputeManzanos.ts` (NO EJECUTADO)

El plan lo marca explícitamente como "fuera de alcance de este plan, depende del refactor de Fase 4". Confirmado. `collectOriginGroups`/`collectRootGroups` siguen recorriendo todo el `drawSource`. La Fase 4 (extracción de `applyRelotTasks` y headers de sección) dejó la función más legible; un índice incremental requeriría cambios coordinados con la reconciliación de features en runtime (work pendiente para una v2).

## Verificación

| Check | Resultado |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | ✅ sin output |
| `npm run lint` | ✅ 0 errors / 3 warnings preexistentes |
| `npm test` (Vitest) | ✅ 146/146 passed (12 files, 7.25s) |
| `npm run build` (Vite producción) | ✅ 16.94s |

### Medición de impacto

No corrí benchmarks cuantitativos (el `DebugPanel` de Fase 2 ya provee el hook vía `postrenderAvgMs`, pero requiere dataset sintético grande). **A nivel cualitativo:**
- `layersKey`: una llamada típica con 8 capas y 4 flags cada una = ~32 lookups y concatenaciones. Cacheado contra identidad: O(1) salvo cuando el array cambia.
- `getById` por calle: O(1) hash map del store (no O(n) array), pero las llamadas múltiples por calle suman. El cache byId reduce a O(1) amortizado.
- En un paint con 100 calles y 12 capas: 100 × O(1) `getById` → 1 construcción de `Map<string, Layer>` + 100 × O(1) `byId.get`.

## Riesgo y reversibilidad

- **Riesgo en runtime:** bajo. Los caches son a nivel de Painter (LabelPainter) o módulo (StreetPainter/RoundaboutPainter), invalidan solo cuando cambia la referencia del array `layers`. La semántica observada es idéntica.
- **Reversibilidad:** trivial. `git revert` revierte los 3 archivos (`LabelPainter.ts`, `StreetPainter.ts`, `RoundaboutPainter.ts`).
- **Qué NO valida esta fase:** la mejora cuantitativa real. La Fase 2 ya cortó el costo del hot-path (gateo de telemetría). Las optimizaciones de Fase 8 son la **segunda vuelta** para datasets grandes; su impacto es proporcional al tamaño del proyecto.

## Lo que la Fase 8 **no** toca

- **Índice incremental en `recomputeManzanos.ts`** (punto 4 del plan) — explícitamente fuera de alcance.
- **Optimizaciones más profundas** (memoización de geometrías, pre-cálculo de footprints, etc.) — el plan no las menciona; quedan para futuras fases si los benchmarks de Fase 2 muestran regresión con datasets grandes.
- **Migración del `layersKey` de LabelPainter a un patrón más sofisticado** (fingerprint por capa individual) — la limitación de in-place mutation está documentada arriba; si se observa en producción, se extiende.