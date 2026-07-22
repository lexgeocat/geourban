# Diagnóstico técnico — Motor de Lotización, Motor de Trazado Vial e Interfaces

**Proyecto:** GeoUrban
**Alcance:** `src/geo/subdivisionAlgorithms.ts`, `src/geo/subdivisionCabeceraCuerpo.ts`, `src/geo/polygonEngine.ts`, `src/geo/roadNetworkEngine.ts`, `src/geo/streetEngine.ts`, `src/geo/ringFillet.ts`, `src/geo/roundaboutEngine.ts`, `src/store/mapStore.ts` (`recomputeManzanos*`), `src/store/manzanoStore.ts`, `src/store/streetStore.ts`, `src/store/roundaboutStore.ts`, `src/commands/*Lots*`, `src/commands/AddStreetCommand.ts`, `src/commands/AddRoundaboutCommand.ts`, `src/components/ManzanoPanel.tsx`, `src/components/RoundaboutPanel.tsx`, `src/components/SubdivisionDialog.tsx`, `src/map/scene/*Interaction.ts`, `src/map/scene/PostrenderPainter.ts`, `src/map/scene/DrawLayerRenderer.ts`, `src/core/objectModel.ts`, `src/components/StatsPanel.tsx`.

> Metodología: lectura estática completa del código fuente provisto (no hay entorno de ejecución disponible para esta pasada). Cada hallazgo cita el archivo y, cuando es posible, el fragmento exacto que lo sustenta. Los hallazgos marcados **[CONFIRMADO]** están trazados línea por línea entre múltiples archivos; los marcados **[INFERIDO]** son deducciones razonables a partir del código pero no se verificaron en runtime.

---

## 0. Resumen ejecutivo

El sistema tiene dos motores geométricos centrales:

1. **Motor de lotización** (`subdivisionAlgorithms.ts` + `subdivisionCabeceraCuerpo.ts` + `polygonEngine.ts`): parte un polígono "manzano" en lotes según 3 algoritmos distintos (`auto`/cabecera-cuerpo, `exact`, `modo2`/PCA), corriendo en un Web Worker.
2. **Motor de trazado vial** (`roadNetworkEngine.ts` + `streetEngine.ts` + `ringFillet.ts` + `recomputeManzanosImmediate` en `mapStore.ts`): construye la geometría de calles/rotondas, las une, y **resta esa unión de las parcelas originales** para regenerar los manzanos cada vez que la red vial cambia.

El hallazgo más grave del diagnóstico es que **estos dos motores no están realmente integrados**: una vez que un manzano fue lotizado (lotes generados), el motor vial pierde la capacidad de mantener esos lotes sincronizados con cambios posteriores en la red vial, y en un escenario concreto y trazable **deja lotes huérfanos superpuestos con la geometría nueva** (ver §5). A esto se suma una inconsistencia de modelo de datos (`type` vs `kind`) que rompe silenciosamente el renderizado, las estadísticas y el propio panel de manzanos cuando se usa la función "marcar como equipamiento" (ver §5.1), y una pérdida de datos silenciosa en ediciones manuales de vértices sobre manzanos que ya pasaron por el motor vial (ver §5.2).

Ninguno de estos tres problemas requiere reescribir el motor: son bugs de **ciclo de vida de estado** (qué se limpia, qué se congela, qué se vuelve a derivar) más que de matemática geométrica. La matemática (clipping, PCA, bisección, offset de polilíneas, fillets) está, en general, bien resuelta para el caso feliz, pero no tiene red de seguridad (sin validación topológica automática, sin límites en miter joins, sin manejo de casos degenerados en rotondas poligonales pequeñas).

El plan de abajo está ordenado para atacar primero lo que **corrompe datos silenciosamente** (Fase 0), después lo que **define el contrato de datos correcto** (Fase 1), y recién después robustece cada motor y su UI.

---

## 1. Arquitectura actual (mapa de flujo)

```
Trazado vial:
  InteractionModeController (modo 'street'/'roundabout')
    → AddStreetCommand / AddRoundaboutCommand
        → streetStore.addStreet() / roundaboutStore.addRoundabout()   (estado vive en Zustand, NO en drawSource)
        → recomputeManzanos()  [debounced 250ms, mapStore.ts]
            → recomputeManzanosImmediate()
                → buildRoadNetworkRings(streets, roundabouts)   [roadNetworkEngine.ts: offset miter + roundaboutGeometry]
                → computeManzanosInWorker(parcels, roadNetwork) [worker: union(roadNetwork) → difference(parcela, unión)]
                → roundRingReflex()                              [ringFillet.ts: redondea vértices cóncavos]
                → reescribe drawSource: borra manzanas "origen", inserta fragmentos nuevos
  PostrenderPainter.paintStreets() → computeStreetFilletsBoth() [streetEngine.ts, O(n²) por par de calles]

Lotización:
  ManzanoPanel / SubdivisionDialog
    → RecomputeManzanoLotsCommand (1 manzano) / GenerateLotsCommand (todos) / SubdivideCommand (polígono suelto)
        → subdivideManzanoInWorker / subdivideManzanoBatchInWorker / subdivideInWorker
            → subdivisionAlgorithms.ts: subdivideManzano() dispatcher
                → 'auto'  → subdivisionCabeceraCuerpo.ts (cabecera + cuerpo, dirección por bounding-quad o dirPref)
                → 'exact' → subdivideManzanoExact (computeCuts + subdivideHalf, bisección de área)
                → 'modo2' → subdivideManzanoAuto (split en 2 mitades por PCA + cortes maestros)
                → 'manual-slice' → sliceBisectManzano (bisección de una línea de corte)
        → reemplaza manzana por N features 'lote' con lotGroupId = manzanoId
```

