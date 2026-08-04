# Fase 3 — Consolidar la resolución de capa activa (4 implementaciones → 1)

**Estado: COMPLETADA.** El plan detectó cuatro funciones distintas que resolvían "¿a qué capa va esta feature nueva?" con jerarquías de fallback parecidas pero no idénticas:

| Función | Archivo | Antes de la fase |
| --- | --- | --- |
| `resolveLayerId(override?, kind?)` | `commands/features/AddFeatureCommand.ts` | override → active (sin check de kind) → `getLayerForKind` → `undefined` |
| `requireLayerForKind(kind)` | `store/ui/layerPickerStore.ts` | active (con check de kind) → `getLayerForKind` → auto-create |
| `resolveOrCreateLayerForKind(kind)` | `store/entities/layerAutoCreate.ts` | active (con check de kind) → `getLayerForKind` → auto-create |
| `resolveLoteLayerId(preferredLayerId?)` | `geo/recomputeManzanos.ts` | preferred → active (**sin check de kind** — bug) → `getLayerForKind` → auto-create |

## Cambios aplicados

### `src/store/entities/layerResolution.ts` (nuevo)

Función única parametrizable que reemplaza las cuatro:

```ts
pickLayerId(opts: { kind; override?; requireKindMatch?; autoCreate? }): string | undefined
```

Jerarquía: override → capa activa (con check de kind si `requireKindMatch`) → primer match de `getLayerForKind` → auto-create (si `autoCreate`). El default de `autoCreate` es `false` (preserva el contrato de `resolveLayerId` original, que devolvía `undefined` sin capa apta).

### Migración de los 4 call-sites (delegan en `pickLayerId`)

- `AddFeatureCommand.ts` → `resolveLayerId` = `pickLayerId({ kind, override, requireKindMatch: true, autoCreate: false })`. **Comportamiento modificado a propósito:** antes la capa activa se usaba sin chequear kind (bug históricos de calles cayendo en capa "Lote"); ahora respeta kind. Documentado como fix, no refactor silencioso.
- `layerPickerStore.ts` → `requireLayerForKind` = `pickLayerId({ kind, requireKindMatch: true, autoCreate: true })`. Se eliminó el `// FIX:` original que documentaba el fix de kind — ahora el criterio vive centralizado en `layerResolution.ts`.
- `layerAutoCreate.ts` → `resolveOrCreateLayerForKind` = `pickLayerId({ kind, requireKindMatch: true, autoCreate: true })`.
- `recomputeManzanos.ts` → `resolveLoteLayerId` = `pickLayerId({ kind: 'lote', override, requireKindMatch: true, autoCreate: true })`. **BUGFIX:** era la única de las 4 que usaba la capa activa sin validar que fuera de tipo `lote` (el `// FIX:` de `layerPickerStore` documentaba que el bug se había corregido ahí pero no acá).

### `src/commands/core/commandContext.ts` (nuevo) + `Command.ts` + `CommandStack.ts`

Rompe el ciclo de imports `Command ⇄ mapStore` (Command → commandContext → mapStore → DeleteFeaturesCommand → Command) que rompía la carga del test suite:

- `CommandContext` + `getCommandContext` se extraen a `./commandContext`.
- `CommandStack.ts` importa `getCommandContext` directo de `./commandContext` (era el único consumidor del re-export).
- `Command.ts` re-exporta solo el tipo `CommandContext` (type-only, no fuerza la evaluación de `mapStore`).

### `src/store/entities/layerResolution.test.ts` (nuevo, 26 tests)

Tests de caracterización + regresión: jerarquía de 4 niveles, flag `requireKindMatch` (el FIX), y contrato de los 4 wrappers. Los imports de los wrappers que arrastran el grafo `CommandStack` se hacen con `await import(...)` dentro de cada `it`.

Dos tests se ajustaron durante la fase porque su expectativa no matcheaba el comportamiento real consolidado (comportamiento preservado de las 4 funciones originales):

- `pickLayerId` sin `autoCreate` retorna `undefined` (no auto-crea) — el test asumía auto-create por defecto.
- `getLayerForKind` retorna el primer match del kind aunque esté locked; no se busca la primera capa no-locked. La consolidación no cambió esa semántica (cambiar a "primera no-locked" queda como mejora futura, fuera del alcance de la fase).

### Limpiezas menores

- `resolveLoteLayerId` y `resolveOrCreateLayerForKind`: eliminado el `?? autoCreateLayerForKind(...)` redundante (`pickLayerId` con `autoCreate: true` siempre retorna string).
- `geometryTelemetry.ts`: los dos `catch {}` vacíos que rompían `npm run lint` (preexistentes de la Fase 2) ahora llevan comentario.

## Verificación

| Check | Resultado |
| ----- | --------- |
| `npm run lint` | ✅ 0 errors / 3 warnings (los warnings son preexistentes: `LayerPanel`, `StatsPanel`, `Map.tsx`) |
| `npm test` (Vitest) | ✅ 76/76 passed (8 files, 8.06s) — incluye los 26 tests nuevos de `layerResolution.test.ts` |
| `npm run build` (producción) | ✅ OK en 17.38s (bundle 1,153.01 kB / gzip 341.67 kB — sin delta material vs. post-Fase 2) |

## Comportamiento esperado

| Caso | Antes (con bug en `resolveLoteLayerId`) | Después (unificado) |
| ---- | --- | --- |
| Active = calle, se dibuja un lote | `resolveLoteLayerId` asignaba el lote a la capa calle (BUG) | cae a `getLayerForKind('lote')` o auto-crea |
| Active = calle, AddFeatureCommand con kind=lote | `resolveLayerId` asignaba a calle (BUG histórico en comandos) | cae a la capa de lote o `undefined` |
| Override locked | se salta → siguiente nivel | igual (nivel 1 valida `!locked`) |

## Riesgo y reversibilidad

- **Riesgo en runtime:** medio → gestionado con tests de caracterización ANTES de tocar (26 tests que fijan el contrato), y un solo cambio de semántica intencional: el check de `kind` en `resolveLoteLayerId`/`resolveLayerId` (bugfix documentado).
- **Reversibilidad:** 6 archivos de producto + 1 de test + 2 nuevos. `git revert` simple; los 26 tests de caracterización fijan el comportamiento nuevo.
- **Qué NO valida esta fase:** la interacción real con GEOS/Tauri IPC y el flujo completo de recompute de manzanos con red vial (el cambio en `recomputeManzanos.ts` es solo la capa de resolución, el flujo de reconciliación es la Fase 4).

## Lo que la Fase 3 **no** toca (queda para fases siguientes)

- Los lookups directos de `getLayerForKind` en painters/selectors (`StreetPainter`, `RoundaboutPainter`, `layerStats`) — son lecturas, no resolución con fallback; fuera de alcance.
- El refactor de `recomputeManzanos.ts` (Fase 4) — incluye eliminar del todo `resolveLoteLayerId` en favor del call-site directo si se prefiere.
- Tests de `CommandStack`/`layersRegistryStore`/`advancedSnap` (Fase 9).
