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

export function useTopBarActions() {
  const [lotsBusy, setLotsBusy] = useState(false);

  const handleNewProject = async () => {
    const drawSource = useMapStore.getState().drawSource;
    const ok = window.confirm(
      '¿Crear un nuevo proyecto? Se borrarán todos los features del mapa actual.',
    );
    if (!ok || !drawSource) return;
    await useCommandStack.getState().run(new ClearFeaturesCommand());
    useStreetStore.getState().clearStreets();
    useRoundaboutStore.getState().clearRoundabouts();
    resetIncrementalRoadTracking();
    useLayersStore.getState().resetToEmpty();
    refreshSourceMetrics(drawSource);
    drawSource.changed();
    useSelectionStore.getState().clear();
  };

  const handleExit = () => {
    window.alert('GeoUrban se ejecuta en el navegador. Para salir, cerrá la pestaña o la ventana.');
  };

  const handleAbout = () => {
    window.alert(
      'GeoUrban v0.1\n\nEditor CAD/GIS client-side para planificación urbana.\nConstruido con React + TypeScript + OpenLayers + Tauri.\n\n© 2026',
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
      alert('Seleccioná un polígono para subdividir.');
      return;
    }
    const src = useMapStore.getState().drawSource;
    const feat = src?.getFeatureById(primaryId) as any;
    const openSubdivision = useSubdivisionStore.getState().open;
    const kind = feat ? getFeatureKind(feat) : null;
    if (kind === 'perimetro') {
      alert('El perímetro es la referencia intacta del sitio y no se subdivide directamente. Trazá calles para generar manzanos, o seleccioná un manzano.');
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
      alert('No hay manzanos para subdividir. Trazá calles primero para generar manzanos.');
      return;
    }
    const layerId = await requireLayerForKind('lote');
    if (!layerId) return;
    setLotsBusy(true);
    try {
      const result = await useCommandStack
        .getState()
        .run(new GenerateLotsCommand({ targetAreaM2: 250, frontMinM: 12, layerId }));
      if (!result.ok) {
        alert(result.error);
        return;
      }
      let newLotes = 0;
      src.forEachFeature((f) => {
        const k = getFeatureKind(f as any);
        if (k === 'lote' || (typeof f.get('label') === 'string' && f.get('label')?.toString().startsWith('Lote'))) {
          newLotes++;
        }
      });
      if (newLotes > 0) alert(`${newLotes} lotes generados automáticamente.`);
      else alert('No se pudieron generar lotes. Verificá que los manzanos sean lo suficientemente grandes.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al generar lotes');
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
      alert('Seleccioná un polígono para editar sus vértices.');
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