**Punto de acoplamiento crítico:** `recomputeManzanosImmediate()` decide qué es "parcela origen" mirando `kind !== 'lote' && kind !== 'manzana'` y excluyendo lotes con `lotGroupId`. Esto significa que el motor vial **no sabe qué hacer con los lotes hijos de un manzano ya lotizado** — ver §5.

---

## 2. Diagnóstico — Motor de Lotización

### 2.1 Hallazgos críticos

**H-LOT-1 — `origPts` congela la geometría y descarta ediciones manuales [CONFIRMADO]**
En `recomputeManzanosImmediate` (`mapStore.ts`):

```js
let origPts = feature.get('origPts') as Pt[] | undefined;
if (!origPts) { /* derivar de coords actuales */ }
```

Si `origPts` ya existe (se setea la primera vez que una parcela pasa por el motor vial), se usa **siempre esa copia congelada**, sin importar si el usuario movió vértices después con `ModifyGeometryCommand`/`SafeTranslate`. Ningún comando de edición de geometría actualiza o invalida `origPts`. Resultado: cualquier edición manual de un manzano se **revierte silenciosamente** la próxima vez que se trace una calle o rotonda en cualquier parte del proyecto (el recompute corre sobre TODA la red vial, no solo la zona tocada).

**H-LOT-2 — Lotes huérfanos al re-trazar vías sobre un manzano ya lotizado (vía `GenerateLotsCommand`) [CONFIRMADO]**
Secuencia reproducible:

1. Se traza calle → se genera manzana `M1` (`kind:'manzana'`, con `origParcelId`/`origPts`).
2. Usuario ejecuta "Generar todos" (`GenerateLotsCommand`): esto **borra `M1`** (`ctx.drawSource.removeFeature(feat)`) y crea lotes `L1..Ln` con `lotGroupId: String(M1.id)`.
3. Usuario traza una nueva calle que cruza esa zona.
4. `recomputeManzanosImmediate` filtra `if (kind === 'lote' && feature.get('lotGroupId')) return;` — los lotes `L1..Ln` **nunca entran como origen** y tampoco como miembros a borrar de ningún grupo (porque el manzano `M1` que los generó ya no existe como feature).
5. El recompute no toca `L1..Ln` en absoluto: quedan en el mapa, ahora **geométricamente inconsistentes con la calle nueva** (pueden quedar atravesados por la calzada).

**H-LOT-3 — Vía `RecomputeManzanoLotsCommand` (mantiene la manzana viva) el bug es distinto y también real [CONFIRMADO]**
Este comando no borra la manzana, solo reemplaza sus lotes hijos. Eso significa que `M1` sigue siendo "origen" válido para el próximo `recomputeManzanosImmediate`. Pero cuando ese recompute corre:

```js
for (const m of group.members) src.removeFeature(m);
```

`group.members` solo contiene features que pasaron el filtro de origen (la manzana `M1`), **nunca sus lotes hijos** (excluidos por `lotGroupId`). Se borra `M1`, se insertan fragmentos nuevos con **id nuevo** (`${group.origId}-mzn-${i}`), pero los lotes viejos `L1..Ln` (cuyo `lotGroupId` apuntaba al `M1` ya borrado) **quedan en el mapa sin dueño**, superpuestos a los fragmentos nuevos.

**Impacto de H-LOT-1/2/3:** corrupción visual y de datos sin ningún error ni warning. El usuario no tiene forma de saber que pasó salvo notarlo a simple vista en el mapa. Esto es, con diferencia, el hallazgo de mayor severidad de todo el diagnóstico.

### 2.2 Hallazgos de diseño / consistencia algorítmica

**H-LOT-4 — Tres algoritmos con contratos distintos y nombres desalineados con la UI**
Claves internas: `auto` (cabecera+cuerpo), `exact`, `modo2` (PCA). En `SubdivisionDialog.tsx` los labels son "Auto (Cabecera+Cuerpo)", "Modo 1 (área exacta)", "Modo 2 (grilla PCA)" — es decir, la clave interna `exact` se muestra como **"Modo 1"** y `modo2` se muestra como **"Modo 2"**, mientras que `auto` no tiene número. Mismo patrón se repite en `ManzanoPanel.METHOD_BTNS` (`▣ Auto`, `◈ Modo 1`, `◆ Modo 2`). Cualquier persona que lea el código sin el mapeo de la UI en la cabeza va a confundir `exact` con "Modo 2" por analogía de nombre. Riesgo de bug futuro al tocar cualquiera de los dos componentes por separado.

**H-LOT-5 — `sliceBisectLote` es código muerto (o una función no conectada)**
`subdivisionAlgorithms.ts` define `sliceBisectLote` (bisección a nivel de un lote individual, casi idéntica a `sliceBisectManzano`) pero **no hay ningún call-site** en el dispatcher `subdivide()` ni en ningún comando provisto. O es vestigial, o es una feature de "subdividir un lote ya generado" que se dejó a medio conectar. En cualquier caso, ~120 líneas de lógica duplicada.

