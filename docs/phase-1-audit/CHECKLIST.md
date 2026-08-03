# Fase 1 — Checklist consolidada (auditoría, solo lectura)

**Output único de la Fase 1.** Esta fase no toca código de producto: solo lee, grepa y cataloga. La checklist de abajo es lo que alimenta las Fases 2, 6, 7, 8 y 13. Lo que **no** aparece acá explícitamente como "vivo" o "muerto" no se toca hasta que alguna fase posterior lo confirme por sí misma.

Artefactos detallados:
- `grep-symbolos.txt` y `grep-simbolos-extendido.txt` — Fase 1.1, símbolos de `polygonEngine.ts`
- `console-audit.md` — Fase 1.3, clasificación de los 26 `console.*`
- `any-audit.md` — Fase 1.4, los 28 `any` como tipo

---

## 1.1 — `polygonEngine.ts`: confirmados para borrar en Fase 6

Grep en repo entero (`git grep -w`, excluyendo `index_modelo.html` que es legacy no importado). **Corrección importante vs. el plan:** el plan decía "`clipToStrip`/`clipHalfPlane` se usan entre sí pero no vi un consumidor externo" — confirmado, y como `clipToStrip` mismo está muerto, **ambos** se van juntos.

| Símbolo                | Consumidores externos reales                    | Veredicto                                  |
| ---------------------- | ----------------------------------------------- | ------------------------------------------ |
| `LotResult` (tipo)     | `geoWorkerClient.ts`, `GenerateLotsCommand.ts`  | **VIVO** — contrato IPC con Rust           |
| `convexHull`           | —                                               | **MUERTO**                                 |
| `principalAxis`        | — (solo `index_modelo.html` legacy)             | **MUERTO**                                 |
| `projectExtents`       | — (solo `index_modelo.html` legacy)             | **MUERTO**                                 |
| `clipToStrip`          | — (solo `index_modelo.html` legacy)             | **MUERTO**                                 |
| `clipHalfPlane`        | — (uso interno desde `clipToStrip`)             | **MUERTO**                                 |
| `buildCutPolys`        | —                                               | **MUERTO**                                 |
| `SliceResult` (tipo)   | — (matches en Rust son tipos homónimos)         | **MUERTO**                                 |
| `CutResult` (tipo)     | — (matches en Rust son tipos homónimos)         | **MUERTO**                                 |

**Acción Fase 6:** borrar `convexHull`, `principalAxis`, `projectExtents`, `clipToStrip`, `clipHalfPlane`, `buildCutPolys`, `interface SliceResult`, `interface CutResult`. Dejar `LotResult`, `polyArea`, `centroid`, `ringPerimeter`, `pathLength`, `pointInPoly`, `segmentIntersectsPoly` y los helpers privados (`side`, `lineLineIntersect` que solo se usan desde `clipHalfPlane` — si `clipHalfPlane` se va, se evalúan en Fase 6).

**Riesgo:** bajo. Confirmar con `tsc --noEmit` y `npm run build` post-borrado.

---

## 1.2 — Dependencias de import/export: confirmadas como muertas

`git grep -l "dxf-parser|dxf-writer|shpjs|shp-write|jszip" -- 'src' 'src-tauri'`:

```
src/types/vendor.d.ts     ← único hit
```

**No existe** código de import/export DXF/SHP/GPKG en el repo. El plan asumía que existía y no me había sido compartido — el grep en el repo real lo desmiente.

**Acción Fase 13:** eliminar de `package.json`: `dxf-parser`, `dxf-writer`, `shpjs`, `shp-write`, `jszip`. Borrar `src/types/vendor.d.ts`. Regenerar lockfile. Build completo.

**Hallazgo adicional (no en el plan):** hay copy de UI en `StatusBar.tsx:324` y `ProjectSetupModal.tsx:56,70,99` que **anuncia al usuario** una feature "Exportación DXF" / "importar DXF" que **no existe** en el código. Es un bug funcional/de UX:

```ts
// StatusBar.tsx:323-326
"Exportación DXF usa: " + (crsMode === 'utm' ? exportEpsg : 'Plano local (centrado en la vista actual)')
```

```ts
// ProjectSetupModal.tsx:56,70,99
"pero exportar/importar DXF necesita un ..."
"Coordenadas reales en metros. Requerido para DXF georreferenciado"
"Plano local en metros. El DXF exportado no tiene anclaje real"
```

**Decisión a tomar por el equipo antes de la Fase 13:**

