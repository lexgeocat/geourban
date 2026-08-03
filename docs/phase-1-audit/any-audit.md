# Fase 1.4 — Auditoría de `any`

28 ocurrencias de `any` como tipo en `src/` (excluyendo falsos positivos como `anywhere`/`anyEnabled`/`anyCalle`).

`eslint.config.js` tiene `'@typescript-eslint/no-explicit-any': 'off'` a nivel global, por eso nada de esto rompe el build. La Fase 7 los va a endurecer.

## Por archivo

### `src/commands/core/structuralDiff.test.ts` — 7 ocurrencias (todas en un test)

Líneas 22, 26, 29, 173, 183, 195, 198, 201. **Prioridad: BAJA.** Son un test que arma fixtures con shapes arbitrarios y los pasa por `composeStructuralDiffs` / `applyStructuralDiffForward` / `revertStructuralDiff`. El `as any` está acotado a la línea de cada test, no toca lógica de producto. La justificación razonable es "estos tests verifican la función pura, no me importa la precisión del tipo del fixture". **No se toca en Fase 7** salvo que el equipo decida subir la regla a `error` y quiera coherencia.

### `src/components/panels/PropertyPanel.tsx:67` — 1 ocurrencia

```ts
const feat = drawSource.getFeatureById(primaryId) as any;
```

**Prioridad: ALTA.** Archivo UI, lee feature de fuente OL, `as any` desactiva verificación hasta el primer uso. Reemplazar por `Feature<Geometry> | null` (el plan ya lo sugiere).

### `src/components/panels/StatsPanel.tsx:36` — 1 ocurrencia

```ts
function computeStats(drawSource: any, streets: any[]): StatsData
```

**Prioridad: ALTA.** Mismo problema. Tipar como `VectorSource | null` y `Street[]` (ya existe ese tipo en el dominio).

### `src/hooks/useTopBarActions.ts` — 3 ocurrencias (líneas 75, 99, 121)

```ts
const feat = src?.getFeatureById(primaryId) as any;
if (getFeatureKind(f as any) === 'manzana') manzanoCount++;
const k = getFeatureKind(f as any);
```

**Prioridad: ALTA.** `getFeatureKind` ya tiene tipos declarados (ver `core/objectModel.ts`). El `as any` es redundante y se quita sin más.

### `src/map/Map.tsx` — 4 ocurrencias

- L112: `const toRemove: any[] = [];` — array tipado como `any[]`.
- L242/245/253: `onSpatialInsert = (evt: any) =>` — handlers de eventos OL.

**Prioridad: ALTA** para los handlers (OL exporta `FeatureEvent` y tiene tipos para `addfeature`/`removefeature`/`changefeature`). **MEDIA** para `toRemove: any[]` (probable array de IDs/feats, refactor trivial).

### `src/map/scene/PostrenderPainter.ts` — 3 ocurrencias (líneas 31, 70, 126)

```ts
private readonly listener: (event: any) => void;
this.listener = (event: any) => this.handle(event);
private handle(event: any): void
```

**Prioridad: MEDIA.** El evento es de tipo `MapEvent` o `RenderEvent` de OL. Reemplazar es directo.

### `src/map/scene/modes/EditMode.ts:58` — 2 ocurrencias

```ts
translate.on('translatestart' as any, (event: any) => {
```

**Prioridad: MEDIA.** El `as any` en el string es porque OL tipa `'translatestart'` solo en algunas versiones; se puede estrechar con un type guard o aceptando `MapBrowserEvent`. No es crítico.

### `src/map/scene/modes/SelectEditMode.ts:113` — 1 ocurrencia

```ts
const coords = (g as any).getCoordinates();
```

**Prioridad: MEDIA.** `g` es un `Geometry` OL, `getCoordinates()` está en la API; el `as any` está escondiendo un narrowing que el tipador de OL no resuelve. Refactor con `instanceof Polygon | LinearRing` debería alcanzarlo.

### `src/store/entities/layersRegistryStore.ts` — 2 ocurrencias (líneas 58, 177)

```ts
colorMode: (layer as any).colorMode ?? ...
colorMode: ((l as any).colorMode as string) === 'colorIdx'
```

**Prioridad: ALTA** (store, no UI). Indica que `Layer` no tiene `colorMode` tipado (o no donde se lee). Revisar `core/objectModel.ts` o la definición de `Layer`.

### `src/store/map/mapStore.ts` — 3 ocurrencias

- L47: `restoreDrawFeatures: (geojson: any) => void;` en la firma de la store.
- L116: `src.addFeatures(finiteFeatures as any);`
- L149: `const src = (layer as any).getSource?.();`

**Prioridad: ALTA** para los 2 últimos (lógica de producto, OL tipa `addFeatures` con `Feature<Geometry>[]` y `layer.getSource()` con `Source`). **MEDIA** para la firma de la store: si es API expuesta, hay que tipar el `geojson` como `FeatureCollection` (depende de qué es "geojson" en el contrato).

### `src/store/ui/subdivisionStore.ts:66` — 1 ocurrencia

```ts
(state.options as any)[k] = v;
```

**Prioridad: ALTA** (store). `state.options` claramente no está bien tipado. Reemplazar por `Partial<SubdivisionOptions>` o por un switch tipado.

## Resumen por prioridad

| Prioridad | Archivos | Ocurrencias |
| --------- | -------- | ----------- |
| ALTA     | PropertyPanel, StatsPanel, useTopBarActions, Map.tsx (parcial), layersRegistryStore, mapStore (parcial), subdivisionStore | ~14 |
| MEDIA    | Map.tsx (`toRemove`), PostrenderPainter, EditMode, SelectEditMode, mapStore (firma) | ~7 |
| BAJA     | structuralDiff.test.ts (solo tests) | 7 |

> **Nota sobre el plan original:** el plan mencionaba `LayerPanel.tsx: const src = (layer as any).getSource?.()` como caso de alta prioridad. Mi grep **no encontró** esa ocurrencia — el archivo tiene `data` (no `layer`) y no usa `as any` en `getSource`. La línea 149 de `mapStore.ts` sí tiene exactamente ese patrón. Probablemente el plan lo atribuyó al archivo equivocado. Lo aclaro para que la Fase 7 corrija el archivo correcto.

## Estado de `eslint.config.js`

Confirmado en lectura directa del archivo (en el listado del plan, no repetido acá): `'@typescript-eslint/no-explicit-any': 'off'` global. La Fase 7 lo cambia a `warn` y resuelve los casos de prioridad ALTA antes de considerar subir a `error`.