**H-LOT-6 — Posible pérdida de área en `subdivideManzanoAuto` (modo2)**
Cuando el manzano se separa en `halfBot`/`halfTop` y se usa un "master" (la mitad con mayor extensión) para generar los cortes que luego se aplican a ambas mitades, los `stripPoly` resultantes en la mitad no-maestra se descartan si `areaM2 < 0.5` sin redistribuir esa área a un lote vecino. Para manzanos muy irregulares esto puede generar micro-huecos sistemáticos que nunca se reportan (no hay validación posterior).

**H-LOT-7 — Tolerancias de bisección no documentadas ni configurables**
`TOL_M2 = 1e-6`, `iters` fijos en 120/160/200, `NARROW_RATIO = 1.6` como constante compartida entre `auto`/`exact`/`modo2` sin justificación en comentarios. Cambiar el comportamiento de un método (p. ej. ajustar la sensibilidad de "manzano angosto") obliga a tocar una constante que afecta a los tres algoritmos por igual, o a duplicarla — ninguna de las dos opciones es buena.

### 2.3 Ciclo de vida de estado (manzanoStore)

**H-LOT-8 — `hasGeomChanged` con tolerancia relativa demasiado ajustada [CONFIRMADO]**

```js
const areaTol = Math.max(0.05, prev.area * 5e-4); // 0.05% relativo
const perimTol = Math.max(0.01, prev.perimeter * 5e-4);
```

0.05% de tolerancia relativa es más ajustado que el ruido de punto flotante esperable al reproyectar repetidamente entre EPSG:3857 y el plano métrico UTM/local (`metrics.ts`). Riesgo de falsos positivos: el badge "⚠ desactualizado" en `ManzanoPanel` puede aparecer sin que el usuario haya tocado nada.

**H-LOT-9 — El snapshot de geometría no se actualiza de forma consistente**
`setGeomSnapshot` solo se llama manualmente desde `ManzanoPanel.runRecompute` **y solo si `dirPref` existe** (`if (dirPref) setGeomSnapshot(...)`). `GenerateLotsCommand` (regenerar todos) nunca lo actualiza. Resultado: el estado "desactualizado" puede quedar permanentemente inconsistente para manzanos rotados y luego regenerados en bloque.

**H-LOT-10 — Estado huérfano sin límite en `manzanoStore`**
`methods`, `rotateDir`, `geomSnapshots`, `openCards` son `Record<string, T>` indexados por id de feature. Cuando `recomputeManzanosImmediate` reemplaza un manzano por fragmentos con **id nuevo** (`${origId}-mzn-${i}`), las entradas del id viejo quedan para siempre en el store (no hay poda ni por conteo ni por TTL). En una sesión larga de edición esto crece sin límite y además hace que un fragmento nuevo "olvide" el método/dirección que el usuario había elegido para ese manzano.

### 2.4 Rendimiento y concurrencia

**H-LOT-11 — Un único Worker singleton serializa TODA la geometría del proyecto**
`geoWorkerClient.ts` usa `let worker: Worker | null` global. Subdivisión, unión, resta, validación, overlaps, gaps y cómputo de manzanos comparten el mismo hilo de worker. Una operación pesada (p. ej. `GenerateLotsCommand` sobre un proyecto grande) bloquea la cola para cualquier otra petición concurrente, incluyendo el recompute que dispara el gizmo de rotación de lotes (`RotateLotsInteraction`) mientras el usuario arrastra — la app puede sentirse "colgada" durante el arrastre si hay un batch en curso.

**H-LOT-12 — Sin cancelación ni progreso**
No hay forma de cancelar un `GenerateLotsCommand` en curso, ni indicador de progreso más allá de un botón deshabilitado con texto "Generando…". Para proyectos con muchos manzanos, la UI da cero feedback incremental.

### 2.5 UI/UX de lotización

- **Sin preview geométrico real.** Tanto `SubdivisionDialog` como `ManzanoPanel` aplican cambios "a ciegas": `SubdivisionDialog` muestra un conteo numérico de lotes tras "Vista previa", pero no dibuja las líneas de corte sobre el mapa antes de aplicar.
- **Dos flujos de UI distintos para el mismo concepto** (subdividir): `SubdivisionDialog` (modal, para un polígono seleccionado cualquiera) y `ManzanoPanel` (tarjetas inline, solo para manzanos). Duplican método/targetAreaM2/frontMinM como estado independiente (`subdivisionStore` vs `manzanoStore`), lo que puede confundir sobre cuál es la fuente de verdad de "área objetivo" en un momento dado.
- **Formato numérico inconsistente:** `ManzanoPanel` imprime `row.areaM2.toFixed(1)` crudo; `PropertyPanel`/`StatsPanel` usan `formatMetricArea()` (con conversión a hectáreas por encima de 10.000 m²). Un manzano grande se ve distinto según el panel donde se lo mire.
- **Gizmo de rotación de lotes** (`RotateLotsInteraction`) es drag-only, tolerancia fija de 14px, sin alternativa por teclado ni input numérico de ángulo.
- **Panel fijo sin responsividad:** `ManzanoPanel` usa `position: fixed; top: 90; left: 10; width: 280` sin clamps de viewport ni colapso en pantallas chicas.

