# shared-ui

## Responsabilidad

Kit de UI genérico sin conocimiento de dominio: modales, toasts, dialogs, hooks utilitarios (draggable panels, incremental render, viewport width, drawSource tick). Todos los engines de dominio importan desde acá para mantener consistencia visual.

Único engine (junto con `kernel`) que **no** depende de otros engines.

## API pública (`index.ts`)

- `Modal`, `ModalProps` — modal base.
- `ToastStack` — sistema de notificaciones.
- `ConfirmDialog`, `useConfirmDialogStore`.
- Hooks: `useDraggablePanel`, `useIncrementalRender`, `useViewportWidth`, `useDrawSourceTick`.

## Dependencias permitidas

- **Solo `kernel`**. Esta restricción se valida en `npm run lint` (eslint-plugin-boundaries).

## Excepciones documentadas

- Sin excepciones. Es UI pura.