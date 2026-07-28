import React from 'react';
import { Trash2 } from 'lucide-react';
import { useDrawStore } from '../../../../store/map/drawStore';
import { useSelectionStore } from '../../../../store/map/selectionStore';
import { RibbonGroup, RibbonTool } from '../RibbonPrimitives';
import { IconRectDashed, IconLasso, IconAlertTriangle, IconAlertCircle, IconVertices } from '../icons';

export interface EditTabProps {
  onDeleteSelected: () => void;
  onFindOverlaps: () => void;
  onFindGaps: () => void;
  onGenerateVertices: () => void;
}

export default function EditTab({ onDeleteSelected, onFindOverlaps, onFindGaps, onGenerateVertices }: EditTabProps) {
  const selectedCount = useSelectionStore((s) => s.selectedIds.size);
  const selectMode = useSelectionStore((s) => s.selectMode);
  const setSelectMode = useSelectionStore((s) => s.setSelectMode);

  return (
    <>
      <RibbonGroup label="Selección">
        <RibbonTool
          icon={<IconRectDashed />} label="Rect" active={selectMode === 'rect'}
          onClick={() => { useDrawStore.getState().setMode('select'); setSelectMode('rect'); }}
          shortcut="Shft+R"
        />
        <RibbonTool
          icon={<IconLasso />} label="Lazo" active={selectMode === 'lasso'}
          onClick={() => { useDrawStore.getState().setMode('select'); setSelectMode('lasso'); }}
          shortcut="Shft+L"
        />
      </RibbonGroup>
      <RibbonGroup label="Modificar">
        <RibbonTool icon={<Trash2 />} label="Eliminar" disabled={selectedCount === 0} badge={selectedCount > 0 ? selectedCount : undefined} onClick={onDeleteSelected} />
      </RibbonGroup>
      <RibbonGroup label="Validación">
        <RibbonTool icon={<IconAlertTriangle />} label="Overlaps" onClick={onFindOverlaps} tooltip="Detectar superposiciones entre lotes/manzanos" />
        <RibbonTool icon={<IconAlertCircle />} label="Huecos" onClick={onFindGaps} tooltip="Detectar huecos entre manzanos" />
      </RibbonGroup>
      <RibbonGroup label="Generar">
        <RibbonTool
          icon={<IconVertices />} label="Vértices" disabled={selectedCount === 0}
          onClick={onGenerateVertices}
          tooltip="Generar un punto por cada vértice de la selección (capa 'vert_geo')"
        />
      </RibbonGroup>
    </>
  );
}