---

## 3. Diagnóstico — Motor de Trazado Vial

### 3.1 Hallazgos críticos

**H-VIA-1 — Miter join sin límite (`offsetPolylineMiter`)**
`roadNetworkEngine.ts` calcula el offset de la polilínea de una calle con un empalme a inglete puro, sin miter-limit ni fallback a bisel/redondeado:

```js
const t = ((p1[0] - p0[0]) * d1[1] - (p1[1] - p0[1]) * d1[0]) / det;
out.push([p0[0] + d0[0] * t, p0[1] + d0[1] * t]);
```

En un waypoint con ángulo muy agudo (zig-zag), esto puede generar una "espiga" de longitud arbitrariamente grande — el clásico problema de miter join sin límite. Esa geometría degenerada alimenta directamente `buildRoadNetworkRings` → unión → resta contra parcelas, pudiendo producir manzanos con formas completamente erróneas para una calle con curvas pronunciadas.

**H-VIA-2 — Sin snapping obligatorio en el trazado de calles → intersecciones "casi tocan"**
El motor de snap avanzado (`advancedSnap.ts`, `SnapEngine`) existe y cubre `intersection`/`endpoint`, pero no hay ninguna validación que obligue (o al menos advierta) que dos calles trazadas cerca una de otra realmente se toquen. Dos calles a pocos centímetros de distancia generan, tras `computeManzanosInWorker`, un **manzano-sliver** en ese hueco — invisible a simple vista en zoom bajo, y sin ningún chequeo automático que lo detecte (ver H-VIA-4).

**H-VIA-3 — Tabla de fillet hardcodeada y con techo bajo para vías anchas**

```js
const MAX_FILLET_R = 8;
export function getFilletRadiusForAngle(angleDeg: number): number { ... }
```

No es configurable por proyecto ni por calle. Para una avenida de 30m de calzada, un radio de ochave máximo de 8m es visualmente incorrecto (las curvas de esquina reales para vías anchas suelen requerir radios mayores). No hay ninguna UI para ajustar esto.

**H-VIA-4 — Validación topológica desconectada del propio motor**
`findOverlaps`/`findGaps`/`validateTopology` existen en el worker y se exponen en `TopBar` como botones manuales ("Overlaps", "Huecos"). **Ninguno se ejecuta automáticamente** después de `recomputeManzanosImmediate`. El usuario tiene que acordarse de clickear manualmente para enterarse de que su trazado vial generó huecos o superposiciones — que es exactamente lo que puede pasar por H-VIA-1/H-VIA-2.

### 3.2 Hallazgos de diseño / consistencia

**H-VIA-5 — Asimetría de features entre Calles y Rotondas**
`roundaboutStore` tiene `updateRoundabout` **usado** por `RoundaboutPanel.tsx` (editar radio/calzada por instancia después de trazada). `streetStore.updateStreet` **existe pero no se llama desde ningún componente provisto** — no existe un "StreetPanel". Para cambiar el ancho de una calle ya trazada, el único camino es borrarla y re-trazarla. Brecha de producto real, no solo estética.

**H-VIA-6 — Calles con ancho ≤ 0 se pueden guardar y dibujar**
`buildRoadNetworkRings` filtra `if (s.widthM <= 0) continue;`, pero el `Street` ya fue creado y persiste en `streetStore`/se pinta en `PostrenderPainter`. Resultado: una calle "fantasma" visible que no corta ningún manzano, sin ningún error visible al usuario que explique por qué.

**H-VIA-7 — `computeStreetFillets` (versión O(n²) deprecada) sigue exportada**
`streetEngine.ts` mantiene la función vieja marcada `@deprecated` junto a la nueva `computeStreetFilletsBoth`. Superficie de error para quien la use por error en código nuevo.

**H-VIA-8 — Contador `nextId` de calles/rotondas nunca se resetea entre proyectos**
`let nextId = 1;` a nivel de módulo en `streetStore.ts` y `roundaboutStore.ts`. Ni `ClearFeaturesCommand` ni la carga de un proyecto nuevo lo reinician. Un proyecto nuevo puede arrancar nombrando su primera calle "Calle F" en vez de "Calle A" si hubo actividad previa en la sesión.

**H-VIA-9 — Rotondas poligonales pequeñas + calzada ancha: sin guard contra geometría degenerada**
`roundaboutGeometry` solo valida que `islandR > 0.3` para dibujar la isla central, pero no valida que el anillo de calzada externo (`roadOuter`/`sideOuter`) no se auto-intersecte para combinaciones extremas de `sides` bajo (3, triángulo) + `roadWidthM` grande. `k = 1/cos(π/n)` puede amplificar bastante el radio efectivo en polígonos de pocos lados.

### 3.3 Rendimiento

**H-VIA-10 — Recompute de fillets/crossings es O(n²) global ante cualquier cambio puntual**
`PostrenderPainter.updateCache` recalcula `computeStreetFilletsBoth` y `computeStreetCrossings` sobre **todas** las calles del proyecto cada vez que cambia una sola calle (`streetsChanged`), no solo las calles afectadas. Con muchas calles esto es cómputo desperdiciado en cada edición.

