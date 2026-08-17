import { Trash2 } from 'lucide-react';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useDrawStore } from '@map-core/store/drawStore';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { useMapStore } from '@map-core/store/mapStore';
import { isVertexEditableKind } from '@kernel/domain-model/featureModel';
import { RibbonGroup, RibbonTool } from '../../topbar/RibbonPrimitives';
import { IconRectDashed, IconLasso, IconSplit, IconEditVertices } from '../../topbar/icons';

export interface EditTabProps {
  onDeleteSelected: () => void;
}

export default function EditTab({ onDeleteSelected }: EditTabProps) {
  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const selectedCount = selectedIds.size;
  const selectMode = useSelectionStore((s) => s.selectMode);
  const setSelectMode = useSelectionStore((s) => s.setSelectMode);
  const drawSource = useMapStore((s) => s.drawSource);

  let hasVertexEditableSelection = false;
  if (drawSource && selectedCount > 0) {
    for (const id of selectedIds) {
      const f = drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (f && isVertexEditableKind(f)) {
        hasVertexEditableSelection = true;
        break;
      }
    }
  }

  return (
    <>
      <RibbonGroup label="Selección">
        <RibbonTool
          icon={<IconRectDashed />}
          label="Rect"
          active={selectMode === 'rect'}
          onClick={() => {
            useDrawStore.getState().setMode('select');
            setSelectMode('rect');
          }}
          shortcut="Shft+R"
        />
        <RibbonTool
          icon={<IconLasso />}
          label="Lazo"
          active={selectMode === 'lasso'}
          onClick={() => {
            useDrawStore.getState().setMode('select');
            setSelectMode('lasso');
          }}
          shortcut="Shft+L"
        />
      </RibbonGroup>

      <RibbonGroup label="Edición avanzada">
        <RibbonTool
          mode="edit"
          icon={<IconEditVertices />}
          label="Editar vértices"
          shortcut="Ctrl+E"
          disabled={selectedCount === 0 || !hasVertexEditableSelection}
          active={mode === 'edit'}
          tooltip={
            selectedCount === 0
              ? 'Seleccioná un elemento en una capa con edición activa'
              : !hasVertexEditableSelection
                ? 'Rotondas, círculos y puntos no tienen vértices editables — usá sus propios parámetros'
                : 'Mover vértices (clic derecho borra un vértice) · los rectángulos se redimensionan manteniendo ángulos rectos'
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
        <RibbonTool
          icon={<Trash2 />}
          label="Eliminar"
          disabled={selectedCount === 0}
          badge={selectedCount > 0 ? selectedCount : undefined}
          onClick={onDeleteSelected}
        />
      </RibbonGroup>
    </>
  );
}
