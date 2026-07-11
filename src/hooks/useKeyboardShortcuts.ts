import { useEffect } from 'react';
import { useDrawStore } from '../store/drawStore';
import { useHistoryStore } from '../store/historyStore';
import { useMapStore } from '../store/mapStore';
import { useSelectionStore } from '../store/selectionStore';

/* ================================================================
   useKeyboardShortcuts
   ================================================================
   Atajos al estilo CAD (single-key + modificadores):
     V -> select
     H -> pan
     P -> polygon
     L -> line
     E -> erase
     Esc -> none (sale de cualquier modo)
     Delete / Backspace -> borrar seleccionados
     Ctrl/Cmd + Z -> undo
     Ctrl/Cmd + Y / Ctrl + Shift + Z -> redo
     Ctrl/Cmd + A -> seleccionar todo (drawSource)

   Los atajos NO se disparan si el foco esta en un input/textarea
   o en un contentEditable (para no romper formularios o busquedas).
   ================================================================ */

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

      // Undo / Redo
      if (ctrlOrCmd && (key === 'z' || key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          const s = useHistoryStore.getState().redo();
          if (s) useMapStore.getState().restoreDrawFeatures(s);
        } else {
          const s = useHistoryStore.getState().undo();
          if (s) useMapStore.getState().restoreDrawFeatures(s);
        }
        return;
      }
      if (ctrlOrCmd && (key === 'y' || key === 'Y')) {
        e.preventDefault();
        const s = useHistoryStore.getState().redo();
        if (s) useMapStore.getState().restoreDrawFeatures(s);
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

      // Delete / Backspace: borrar seleccion
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        useMapStore.getState().deleteSelected();
        return;
      }

      // Escape: salir a modo 'none'
      if (key === 'Escape') {
        e.preventDefault();
        useDrawStore.getState().setMode('none');
        return;
      }

      // Single-key shortcuts (sin modifier)
      if (ctrlOrCmd) return;
      const lower = key.toLowerCase();
      const map: Record<string, 'select' | 'pan' | 'polygon' | 'line' | 'erase' | 'none'> = {
        v: 'select',
        h: 'pan',
        p: 'polygon',
        l: 'line',
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