- (A) Borrar la copy junto con las deps (el producto no tiene la feature, no la debe prometer).
- (B) Implementar la feature.
- (C) Cambiar la copy a "próximamente" / quitar la mención.

**No aplica a Fase 13 automáticamente** — necesita decisión de producto. Lo dejo registrado acá.

---

## 1.3 — `console.*`: 17 errores genuinos / 7 a gatear / 1 ya gated / 1 caso Fase 2

Ver `console-audit.md` para el detalle línea por línea.

**Acción Fase 2/8 (consolidada):**

- `affineCache.ts:79`, `recomputeManzanos.ts:732`, `DrawLayerRenderer.ts:43`, `mapStore.ts:110` → envolver en `if (import.meta.env.DEV)`.
- `geometryTelemetry.ts:56` → ya está en el plan de Fase 2 explícitamente (gatear el `console.warn` + `JSON.stringify`).
- `recomputeManzanos.ts:560` y `:1000` (warnings de "fragmentos descartados") → mismo patrón que `geometryTelemetry` (conteo siempre, log solo en dev). **A confirmar con el equipo si el conteo ya se mantiene en memoria** — el plan dice que sí pero no verifiqué el código de esa rama.
- `PostrenderPainter.ts:196` → **ya está gated** (confirmado en lectura del archivo). No requiere acción.

---

## 1.4 — `any` como tipo: 28 ocurrencias, 14 de prioridad alta

Ver `any-audit.md` para el detalle por archivo y por línea.

**Acción Fase 7 (resumen de alta prioridad):**

| Archivo                                       | Ocurrencias | Acción |
| --------------------------------------------- | ----------- | ------ |
| `PropertyPanel.tsx:67`                        | 1           | Reemplazar `as any` por `Feature<Geometry> \| null` |
| `StatsPanel.tsx:36`                           | 1           | Tipar `drawSource: VectorSource \| null, streets: Street[]` |
| `useTopBarActions.ts:75,99,121`               | 3           | Quitar `as any` (los tipos ya existen) |
| `Map.tsx:242,245,253`                         | 3           | Tipar handlers con `FeatureEvent` de OL |
| `Map.tsx:112`                                 | 1           | Tipar `toRemove: string[]` o `Feature<Geometry>[]` |
| `layersRegistryStore.ts:58,177`               | 2           | Agregar `colorMode` al tipo `Layer` o usar type guard |
| `mapStore.ts:116,149`                         | 2           | Tipar `addFeatures` y `getSource` con tipos OL |
| `subdivisionStore.ts:66`                      | 1           | Tipar `state.options` con `Partial<SubdivisionOptions>` |

**Corrección vs. el plan:** el plan atribuyó `(layer as any).getSource?.()` a `LayerPanel.tsx`; el grep real lo encuentra en `mapStore.ts:149`. Mismo patrón, archivo distinto. La Fase 7 ataca el archivo correcto.

**Prioridad MEDIA/BAJA:** no listadas acá, no urge. Fase 7 los resuelve solo si sobran ganas.

---

## Resumen ejecutivo para Fases siguientes

| Fase | Qué usa de este checklist |
| ---- | ------------------------- |
| 2    | 1.3 (gatear `console.warn` de desarrollo + `geometryTelemetry`) |
| 6    | 1.1 (borrar símbolos muertos de `polygonEngine.ts`) |
| 7    | 1.4 (cambiar regla a `warn` + resolver 14 de prioridad alta) |
| 8    | 1.3 (los 4 restantes de prioridad B) |
| 13   | 1.2 (borrar deps DXF/SHP/JSZip + `vendor.d.ts`) — **previo OK sobre la copy de UI** |

## Riesgos detectados durante la auditoría (no en el plan original)

1. **Copy de UI promete feature inexistente (DXF import/export).** Hallazgo de Fase 1.2. Decisión de producto pendiente antes de Fase 13.
2. **`recomputeManzanos.ts:560/1000` borderline A/B.** Los warnings de "fragmentos descartados" pueden ser error genuino (si el conteo en memoria se pierde) o telemetría (si se mantiene). Verificar antes de la Fase 2.
3. **El plan atribuyó `(layer as any).getSource?.()` a `LayerPanel.tsx`**; en realidad está en `mapStore.ts:149`. La Fase 7 va al archivo correcto, pero anoto que el plan tiene al menos un error factual — si el equipo encuentra otros, los vamos detectando en cada fase.
