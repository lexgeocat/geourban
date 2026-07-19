import { useEffect } from 'react';
import { useDrawStore, type DrawMode } from '../store/drawStore';
import { undo, redo, useCommandStack } from '../commands/CommandStack';
import { useMapStore } from '../store/mapStore';
import { useSelectionStore } from '../store/selectionStore';
import { useSnapSettingsStore } from '../store/snapSettingsStore';
import { DeleteFeaturesCommand } from '../commands/DeleteFeaturesCommand';
import { runCommand } from '../commands/CommandStack';
import { copySelected } from '../commands/editOperations';

// No se disparan si el foco esta en un input/textarea/contentEditable

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.altKey) return;

      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      const key = e.key;

      // Undo / Redo (delegan al CommandStack)
      if (ctrlOrCmd && (key === 'z' || key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        useCommandStack.getState().refresh();
        return;
      }
      if (ctrlOrCmd && (key === 'y' || key === 'Y')) {
        e.preventDefault();
        redo();
        useCommandStack.getState().refresh();
        return;
      }

      // Ctrl/Cmd + A: seleccionar todo
      if (ctrlOrCmd && (key === 'a' || key === 'A')) {
        const src = useMapStore.getState().drawSource;
        if (!src) return;
        e.preventDefault();
        const ids: Array<string | number> = [];
        src.forEachFeature((f) => {
          const id = f.getId();
          if (id !== undefined) ids.push(id as string | number);
        });
        useSelectionStore.getState().setSelection(ids, ids[0] ?? null);
        return;
      }

      // Ctrl/Cmd + D: copiar selección
      if (ctrlOrCmd && (key === 'd' || key === 'D')) {
        e.preventDefault();
        void copySelected();
        return;
      }

      // Delete / Backspace: borrar seleccion (via comando)
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        const ids = Array.from(useSelectionStore.getState().selectedIds);
        if (ids.length > 0) {
          void runCommand(new DeleteFeaturesCommand(ids));
        }
        return;
      }

      // Escape: sale de cualquier modo y vuelve a 'select'
      if (key === 'Escape') {
        e.preventDefault();
        useDrawStore.getState().setMode('select');
        return;
      }
      // F3: alterna el motor de snap completo (OSNAP maestro, como AutoCAD)
      if (key === 'F3') {
        e.preventDefault();
        useSnapSettingsStore.getState().toggleEnabled();
        return;
      }

      // Single-key shortcuts (sin modifier)
      if (ctrlOrCmd) return;
      const lower = key.toLowerCase();
const map: Record<string, DrawMode> = {
  v: 'select',
  p: 'polygon',
  l: 'line',
  r: 'rectangle',
  c: 'circle',
  a: 'arc',
  x: 'text',
  s: 'street',
  o: 'roundabout',
  h: 'rotate',
  k: 'scale',
  m: 'mirror',
  e: 'erase',
};
      const next = map[lower];
      if (next) {
        e.preventDefault();
        useDrawStore.getState().setMode(next);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
