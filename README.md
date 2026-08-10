# GeoUrban

Herramienta CAD-like para urbanismo en el navegador. Dibuja polígonos, subdivide lotes en manzanos, traza calles con rotondas, etiqueta entidades y exporta el proyecto. 100% client-side (sin backend), publicado como PWA instalable y como app de escritorio nativa vía Tauri.

**Stack:** React 19 + TypeScript + OpenLayers 10 (WebGL) + Zustand + Vite + Tauri v2 + Rust (GEOS) + IndexedDB.

## Quick start

```bash
npm install
npm run dev          # PWA en http://localhost:5173
npm run tauri:dev    # app de escritorio nativa
npm run build        # build de producción (Vite)
```

## Arquitectura

GeoUrban está dividido en **14 engines** verticales (ver `CONTRIBUTING.md`):

- **kernel/** — primitivas compartidas (comandos/undo-redo, geometría, id, registry, bridge nativo).
- **shared-ui/** — kit de UI genérico (modales, toasts).
- **9 engines de dominio** — `georef`, `layers`, `selection`, `snap`, `drawing`, `vias`, `lotificacion`, `manzanos`, `label`.
- **map-core/** — composition root del mapa (ensambla modos/painters de todos los engines).
- **persistence-engine/** — serialización del proyecto (`.geourban`).
- **app-shell/** — composition root de la app (TopBar, ribbon, sidebar, atajos).

Cada engine vive en `src/<engine>/`, expone su API vía `index.ts`, y tiene su propio `README.md` con la responsabilidad y excepciones documentadas.

## Documentación

- `CONTRIBUTING.md` — guía de contribución, gates de CI, reglas arquitectónicas.
- `src/<engine>/README.md` — qué hace cada engine, qué NO hace, y sus excepciones documentadas (14 archivos, uno por engine).

## Scripts

```bash
npm run dev            # dev server (Vite + HMR)
npm run build          # build de producción
npm run preview        # preview del build
npm run tauri          # CLI de Tauri
npm run tauri:dev      # app de escritorio en dev (Rust + WebView)
npm run tauri:build    # instaladores (.msi/.dmg/.AppImage)
npm run lint           # ESLint
npm run lint:fix       # ESLint con autofix
npm run format         # Prettier
```

## Licencia

MIT.