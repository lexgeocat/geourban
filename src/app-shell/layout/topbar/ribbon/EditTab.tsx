import { Trash2 } from 'lucide-react';
import { useDrawStore } from '@map-core/store/drawStore';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { RibbonGroup, RibbonTool } from '../../topbar/RibbonPrimitives';
import { IconRectDashed, IconLasso, IconSplit, IconEditVertices } from '../../topbar/icons';

export interface EditTabProps {
  onDeleteSelected: () => void;
}

export default function EditTab({ onDeleteSelected }: EditTabProps) {
  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);
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

      <RibbonGroup label="Edición avanzada">
        <RibbonTool
          mode="edit"
          icon={<IconEditVertices />}
          label="Editar vértices"
          shortcut="Ctrl+E"
          disabled={selectedCount === 0}
          active={mode === 'edit'}
          tooltip={
            selectedCount === 0
              ? 'Seleccioná un elemento en una capa con edición activa'
              : 'Mover/agregar/borrar vértices (clic derecho borra un vértice)'
          }
          onClick={() => setMode('edit')}
        />
        <RibbonTool
          mode="splitFeature"
          icon={<IconSplit />}
          label="Dividir"
          shortcut="X"
          disabled={selectedCount === 0}
          active={mode === 'splitFeature'}
          tooltip={
            selectedCount === 0
              ? 'Seleccioná el elemento a dividir'
              : 'Trazá una línea que cruce el elemento para dividirlo en dos'
          }
          onClick={() => setMode('splitFeature')}
        />
      </RibbonGroup>

      <RibbonGroup label="Modificar">
        <RibbonTool icon={<Trash2 />} label="Eliminar" disabled={selectedCount === 0} badge={selectedCount > 0 ? selectedCount : undefined} onClick={onDeleteSelected} />
      </RibbonGroup>
    </>
  );
}