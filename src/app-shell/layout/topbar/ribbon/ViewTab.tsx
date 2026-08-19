import { BarChart3, Table2 } from 'lucide-react';
import { useUiShellStore } from '../../../store/uiShellStore';
import { BASE_MAP_DEFS } from '@map-core/baseMaps';
import { RibbonGroup, RibbonTool } from '../../topbar/RibbonPrimitives';
import { IconGrid, IconSat, IconRoad, IconCursor } from '../../topbar/icons';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useAttributeTableStore } from '@attributes-engine';
import { toast } from '@shared-ui/store/toastStore';

export default function ViewTab() {
  const baseMap = useUiShellStore((s) => s.baseMap);
  const setBaseMap = useUiShellStore((s) => s.setBaseMap);
  const statsPanelVisible = useUiShellStore((s) => s.statsPanelVisible);
  const setStatsPanelVisible = useUiShellStore((s) => s.setStatsPanelVisible);
  const propsPanelVisible = useUiShellStore((s) => s.panelVisibility.properties);

  return (
    <>
      <RibbonGroup label="Mapa base">
        {BASE_MAP_DEFS.map((def) => {
          const icon =
            def.id === 'cad' ? <IconGrid /> :
            def.id === 'googleSatellite' ? <IconSat /> :
            def.id === 'googleRoadmap' ? <IconRoad /> :
            <IconGrid />;
          return (
            <RibbonTool key={def.id} icon={icon} label={def.label} active={baseMap === def.id} onClick={() => setBaseMap(def.id)} />
          );
        })}
      </RibbonGroup>

      <RibbonGroup label="Paneles">
        <RibbonTool icon={<BarChart3 />} label="Estadísticas" active={statsPanelVisible} onClick={() => setStatsPanelVisible(!statsPanelVisible)} />
        <RibbonTool
          icon={<IconCursor />} label="Propiedades" active={propsPanelVisible}
          onClick={() => useUiShellStore.getState().setPanelVisibility('properties', !propsPanelVisible)}
        />
        <RibbonTool
          icon={<Table2 />}
          label="Atributos"
          onClick={() => {
            const s = useLayersStore.getState();
            const targetId = s.activeLayerId ?? s.layers[0]?.id;
            if (!targetId) { toast('No hay capas todavía.', { variant: 'info' }); return; }
            useAttributeTableStore.getState().openForLayer(targetId);
          }}
        />
      </RibbonGroup>
    </>
  );
}
