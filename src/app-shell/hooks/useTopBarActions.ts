import { useMapStore } from '@map-core/store/mapStore';
import { resetIncrementalRoadTracking } from '@manzanos-engine/orchestration/recomputeManzanos';
import { useCommandStack } from '@kernel/command/CommandStack';
import { ClearFeaturesCommand } from '@drawing-engine/commands/ClearFeaturesCommand';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { useManzanoStore } from '@lotificacion-engine/store/manzanoLotConfigStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useDrawStore } from '@map-core/store/drawStore';
import { refreshSourceMetrics } from '@georef-engine/metrics';
import { confirmAsync } from '@shared-ui/store/confirmDialogStore';
import { toast } from '@shared-ui/store/toastStore';
import { useProjectFileStore } from '@persistence-engine/store/projectFileStore';
import { resetManzanoSeq } from '@manzanos-engine/naming/manzanoNaming';
import { useEditSessionStore } from '@layers-engine/store/editSessionStore';
import { resetLayerFidRegistry } from '@kernel/id/layerFidRegistry';

export function useTopBarActions() {
  const handleNewProject = async () => {
    const drawSource = useMapStore.getState().drawSource;
    const ok = await confirmAsync(
      '¿Crear un nuevo proyecto? Se borrarán todos los features del mapa actual.',
      { title: 'Nuevo proyecto', confirmLabel: 'Crear', cancelLabel: 'Cancelar', danger: true }
    );
    if (!ok || !drawSource) return;
    await useCommandStack.getState().run(new ClearFeaturesCommand());
    useStreetStore.getState().clearStreets();
    useRoundaboutStore.getState().clearRoundabouts();
    useEntityLabelStore.getState().clear();
    resetIncrementalRoadTracking();
    useLayersStore.getState().resetToEmpty();
    useManzanoStore.getState().resetAll();
    useEditSessionStore.getState().stopAll();
    resetManzanoSeq();
    resetLayerFidRegistry();
    useDrawStore.getState().setMode('select');
    useDrawStore.getState().setLastDrawnLineId(null);
    refreshSourceMetrics(drawSource);
    drawSource.changed();
    useSelectionStore.getState().clear();
    toast('Proyecto nuevo creado.', { variant: 'success' });
  };

  const handleExit = async () => {
    const isNative = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (isNative) {
      try {
        const { exit } = await import('@tauri-apps/plugin-process');
        await exit(0);
        return;
      } catch (err) {
        console.error('handleExit: no se pudo cerrar la app nativa', err);
        toast('No se pudo cerrar la app. Cerrá la ventana manualmente.', {
          variant: 'warning',
          durationMs: 6000,
        });
        return;
      }
    }
    toast('GeoUrban no está corriendo en una app nativa — cerrá la ventana manualmente.', {
      variant: 'info',
      durationMs: 6000,
    });
  };

  const handleAbout = () => {
    toast(
      'GeoUrban v0.1 · Editor CAD/GIS client-side para planificación urbana.\nReact + TypeScript + OpenLayers + Tauri.\n© 2026',
      { variant: 'info', durationMs: 8000 }
    );
  };

  const handleDeleteSelected = () => {
    const primarySelected = useSelectionStore.getState().primaryId !== null;
    const removed = useMapStore.getState().deleteSelected();
    if (removed === 0 && primarySelected) {
      useSelectionStore.getState().clear();
    }
  };

  const handleSaveProject = () => {
    useProjectFileStore.getState().setSaveModalOpen(true);
  };

  const handleOpenProject = () => {
    useProjectFileStore.getState().setOpenModalOpen(true);
  };

  return {
    handleNewProject,
    handleSaveProject,
    handleOpenProject,
    handleExit,
    handleAbout,
    handleDeleteSelected,
  };
}
