import React from 'react';
import { Trash2 } from 'lucide-react';
import { useDrawStore } from '../../../../store/map/drawStore';
import { useStreetStore } from '../../../../store/entities/streetStore';
import { useRoundaboutStore } from '../../../../store/entities/roundaboutStore';
import { useLayersStore } from '../../../../store/entities/layersRegistryStore';
import { useGenerateLotsProgressStore } from '../../../../store/ui/generateLotsProgressStore';
import { recomputeManzanos, resetIncrementalRoadTracking } from '../../../../geo/recomputeManzanos';
import { RibbonGroup, RibbonTool, RibbonToolDropdown } from '../RibbonPrimitives';
import {
  IconCursor, IconEraser, IconPolygon, IconLine, IconRect, IconPerimeter,
  IconSubdivide, IconLots, IconStreet, IconRoundabout,
} from '../icons';

export interface UrbanDesignTabProps {
  lotsBusy: boolean;
  onOpenSubdivision: () => void;
  onGenerateLots: () => void;
}

export default function UrbanDesignTab({ lotsBusy, onOpenSubdivision, onGenerateLots }: UrbanDesignTabProps) {
  const mode = useDrawStore((s) => s.mode);
  const genLotsProgress = useGenerateLotsProgressStore();

  const streets = useStreetStore((s) => s.streets);
  const clearStreets = useStreetStore((s) => s.clearStreets);
  const clearRoundabouts = useRoundaboutStore((s) => s.clearRoundabouts);

  const layers = useLayersStore((s) => s.layers);
  const activeLayerId = useLayersStore((s) => s.activeLayerId);
  const setActiveLayer = useLayersStore((s) => s.setActiveLayer);

  const handleClearStreets = () => {
    clearStreets();
    clearRoundabouts();
    resetIncrementalRoadTracking();
    void recomputeManzanos();
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
        <RibbonTool mode="line" icon={<IconLine />} label="Línea" shortcut="L" />
      </RibbonGroup>

      <RibbonGroup label="Vialidad">
        <RibbonTool mode="street" icon={<IconStreet />} label="Trazar calle" shortcut="S" active={mode === 'street'} />
        <RibbonTool mode="roundabout" icon={<IconRoundabout />} label="Rotonda" shortcut="O" active={mode === 'roundabout'} />
        {streets.length > 0 && (
          <button
            className="ribbon-tool small"
            onClick={handleClearStreets}
            style={{ color: 'var(--cad-accent-red)' }}
            data-tooltip="Limpiar todas las calles"
            title="Limpiar todas las calles"
          >
            <Trash2 />
            <span className="ribbon-tool-label">Limpiar ({streets.length})</span>
          </button>
        )}
      </RibbonGroup>

      <RibbonGroup label="Capa activa">
        <div className="ribbon-inline-control" style={{ minWidth: 160 }}>
          <select
            className="ribbon-inline-input"
            value={activeLayerId ?? ''}
            onChange={(e) => setActiveLayer(e.target.value || null)}
            title="Capa activa — los nuevos trazos se asignan acá"
            aria-label="Capa activa"
          >
            <option value="">— Sin capa activa —</option>
            {layers.map((l) => (
              <option key={l.id} value={l.id} disabled={l.locked}>
                {l.name}{l.locked ? ' 🔒' : ''}
              </option>
            ))}
          </select>
          <span className="ribbon-inline-text">Capa activa</span>
        </div>
      </RibbonGroup>

      <RibbonGroup label="Subdivisión">
        <RibbonTool icon={<IconSubdivide />} label="Subdividir" onClick={onOpenSubdivision} />
        <RibbonTool
          icon={<IconLots />} label="Gen. Lotes" disabled={lotsBusy}
          badge={genLotsProgress.active ? genLotsProgress.processed : undefined} onClick={onGenerateLots}
        />
      </RibbonGroup>
    </>
  );
}