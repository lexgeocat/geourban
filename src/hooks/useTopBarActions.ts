import { useMapStore } from '../store/map/mapStore';
import { resetIncrementalRoadTracking } from '../geo/recomputeManzanos';
import { useCommandStack } from '../commands/core/CommandStack';
import { ClearFeaturesCommand } from '../commands/features/ClearFeaturesCommand';
import { useSelectionStore } from '../store/map/selectionStore';
import { useStreetStore } from '../store/entities/streetStore';
import { useRoundaboutStore } from '../store/entities/roundaboutStore';
import { useManzanoStore } from '../store/entities/manzanoStore';
import { useLayersStore } from '../store/entities/layersRegistryStore';
import { useDrawStore } from '../store/map/drawStore';
import { refreshSourceMetrics } from '../geo/metrics';
import { getFeatureKind } from '../core/objectModel';
import { confirmAsync } from '../store/ui/confirmDialogStore';
import { toast } from '../store/ui/toastStore';
import { useProjectFileStore } from '../store/ui/projectFileStore';
import { useLotsWorkflow } from './useLotsWorkflow';

export function useTopBarActions() {
  const { lotsBusy, runGenerateAllLots, cancelGenerateAllLots, focusManzanoInSidebar } = useLotsWorkflow();

  const handleNewProject = async () => {
    const drawSource = useMapStore.getState().drawSource;
    const ok = await confirmAsync(
      '¿Crear un nuevo proyecto? Se borrarán todos los features del mapa actual.',
      { title: 'Nuevo proyecto', confirmLabel: 'Crear', cancelLabel: 'Cancelar', danger: true },
    );
    if (!ok || !drawSource) return;
    await useCommandStack.getState().run(new ClearFeaturesCommand());
    useStreetStore.getState().clearStreets();
    useRoundaboutStore.getState().clearRoundabouts();
    resetIncrementalRoadTracking();
    useLayersStore.getState().resetToEmpty();
    useManzanoStore.getState().resetAll();
    useDrawStore.getState().setMode('select');
    useDrawStore.getState().setAreaKind('lote');
    useDrawStore.getState().setLastDrawnLineId(null);
    refreshSourceMetrics(drawSource);
    drawSource.changed();
    useSelectionStore.getState().clear();
    toast('Proyecto nuevo creado.', { variant: 'success' });
  };

  const handleExit = () => {
    toast('GeoUrban se ejecuta en el navegador. Para salir, cerrá la pestaña o la ventana.', {
      variant: 'info',
      durationMs: 6000,
    });
  };

  const handleAbout = () => {
    toast(
      'GeoUrban v0.1 · Editor CAD/GIS client-side para planificación urbana.\nReact + TypeScript + OpenLayers + Tauri.\n© 2026',
      { variant: 'info', durationMs: 8000 },
    );
  };

  const handleDeleteSelected = () => {
    const primarySelected = useSelectionStore.getState().primaryId !== null;
    const removed = useMapStore.getState().deleteSelected();
    if (removed === 0 && primarySelected) {
      useSelectionStore.getState().clear();
    }
  };

  const handleOpenSubdivision = () => {
    const primaryId = useSelectionStore.getState().primaryId;
    if (!primaryId) {
      toast('Seleccioná un manzano para subdividir.', { variant: 'warning' });
      return;
    }
    const src = useMapStore.getState().drawSource;
    const feat = src?.getFeatureById(primaryId);
    const kind = feat ? getFeatureKind(feat) : null;

    if (kind === 'perimetro') {
      toast(
        'El perímetro es la referencia intacta del sitio y no se subdivide directamente. Trazá calles para generar manzanos, o seleccioná un manzano.',
        { variant: 'info', durationMs: 6000 },
      );
      return;
    }
    if (kind !== 'manzana') {
      toast(
        'Seleccioná un manzano para subdividir — la subdivisión de lotes se maneja desde el panel "Manzanos".',
        { variant: 'warning', durationMs: 5000 },
      );
      return;
    }
    focusManzanoInSidebar(primaryId);
  };

  const handleGenerateLots = async () => {
    await runGenerateAllLots();
  };

  const handleToggleEdit = () => {
    const mode = useDrawStore.getState().mode;
    if (mode === 'edit') {
      useDrawStore.getState().setMode('select');
      return;
    }
    const primaryId = useSelectionStore.getState().primaryId;
    if (!primaryId) {
      toast('Seleccioná un polígono para editar sus vértices.', { variant: 'warning' });
      return;
    }
    useDrawStore.getState().setMode('edit');
  };

  const handleSaveProject = () => {
    useProjectFileStore.getState().setSaveModalOpen(true);
  };

  const handleOpenProject = () => {
    useProjectFileStore.getState().setOpenModalOpen(true);
  };

  return {
    lotsBusy,
    handleNewProject,
    handleSaveProject,
    handleOpenProject,
    handleExit,
    handleAbout,
    handleDeleteSelected,
    handleOpenSubdivision,
    handleGenerateLots,
    handleCancelGenerateLots: cancelGenerateAllLots,
    handleToggleEdit,
  };
}