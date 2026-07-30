import { useState } from 'react';
import { useMapStore } from '../store/map/mapStore';
import { resetIncrementalRoadTracking } from '../geo/recomputeManzanos';
import { useCommandStack } from '../commands/core/CommandStack';
import { ClearFeaturesCommand } from '../commands/features/ClearFeaturesCommand';
import { useSelectionStore } from '../store/map/selectionStore';
import { useSubdivisionStore } from '../store/ui/subdivisionStore';
import { useStreetStore } from '../store/entities/streetStore';
import { useRoundaboutStore } from '../store/entities/roundaboutStore';
import { useManzanoStore } from '../store/entities/manzanoStore';
import { useLayersStore } from '../store/entities/layersRegistryStore';
import { useDrawStore } from '../store/map/drawStore';
import { GenerateLotsCommand } from '../commands/lots/GenerateLotsCommand';
import { refreshSourceMetrics } from '../geo/metrics';
import { getFeatureKind } from '../core/objectModel';
import { requireLayerForKind } from '../store/ui/layerPickerStore';
import { confirmAsync } from '../store/ui/confirmDialogStore';
import { toast } from '../store/ui/toastStore';

export function useTopBarActions() {
  const [lotsBusy, setLotsBusy] = useState(false);

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

  const handleOpenSubdivision = async () => {
    const primaryId = useSelectionStore.getState().primaryId;
    if (!primaryId) {
      toast('Seleccioná un polígono para subdividir.', { variant: 'warning' });
      return;
    }
    const src = useMapStore.getState().drawSource;
    const feat = src?.getFeatureById(primaryId) as any;
    const openSubdivision = useSubdivisionStore.getState().open;
    const kind = feat ? getFeatureKind(feat) : null;
    if (kind === 'perimetro') {
      toast('El perímetro es la referencia intacta del sitio y no se subdivide directamente. Trazá calles para generar manzanos, o seleccioná un manzano.', {
        variant: 'info',
        durationMs: 6000,
      });
      return;
    }
    if (feat && kind === 'manzana') {
      const { targetAreaM2, frontMinM } = useManzanoStore.getState();
      openSubdivision(primaryId, 'auto', { targetAreaM2, frontMinM });
    } else {
      openSubdivision(primaryId);
    }
  };

  const handleGenerateLots = async () => {
    if (lotsBusy) return;
    const src = useMapStore.getState().drawSource;
    if (!src) return;
    let manzanoCount = 0;
    src.forEachFeature((f) => {
      if (getFeatureKind(f as any) === 'manzana') manzanoCount++;
    });
    if (manzanoCount === 0) {
      toast('No hay manzanos para subdividir. Trazá calles primero para generar manzanos.', {
        variant: 'warning',
      });
      return;
    }
    const layerId = await requireLayerForKind('lote');
    if (!layerId) return;
    const { targetAreaM2, frontMinM } = useManzanoStore.getState();
    setLotsBusy(true);
    try {
      const result = await useCommandStack
        .getState()
        .run(new GenerateLotsCommand({ targetAreaM2, frontMinM, layerId }));
      if (!result.ok) {
        toast(result.error, { variant: 'error', durationMs: 6000 });
        return;
      }
      let newLotes = 0;
      src.forEachFeature((f) => {
        const k = getFeatureKind(f as any);
        if (k === 'lote' || (typeof f.get('label') === 'string' && f.get('label')?.toString().startsWith('Lote'))) {
          newLotes++;
        }
      });
      if (newLotes > 0) {
        toast(`${newLotes} lotes generados automáticamente.`, { variant: 'success' });
      } else {
        toast('No se pudieron generar lotes. Verificá que los manzanos sean lo suficientemente grandes.', {
          variant: 'warning',
        });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al generar lotes', {
        variant: 'error',
        durationMs: 6000,
      });
    } finally {
      setLotsBusy(false);
    }
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

  return {
    lotsBusy,
    handleNewProject,
    handleExit,
    handleAbout,
    handleDeleteSelected,
    handleOpenSubdivision,
    handleGenerateLots,
    handleToggleEdit,
  };
}