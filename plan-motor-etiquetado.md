# Plan de robustecimiento — Motor de Etiquetado GeoUrban

### De "sello por feature" a un motor declarativo tipo ArcGIS Pro / QGIS

**Alcance analizado:** `src/label-engine/**`, y su acoplamiento con `layers-engine`, `vias-engine`, `lotificacion-engine`, `manzanos-engine`, `kernel/registry`.

**Método:** lectura completa del código fuente actual (no hipotético) — cada bug listado abajo tiene archivo y línea/función concretos.

---

## 0. Resumen ejecutivo

El motor actual **funciona**, pero es fundamentalmente distinto al de ArcGIS Pro / QGIS:

- **Hoy**: cada feature (lote, manzano) o entidad (calle, rotonda) recibe un **snapshot** (`labelConfig` + `labelText`) grabado a mano por un comando (`ApplyLabelConfigCommand`, `AssignLabelOrderCommand`, etc.) en el momento en que el usuario aprieta "Aplicar". Ese snapshot vive **dentro de la feature** (`feature.get('labelConfig')`) o en un store paralelo (`entityLabelStore`).
- **ArcGIS/QGIS**: el estilo de etiqueta vive **en la capa** (una o más "Label Classes" por capa), con reglas, y se evalúa dinámicamente contra cada feature en render-time. Etiquetar es _declarar una regla_, no _estampar cada elemento_.

Esa diferencia de modelo es la causa raíz de casi todos los bugs de "coordinación con capas" que se encontraron: nada se reaplica solo, la numeración se pierde al regenerar, capas nuevas no heredan nada, y hay una zona gris entre "capa" y "entidad" (calles/rotondas no son `Feature` de `drawSource`) que dos comandos de capas ignoran directamente, dejando geometría vial invisible pero funcionalmente activa.

Este documento:

1. Cataloga los bugs concretos encontrados (§2), con severidad.
2. Compara feature-por-feature contra ArcGIS Pro / QGIS (§3).
3. Propone la arquitectura objetivo — "Label Classes" por capa (§4).
4. Da un plan ejecutable en 8 fases, cada una con tareas, archivos a tocar, criterios de aceptación y esfuerzo estimado (§5).

---

