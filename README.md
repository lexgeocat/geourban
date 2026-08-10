# GeoUrban

Editor CAD/GIS de escritorio para planificación urbana. Dibuja polígonos, subdivide lotes en manzanos, traza calles con rotondas, etiqueta entidades y exporta el proyecto. App nativa de escritorio (Tauri v2 + WebView); 100% client-side, sin backend.

> **GeoUrban requiere Tauri.** Las operaciones geométricas (subdivisión de manzanos, red vial con GEOS, índice espacial RTree, persistencia SQLite) viven en un crate Rust expuesto vía `invoke()` desde el frontend. `npm run dev` puro no funciona — la geometría explota porque `requireNativeRuntime()` detecta la ausencia de `window.__TAURI_INTERNALS__` y lanza error.

**Stack:** React 19 + TypeScript + OpenLayers 10 (WebGL) + Zustand + Vite + Tauri v2 + Rust (GEOS, rstar, rusqlite).

## Quick start

```bash
npm install
npm run tauri:dev    # app de escritorio nativa (Windows/macOS/Linux)
```

`tauri:dev` levanta Vite para el frontend (`localhost:5173`) y compila/abre la app nativa que lo embebe via WebView. El comando único es el flujo soportado; `npm run dev` solo queda como servidor de assets para herramientas externas.

## Build de producción

```bash
npm run tauri:build  # genera .msi (Windows) / .dmg (macOS) / .AppImage + .deb (Linux) en src-tauri/target/release/bundle/
```

Los instaladores se suben automáticamente como assets del GitHub Release al pushear un tag `v*` (ver `.github/workflows/release-tauri.yml`).

## Arquitectura

GeoUrban está dividido en **14 engines** verticales (ver `CONTRIBUTING.md`):

- **kernel/** — primitivas compartidas (comandos/undo-redo, geometría, id, registry, bridge nativo a Tauri).
- **shared-ui/** — kit de UI genérico (modales, toasts).
- **9 engines de dominio** — `georef`, `layers`, `selection`, `snap`, `drawing`, `vias`, `lotificacion`, `manzanos`, `label`.
- **map-core/** — composition root del mapa (ensambla modos/painters de todos los engines).
- **persistence-engine/** — serialización del proyecto (`.geourban`) vía SQLite local (`rusqlite`, `src-tauri/src/project_store.rs`).
- **app-shell/** — composition root de la app (TopBar, ribbon, sidebar, atajos).

Cada engine vive en `src/<engine>/`, expone su API vía `index.ts`, y tiene su propio `README.md` con la responsabilidad y excepciones documentadas.

## Documentación

- `CONTRIBUTING.md` — guía de contribución, gates de CI, reglas arquitectónicas.
- `src/<engine>/README.md` — qué hace cada engine, qué NO hace, y sus excepciones documentadas (14 archivos, uno por engine).

## Scripts

```bash
npm run dev            # solo servidor Vite (sin Tauri; la geometría no funciona — usar tauri:dev)
npm run build          # build de producción del frontend (Vite)
npm run preview        # preview del build estático (sin Tauri)
npm run tauri          # CLI de Tauri
npm run tauri:dev      # app de escritorio en dev (Rust + WebView) — flujo soportado
npm run tauri:build    # instaladores nativos (.msi/.dmg/.AppImage/.deb)
npm run lint           # ESLint
npm run lint:fix       # ESLint con autofix
npm run format         # Prettier
```

## Licencia

MIT.