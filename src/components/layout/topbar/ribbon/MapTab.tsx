import React from 'react';
import { Trash2 } from 'lucide-react';
import { useDrawStore } from '../../../../store/map/drawStore';
import { useSelectionStore } from '../../../../store/map/selectionStore';
import { useStreetStore } from '../../../../store/entities/streetStore';
import { useRoundaboutStore } from '../../../../store/entities/roundaboutStore';
import { useGenerateLotsProgressStore } from '../../../../store/ui/generateLotsProgressStore';
import { recomputeManzanos, resetIncrementalRoadTracking } from '../../../../geo/recomputeManzanos';
import { RibbonGroup, RibbonTool } from '../RibbonPrimitives';
import {
  IconCursor, IconEraser, IconPolygon, IconLine, IconRect, IconEdit,
  IconSubdivide, IconLots, IconStreet, IconRoundabout,
} from '../icons';

export interface MapTabProps {
  lotsBusy: boolean;
  onToggleEdit: () => void;
  onDeleteSelected: () => void;
  onOpenSubdivision: () => void;
  onGenerateLots: () => void;
}

export default function MapTab({ lotsBusy, onToggleEdit, onDeleteSelected, onOpenSubdivision, onGenerateLots }: MapTabProps) {
  const mode = useDrawStore((s) => s.mode);
  const selectedCount = useSelectionStore((s) => s.selectedIds.size);
  const primarySelected = useSelectionStore((s) => s.primaryId !== null);
  const genLotsProgress = useGenerateLotsProgressStore();

  const rbDefaultRadiusM = useRoundaboutStore((s) => s.defaultRadiusM);
  const setRbDefaultRadius = useRoundaboutStore((s) => s.setDefaultRadius);
  const defaultSideWidthM = useStreetStore((s) => s.defaultSideWidthM);
  const setDefaultSideWidth = useStreetStore((s) => s.setDefaultSideWidth);
  const streets = useStreetStore((s) => s.streets);
  const clearStreets = useStreetStore((s) => s.clearStreets);
  const clearRoundabouts = useRoundaboutStore((s) => s.clearRoundabouts);

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
        <RibbonTool mode="polygon" icon={<IconPolygon />} label="Polígono" shortcut="P" />
        <RibbonTool mode="line" icon={<IconLine />} label="Línea" shortcut="L" />
        <RibbonTool mode="rectangle" icon={<IconRect />} label="Rectángulo" shortcut="R" />
      </RibbonGroup>

      <RibbonGroup label="Edición">
        <RibbonTool icon={<IconEdit />} label="Vértices" disabled={!primarySelected} active={mode === 'edit'} onClick={onToggleEdit} />
        <RibbonTool
          icon={<Trash2 />}
          label="Eliminar"
          disabled={selectedCount === 0}
          badge={selectedCount > 0 ? selectedCount : undefined}
          onClick={onDeleteSelected}
        />
      </RibbonGroup>

      <RibbonGroup label="Subdivisión">
        <RibbonTool icon={<IconSubdivide />} label="Subdividir" disabled={!primarySelected} onClick={onOpenSubdivision} />
        <RibbonTool
          icon={<IconLots />}
          label="Gen. Lotes"
          disabled={lotsBusy}
          badge={genLotsProgress.active ? genLotsProgress.processed : undefined}
          onClick={onGenerateLots}
        />
      </RibbonGroup>

      <RibbonGroup label="Calles">
        <RibbonTool mode="street" icon={<IconStreet />} label="Trazar calle" shortcut="S" active={mode === 'street'} />
        <RibbonTool mode="roundabout" icon={<IconRoundabout />} label="Rotonda" shortcut="O" active={mode === 'roundabout'} />
        <div className="ribbon-inline-control">
          <input
            type="number" className="ribbon-inline-input" value={rbDefaultRadiusM} min={3} max={200} step={1}
            onChange={(e) => setRbDefaultRadius(parseFloat(e.target.value) || 12)}
            title="Radio de rotonda (m)" aria-label="Radio de rotonda en metros"
          />
          <span className="ribbon-inline-text">Radio rot. (m)</span>
        </div>
        <div className="ribbon-inline-control">
          <input
            type="number" className="ribbon-inline-input" value={defaultSideWidthM} min={0} max={30} step={0.5}
            onChange={(e) => setDefaultSideWidth(Math.max(0, parseFloat(e.target.value) || 0))}
            title="Ancho de vereda (m)" aria-label="Ancho de vereda en metros"
          />
          <span className="ribbon-inline-text">Vereda (m) · {streets.length} trazadas</span>
        </div>
        {streets.length > 0 && (
          <button className="ribbon-tool small" onClick={handleClearStreets} style={{ color: 'var(--cad-accent-red)' }} data-tooltip="Limpiar todas las calles" title="Limpiar todas las calles">
            <Trash2 />
            <span className="ribbon-tool-label">Limpiar</span>
          </button>
        )}
      </RibbonGroup>
    </>
  );
}