import { Trash2 } from 'lucide-react';
import { useDrawStore } from '@map-core/store/drawStore';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { RibbonGroup, RibbonTool } from '../../topbar/RibbonPrimitives';
import { IconRectDashed, IconLasso } from '../../topbar/icons';

export interface EditTabProps {
  onDeleteSelected: () => void;
}

export default function EditTab({ onDeleteSelected }: EditTabProps) {
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
    </>
  );
}