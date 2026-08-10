import { BarChart3 } from 'lucide-react';
import { useUiShellStore } from '../../../store/uiShellStore';
import { useLeftSidebarStore } from '../../../store/leftSidebarStore';
import { BASE_MAP_DEFS } from '@map-core/baseMaps';
import { RibbonGroup, RibbonTool } from '../../topbar/RibbonPrimitives';
import { IconGrid, IconSat, IconRoad, IconStreet, IconLots, IconRoundabout, IconCursor } from '../../topbar/icons';

export default function ViewTab() {
  const baseMap = useUiShellStore((s) => s.baseMap);
  const setBaseMap = useUiShellStore((s) => s.setBaseMap);
  const statsPanelVisible = useUiShellStore((s) => s.statsPanelVisible);
  const setStatsPanelVisible = useUiShellStore((s) => s.setStatsPanelVisible);
  const propsPanelVisible = useUiShellStore((s) => s.panelVisibility.properties);

  const leftSidebarTab = useLeftSidebarStore((s) => s.activeTab);
  const toggleLeftSidebarTab = useLeftSidebarStore((s) => s.toggleTab);

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
        <RibbonTool icon={<IconLots />} label="Manzanos" active={leftSidebarTab === 'manzanos'} onClick={() => toggleLeftSidebarTab('manzanos')} />
        <RibbonTool icon={<IconRoundabout />} label="Rotondas" active={leftSidebarTab === 'rotondas'} onClick={() => toggleLeftSidebarTab('rotondas')} />
        <RibbonTool icon={<IconStreet />} label="Panel vías" active={leftSidebarTab === 'vias'} onClick={() => toggleLeftSidebarTab('vias')} />
        <RibbonTool
          icon={<IconCursor />} label="Propiedades" active={propsPanelVisible}
          onClick={() => useUiShellStore.getState().setPanelVisibility('properties', !propsPanelVisible)}
        />
      </RibbonGroup>
    </>
  );
}