**H-VIA-11 — `recomputeManzanosImmediate` es un rebuild completo, no incremental**
Cualquier alta/edición de calle o rotonda dispara una reconstrucción de **todas** las parcelas-origen del proyecto contra la unión completa de la red vial (`computeManzanosInWorker`), sin acotar espacialmente a la zona tocada. Para proyectos grandes esto escala mal y es la causa raíz estructural detrás de H-LOT-2/H-LOT-3 (no distingue "esta calle no afecta a este manzano lotizado" de "recorté todo el proyecto de nuevo").

### 3.4 UI/UX de trazado vial

- Sin feedback numérico en vivo durante el trazado de rotonda (`RoundaboutDrawInteraction`): el radio solo se ve como preview visual punteado, no hay etiqueta con metros mientras se arrastra.
- Controles de ancho de calle/vereda duplicados en dos tabs del ribbon (Mapa e Insertar) con el mismo estado — doble superficie de mantenimiento.
- Sin indicación visual de "esta calle no está cortando nada" cuando `widthM <= 0` (ver H-VIA-6).
- Sin loading state visible durante `recomputeManzanos()` (250ms debounce + tiempo de worker): trazar varias calles rápido no muestra ningún indicador de "recalculando…".

---

## 4. Hallazgo transversal — Inconsistencia `type` vs `kind` [CONFIRMADO, alta severidad]

El modelo de datos está en migración incompleta de un campo legado `type` (string libre) hacia `kind` (`GeoUrbanFeatureKind` tipado, resuelto por `getFeatureKind()` en `objectModel.ts`, que revisa `kind` y cae a `type` como fallback).

El problema concreto está en `ManzanoPanel.handleToggleEquip`:

```js
feat.setProperties(ensureKind({ ...feat.getProperties(), kind: wasEquip ? 'manzana' : 'equipamiento' }, ...));
// Limpia el `type` legado para que `getFeatureKind` no caiga al fallback.
feat.unset('type', true);
```

La intención (según el propio comentario) es sana: dejar `kind` como única fuente de verdad. El problema es que **otros cinco consumidores siguen leyendo `type` directamente**, sin pasar por `getFeatureKind()`:

| Consumidor                                           | Código                                                         | Efecto tras togglear equipamiento                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `DrawLayerRenderer.buildWebglStyle`                  | `['==', ['get', 'type'], 'manzana']` (fallback de color WebGL) | El manzano pierde su relleno/borde de color por `colorIdx` y cae al estilo genérico de lote |
| `ManzanoPanel.readManzanoRows` (el mismo componente) | `if (type !== 'manzana' && type !== 'equipamiento') return;`   | **La fila desaparece del propio panel que originó el toggle**                               |
| `StatsPanel.computeStats`                            | `f.get('type') === 'manzana'`                                  | El manzano deja de contarse en "Manzanos" en las estadísticas                               |
| `PostrenderPainter.paintFeatureLabels`               | `feature.get('type') === 'manzana'`                            | Pierde el label especial "Mzo. N" y el color de manzana en las etiquetas                    |
| `styleFactory.resolveDimensionOrientation`           | `if (feature.get('type') === 'manzana') return 'outward';`     | Las cotas de lado cambian de orientación                                                    |

Nótese que las manzanas creadas por `recomputeManzanosImmediate` (el flujo normal de trazado vial) **no reciben `layerId`** — dependen exactamente de esta rama `type==='manzana'` del `match` de WebGL para su color distintivo. Es decir, el bug no es un caso raro: **cualquier manzano generado por el flujo normal de calles, al que se le togglee "Marcar como equipamiento" y luego "Quitar equipamiento", queda permanentemente roto** en cinco lugares distintos del sistema, sin ningún error visible.

`getFeatureKind()` (usado por `recomputeManzanosImmediate`, `AddFeatureCommand`, `RecomputeManzanoLotsCommand`, `GenerateLotsCommand`) **sí** sigue funcionando bien porque prioriza `kind`. Esto hace que el bug sea aún más insidioso: la lógica "de negocio" (motor vial, comandos) sigue operando correctamente sobre el feature roto, mientras la capa visual y de reporting queda desincronizada.

---

## 5. Matriz de severidad y priorización

| ID                | Hallazgo                                 | Severidad  | Esfuerzo estimado | Corrupción de datos       |
| ----------------- | ---------------------------------------- | ---------- | ----------------- | ------------------------- |
| H-LOT-1           | `origPts` descarta ediciones manuales    | 🔴 Crítica | Bajo              | Sí                        |
| H-LOT-2/3         | Lotes huérfanos tras recompute vial      | 🔴 Crítica | Medio             | Sí                        |
| §4                | `type` vs `kind` (toggle equipamiento)   | 🔴 Crítica | Bajo              | No (visual/estadística)   |
| H-VIA-4           | Validación topológica desconectada       | 🟠 Alta    | Bajo              | No (detección)            |
| H-VIA-1           | Miter join sin límite                    | 🟠 Alta    | Medio             | Sí (geometría degenerada) |
| H-LOT-10          | Estado huérfano en manzanoStore          | 🟠 Alta    | Bajo              | No (memoria/UX)           |
| H-VIA-2           | Sin snapping obligatorio en calles       | 🟠 Alta    | Medio             | Sí (slivers)              |
| H-LOT-8/9         | Snapshot de staleness inconsistente      | 🟡 Media   | Bajo              | No                        |
| H-VIA-5           | Sin StreetPanel (editar calle existente) | 🟡 Media   | Medio             | No (producto)             |
| H-VIA-6           | Calles con ancho ≤ 0                     | 🟡 Media   | Bajo              | No                        |
| H-LOT-4           | Nombres de método desalineados           | 🟡 Media   | Bajo              | No (mantenibilidad)       |
| H-LOT-5           | `sliceBisectLote` código muerto          | 🟢 Baja    | Bajo              | No                        |
| H-VIA-7           | `computeStreetFillets` deprecado vivo    | 🟢 Baja    | Bajo              | No                        |
| H-VIA-8           | `nextId` no se resetea                   | 🟢 Baja    | Bajo              | No                        |
| H-LOT-11/H-VIA-11 | Worker singleton / rebuild completo      | 🟡 Media   | Alto              | No (performance)          |
| UI/UX (§2.5/§3.4) | Preview, feedback, accesibilidad         | 🟡 Media   | Medio-Alto        | No                        |

