# persistence-engine

## Responsabilidad

Guardar y abrir proyectos GeoUrban (WKB, SQLite vía Tauri), modal de Save/Open, store del proyecto actual. Serializa el estado de **TODOS** los engines → por eso es uno de los tres engines con `allow: ['*']` (junto con `map-core` y `app-shell`).

## API pública (`index.ts`)

- `useProjectFileStore` — estado del proyecto abierto (path, dirty flag, autosave).
- `projectFile.ts` — serializa/deserializa el estado global a un `.geourban` (JSON).
- `wkb.ts` — helpers WKB para geometrías.
- UI: `SaveProjectModal`, `OpenProjectModal`, `ProjectMenu`.
- Bridge nativo: `saveProject`, `loadProject` (vía Tauri).

## Dependencias permitidas

- `*` (todos los engines — necesita acceso a sus stores para serializar).

## Excepciones documentadas

- Lee el estado de `useMapStore` directamente (en `projectFile.ts`) para serializar extent y zoom del mapa.
- Restaura el estado llamando los setters de cada store (orden determinístico por la fase de carga).