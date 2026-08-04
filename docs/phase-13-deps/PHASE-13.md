# Fase 13 — Housekeeping final de dependencias

**Estado: COMPLETADA.** Deps muertas eliminadas, lockfile regenerado, copy de UI que prometía DXF ajustada.

## Cambios aplicados

### 1. Greps de confirmación (ejecutados ANTES de borrar)

| Dep | Hits en `src/` y `src-tauri/` | Veredicto |
| --- | --- | --- |
| `dxf-parser` | 1 (en `src/types/vendor.d.ts`, declaración de tipos) | MUERTA |
| `dxf-writer` | 1 (en `src/types/vendor.d.ts`) | MUERTA |
| `shpjs` | 1 (en `src/types/vendor.d.ts`) | MUERTA |
| `shp-write` | 0 | MUERTA |
| `jszip` | 0 | MUERTA |
| `clsx` | 0 | MUERTA — encontrada por grep en esta fase, no estaba en el CHECKLIST 1.2 |
| `@tauri-apps/api` | 3 (`projectFile.ts`, `nativeMemoryTelemetry.ts`, `geoWorkerClient.ts`) | VIVA |
| `@tauri-apps/cli` | 1 (`tauri.conf.json` schema) | VIVA |
| `@types/rbush` | indirecta — `rbush` no incluye sus propios `.d.ts` | VIVA |
| `@types/geojson` | varios (tipos compartidos) | VIVA |
| `@types/react`, `@types/react-dom`, `@types/node` | devDependencies de tooling | VIVA |
| `immer`, `lucide-react`, `ol`, `proj4`, `rbush`, `react`, `react-dom`, `zustand`, `@radix-ui/react-dialog` | múltiples consumidores | VIVAS |

Total eliminado: **6 paquetes** (`dxf-parser`, `dxf-writer`, `shpjs`, `shp-write`, `jszip`, `clsx`) → `npm install` reportó "removed 24 packages" (cada uno arrastra sub-deps transitivas, total 24 archivos quitados de `node_modules`).

### 2. `package.json`

```diff
   "dependencies": {
     "@radix-ui/react-dialog": "^1.1.19",
     "@types/geojson": "^7946.0.16",
     "@types/rbush": "^4.0.0",
-    "clsx": "^2.1.1",
-    "dxf-parser": "^1.1.2",
-    "dxf-writer": "^1.18.4",
     "immer": "^10.1.1",
-    "jszip": "^3.10.1",
     "lucide-react": "^1.23.0",
     "ol": "^10.0.0",
     "proj4": "^2.15.0",
     "rbush": "^4.0.1",
     "react": "^19.0.0",
     "react-dom": "^19.0.0",
-    "shp-write": "^0.3.2",
-    "shpjs": "^6.2.0",
     "zustand": "^4.5.0"
   }
```

### 3. `src/types/vendor.d.ts` borrado

El archivo era el único consumidor de los tipos de las 3 librerías con `.d.ts` (`shpjs`, `dxf-parser`, `dxf-writer`). Como borramos las libs y `shp-write`/`jszip` ni siquiera tenían declaraciones, el archivo entero se va.

Tras borrarlo, el directorio `src/types/` queda vacío — lo borro también.

### 4. Copy de UI que prometía "DXF import/export"

`docs/phase-1-audit/CHECKLIST.md` advertía del problema: hay 3 lugares en la UI donde se promete DXF sin que la feature exista en código.

**Decisión tomada:** opción (A) del checklist — borrar la copy engañosa. Pero **reescribiéndola** en términos genéricos (no eliminando la información que sí es real: que el CRS se usa para exportación/importación de archivos del proyecto). Así:

- **`ProjectSetupModal.tsx:54-58`** — reemplacé "exportar/importar DXF necesita un plano métrico real" por "exportación e importación queden desincronizadas en un CRS real". (El párrafo ahora describe correctamente la relación WGS84 ↔ plano métrico sin prometer DXF.)
- **`ProjectSetupModal.tsx:69-71`** — "Requerido para DXF georreferenciado (AutoCAD Civil3D / QGIS)" → "Necesario para llevar el proyecto a un CRS georreferenciado (AutoCAD Civil3D / QGIS / etc.)". (Sigue mencionando los productos downstream, pero el "requerido para DXF" se convierte en una condición más general.)
- **`ProjectSetupModal.tsx:98-100`** — "El DXF exportado no tiene anclaje real" → "No tiene anclaje a un CRS real; se reposiciona a mano". (Misma idea sin mencionar DXF.)
- **`StatusBar.tsx:324`** — "Exportación DXF usa:" → "El CRS se aplica a la exportación/importación de archivos. Sistema actual:". (Texto genérico que describe el comportamiento real.)

Si en el futuro se implementa DXF, se restaura la mención. Si no, queda como copy honesta.

## Verificación

| Check | Resultado |
| --- | --- |
| `git grep` deps eliminadas | 0 hits en `src/` y `src-tauri/` (excluyendo `vendor.d.ts` borrado y lockfile) |
| `npx tsc --noEmit -p tsconfig.json` | ✅ sin output |
| `npm run lint` | ✅ 0 errors / 3 warnings preexistentes |
| `npm test` (Vitest) | ✅ 146/146 passed (12 files, 7.34s) |
| `npm run build` (Vite) | ✅ 19.35s, bundle 1,127.2 kB |
| `npm install` post-cambio | ✅ "removed 24 packages, and audited 314 packages" |

### Tamaños antes/después

| Métrica | Antes | Después | Δ |
| --- | --- | --- | --- |
| Paquetes en `package.json` (dependencies) | 17 | 11 | −6 |
| Total paquetes instalados (`node_modules/`) | 339 | 314 | −24 |
| `package-lock.json` | (pre-fase: no medido exacto) | 123.3 kB | — |
| Bundle JS de producción | 1,127.0 kB | 1,127.2 kB | +0.2 kB (marginal) |

El bundle JS no baja porque las deps eliminadas no se empaquetaban en runtime (eran dev-only o no tenían consumidores). El valor real es: deps más limpias en `package.json`, lockfile más corto, `node_modules` con 24 archivos menos.

## Riesgo y reversibilidad

- **Riesgo en runtime:** nulo. Las deps eliminadas no tenían importadores en el código de producto. La copy de UI que prometía DXF se ajustó a texto genérico (no se eliminó información, se corrigió el error factual).
- **Reversibilidad:** trivial. `git revert` revierte los 3 archivos (`package.json`, `StatusBar.tsx`, `ProjectSetupModal.tsx`) + recrea `src/types/vendor.d.ts` + `npm install` para regenerar las deps.
- **Qué NO valida esta fase:** que el flujo de Tauri (`npm run tauri:build` → binario en 3 plataformas) siga funcionando — eso requiere entorno Tauri real, fuera de alcance.

## Lo que la Fase 13 **no** toca

- **Versiones de deps desactualizadas** (punto 3 del plan) — el plan explícitamente dice "no se debe hacer a ciegas dentro de este plan de limpieza". Queda como tarea separada con revisión de changelogs.
- **`shpjs`/`dxf-parser`/`dxf-writer` como `@types/...`** — no se usaban en código (las deps tampoco); `@types/geojson` sigue porque sí tiene consumidores.
- **Implementación de la feature DXF** — opción (B) del CHECKLIST 1.2, descartada. Queda como feature request para roadmap futuro.

## Hallazgo adicional (no estaba en el plan)

`clsx` no estaba en la lista del CHECKLIST 1.2 — la auditoría de Fase 1.2 no lo cubrió. El grep de esta fase lo descubrió: 0 consumidores en `src/`. Se eliminó junto con el resto. Si el equipo lo quiere reintroducir para evitar concatenación manual de className strings, es trivial añadirlo de vuelta (es 1 línea en `package.json`).