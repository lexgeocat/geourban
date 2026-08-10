import { useEffect } from 'react';
import { useDrawStore, type DrawMode } from '@map-core/store/drawStore';
import { undo, redo, useCommandStack } from '@kernel/command/CommandStack';
import { useMapStore } from '@map-core/store/mapStore';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { useSnapSettingsStore } from '@snap-engine/store/snapSettingsStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { recomputeManzanos } from '@manzanos-engine/orchestration/recomputeManzanos';
import { DeleteFeaturesCommand } from '@drawing-engine/commands/DeleteFeaturesCommand';
import { runCommand } from '@kernel/command/CommandStack';
import { toast } from '@shared-ui/store/toastStore';
import { useProjectFileStore } from '@persistence-engine/store/projectFileStore';
import { useManzanoStore } from '@lotificacion-engine/store/manzanoLotConfigStore';
import { useLabelConfigModalStore } from '@label-engine/store/labelConfigModalStore';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/** Constante de módulo: antes se recreaba este objeto en cada keydown. */
const DRAW_MODE_SHORTCUTS: Record<string, DrawMode> = {
  v: 'select',
  p: 'polygon',
  l: 'line',
  r: 'rectangle',
  s: 'street',
  o: 'roundabout',
  e: 'erase',
};

function handleDeleteSelection(): void {
  const ids = Array.from(useSelectionStore.getState().selectedIds);
  if (ids.length === 0) return;

  const src = useMapStore.getState().drawSource;
  const regularIds: Array<string | number> = [];
  const streetIds: string[] = [];
  const roundaboutIds: string[] = [];

  for (const id of ids) {
    if (src && src.getFeatureById(id) != null) {
      regularIds.push(id);
      continue;
    }
    if (useStreetStore.getState().streets.some((s) => s.id === id)) {
      streetIds.push(String(id));
    } else if (useRoundaboutStore.getState().roundabouts.some((r) => r.id === id)) {
      roundaboutIds.push(String(id));
    }
  }

  if (regularIds.length > 0) {
    const cmd = new DeleteFeaturesCommand(regularIds);
    void runCommand(cmd);
    if (cmd.skippedCount > 0) {
      toast(`${cmd.skippedCount} elemento(s) no se borraron por estar en una capa bloqueada.`, {
        variant: 'warning',
        durationMs: 5000,
      });
    }
  }
  if (streetIds.length > 0 || roundaboutIds.length > 0) {
    streetIds.forEach((sid) => {
      useStreetStore.getState().removeStreet(sid);
      useEntityLabelStore.getState().remove(sid);
    });
    roundaboutIds.forEach((rid) => {
      useRoundaboutStore.getState().removeRoundabout(rid);
      useEntityLabelStore.getState().remove(rid);
    });
    useSelectionStore.getState().clear();
    void recomputeManzanos();
  }
}

function handleSelectAll(): void {
  const src = useMapStore.getState().drawSource;
  if (!src) return;
  const ids: Array<string | number> = [];
  const getLayer = useLayersStore.getState().getById;
  src.forEachFeature((f) => {
    const id = f.getId();
    if (id === undefined) return;
    const layerId = f.get('layerId') as string | undefined;
    if (layerId) {
      const layer = getLayer(layerId);
      if (layer?.locked) return;
      if (layer && !layer.visible) return;
    }
    ids.push(id as string | number);
  });
  useSelectionStore.getState().setSelection(ids, ids[0] ?? null);
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.altKey) return;

      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      const key = e.key;

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
      if (ctrlOrCmd && (key === 'a' || key === 'A')) {
        e.preventDefault();
        handleSelectAll();
        return;
      }
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        handleDeleteSelection();
        return;
      }
      if (key === 'Escape') {
        e.preventDefault();
        if (useManzanoStore.getState().rotatingId != null) {
          useManzanoStore.getState().cancelRotateLots();
        }
        if (useDrawStore.getState().mode === 'labelOrder') {
          useLabelConfigModalStore.getState().clearOrderTrace();
        }
        useDrawStore.getState().setMode('select');
        useSelectionStore.getState().setSelectMode('click');
        return;
      }
      if (key === 'F3') {
        e.preventDefault();
        useSnapSettingsStore.getState().toggleEnabled();
        return;
      }
      if (ctrlOrCmd && (key === 's' || key === 'S')) {
        e.preventDefault();
        useProjectFileStore.getState().setSaveModalOpen(true);
        return;
      }
      if (ctrlOrCmd && (key === 'o' || key === 'O')) {
        e.preventDefault();
        useProjectFileStore.getState().setOpenModalOpen(true);
        return;
      }
      if (ctrlOrCmd) return;

      const next = DRAW_MODE_SHORTCUTS[key.toLowerCase()];
      if (next) {
        e.preventDefault();
        useDrawStore.getState().setMode(next);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
