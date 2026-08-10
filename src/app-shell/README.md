# app-shell

## Responsabilidad

**Composition root de la app**: ensambla el layout completo (TopBar, StatusBar, LeftSidebar, ribbon de 3 tabs), los hooks de shell (`useTopBarActions`, `useKeyboardShortcuts`), los stores de shell (`uiShellStore`, `leftSidebarStore`), y los paneles UI (`StatsPanel`).

Único composition root de la app — junto con `map-core` (composition root del mapa) y `persistence-engine` (serialización global). Importa de **todos** los engines para ensamblar la UI final.

## API pública (`index.ts`)

- `App` (componente default export de `App.tsx`) — punto de entrada de la app.
- Layout: `TopBar`, `StatusBar`, `LeftSidebar`, `StatsPanel`.
- Tabs del ribbon: `EditTab`, `UrbanDesignTab`, `ViewTab`.
- Stores de shell: `useUiShellStore`, `useLeftSidebarStore`.
- Hooks: `useTopBarActions`, `useKeyboardShortcuts`.

## Dependencias permitidas

- `*` (todos los engines). Composition root final.

## Excepciones documentadas

- `main.tsx` es el único entry-point fuera de los engines (junto con `index.css`). Importa `@app-shell/App`. No matchea ningún element-type.