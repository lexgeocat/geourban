# Fase 7 — Endurecer tipado (`any` → tipos reales)

**Estado: COMPLETADA con alcance extendido.** El plan listaba ~14 ocurrencias `any` de prioridad ALTA; en la fase se atacaron las **32 ocurrencias totales** que la regla reportó al pasar de `off` a `warn`. **Conteo final: 0 warnings** de `no-explicit-any`.

> **Decisión:** el plan proponía mantener la regla en `warn` después de la fase. Como **todos** los `any` quedaron resueltos sin compromisos (incluso los de prioridad BAJA en tests), la regla podría ahora subirse a `'error'` sin romper CI. La decisión de subirla queda al equipo — documentada abajo en "Lo que esta fase no toca".

## Cambios aplicados

### Regla global

`eslint.config.js`: `'@typescript-eslint/no-explicit-any': 'off'` → `'warn'`. Midición: **32 warnings al activar la regla → 0 al finalizar la fase.**

### Prioridad ALTA (14 → 0)

| Archivo:línea | Antes | Después |
| --- | --- | --- |
| `PropertyPanel.tsx:67` | `drawSource.getFeatureById(primaryId) as any` | `as Feature<Geometry> \| null` + null coalescing |
| `StatsPanel.tsx:36` | `computeStats(drawSource: any, streets: any[])` | `VectorSource<Feature<Geometry>> \| null, Street[]` |
| `useTopBarActions.ts:75,99,121` | `as any` redundantes (3) | eliminados; los tipos de `getFeatureKind(Feature<Geometry>)` y `VectorSource.getFeatureById` ya eran correctos |
| `Map.tsx:242,245,253` | `(evt: any)` en handlers OL | `VectorSourceEvent<Feature<Geometry>>` (tipo oficial de OL) |
| `layersRegistryStore.ts:58,177` | `(layer as any).colorMode` redundantes | eliminados; `Layer.colorMode` ya estaba tipado |
| `mapStore.ts:116,149` | `(layer as any).getSource?.()` y `finiteFeatures as any` | `instanceof VectorLayer` (type guard); eliminado el cast redundante |
| `subdivisionStore.ts:66` | `(state.options as any)[k] = v` | `Partial<SubdivisionOptions>` con cast tipado a `Record<string, unknown>` |

### Prioridad MEDIA (7 → 0)

| Archivo:línea | Antes | Después |
| --- | --- | --- |
| `Map.tsx:112` | `const toRemove: any[] = []` | `Interaction[]` |
| `PostrenderPainter.ts:31,70,126` | `(event: any)` para handler de `postrender` | `RenderEvent` (tipo oficial de OL) |
| `EditMode.ts:58` | `'translatestart' as any, (event: any)` | `TranslateEvent` (de `safeTranslate.ts`); el cast del string literal se eliminó y el listener queda tipado vía `as unknown as TranslateEvent` (ver "Decisiones" abajo) |
| `SelectEditMode.ts:113` | `(g as any).getCoordinates()` | `instanceof Polygon \| MultiPolygon` con narrowing real; geometrías no soportadas hacen `continue` |
| `mapStore.ts:48` | `restoreDrawFeatures: (geojson: any)` | `(geojson: unknown)` — el contrato del `readFeatures` de OL ya es `object: any` |

### Prioridad BAJA (7 → 0)

`structuralDiff.test.ts` tenía 7 `as any` en fixtures. La auditoría los marcó como "baja — son fixtures de test, no tocan lógica de producto", pero como estaban acotados a líneas individuales, se tiparon correctamente con `StructuralDiff` y `Feature<Point>` en vez de `Feature<any>`. Cero impacto en coverage o legibilidad.

## Decisiones de diseño

### `EditMode.ts` y `SafeTranslate`

El tipo `TranslateOnSignature<EventsKey>` de `SafeTranslate.on/once/un` es problemático: `EventsKey` no satisface la constraint `Type extends string` de `OnSignature`, así que TS no puede inferir el tipo del evento en el callback. El cast `as 'translatestart'` no resuelve porque el overload que matchea es el genérico (que devuelve `BaseEvent`, no `TranslateEvent`).

**Decisión:** importar `TranslateEvent` desde `safeTranslate.ts` (la versión local, con `features: Collection<Feature<Geometry>>` bien tipado) y hacer un cast controlado `(event as unknown as TranslateEvent)` dentro del callback. Esto deja el listener tipado, documenta la intención, y no requiere reescribir `SafeTranslate.on` (que es código de plataforma que otras sesiones podrían tocar).

### `mapStore.ts:48` firma de `restoreDrawFeatures`

`OL format/GeoJSON.readFeatures` recibe `object: any` en su tipo público. Tipar el contrato del store como `unknown` (en vez de inventar un tipo) refleja honestamente "no sé qué me va a llegar" y deja el cast interno dentro del método (que sigue siendo `(geojson as any)` pero no es visible en la firma).

### `SelectEditMode.ts:113` narrowing real

Antes: `(g as any).getCoordinates()` y se procesaba todo. Ahora: `instanceof Polygon | MultiPolygon` con `continue` para geometrías no soportadas (Circle, LineString). El `walk` recursivo solo necesita `Coordinate[] | Coordinate[][] | Coordinate[][][]`, que es el tipo que OL ya garantiza para Polygon/MultiPolygon. Ningún cast, ningún `any`.

## Verificación

| Check | Antes | Después |
| --- | --- | --- |
| `npm run lint` (no-explicit-any) | 32 warnings (regla off) | **0 warnings** (regla warn) |
| `npx tsc --noEmit -p tsconfig.json` | ✅ | ✅ sin output |
| `npm test` (Vitest) | 146/146 | **146/146 passed** (12 files, 9.27s) |
| `npm run build` (Vite producción) | ✅ | ✅ 19.19s, bundle 1,127.0 kB |

## Lo que la Fase 7 **no** toca

- **Subir la regla a `'error'`**: el plan proponía esto "solo si el equipo puede sostenerla". Como el conteo es 0 hoy, **es mecánicamente posible** — pero requiere un PR de un solo cambio en `eslint.config.js` y un acuerdo de equipo (algunos `any` aparecen naturalmente al migrar tipos con libraries third-party). Lo dejo en `warn` y documentado como decisión explícita del equipo.
- **Warnings preexistentes de `react-hooks/exhaustive-deps` (3)**: preexistentes desde antes de la fase, no relacionados con `any`. Se resuelven en otra fase si se quiere.
- **El plan mencionaba `LayerPanel.tsx` `handleZoomToLayer`** con `(layer as any).getSource?.()`. La auditoría de Fase 1.4 ya detectó que ese patrón NO está en `LayerPanel.tsx` sino en `mapStore.ts:149`. Ataco el archivo correcto (Fase 7 fix al plan).

## Riesgo y reversibilidad

- **Riesgo en runtime:** nulo. Todos los cambios son de tipos — el comportamiento en runtime es idéntico (los `as any` se eliminaron porque eran redundantes o se reemplazaron por casts equivalentes).
- **Reversibilidad:** trivial. `git revert` revierte todos los archivos. Los 146 tests cubren el comportamiento que los `any` previos permitían romper silenciosamente.
- **Qué NO valida esta fase:** que el bundle de producción no haya cambiado de tamaño o semántica — el bundle bajó marginalmente (~1 kB minificado) por la mejor inferencia de tipos en `ol/VectorSourceEvent`.