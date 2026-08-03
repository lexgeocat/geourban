# Fase 2 — Sacar la instrumentación de debug/benchmark del bundle de producción

**Resultado de mayor impacto/riesgo-bajo del plan.** El plan advertía: el problema real no es el tamaño del bundle (esto es Tauri, no web), es la **telemetría corriendo en cada frame de render, siempre, para todo usuario**, más un arnés de automatización que puede intentar pegarle a `localhost:9876` en producción. La Fase 2 atacó ambos frentes.

## Cambios aplicados

### `src/App.tsx`

- `DebugPanel` y `Fase6AutoValidator` ahora son `React.lazy(() => import('...'))` solo si `import.meta.env.DEV`. En producción se resuelven a `null` y ni siquiera se monta el componente (se mantienen dentro de `<Suspense fallback={null}>` por si en dev el chunk tarda en llegar).
- Vite/Rollup hace tree-shaking de la rama `null` y **elimina del bundle** los imports de `DebugPanel.tsx`, `Fase6AutoValidator.tsx` y todos los `geo/debug/*` que solo ellos importan (los benchmarks, `syntheticDataset`, `syntheticUrbanLayout`, etc.).

### `src/store/debug/debugCounters.ts`

- Nuevo flag módulo-privado `telemetryEnabled` (default `false`).
- Export nuevo `setDebugTelemetryEnabled(v: boolean)`.
- **Todas las funciones `record*`** y `readPostrenderSplit`/`readDebugCounters` arrancan con `if (!isEnabled()) return;` o `return {}`/`return {...0s}`. En dev con panel cerrado no se ejecuta nada.

### `src/store/debug/geometryTelemetry.ts`

- Mismo flag `telemetryEnabled` con `setGeometryTelemetryEnabled(v)`.
- El `console.warn('[geometry-sanitize]', JSON.stringify(...))` se gateó por `import.meta.env.DEV` (la idea original del plan literal). El `JSON.stringify` nunca corre en producción.
- `bumpContext`/`recentEvents.push` también se gatean por el flag (sino el módulo sigue pagando costo por cada evento de saneo, que puede dispararse durante edición normal).

### `src/components/debug/DebugPanel.tsx`

- En el `useEffect` que ya se gatilla solo cuando `open === true` (línea 132), se prenden ambos flags: `setDebugTelemetryEnabled(true)` y `setGeometryTelemetryEnabled(true)`.
- Decisión: el panel activa los counters **al abrirse**, no al montarse. Esto preserva la propiedad del plan original de "cero costo en dev con panel cerrado" (que es el 99% del tiempo en dev, dado que el panel está oculto tras Ctrl+Shift+D).
- Consecuencia: cuando el usuario abre el panel por primera vez, los counters arrancan desde 0. Es el trade-off correcto — si el panel estuviera siempre activo en dev, el dev también pagaría el costo en hot-path, anulando el beneficio de la Fase 2 para devs.

## Módulos NO tocados a propósito

- `store/debug/debugPanelStore.ts` (Zustand store de `open/toggle`) — se usa desde `useKeyboardShortcuts.ts`, que corre siempre.
- `store/debug/perfTelemetry.ts` — **no es solo debug**: lo usan `CommandStack`, `projectFile`, `mapStore`, `geoWorkerClient`. Es código de producto real.
- `store/debug/nativeEngineTelemetry.ts`, `nativeMemoryTelemetry.ts`, `affineTelemetry.ts` — los usan `affineCache` y `geoWorkerClient` (código de producto).
- `geo/debug/*` — **no requirieron cambios explícitos**: solo se importan desde `DebugPanel.tsx` y `Fase6AutoValidator.tsx`. Con estos en `lazy + DEV`, los benchmarks quedan fuera del bundle de producción automáticamente.

## Verificación

| Check | Resultado |
| ----- | --------- |
| `tsc --noEmit` | ✅ sin output (0 errores) |
| `npm run lint` | ✅ 2 errors / 3 warnings — **idéntico al baseline** (los errores preexistentes son `no-empty` en `try { ... } catch {}`, no introducidos por esta fase) |
| `npm test` (Vitest) | ✅ 50/50 passed (7 files, 7.58s) |
| `cargo test -p geourban-geo --features geos-backend` | ✅ 3/3 sintéticos + paridad, PASS |
| `npm run build` (producción) | ✅ OK en 19.86s |

### Cambios en tamaño de bundle

```
baseline (Fase 0):  1,196,965 bytes  (gzip 356,224)
post-Fase 2:        1,153,670 bytes  (gzip 341,631)
delta:              -43,295 bytes  (gzip -14,593)
                    -3.62%         (gzip -4.10%)
```

