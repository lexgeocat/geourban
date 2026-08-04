# Fase 10 — Estructura de carpetas

**Estado: COMPLETADA (alcance acotado).** El plan proponía dos puntos: (10.1) señalizar `geo/debug/` como dev-only y (10.2) decidir sobre `src/types/vendor.d.ts`. El punto 10.1 se ejecutó con un README explícito. El punto 10.2 queda para Fase 13 (housekeeping de deps) que ya tiene toda la información necesaria.

> El plan advertía: "La estructura actual está bien pensada y **no requiere reestructuración**". Esta fase no mueve archivos — solo anota el contrato de la carpeta `geo/debug/` para que sea imposible confundirla con lógica de producto.

## Cambios aplicados

### 10.1 — `src/geo/debug/README.md`

README explícito dentro de la carpeta que documenta:

- Que **todo** el contenido es dev-only.
- Que los únicos consumidores en código de producto son `src/components/debug/DebugPanel.tsx` y `src/components/debug/Fase6AutoValidator.tsx`, ambos gateados con `React.lazy()` + `import.meta.env.DEV` desde Fase 2 (el bundle de release no incluye este grafo).
- Qué hace cada uno de los 10 archivos del directorio.
- Por qué no se renombró la carpeta a `__dev-tools__/` o similar (sería un `git mv` de muchos imports relativos y rompería el grep de Fase 2; el README cumple la misma función).
- Por qué los tests del directorio **sí corren en CI** — son cobertura de las herramientas, no de producto; el "dev-only" aplica al runtime, no al tiempo de build de tests.

### 10.2 — `src/types/vendor.d.ts`

**No se toca en esta fase.** Queda para Fase 13 que ya tiene toda la información:

- La auditoría de Fase 1.2 confirmó que `shpjs`, `dxf-parser`, `dxf-writer`, `jszip` no se importan en ningún archivo de producto — el único hit es `src/types/vendor.d.ts`.
- Fase 13 eliminará las dependencias de `package.json` + `vendor.d.ts` + copiar el lockfile.
- **Decisión de producto pendiente** (registrada en `docs/phase-1-audit/CHECKLIST.md`): tres opciones para la copy de UI que promete "exportar/importar DXF" sin que exista la feature:
  - (A) borrar la copy junto con las deps,
  - (B) implementar la feature,
  - (C) cambiar a "próximamente" / quitar la mención.
- Fase 10 no requiere esa decisión — solo la deja intacta hasta que Fase 13 la enfrente.

## Verificación

| Check | Resultado |
| --- | --- |
| `git grep "from.*geo/debug" src/` | 8 hits, todos en `DebugPanel.tsx` (6) y `Fase6AutoValidator.tsx` (2) — los únicos consumidores esperados |
| `npm test` | ✅ 146/146 passed (12 files, 9.52s) |
| `npm run lint` | ✅ 0 errors / 3 warnings preexistentes |

## Lo que la Fase 10 **no** toca (decisiones de diseño explícitas)

- **Renombrar `geo/debug/` a `__dev-tools__/`** — descartado por el costo del `git mv` y por romper el grep de Fase 2. El README cumple la función.
- **Renombrar `src/types/vendor.d.ts`** — el archivo es legítimo mientras las dependencias estén en `package.json`; cuando Fase 13 las elimine, el archivo se borra junto con ellas.
- **Reestructurar otras carpetas** (`store/`, `commands/`, `geo/`, `map/scene/`) — el plan las declara explícitamente "bien pensadas, no requiere reestructuración".

## Riesgo y reversibilidad

- **Riesgo:** nulo. README es documentación, no código.
- **Reversibilidad:** trivial. `git rm src/geo/debug/README.md` y la carpeta vuelve al estado previo.
- **Qué NO valida esta fase:** que el bundle de release realmente NO incluya `geo/debug/*`. Esa validación es estructural (Vite tree-shake) y la hizo la Fase 2 al montar los `React.lazy()`. Si en el futuro alguien agrega un import directo a `geo/debug/*` desde código de producto, el README no lo va a detectar — el grep manual o el bundle analyzer sí.