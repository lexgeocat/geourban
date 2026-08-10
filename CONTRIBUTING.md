# CONTRIBUTING — GeoUrban

> **GeoUrban** — editor CAD/GIS de escritorio para planificación urbana. React + TypeScript + OpenLayers + Tauri v2 + Rust (GEOS).
>
> **App de escritorio únicamente.** Toda la geometría corre en el crate Rust (`src-tauri/crates/geourban-geo/`); el frontend la invoca vía `invoke()`. Levantar Vite solo (`npm run dev`) hace que las operaciones geométricas exploten porque `requireNativeRuntime()` (`src/kernel/native/geoWorkerClient.ts`) detecta la ausencia de `window.__TAURI_INTERNALS__` y lanza error. El flujo soportado es siempre `npm run tauri:dev`.

## Setup

```bash
npm install
npm run tauri:dev    # app de escritorio (Windows/macOS/Linux) — flujo único soportado
```

`tauri:dev` levanta Vite para el frontend (`localhost:5173`) y compila/abre la app nativa que lo embebe vía WebView.

## Arquitectura: engines verticales

`src/` está dividido en **14 engines**. Cada uno tiene su propia carpeta, su `index.ts` (API pública) y un `README.md`. Los engines se dividen en 3 capas:

```
src/
├─ kernel/                    ← primitivas compartidas (commands, geometry, id, modes, registry, native)
├─ shared-ui/                 ← kit de UI genérico (modales, toasts, hooks)
│
├─ <engine de dominio>/       ← un engine por dominio de GeoUrban
│   ├─ georef-engine/         CRS, métricas (m², m)
│   ├─ layers-engine/         capas de trabajo
│   ├─ selection-engine/      selección + hit-test (genérico)
│   ├─ snap-engine/           snapping avanzado (genérico)
│   ├─ drawing-engine/        dibujo + erase (genérico)
│   ├─ vias-engine/           calles + rotondas
│   ├─ lotificacion-engine/   subdivisión de manzanos
│   ├─ manzanos-engine/       identidad y reconciliación de manzanos
│   └─ label-engine/          etiquetado y numeración
│
├─ map-core/                  ← composition root del mapa (ensambla modos/painters)
├─ persistence-engine/        ← serialización del proyecto
└─ app-shell/                 ← composition root de la app (TopBar, ribbon, sidebar)
```

## Reglas operativas (no negociables)

1. **Toda dependencia cruzada entre engines pasa por el alias `@<engine>`**, que apunta al `index.ts`. Nunca `@vias-engine/store/streetStore` desde fuera de `vias-engine` — usar `@vias-engine` (el barrel).

2. **`extensionPoints` en `@kernel`** para desacoplar dominios genéricos (snap-engine, selection-engine, drawing-engine) de dominios específicos (vias-engine, manzanos-engine). El consumer pide al handle, el dominio específico se registra al cargar. Ejemplo: `vias-engine/index.ts` registra `extraSnapSources.register('vias:roadSnapSource', ...)`.

3. **Imports relativos solo dentro de un mismo engine** (`./store/X`). Entre engines, siempre alias.

4. **TypeScript estricto** — sin `any`, sin `// @ts-ignore`. Si necesitás flexibilidad, declarala explícitamente con tipos.

## Gates (bloqueantes en CI)

| Gate | Comando | Qué valida |
|---|---|---|
| Type-check | `npx tsc --noEmit` | TypeScript estricto (0 errores) |
| Lint | `npm run lint` | ESLint (0 problemas, 0 warnings) |
| Build | `npm run build` | Vite build de producción |
| Rust | `cd src-tauri && cargo check && cargo build` | Crate `geourban-geo` (`kernel/` + `domains/`) |

## Añadir un nuevo engine

1. Crear `src/<nombre>-engine/` con `index.ts` (API pública) y `README.md` (responsabilidad + qué NO hace + excepciones).
2. Registrar el engine en `tsconfig.json` (`paths`) y `vite.config.ts` (`resolve.alias`).
3. Implementar la lógica, mantener imports relativos dentro del engine.
4. Re-exportar la API pública desde `index.ts`.

## Convenciones de código

- ESLint config en `eslint.config.js`.
- Prettier config en `.prettierrc` (formateo automático).
- Commits: `feat(<engine>): ...`, `fix(<engine>): ...`, `refactor: ...`, `docs: ...`.

## Más información

- `README.md` — quick start y arquitectura de alto nivel.
- `src/<engine>/README.md` — qué hace cada engine, qué NO hace, y sus excepciones documentadas (14 archivos).