---

## 6. Plan de solución por fases

### **Fase 0 — Hotfixes de corrupción de datos (1-2 sprints, bajo riesgo)**

Objetivo: parar el sangrado. Ningún cambio estructural, solo cerrar las tres vías de corrupción/rotura silenciosa.

1. **Eliminar la escritura de `type`, dejar solo `kind`.**
   - Quitar `feat.unset('type', true)` de `ManzanoPanel.handleToggleEquip` (ya no hace falta si nadie más escribe `type`).
   - Quitar `type: 'manzana'` de `recomputeManzanosImmediate` (dejar que `ensureKind` maneje `kind` únicamente).
   - Reemplazar **los cinco consumidores** listados en §4 (`DrawLayerRenderer.buildWebglStyle`, `ManzanoPanel.readManzanoRows`, `StatsPanel.computeStats`, `PostrenderPainter.paintFeatureLabels`, `styleFactory.resolveDimensionOrientation`) para que usen `getFeatureKind(feature) === 'manzana'` en vez de `feature.get('type') === 'manzana'`.
   - Nota: `getFeatureKind` ya soporta fallback a `type` para proyectos `.geourban` antiguos guardados en disco — no rompe compatibilidad de importación.
   - Asignar explícitamente `layerId` a las manzanas creadas en `recomputeManzanosImmediate` (vía `resolveLayerId(undefined, 'manzana')`) para no depender exclusivamente de la rama fallback del `match` de WebGL.

2. **Invalidar `origPts` en cada edición manual confirmada.**
   - En `ModifyGeometryCommand.execute()` (tras `updateFeatureMetrics(t)`), si el feature tiene `origPts` seteado, o bien: (a) eliminarlo (`t.unset('origPts', true); t.unset('origParcelId', true)`) forzando que el próximo recompute lo re-derive de la geometría actual tratándolo como parcela nueva, o (b) actualizarlo con las coordenadas nuevas. Se recomienda **(a)**: es más simple y evita mantener sincronizados dos representantes de la misma geometría.
   - Mismo tratamiento en `SafeTranslate`/traslados (`translateend`, que también dispara `ModifyGeometryCommand` según `InteractionModeController` — confirmar que pasa por el mismo camino).

3. **No dejar lotes huérfanos al recomputar la red vial.**
   - Cambio mínimo en `recomputeManzanosImmediate`: cuando se identifica un `origId` cuyo miembro manzana tiene lotes hijos vivos (`lotGroupId === String(member.getId())`), **antes** de reconstruir fragmentos, remover también esos lotes hijos del `drawSource`.
   - Decisión de producto a resolver en esta fase (bloqueante, involucrar a quien define UX): al detectar ese caso, ¿se regeneran los lotes automáticamente con el mismo método/targetArea que tenían (usando `manzanoStore.getMethod`/`getRotateDir` del manzano original), o simplemente se vuelve a mostrar el manzano sin lotizar y se le pide al usuario que regenere a mano? Fase 4 desarrolla la solución completa; acá solo se **detiene la corrupción** (mínimo: borrar huérfanos, aunque implique perder el detalle de lotización hasta que el usuario regenere).

4. **Poda de `manzanoStore` en cada recompute.**
   - Al final de `recomputeManzanosImmediate`, calcular el set de ids de manzana vivos en `drawSource` y purgar de `methods`/`rotateDir`/`geomSnapshots`/`openCards` cualquier entrada cuyo id ya no exista.

**Criterio de salida de Fase 0:** un test manual de "trazar calle → generar lotes → trazar calle nueva que atraviesa esa zona → verificar que no queden polígonos superpuestos" pasa limpio, y "togglear equipamiento dos veces → verificar color/estadísticas/panel sin cambios" pasa limpio.

---

### **Fase 1 — Contrato de datos formal (1 sprint)**

Objetivo: que la Fase 0 no se vuelva a romper por accidente.

1. Documentar en `core/objectModel.ts` (comentario de cabecera) que `kind` es la **única** fuente de verdad de ahí en más; `type` solo se lee (nunca se escribe) y únicamente dentro de `getFeatureKind()`, exclusivamente para migrar proyectos `.geourban` guardados antes de este cambio.
2. Formalizar el **contrato de "manzano lotizado"**: agregar un campo explícito (`lotStatus: 'none' | 'subdivided'` o similar) en vez de inferirlo indirectamente de "¿existe una manzana con este id?" + "¿hay lotes con este lotGroupId?". Este campo es el que va a necesitar la Fase 4 para decidir si re-lotizar automáticamente.

