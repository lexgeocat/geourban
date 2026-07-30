import React from 'react';
import { BarChart3 } from 'lucide-react';
import { useUiShellStore } from '../../../../store/ui/uiShellStore';
import { useManzanoStore } from '../../../../store/entities/manzanoStore';
import { useRoundaboutStore } from '../../../../store/entities/roundaboutStore';
import { useStreetStore } from '../../../../store/entities/streetStore';
import { BASE_MAP_DEFS } from '../../../../map/baseMaps';
import { RibbonGroup, RibbonTool } from '../RibbonPrimitives';
import { IconGrid, IconSat, IconRoad, IconStreet, IconLots, IconRoundabout, IconCursor } from '../icons';

export default function ViewTab() {
  const baseMap = useUiShellStore((s) => s.baseMap);
  const setBaseMap = useUiShellStore((s) => s.setBaseMap);
  const statsPanelVisible = useUiShellStore((s) => s.statsPanelVisible);
  const setStatsPanelVisible = useUiShellStore((s) => s.setStatsPanelVisible);
  const propsPanelVisible = useUiShellStore((s) => s.panelVisibility.properties);

  const manzanoPanelVisible = useManzanoStore((s) => s.panelVisible);
  const setManzanoPanelVisible = useManzanoStore((s) => s.setPanelVisible);
  const roundaboutPanelVisible = useRoundaboutStore((s) => s.panelVisible);
  const setRoundaboutPanelVisible = useRoundaboutStore((s) => s.setPanelVisible);
  const streetPanelVisible = useStreetStore((s) => s.panelVisible);
  const setStreetPanelVisible = useStreetStore((s) => s.setPanelVisible);

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
        <RibbonTool icon={<IconLots />} label="Manzanos" active={manzanoPanelVisible} onClick={() => setManzanoPanelVisible(!manzanoPanelVisible)} />
        <RibbonTool icon={<IconRoundabout />} label="Rotondas" active={roundaboutPanelVisible} onClick={() => setRoundaboutPanelVisible(!roundaboutPanelVisible)} />
        <RibbonTool icon={<IconStreet />} label="Panel vías" active={streetPanelVisible} onClick={() => setStreetPanelVisible(!streetPanelVisible)} />
        <RibbonTool
          icon={<IconCursor />} label="Propiedades" active={propsPanelVisible}
          onClick={() => useUiShellStore.getState().setPanelVisibility('properties', !propsPanelVisible)}
        />
      </RibbonGroup>
    </>
  );
}