### Cero referencias en el bundle de producción

Grep sobre `dist/assets/index-*.js` para los strings clave del debug:

```
'DebugPanel'                 -> 0 matches
'Fase6AutoValidator'         -> 0 matches
'syntheticUrban'             -> 0 matches
'concurrencyStress'          -> 0 matches
'affineAccuracy'             -> 0 matches
'undoRedoBenchmark'          -> 0 matches
'spatialIndexBenchmark'      -> 0 matches
'generateSyntheticManzanos'  -> 0 matches
'#fase6-validate'            -> 0 matches
'127.0.0.1:9876'             -> 0 matches  ← POST a localhost eliminado
'runSyntheticUrbanBenchmarkSuite' -> 0 matches
'runConcurrencyStressSuite'  -> 0 matches

# Variables internas de los counters:
'setStyleCalls'              -> 0 matches
'postrenderSamples'          -> 0 matches
'splitSamples'               -> 0 matches
'recordPostrenderSplit'      -> 0 matches
'recordPostrenderDuration'   -> 0 matches
'recordSetStyleCall'         -> 0 matches
'recordSyncLayerSetCall'     -> 0 matches
'recordSyncGizmoCall'        -> 0 matches
'recordWebglLayerCount'      -> 0 matches
'recordLabelCacheHit'        -> 0 matches
'recordLabelCacheMiss'       -> 0 matches
'recordGeometrySanitizeEvent'-> 0 matches
'setDebugTelemetryEnabled'   -> 0 matches
'setGeometryTelemetryEnabled'-> 0 matches
```

**Interpretación:** Rollup detectó que `setStyleCalls`, `postrenderSamples`, `splitSamples` y compañía son `let` con `if (!isEnabled()) return;` donde `isEnabled()` retorna `false` constante en prod → eliminó el cuerpo de las funciones. El bundle de producción ya **no contiene** ni la instrumentación ni la lógica de counters.

## Comportamiento esperado por modo

| Modo | Panel montado | `telemetryEnabled` | Console warn | Counters activos |
| ---- | ------------- | ------------------ | ------------ | ---------------- |
| Dev, panel cerrado (Ctrl+Shift+D) | sí (lazy chunk cargado) | `false` | no | no |
| Dev, panel abierto              | sí | `true` | sí (DEV) | sí |
| Prod, cualquier caso             | no (lazy nunca se monta) | `false` para siempre | no | no |

## Reproducir la verificación

```powershell
# desde F:\lexgeocat-geourban (branch chore/cleanup)
npm run build 2>&1 | Tee-Object -FilePath docs\phase-2-debug-gating\build.txt
Get-ChildItem dist\assets -File |
  Select-Object Name, Length |
  Out-File -FilePath docs\phase-2-debug-gating\bundle-sizes.txt -Encoding utf8

# Sanity: que el bundle no tenga codigo de debug
$js = (Get-ChildItem dist\assets -Filter "*.js")[0]
$content = Get-Content $js.FullName -Raw
'DebugPanel', 'Fase6AutoValidator', '127.0.0.1:9876', 'syntheticUrban' |
  ForEach-Object { "$_ -> $(([regex]::Matches($content, [regex]::Escape($_))).Count)" }
```

## Riesgo y reversibilidad

- **Riesgo en runtime:** bajo. El comportamiento en dev es idéntico al anterior (el panel sigue funcionando, los counters se activan al abrir). En prod, todo el código eliminado es instrumentación que no debería estar corriendo de todas formas.
- **Reversibilidad:** trivial. Un solo `git revert` revierte los 3 archivos (`App.tsx`, `debugCounters.ts`, `geometryTelemetry.ts`, `DebugPanel.tsx`).
- **Qué NO valida esta fase:** el dev server real con Ctrl+Shift+D abriendo el panel. La validación es estática (presencia en bundle, `tsc --noEmit`, vitest) — la confirmación manual de UX queda para QA humano.

## Lo que la Fase 2 **no** toca (queda para Fase 7/8)

- Los `console.*` de las 4 entradas restantes de prioridad B del `console-audit.md` (`affineCache.ts:79`, `recomputeManzanos.ts:732`, `DrawLayerRenderer.ts:43`, `mapStore.ts:110`). Son gatings de un solo `if` por archivo, no necesitan estar en esta fase.
- El `any`-audit de Fase 1.4 (Fase 7).
- El borrar símbolos muertos de `polygonEngine.ts` (Fase 6).
- Las deps DXF/SHP/JSZip (Fase 13).