---

### **Fase 2 — Robustez del motor vial (1-2 sprints)**

1. **Miter limit en `offsetPolylineMiter`** (`roadNetworkEngine.ts`): acotar `t` a un múltiplo razonable del ancho de calle (p. ej. `t = Math.min(t, halfWidth * MITER_LIMIT)`) y hacer fallback a un punto de bisel simple cuando se excede el límite, en vez de dejar la espiga sin control.
2. **Fillet radius configurable**: mover `MAX_FILLET_R` y la tabla de `getFilletRadiusForAngle` a un parámetro de proyecto (o mínimo, derivarlo proporcionalmente al ancho de calzada de las calles que confluyen, en vez de una tabla fija por ángulo únicamente). Exponer el máximo en la UI de parámetros de vía (`ManzanoPanel`/`TopBar`).
3. **Snapping recomendado/forzado en modo `street`**: cuando el punto final de una calle nueva cae dentro de una tolerancia pequeña (p. ej. 2x el pixelTolerance de OSNAP) de otra calle sin llegar a hacer snap exacto, mostrar una advertencia inline ("¿Conectar con Calle B?") antes de confirmar el trazo, reutilizando `advancedSnap.ts` ya existente.
4. **Validación topológica automática post-recompute**: tras cada `recomputeManzanosImmediate` (y tras cada `GenerateLotsCommand`), correr `findOverlapsInWorker`/`findGapsInWorker` en segundo plano (sin bloquear UI) y mostrar un badge no intrusivo en `StatusBar` ("⚠ 2 superposiciones detectadas — ver detalle") en vez de depender de que el usuario clickee manualmente los botones de `TopBar`.
5. Eliminar `computeStreetFillets` (deprecada) del árbol de exports de `streetEngine.ts`; dejar solo `computeStreetFilletsBoth`.
6. Clamps/warnings para combinaciones degeneradas de rotonda poligonal (`sides` bajo + `roadWidthM` grande): validar que `roadOuter` no se auto-intersecte antes de confirmar el trazado (o al menos advertir).
7. Filtrar/advertir calles con `widthM <= 0` en el momento de creación (`AddStreetCommand`), no solo silenciosamente en `buildRoadNetworkRings`.
8. Resetear `nextId` de `streetStore`/`roundaboutStore` al cargar un proyecto o crear uno nuevo (mover el contador dentro del store, no a nivel de módulo, o reiniciarlo explícitamente en `ClearFeaturesCommand`/`handleNewProject`/al importar).

---

### **Fase 3 — Robustez del motor de lotización (1-2 sprints)**

1. Renombrar (o al menos documentar con un mapa explícito en un único lugar) las claves internas `auto`/`exact`/`modo2` junto a sus etiquetas de UI ("Auto (Cabecera+Cuerpo)", "Modo 1 (área exacta)", "Modo 2 (grilla PCA)"), idealmente unificando el vocabulario interno y externo para evitar el desfasaje descrito en H-LOT-4.
2. Decidir el destino de `sliceBisectLote`: conectarlo a una feature real ("subdividir un lote ya generado", coherente con la UI que ya tiene botones de "Subdividir" en `PropertyPanel` para cualquier polígono seleccionado, incluidos lotes) o eliminarlo.
3. Mover la actualización de `manzanoStore.setGeomSnapshot` **dentro** de `RecomputeManzanoLotsCommand.execute()` (siempre, no condicionado a `dirPref`) y agregarla también a `GenerateLotsCommand.execute()` por cada manzano procesado, para que el estado de "desactualizado" sea consistente sin importar el flujo de entrada.
4. Revisar la tolerancia de `hasGeomChanged`: pasar de tolerancia puramente relativa a un mínimo absoluto más generoso, o comparar adicionalmente el centroide con una tolerancia en metros (más robusto a ruido de reproyección que área/perímetro puros).
5. Investigar y, si se confirma, corregir la pérdida de área sistemática descrita en H-LOT-6 (`subdivideManzanoAuto`, filtrado `areaM2 < 0.5` sin redistribución).
6. Ejecutar validación topológica automática (igual que en Fase 2, punto 4) también tras `SubdivideCommand`/`RecomputeManzanoLotsCommand`/`GenerateLotsCommand`, mostrando el resultado por manzano afectado en `ManzanoPanel` (no solo un badge global).

---

### **Fase 4 — Integración vial ↔ lotización ("dejar de congelar")**

Esta es la fase de mayor impacto de producto: resolver de raíz H-LOT-2/H-LOT-3, no solo contenerlos.

