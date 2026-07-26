import React from 'react';
import { Trash2 } from 'lucide-react';
import { useDrawStore } from '../../../../store/map/drawStore';
import { useSelectionStore } from '../../../../store/map/selectionStore';
import { RibbonGroup, RibbonTool } from '../RibbonPrimitives';
import { IconCursor, IconEdit, IconRectDashed, IconLasso, IconAlertTriangle, IconAlertCircle } from '../icons';

export interface EditTabProps {
  onToggleEdit: () => void;
  onDeleteSelected: () => void;
  onFindOverlaps: () => void;
  onFindGaps: () => void;
}

export default function EditTab({ onToggleEdit, onDeleteSelected, onFindOverlaps, onFindGaps }: EditTabProps) {
  const mode = useDrawStore((s) => s.mode);
  const selectedCount = useSelectionStore((s) => s.selectedIds.size);
  const primarySelected = useSelectionStore((s) => s.primaryId !== null);
  const selectMode = useSelectionStore((s) => s.selectMode);
  const setSelectMode = useSelectionStore((s) => s.setSelectMode);

  return (
    <>
      <RibbonGroup label="Selección">
        <RibbonTool mode="select" icon={<IconCursor />} label="Seleccionar" shortcut="V" />
        <RibbonTool mode="edit" icon={<IconEdit />} label="Editar vértices" disabled={!primarySelected} active={mode === 'edit'} onClick={onToggleEdit} />
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
      <RibbonGroup label="Topología">
        <RibbonTool icon={<Trash2 />} label="Eliminar" disabled={selectedCount === 0} badge={selectedCount > 0 ? selectedCount : undefined} onClick={onDeleteSelected} />
      </RibbonGroup>
      <RibbonGroup label="Validación">
        <RibbonTool icon={<IconAlertTriangle />} label="Overlaps" onClick={onFindOverlaps} tooltip="Detectar superposiciones entre lotes/manzanos" />
        <RibbonTool icon={<IconAlertCircle />} label="Huecos" onClick={onFindGaps} tooltip="Detectar huecos entre manzanos" />
      </RibbonGroup>
    </>
  );
}