## 1. Cómo funciona hoy (mapa del sistema actual)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Fuente de verdad del estilo de etiqueta = LA FEATURE MISMA          │
│                                                                       │
│  Polígono (lote/manzano/perímetro/equipamiento):                     │
│    feature.set('labelConfig', cfg)   ← snapshot completo             │
│    feature.set('labelText', text)    ← texto ya resuelto             │
│    feature.get('labelPoint')         ← pole-of-inaccessibility       │
│                                       (calculado en metrics.ts)       │
│                                                                       │
│  Calle / Rotonda (NO son Feature de drawSource, viven en stores      │
│  aparte: useStreetStore / useRoundaboutStore):                       │
│    useEntityLabelStore.byId[entityId] = { config, text }             │
│                                                                       │
│  Comandos que escriben ese snapshot:                                 │
│    ApplyLabelConfigCommand        (1 feature)                        │
│    ApplyEntityLabelConfigCommand  (1 calle/rotonda)                  │
│    AssignLabelOrderCommand        (batch, orden trazado a mano)      │
│    AssignLotsLabelConfigCommand   (batch lotes, por manzano)         │
│    RestyleBatchLabelsCommand      (solo estilo, no re-numera)        │
│                                                                       │
│  Render (cada frame, PostrenderPainter → LabelPainter.paint):        │
│    1. Lee feature.labelConfig / entityLabelStore                     │
│    2. Resuelve líneas de texto (composeLabelLines)                   │
│    3. Grid de colisión simple (una sola posición candidata)          │
│    4. Dibuja o descarta (sin aviso, sin leader line)                 │
└─────────────────────────────────────────────────────────────────────┘
```

Componentes relevantes (ya existen y son reutilizables):

- `src/label-engine/model/labelModel.ts` — `LabelStyleConfig`, `composeLabelLines`.
- `src/label-engine/model/labelNumbering.ts` — `formatOrderLabel` (alpha/roman/circled/parent-*).
- `src/label-engine/store/entityLabelStore.ts` — snapshot para calles/rotondas.
- `src/label-engine/painters/LabelPainter.ts` — dibujo + colisión simple + slots de calle.
- `src/label-engine/geometry/streetLabelSlots.ts` — posiciones repetidas a lo largo de una calle.
- `src/label-engine/commands/*` — comandos de escritura del snapshot.
- `src/label-engine/modes/LabelOrderMode.ts` — trazo para ordenar manzanos/lotes.
- `src/kernel/registry/ExtensionPointRegistry.ts` — patrón de extension point **ya usado** en `extraSnapSources`, `eraseInterceptors`, `entityGeometryProviders`. Es la pieza clave para desacoplar el motor de etiquetado (ver Fase 1).

---

## 2. Bugs e inconsistencias encontrados

Severidad: 🔴 Crítico (rompe datos o UX básica) · 🟠 Alto (comportamiento incorrecto visible) · 🟡 Medio (deuda/edge case) · 🟢 Bajo (cosmético/perf).

### 🔴 B1 — Las etiquetas de polígonos no aparecen la primera vez, por diseño accidental

**Archivos:** `layers-engine/store/layersRegistryStore.ts` (`add`), `layers-engine/store/layerAutoCreate.ts`, `layers-engine/ui/AddLayerModal.tsx`, `label-engine/painters/LabelPainter.ts` (`paint`).

Toda capa nueva se crea con `showLabel: false` (los 3 puntos de creación de capa lo fijan explícitamente o vía `?? false`). En `LabelPainter.paint`:

```ts
if (!layer || layer.showLabel !== false) { ... dibujar ... }
```

Si `layer.showLabel === false` (el default), la condición es `false`, y el label **nunca se dibuja**, aunque el usuario haya abierto el modal, tildado "Habilitada" y apretado "Aplicar" (`ApplyLabelConfigCommand`). Ningún comando de etiquetado toca `layer.showLabel`. El usuario tiene que _adivinar_ que existe un ícono 🏷 aparte en el Panel de Capas y activarlo a mano.

**Lo mismo pasa con cotas** (`showEdgeCotas` + `layer.showCota`, mismo default `false`).

**Impacto:** primer uso roto — "configuré la etiqueta y no se ve nada" — para lotes, manzanos, perímetro y equipamiento (no para calles/rotondas, ver B2).

### 🔴 B2 — Asimetría: calles/rotondas SÍ se muestran solas; polígonos NO

**Archivo:** `label-engine/painters/LabelPainter.ts` (`paintStreetLabels`, `paintRoundaboutLabels`).

Estos dos métodos solo chequean `entry.config.enabled`, **nunca** `layer.showLabel`. Es decir: para calles y rotondas el bug B1 no existe — se ven apenas se aplican. Para lotes/manzanos/perímetro/equipamiento, sí. Es la misma feature (etiquetado) con dos comportamientos distintos según el tipo de entidad — justo lo opuesto a "coordinar con las capas" de forma consistente.

### 🔴 B3 — Borrar la capa "Vías" no borra las calles/rotondas: quedan invisibles pero siguen cortando manzanos

**Archivo:** `layers-engine/commands/RemoveLayerCommand.ts` (`execute`).

```ts
ctx.drawSource.forEachFeature((f) => {
  if (f.get('layerId') === this.opts.layerId) affected.push(f as Feature<Geometry>);
});
```

Las calles y rotondas **no son `Feature` de `drawSource`** (viven en `useStreetStore`/`useRoundaboutStore`, ver `vias-engine/store/streetStore.ts`). `RemoveLayerCommand` no las conoce. Si se elimina (o se "mueve") una capa de tipo `calle`, las calles reales:

- Siguen existiendo en `useStreetStore` con un `layerId` que ya no existe.
- `StreetPainter`/`resolveEntityLayer` no encuentran layer → `if (!layer || !layer.visible) continue;` → **dejan de dibujarse y de tener etiqueta**, silenciosamente.
- Pero `recomputeManzanos.ts` las sigue usando para el `union`/`difference` de la red vial (`useStreetStore.getState().streets` no cambia) → siguen **cortando manzanos invisiblemente**.
- Su entrada en `entityLabelStore` también queda huérfana.

Mismo problema en `DuplicateLayerCommand.ts` (no duplica calles/rotondas de una capa `calle`) y en `MoveFeaturesToLayerCommand.ts` (no reasigna `street.layerId`/`roundabout.layerId`).

**Impacto:** integridad de datos, no solo etiquetado — pero el síntoma visible más directo es "la calle desapareció junto con su etiqueta y ya no puedo tocarla desde ningún panel".

### 🔴 B4 — Fuga de memoria/datos: borrar con la herramienta "Borrar" no limpia `entityLabelStore`

**Archivo:** `vias-engine/index.ts` (`eraseStreetInterceptor`, `eraseRoundaboutInterceptor`).

```ts
const eraseStreetInterceptor: EraseInterceptor = (kind, id) => {
  ...
  useStreetStore.getState().removeStreet(id);
  return true;              // ← nunca llama a useEntityLabelStore.getState().remove(id)
};
```

Compárese con `StreetPanel.tsx` (`handleDelete`), `RoundaboutPanel.tsx`, `useKeyboardShortcuts.ts` (`handleDeleteSelection`) y `UrbanDesignTab.tsx` (`handleClearStreets`), que **sí** limpian `entityLabelStore`. Solo el camino "herramienta Borrar del lienzo" (`EraseMode.ts` → interceptores) tiene el bug. Las entradas huérfanas se persisten en el `.guproj` para siempre (`projectFile.ts` guarda `entityLabels` completo).

### 🟠 B5 — El "cap" de rendimiento apaga TODAS las etiquetas, no solo las que lo justifican

**Archivo:** `label-engine/painters/LabelPainter.ts` (`paint`).

```ts
if (interacting) return;
if (features.length > HARD_VISIBLE_CAP) return;   // 20 000 — corta ANTES de calles/rotondas
...
if (zoom > STREET_LABEL_MIN_ZOOM) this.paintStreetLabels(ctx, toPx);
this.paintRoundaboutLabels(ctx, toPx, resolution);
```

Con >20k features de polígono visibles, se pierden también las etiquetas de calles y rotondas (que son órdenes de magnitud más baratas y no dependen del conteo de lotes). El cap debería aplicarse por categoría.

### 🟠 B6 — Regenerar lotes pisa la numeración elegida por el usuario

**Archivos:** `lotificacion-engine/commands/replaceLotsForManzano.ts`, usado por `RecomputeManzanoLotsCommand.ts` y `GenerateLotsCommand.ts`.

```ts
if (carriedLabelConfig) {
  feature.set('labelConfig', carriedLabelConfig, true);
  feature.set('labelText', feature.get('code') as string, true); // ← SIEMPRE el code crudo
}
```

Si el usuario usó "🏷 Etiquetar lotes de este manzano" con numeración `roman-upper` o `parent-dash` (`AssignLotsLabelConfigCommand`), el **estilo visual** (`labelConfig`, incluido `titleBadge`) se conserva porque viene del primer lote viejo, pero el **texto** se resetea siempre a `code` (p.ej. `"A-1"`) en cuanto cualquier evento dispara una regeneración (una calle nueva recorta el manzano, "Recalcular", "Generar todos"). El resultado es una insignia circular (`titleBadge: 'circle'`) mostrando el código crudo en vez del número romano/alfabético — visualmente roto y funcionalmente inconsistente con lo que el usuario configuró.

Causa raíz: el modo de numeración (`LabelNumberingMode`) nunca se persiste como dato de la feature/manzano; se parsea _hacia atrás_ con una regex sobre `code` (`AssignLotsLabelConfigCommand.lotSortKey`) en vez de guardarse como número de orden estable.

### 🟠 B7 — Manzanos nuevos no heredan ninguna etiqueta automáticamente

**Archivo:** `manzanos-engine/orchestration/recomputeManzanos.ts` (creación de manzanos nuevos por fragmentación de red vial).

Cuando la unión de calles genera un manzano nuevo (`newFeat` en `recomputeManzanosImmediate`), no se le asigna `labelConfig` de ningún tipo — el usuario tiene que volver a abrir "Configurar / Trazar orden…" y re-etiquetar manualmente cada vez que aparece un manzano nuevo. No hay concepto de "todo lo de esta capa se etiqueta con esta regla", que es exactamente lo que un `LabelClass` por capa (ArcGIS/QGIS) resolvería de raíz.

### 🟡 B8 — Cotas de borde (`showEdgeCotas`) no participan del grid de colisión

**Archivo:** `label-engine/painters/LabelPainter.ts` (`drawEdgeCotas` vs `drawLabelBlock`).

`drawLabelBlock`/`drawRotatedLabelBlock` insertan su caja en `collisionGrid`. `drawEdgeCotas` dibuja directo, sin registrar ni chequear colisión. En lotes chicos con muchos lados cortos, el texto de cota se superpone entre sí y con la etiqueta principal, sin ningún mecanismo de mitigación.

### 🟡 B9 — Batch de etiquetado no distingue capas duplicadas

**Archivo:** `label-engine/commands/RestyleBatchLabelsCommand.ts` (`targets`), `label-engine/store/labelConfigModalStore.ts` (`openForManzanoBatch`/`openForLotsBatch`).

El filtrado es solo por `kind` (`'manzana'`/`'lote'`) y opcionalmente `lotGroupId` — nunca por `layerId`. Si el usuario duplica la capa "Lote" (`DuplicateLayerCommand` existe justamente para esto), "Etiquetar todos los lotes" etiqueta ambas capas juntas sin forma de aislar una. No hay noción de "clase de etiqueta por capa".

### 🟡 B10 — Colores de etiqueta no reaccionan a cambios de color de capa

**Archivo:** `label-engine/model/labelModel.ts` (`defaultColorForKind`), comparado con `DrawLayerRenderer.buildSingleLayerStyle` (que sí usa `layer.color` reactivamente para el relleno/trazo).

El color de la etiqueta se copia una sola vez al crearla (`defaultColorForKind(kind)` como valor inicial en el modal). Cambiar el color de la capa después no actualiza las etiquetas ya aplicadas — no hay modo "usar color de capa" dinámico, solo color fijo por snapshot.

### 🟡 B11 — Nombres de campos genéricos con semántica de polígono, reusados para calles

**Archivo:** `label-engine/model/labelModel.ts` (`LabelStyleConfig.showArea` / `showPerimeter`), `LabelConfigModal.tsx` (`ENTITY_COPY`).

`cfg.showArea` controla si se muestra la "métrica primaria" (área en polígonos, **longitud** en calles) y `cfg.showPerimeter` la "métrica secundaria" (perímetro en polígonos, **ancho de calzada** en calles/rotondas). Funciona, pero el nombre del campo miente sobre su contenido — riesgo de bugs futuros al tocar ese código sin conocer el mapeo semántico oculto.

### 🟢 B12 — Sin rango de escala configurable por tipo

**Archivo:** `label-engine/painters/LabelPainter.ts` — `STREET_LABEL_MIN_ZOOM = 12` es la única regla de escala del sistema, hardcodeada y solo para calles. Lotes/manzanos siempre etiquetan a cualquier zoom, generando sopa de texto al alejar la vista en proyectos grandes.

### 🟢 B13 — `computeStreetCrossings` es O(calles² × segmentos²) sin cortes tempranos

**Archivo:** `label-engine/geometry/streetLabelSlots.ts`. Memoizado por firma (barato en el caso común), pero escala mal en proyectos con muchas calles con muchos waypoints; no hay bounding-box pre-filtro antes de la intersección segmento-a-segmento.

### 🟢 B14 — Primer frame tras cargar el mapa puede usar el cap de "todas las features" en vez del set ya recortado por viewport

**Archivo:** `map-core/scene/PostrenderPainter.ts` (`getVisibleFeatures`, fallback `this.cachedVisibleFeatures ?? all`). Transitorio, se autocorrige en el segundo frame, pero puede disparar el cap de B5 innecesariamente en la carga inicial de proyectos grandes.

### Tabla resumen

| #   | Severidad | Área                            | Fase de fix       |
| --- | --------- | ------------------------------- | ----------------- |
| B1  | 🔴        | Capas × labelConfig.enabled     | Fase 0            |
| B2  | 🔴        | Simetría polígono/entidad       | Fase 0            |
| B3  | 🔴        | Integridad capa↔calle/rotonda   | Fase 0            |
| B4  | 🔴        | Fuga entityLabelStore           | Fase 0            |
| B5  | 🟠        | Cap de rendimiento              | Fase 0            |
| B6  | 🟠        | Numeración perdida al regenerar | Fase 4            |
| B7  | 🟠        | Manzanos nuevos sin herencia    | Fase 1/4          |
| B8  | 🟡        | Colisión de cotas               | Fase 2            |
| B9  | 🟡        | Batch sin scope por capa        | Fase 1            |
| B10 | 🟡        | Color no reactivo               | Fase 5            |
| B11 | 🟡        | Naming semántico                | Fase 1 (refactor) |
| B12 | 🟢        | Sin rangos de escala            | Fase 5            |
| B13 | 🟢        | Complejidad crossings           | Fase 6            |
| B14 | 🟢        | Cache transitorio               | Fase 6            |

---

## 3. Comparación de features vs. ArcGIS Pro / QGIS

| Capacidad                                           | ArcGIS Pro                  | QGIS                   | GeoUrban hoy                         | Objetivo (este plan)        |
| --------------------------------------------------- | --------------------------- | ---------------------- | ------------------------------------ | --------------------------- |
| Regla de etiqueta a nivel de capa                   | ✅ Label Classes            | ✅ Rule-based labeling | ❌ snapshot por feature              | ✅ Fase 1                   |
| Auto-aplicar a features nuevas                      | ✅                          | ✅                     | ❌ (B7)                              | ✅ Fase 1/4                 |
| Prioridad/orden entre capas                         | ✅ Label Priority Ranking   | ✅                     | ❌                                   | ✅ Fase 5                   |
| Múltiples posiciones candidatas                     | ✅ Maplex                   | ✅                     | ❌ (1 sola posición)                 | ✅ Fase 2                   |
| Leader line si se desplaza                          | ✅                          | ✅ (parcial)           | ❌                                   | ✅ Fase 2                   |
| Rango de escala visible                             | ✅                          | ✅                     | ⚠️ solo calles, hardcodeado          | ✅ Fase 5                   |
| Etiqueta a lo largo de línea con repetición         | ✅                          | ✅                     | ✅ ya existe (`streetLabelSlots.ts`) | mantener + mejorar          |
| Numeración estable ante edición                     | ✅ (basado en atributo)     | ✅                     | ❌ (B6, regex sobre string)          | ✅ Fase 4                   |
| Indicador de etiquetas ocultas                      | ✅ contador                 | ✅ panel de log        | ❌                                   | ✅ Fase 2/6                 |
| Expresión de etiqueta (campos)                      | ✅                          | ✅                     | ⚠️ prefijo + área + perímetro fijos  | ✅ Fase 5 (alcance acotado) |
| Coordinación borrar/mover/duplicar capa ↔ contenido | ✅ (todo vive como feature) | ✅                     | ❌ para calles/rotondas (B3)         | ✅ Fase 0/3                 |

---

## 4. Arquitectura objetivo

### 4.1 Concepto central: `LabelClass` por capa

```ts
// src/label-engine/model/labelClass.ts (nuevo)
export interface LabelClass {
  id: string;
  layerId: string;
  name: string;
  enabled: boolean;
  priority: number; // mayor = gana en colisión (ArcGIS "priority ranking")
  style: LabelStyleConfig; // el tipo ya existe, se reutiliza tal cual
  placement: {
    strategy: 'poleOfInaccessibility' | 'centroid' | 'alongLine';
    repeatIntervalM?: number; // solo 'alongLine'
    allowLeaderLine?: boolean;
  };
  numbering?: {
    mode: LabelNumberingMode; // ya existe en labelNumbering.ts
    restartPerParent: boolean; // p.ej. reinicia por manzano
  };
  visibleMinZoom?: number;
  visibleMaxZoom?: number;
}
```

- **Una capa por defecto tiene 0 o 1 `LabelClass`** (alcance de este plan). El modelo permite N a futuro (reglas por atributo) sin romper nada.
- El `LabelClass` reemplaza el rol que hoy cumplen a medias `ManzanoLabelingCard`/`LoteLabelingCard`/`StreetPanel`/`RoundaboutPanel` + `labelConfigModalStore.lastManzanoConfig/lastLotsConfig` (que son memoria volátil, no persistente, no ligada a la capa).

### 4.2 Resolución en dos capas: clase + override

```ts
// src/label-engine/engine/resolveFeatureLabel.ts (nuevo)
function resolveFeatureLabel(
  feature: Feature,
  layer: Layer | undefined,
  labelClass: LabelClass | undefined
): ResolvedLabel | null {
  // 1. Si la feature tiene un override manual (labelConfig/labelText seteado a mano
  //    con "Aplicar" sobre UNA feature puntual) → se respeta tal cual (compat. hacia atrás).
  // 2. Si no, y existe labelClass.enabled → se deriva todo dinámicamente:
  //    texto = formatOrderLabel(labelClass.numbering.mode, orderIndex, total, parentCode)
  //    estilo = labelClass.style
  // 3. Si no hay ni override ni labelClass → sin etiqueta.
}
```

Esto es **retrocompatible**: los proyectos viejos (con `labelConfig`/`labelText` ya grabados) siguen funcionando como "override" sin migración obligatoria (ver Fase 7). Las herramientas de batch (`AssignLabelOrderCommand` etc.) pasan a escribir en el `LabelClass` de la capa en vez de en cada feature.

### 4.3 Extension point para desacoplar entidades (mismo patrón que ya usa el código)

El código ya tiene el patrón correcto (`kernel/registry/ExtensionPointRegistry.ts`) usado por `extraSnapSources`, `eraseInterceptors`, `entityGeometryProviders`. Se agrega uno más:

```ts
// src/label-engine/extension-points.ts (nuevo)
export interface LabelSourceProvider {
  kind: string; // 'lote' | 'manzana' | 'calle' | 'rotonda' | ...
  listCandidates(layerId: string): LabelCandidate[]; // id, anchor/línea, orderIndex, parentCode
}
export const labelSourceProviders = createDirectExtensionPoint<LabelSourceProvider>();
```

`vias-engine` registra sus proveedores para `calle`/`rotonda` (igual que ya registra `entityGeometryProviders.register('street', ...)`), `lotificacion-engine`/`manzanos-engine` registran los suyos. `LabelPainter`/`LabelEngineService` dejan de importar `useStreetStore`/`useRoundaboutStore` directamente — **esto también resuelve de raíz el bug B3/B9**, porque `layers-engine` puede pedirle al registro "quién tiene features en esta capa" sin conocer `vias-engine`, evitando el import circular que hoy hace que `RemoveLayerCommand` ni se entere de que existen calles.

### 4.4 Motor de colisión desacoplado del canvas

```ts
// src/label-engine/engine/LabelEngineService.ts (nuevo)
function resolveVisibleLabels(
  candidates: LabelCandidate[],
  resolutionCtx: { zoom; resolution; extent }
): PlacedLabel[] {
  // 1. filtra por visibleMinZoom/MaxZoom
  // 2. ordena por priority desc, luego layer.zIndex desc
  // 3. para cada candidato, intenta N posiciones (ancla, offsets) contra un grid de colisión
  // 4. si ninguna cabe → PlacedLabel con { dropped: true } (telemetría) en vez de desaparecer sin rastro
}
```

`LabelPainter` pasa a ser un renderer puro que consume `PlacedLabel[]` — permite **testear la lógica de colisión sin canvas** (Fase 6).

---

## 5. Plan por fases

> Cada fase es mergeable independientemente. 0→3 son requisito para el resto. 5 es iterable por partes.

### Fase 0 — Hotfixes críticos (1–3 días, sin cambios de arquitectura)

Objetivo: parar la sangría de datos y la UX rota, sin esperar al rediseño.

| Tarea                                                                                  | Archivo(s)                                                                                                  | Detalle                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.1 Auto-activar `layer.showLabel` al aplicar una etiqueta                             | `ApplyLabelConfigCommand.ts`, `AssignLabelOrderCommand.ts`, `AssignLotsLabelConfigCommand.ts`               | Nuevo helper `ensureLayerLabelsVisible(layerId)` que dispara `UpdateLayerCommand({showLabel:true})` **solo si estaba en `false`**, dentro del mismo `execute()` (mismo undo/redo). No cambia el default de capas nuevas — corrige la sorpresa sin tocar semántica de "capa recién creada = limpia".    |
| 0.2 Gatear labels de calle/rotonda por `layer.showLabel` (simetría con B1 ya resuelto) | `LabelPainter.ts` (`paintStreetLabels`, `paintRoundaboutLabels`)                                            | Agregar el mismo chequeo `layer && layer.showLabel === false → skip` que ya tienen los polígonos, usando `resolveEntityLayer`.                                                                                                                                                                         |
| 0.3 Limpiar `entityLabelStore` en los interceptores de borrado                         | `vias-engine/index.ts`                                                                                      | Agregar `useEntityLabelStore.getState().remove(id)` dentro de `eraseStreetInterceptor`/`eraseRoundaboutInterceptor`, igual que ya hacen `StreetPanel`/`RoundaboutPanel`/`useKeyboardShortcuts`.                                                                                                        |
| 0.4 Cap de rendimiento por categoría                                                   | `LabelPainter.ts` (`paint`)                                                                                 | Mover el `if (features.length > HARD_VISIBLE_CAP) return` para que solo salte el loop de polígonos (`for (const feature of features)`), dejando `paintStreetLabels`/`paintRoundaboutLabels` fuera del corte.                                                                                           |
| 0.5 Calles/rotondas huérfanas al borrar/mover/duplicar capa                            | `layers-engine/commands/RemoveLayerCommand.ts`, `DuplicateLayerCommand.ts`, `MoveFeaturesToLayerCommand.ts` | Fix mínimo (sin extension point todavía): importar `useStreetStore`/`useRoundaboutStore` directamente y replicar la misma lógica de mover/eliminar/duplicar que ya aplica a `drawSource` features, filtrando por `layerId`. _(En Fase 3 esto se reemplaza por el extension point, sin romper el fix.)_ |

**Criterios de aceptación:**

- Crear un lote nuevo → "Generar etiqueta" → Aplicar → **se ve inmediatamente**, sin tocar el panel de capas.
- Trazar una calle nueva → "Generar etiqueta" → Aplicar → se sigue viendo igual que antes (no regresión).
- Borrar una calle con la herramienta "Borrar" (tecla E) → `useEntityLabelStore.getState().byId` ya no tiene esa entrada (verificable con un test o con Redux DevTools/consola).
- Eliminar la capa "Vías" con calles trazadas → las calles desaparecen del mapa **y** de `useStreetStore` **y** de `recomputeManzanos` (ya no cortan manzanos fantasma) — o, alternativa aceptada: el flujo de "Eliminar capa" ofrece explícitamente "esta capa tiene N calles, ¿eliminarlas también?" igual que ya hace `LayerDeleteModal.tsx` para `drawSource` features.
- Con >20 000 lotes simulados, las calles y rotondas siguen mostrando su etiqueta.

**Riesgo:** bajo. Son fixes localizados, con los mismos comandos/undo-redo existentes.

---

### Fase 1 — Fundaciones: `LabelClass` por capa (1.5–2 semanas)

Objetivo: introducir el modelo declarativo sin romper proyectos existentes.

1. Nuevo store `labelClassStore.ts` (`Record<layerId, LabelClass>`), con `getForLayer`, `upsert`, `remove`, persistido en `ProjectMeta` (ver Fase 7 para versión de esquema).
2. `resolveFeatureLabel()` (§4.2) como función pura, con tests unitarios exhaustivos (override vs. clase, clase deshabilitada, sin clase).
3. Reescribir `LabelPainter.paint()` para consumir `resolveFeatureLabel()` en vez de leer `feature.get('labelConfig')` directo — el 90% del código de dibujo (medida, colisión, etc.) no cambia.
4. Migrar los flujos de batch (`ManzanoLabelingCard`, `LoteLabelingCard`, `StreetPanel`, `RoundaboutPanel`) para que "Configurar / Trazar orden…" escriba/actualice el `LabelClass` de la capa correspondiente en vez de (o además de) estampar cada feature. Mantener el estampado como _cache_ para no recalcular en cada frame si conviene por performance, pero el `LabelClass` pasa a ser la fuente de verdad.
5. Renombrar semánticamente los campos ambiguos de B11 dentro de `LabelStyleConfig`: `showArea`→`showPrimaryMetric`, `showPerimeter`→`showSecondaryMetric` (con alias de compatibilidad para no romper proyectos guardados — ver Fase 7).
6. `RestyleBatchLabelsCommand`/batch cards ahora aceptan filtro opcional por `layerId` (resuelve B9): si hay más de una capa del mismo `kind`, el usuario elige a cuál aplica.

**Criterios de aceptación:**

- Crear una capa "Lote", configurar su `LabelClass` una vez → todo lote generado _después_ (vía "Generar todos", recompute, etc.) ya sale etiquetado sin volver a tocar el modal (resuelve B7 en el caso de lotes; manzanos se cierra en Fase 4 junto con B6).
- Un proyecto guardado con la versión anterior (`labelConfig` por feature, sin `LabelClass`) se abre igual que antes, sin errores ni etiquetas perdidas (override sigue funcionando).
- Duplicar la capa "Lote" y aplicar `LabelClass` distinto a cada una no se pisan entre sí (resuelve B9).

**Riesgo:** medio — es el cambio de mayor superficie. Mitigar con feature flag interno (`labelClassStore` opcional; si no hay clase para la capa, cae 100% al comportamiento viejo) y tests de regresión sobre `LabelConfigModal.tsx` (que debe seguir funcionando igual desde la UI).

---

### Fase 2 — Motor de colisión y posicionamiento avanzado (1–2 semanas)

1. `LabelEngineService.resolveVisibleLabels()` (§4.4): ordena candidatos por `priority` (default = orden por `layer.zIndex`, configurable luego en Fase 5) antes de insertarlos en el grid de colisión — hoy el orden es puramente el de iteración de `drawSource`.
2. Multi-candidato: para el label principal, probar además de la posición ancla 2–3 offsets cortos (arriba/abajo/lateral) antes de descartarlo. Si la posición final está a más de X px del ancla real → dibujar una leader line fina (ya existe `traceRing`/utilidades de canvas en `map-core/scene/canvasPathUtils.ts`, reutilizables).
3. Registrar las cajas de `drawEdgeCotas` en el mismo `collisionGrid` que las etiquetas principales (resuelve B8) — cotas que no entran se saltan igual que las etiquetas, en vez de dibujarse siempre.
4. Contador de "etiquetas ocultas por colisión" expuesto (para Fase 6/StatsPanel).
5. (Opcional, bajo riesgo) reducción progresiva de `labelFontSizePx` dentro de un rango mínimo configurable cuando el polígono es muy chico, antes de descartar el label.

**Criterios de aceptación:**

- En un manzano con lotes muy angostos y muchas cotas, cotas y etiqueta principal ya no se pisan visualmente (o, si no entran, se ocultan de forma consistente, no aleatoria).
- Con dos labels candidatos al mismo pixel, gana el de mayor prioridad/capa superior de forma determinística y reproducible (no orden de inserción arbitrario).

**Riesgo:** medio-bajo, acotado a `LabelPainter`/nuevo `LabelEngineService`, no toca comandos ni stores de dominio.

---

### Fase 3 — Coordinación capas ↔ entidades, vía extension point (1 semana)

Reemplaza el fix directo de la Fase 0.5 por la solución arquitectónica limpia (§4.3), evitando el acoplamiento `layers-engine → vias-engine`.

1. Nuevo extension point `layerEntityAdapters` en `kernel/registry` (mismo patrón que `eraseInterceptors`): cada dominio (`vias-engine`) registra cómo reasignar/eliminar/duplicar sus entidades cuando su capa sufre esas operaciones.
2. `RemoveLayerCommand`/`DuplicateLayerCommand`/`MoveFeaturesToLayerCommand` iteran también `layerEntityAdapters.collect()` para la capa afectada, sin importar `vias-engine` directamente.
3. `LayerDeleteModal.tsx` — el conteo de "elementos afectados" que hoy solo cuenta `drawSource` features debe sumar también calles/rotondas del adapter, para que el usuario vea el número real antes de confirmar.
4. Tests de integración: eliminar/mover/duplicar una capa `calle` con calles y rotondas presentes, verificar estado de `useStreetStore`, `useRoundaboutStore`, `entityLabelStore` y `recomputeManzanos` (que la red vial ya no las incluya tras eliminar).

**Criterios de aceptación:** los mismos de Fase 0.5, pero verificados con test automatizado y sin import circular entre `layers-engine` y `vias-engine`.

**Riesgo:** bajo — es refactor puro sobre un patrón ya validado en el código (`eraseInterceptors`).

---

### Fase 4 — Continuidad de numeración ante regeneración (3–5 días)

Cierra B6 y termina B7 para manzanos.

1. Persistir `numberingMode` + `orderIndex` como propiedades estables de la feature (o, mejor, dentro del `LabelClass` de la capa + un `orderIndex` numérico por feature que no dependa de parsear `code`).
2. `replaceLotsForManzano.ts`: en vez de `feature.set('labelText', feature.get('code'))`, resolver el texto vía `formatOrderLabel(numberingMode, orderIndex, total, parentCode)` leyendo el modo persistido (fallback a `code` crudo solo si el manzano nunca fue etiquetado explícitamente).
3. `recomputeManzanos.ts`: al crear un manzano nuevo (`newFeat`), consultar si la capa `manzana` tiene `LabelClass` habilitado (Fase 1) y aplicarlo automáticamente — cierre completo de B7.
4. Test: etiquetar lotes de un manzano con numeración `roman-upper`, forzar un recompute (trazar una calle que atraviese el manzano), verificar que el texto siga en números romanos y no vuelva al `code` crudo.

**Criterios de aceptación:**

- Regenerar/recalcular lotes de un manzano ya etiquetado con un esquema no-`numeric` (romano, alfabético, `parent-dash`) conserva ese esquema.
- Un manzano nuevo generado por corte de vía sale con la `LabelClass` de la capa `manzana` aplicada, sin acción manual.

**Riesgo:** bajo-medio, contenido a `lotificacion-engine`/`manzanos-engine`, depende de Fase 1 para el paso 3 (los pasos 1-2 son independientes y se pueden mergear antes).

---

### Fase 5 — Funcionalidades profesionales avanzadas (2–3 semanas, iterable por sub-tareas)

Todas dependen de Fase 1 (`LabelClass`) pero son independientes entre sí — se pueden priorizar según valor percibido.

| Sub-fase                                       | Qué agrega                                                                                                                             | Análogo GIS                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 5.a Rango de escala                            | `visibleMinZoom`/`visibleMaxZoom` en `LabelClass` + control tipo slider en `LabelConfigModal`                                          | "Visible range" de ArcGIS/QGIS                                       |
| 5.b Prioridad/stacking editable                | Panel "Administrador de etiquetas": lista de `LabelClass` por capa con reordenamiento drag-and-drop → `priority`                       | "Label Priority Ranking"                                             |
| 5.c Color dinámico de capa                     | Toggle "usar color de capa" vs. color fijo en `LabelStyleConfig`; si está activo, `LabelPainter` lee `layer.color` en vez del snapshot | —                                                                    |
| 5.d Estilo automático para remanentes          | Regla simple en `LabelClass`: `if feature.isRemnant → variante de color/badge` (sin DSL completa, alcance acotado)                     | Symbology rules                                                      |
| 5.e Panel de diagnóstico "N etiquetas ocultas" | Usa el contador de Fase 2, se muestra en `StatsPanel`/`StatusBar`                                                                      | Log de advertencias de labeling                                      |
| 5.f Expresión de etiqueta simple               | Combinar tokens predefinidos (código, área, texto libre, nombre de capa) en vez de solo prefijo+texto                                  | Label Expression (alcance acotado, no motor de expresiones completo) |

**Criterio de aceptación por sub-tarea:** demo aislada + test unitario del cálculo (sin depender de canvas).

**Riesgo:** bajo por ítem — se pueden entregar de a una sin bloquear el resto del roadmap.

---

### Fase 6 — Rendimiento, telemetría y QA (transversal, continuo desde Fase 1)

1. Separar `LabelEngineService` (cálculo puro) de `LabelPainter` (dibujo) — ya sembrado en Fase 2 — para poder testear resolución de colisiones sin `CanvasRenderingContext2D`.
2. Suite de tests unitarios mínima:
   - `resolveFeatureLabel` (override vs. clase vs. ninguno).
   - `formatOrderLabel` + continuidad tras `replaceLotsForManzano` (Fase 4).
   - `RemoveLayerCommand`/`DuplicateLayerCommand`/`MoveFeaturesToLayerCommand` con entidades viales (Fase 3).
   - Interceptores de borrado limpian `entityLabelStore` (Fase 0).
3. Perf: reemplazar el cap fijo `HARD_VISIBLE_CAP = 20_000` por un valor configurable (o al menos separar el cap de polígonos del de entidades, ya resuelto en Fase 0.4) y medir con un dataset sintético de 50k/100k lotes antes/después de Fase 1-2.
4. Optimizar `computeStreetCrossings` (B13) con un pre-filtro por bounding box antes de la intersección segmento-a-segmento (reduce el caso cuadrático típico).
5. Resolver el uso transitorio de `all` sin recorte en el primer frame (B14) precomputando el índice espacial antes del primer `postrender` si es viable, o aceptando el costo documentándolo.

**Riesgo:** bajo, es trabajo de calidad/perf sin cambiar contratos públicos.

---

### Fase 7 — Migración y compatibilidad de datos (3–5 días, al cierre de Fase 1)

1. Versionar el bloque de metadatos de etiquetado dentro de `ProjectMeta` (`persistence-engine/projectFile.ts`) con un `schemaVersion` explícito.
2. Migración al cargar un proyecto viejo (`loadProject`): si no hay `labelClasses` pero sí hay `labelConfig` repetidos y consistentes entre las features de una misma capa, sintetizar un `LabelClass` equivalente automáticamente (heurística simple: tomar el `labelConfig` más frecuente por capa). Si son heterogéneos, no se sintetiza nada y todo sigue funcionando vía "override" (comportamiento actual, sin pérdida de datos).
3. Alias de compatibilidad para los campos renombrados en Fase 1.5 (`showArea`/`showPerimeter`) al leer JSON viejo.
4. Documentar en el propio código (comentario tipo los que ya usa el repo, ej. `layerPanelUiStore.ts` `migrate()`) el criterio de migración, siguiendo el mismo patrón que ya usan para otros stores persistidos con `zustand/middleware persist` + `version`.

**Criterios de aceptación:** abrir un `.guproj` generado con la versión actual del código, sin errores, sin diffs visuales, y con `LabelClass` sintetizadas donde aplique.

**Riesgo:** bajo, es aditivo y con fallback seguro al comportamiento actual.

---

## 6. Orden de ejecución recomendado

```
Fase 0 (hotfixes) ──────────────────────────────► release inmediato
      │
      ▼
Fase 1 (LabelClass) ──► Fase 7 (migración, en paralelo al final de F1)
      │
      ├──► Fase 3 (extension point capas↔entidades, reemplaza el parche de F0.5)
      ├──► Fase 4 (numeración estable, depende de F1 solo en el paso 3)
      │
      ▼
Fase 2 (colisión avanzada) ──► Fase 5 (features Pro, por sub-ítems) ──► Fase 6 (perf/QA, continuo)
```

## 7. Riesgos generales y mitigación

| Riesgo                                                                                   | Mitigación                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fase 1 toca el "camino caliente" de render (`LabelPainter.paint`, se ejecuta cada frame) | Mantener el mismo pipeline de dibujo; solo cambia _de dónde_ se lee el estilo. Feature flag por proyecto (si no hay `LabelClass`, comportamiento idéntico al actual).                                   |
| Migración de datos rompe proyectos guardados                                             | Fase 7 es aditiva con fallback explícito al modelo "override por feature" (comportamiento 100% actual si no hay clase sintetizable).                                                                    |
| Extension point nuevo (Fase 3) introduce otra capa de indirección                        | Ya existe el mismo patrón 3 veces en el repo (`extraSnapSources`, `eraseInterceptors`, `entityGeometryProviders`) — no es un concepto nuevo para el equipo, es aplicar el patrón existente una vez más. |
| Alcance de "expresiones" (5.f) se infla hacia un motor completo                          | Limitar explícitamente a una lista fija de tokens combinables, no una DSL libre — decisión de producto, no técnica.                                                                                     |

## 8. Glosario (equivalencias con ArcGIS Pro / QGIS)

| Término de este plan        | ArcGIS Pro             | QGIS                                                                         |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `LabelClass`                | Label Class            | Regla de etiquetado / "Rule-based labeling"                                  |
| `priority`                  | Label Priority Ranking | Priority (0–10)                                                              |
| Leader line                 | Callout / leader       | Leader line (etiquetas ancladas)                                             |
| `visibleMinZoom/MaxZoom`    | Visible Range          | Escala mínima/máxima visible                                                 |
| Multi-candidato de posición | Maplex placement       | Placement engine                                                             |
| `labelSourceProviders`      | (interno de Esri)      | (interno de QGIS core) — concepto equivalente a un "label provider" por capa |
