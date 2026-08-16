import { Trash2 } from 'lucide-react';
import { useDrawStore } from '@map-core/store/drawStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { recomputeManzanos, resetIncrementalRoadTracking } from '@manzanos-engine/orchestration/recomputeManzanos';
import { useMapStore } from '@map-core/store/mapStore';
import { runCommand } from '@kernel/command/CommandStack';
import { RemoveLayerCommand } from '@layers-engine/commands/RemoveLayerCommand';
import { computeLayerFeatureCounts } from '@layers-engine/selectors/layerStats';
import { RibbonGroup, RibbonTool, RibbonToolDropdown } from '../../topbar/RibbonPrimitives';
import {
  IconCursor, IconEraser, IconPolygon, IconLine, IconRect, IconPerimeter,
  IconStreet,
  IconPoint, IconCircleShape, IconPolyline,
} from '../../topbar/icons';

export default function UrbanDesignTab() {
  const mode = useDrawStore((s) => s.mode);

  const streets = useStreetStore((s) => s.streets);
  const clearStreets = useStreetStore((s) => s.clearStreets);
  const clearRoundabouts = useRoundaboutStore((s) => s.clearRoundabouts);

const handleClearStreets = async () => {
    clearStreets();
    clearRoundabouts();
    useEntityLabelStore.getState().clear();
    resetIncrementalRoadTracking();
    await recomputeManzanos();
    const src = useMapStore.getState().drawSource;
    const counts = computeLayerFeatureCounts(src);
    for (const layer of useLayersStore.getState().layers) {
      if (layer.locked) continue;
      if (layer.kind !== 'manzana' && layer.kind !== 'lote') continue;
      if ((counts[layer.id] ?? 0) > 0) continue;
      void runCommand(new RemoveLayerCommand({ layerId: layer.id, action: 'delete' }));
    }
  };

  return (
    <>
      <RibbonGroup label="Navegación">
        <RibbonTool mode="select" icon={<IconCursor />} label="Seleccionar" shortcut="V" />
        <RibbonTool mode="erase" icon={<IconEraser />} label="Borrar" shortcut="E" />
      </RibbonGroup>

      <RibbonGroup label="Dibujo">
        <RibbonToolDropdown
          icon={<IconPerimeter />}
          label="Diseñar perímetro"
          tooltip="Diseñar perímetro — Polígono (P) o Rectángulo (R)"
          options={[
            { mode: 'polygon', icon: <IconPolygon />, label: 'Polígono', shortcut: 'P' },
            { mode: 'rectangle', icon: <IconRect />, label: 'Rectángulo', shortcut: 'R' },
          ]}
        />
        <RibbonToolDropdown
          icon={<IconLine />}
          label="Línea"
          tooltip="Línea — Segmento simple (L) o Polilínea (Y)"
          options={[
            { mode: 'line', icon: <IconLine />, label: 'Línea', shortcut: 'L' },
            { mode: 'polyline', icon: <IconPolyline />, label: 'Polilínea', shortcut: 'Y' },
          ]}
        />
        <RibbonTool mode="circle" icon={<IconCircleShape />} label="Círculo" shortcut="C" />
        <RibbonTool mode="point" icon={<IconPoint />} label="Punto" shortcut="T" />
      </RibbonGroup>

      <RibbonGroup label="Vialidad">
        <RibbonTool mode="street" icon={<IconStreet />} label="Trazar Via" shortcut="S" active={mode === 'street'} />
        {streets.length > 0 && (
          <button
            className="ribbon-tool small"
            onClick={handleClearStreets}
            style={{ color: 'var(--cad-accent-red)' }}
            data-tooltip="Limpiar todas las vías"
            title="Limpiar todas las vías"
          >
            <Trash2 />
            <span className="ribbon-tool-label">Limpiar ({streets.length})</span>
          </button>
        )}
      </RibbonGroup>
    </>
  );
}