1. Usar el campo `lotStatus` introducido en Fase 1 para que `recomputeManzanosImmediate`, al detectar que un origen tiene lotes vivos, **re-invoque automáticamente** `subdivideManzanoBatchInWorker` con el método/`dirPref`/`targetAreaM2`/`frontMinM` que ese manzano tenía guardados en `manzanoStore` antes de la recorte — regenerando los lotes en el mismo paso, en vez de dejarlos huérfanos o simplemente borrarlos.
2. Si la regeneración automática no es viable en todos los casos (p. ej. el manzano fue partido en 2+ fragmentos por la calle nueva y no está claro cómo repartir el `targetAreaM2` original), como mínimo: marcar visualmente esos fragmentos como "pendientes de re-lotizar" (mismo mecanismo visual que el badge de "desactualizado" de Fase 3) en vez de dejarlos silenciosamente sin lotes ni aviso.
3. Confirmación previa al usuario cuando una calle/rotonda nueva va a afectar un manzano ya lotizado ("Esto va a regenerar los lotes de Mzo. X, ¿continuar?"), para que la sorpresa no sea descubrir el cambio después de trazar.
4. Acotar espacialmente el recompute: usar el índice espacial (`SpatialIndex`, ya existente y usado para hit-testing) para determinar qué orígenes realmente intersectan la red vial nueva/modificada, y solo reconstruir esos — resolviendo a la vez H-VIA-11 (performance) y haciendo más seguro el punto 1 de esta fase (menos superficie de manzanos tocados por edición = menos riesgo de resultados inesperados).

---

### **Fase 5 — UI/UX**

1. **Preview geométrico real**: en `SubdivisionDialog` y en `ManzanoPanel`, dibujar las líneas de corte resultantes como overlay temporal en el mapa (reutilizando el mecanismo de `PostrenderPainter`/capas temporales que ya usa `RotateLotsInteraction`) antes de "Aplicar", no solo un conteo numérico.
2. **`StreetPanel.tsx`** análogo a `RoundaboutPanel.tsx`: listar calles trazadas, permitir editar nombre/ancho/vereda usando `streetStore.updateStreet` (ya existe, no se usa desde ningún componente).
3. Etiqueta numérica en vivo (metros) durante el trazado de rotonda (`RoundaboutDrawInteraction`) y durante el arrastre del gizmo de rotación de lotes.
4. Unificar formato numérico: reemplazar los `toFixed(1)` crudos de `ManzanoPanel` por `formatMetricArea`/`formatMetricLength` (ya usados en `PropertyPanel`/`StatsPanel`).
5. Progreso/feedback durante operaciones largas: spinner o barra en `ManzanoPanel` durante `GenerateLotsCommand`/recompute vial, con opción de cancelar cuando la Fase 6 lo habilite técnicamente.
6. Accesibilidad: alternativa por teclado (inputs numéricos de ángulo) al gizmo drag-only de `RotateLotsInteraction`; revisar `aria-label` en controles numéricos del ribbon.
7. Responsividad: clamps de viewport y colapso automático para `ManzanoPanel`/`StatsPanel`/`RoundaboutPanel` en pantallas angostas.
8. Evaluar consolidar `SubdivisionDialog` y el flujo de `ManzanoPanel` en una sola fuente de verdad de parámetros de subdivisión (hoy `subdivisionStore` y `manzanoStore` mantienen `targetAreaM2`/`frontMinM` de forma independiente).

---

### **Fase 6 — Rendimiento y escalabilidad**

1. Separar el Worker singleton en (al menos) dos: uno para operaciones de edición interactiva (subdivisión puntual, recompute de un manzano) y otro para operaciones batch/validación (generar todos, validar topología, overlaps, gaps), para que una operación pesada no bloquee la cola de operaciones interactivas.
2. Recompute incremental de fillets/crossings en `PostrenderPainter`: cachear por par de calles y solo invalidar los pares donde interviene la calle modificada, en vez de recalcular todo el O(n²) ante cualquier cambio.
3. Recompute vial incremental (ver Fase 4, punto 4) como mejora de performance además de corrección funcional.
4. Chunking/progreso para `GenerateLotsCommand` en proyectos grandes (procesar en tandas, permitir cancelación real, no solo deshabilitar el botón).
5. Poda de `CommandStack`/`manzanoStore` basada también en tamaño aproximado de memoria, no solo en conteo de entradas (`MAX_STACK = 100`).

---

### **Fase 7 — QA, validación automática y observabilidad**

1. Logging estructurado de errores de worker (hoy `console.error` suelto en varios `catch`) hacia un canal centralizado, con contexto suficiente para reproducir (tipo de operación, tamaño de payload, mensaje de error).
2. Checklist de regresión manual para casos límite: calles con waypoints en zig-zag pronunciado, rotonda triangular con calzada ancha, manzano muy angosto (`NARROW_RATIO`), importación DXF con muchas entidades seguida de generación masiva de lotes.

---

## 7. Resumen de dependencias entre fases

```
Fase 0 (hotfixes)  ──┬──> Fase 1 (contrato de datos) ──> Fase 4 (integración vial↔lotización)
                     │
                     ├──> Fase 2 (robustez vial) ─────────┐
                     │                                     ├──> Fase 6 (performance)
                     └──> Fase 3 (robustez lotización) ────┘

Fase 5 (UI/UX) depende de Fase 1 (para el badge "pendiente de re-lotizar")
                y puede avanzar en paralelo a Fase 2/3 en lo que no dependa de eso.

```

**Recomendación de secuencia real de ejecución:** Fase 0 primero y sola (para el próximo release/hotfix), después Fase 1 + Fase 2 + Fase 3 en paralelo si hay más de un desarrollador (son independientes entre sí una vez cerrada la Fase 0), y Fase 4 recién cuando 1/2/3 estén cerradas porque depende de ambas.
