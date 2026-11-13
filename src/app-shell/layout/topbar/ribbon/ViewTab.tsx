import { BarChart3, Table2, SlidersHorizontal, Compass } from 'lucide-react';
import { useUiShellStore } from '../../../store/uiShellStore';
import { BASE_MAP_DEFS } from '@map-core/baseMaps';
import { RibbonGroup, RibbonTool } from '../../topbar/RibbonPrimitives';
import { IconGrid, IconSat, IconRoad } from '../../topbar/icons';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useAttributeTableStore } from '@attributes-engine/store/attributeTableStore';
import { toast } from '@shared-ui/store/toastStore';

export default function ViewTab() {
  const baseMap = useUiShellStore((s) => s.baseMap);
  const setBaseMap = useUiShellStore((s) => s.setBaseMap);
  const statsPanelVisible = useUiShellStore((s) => s.statsPanelVisible);
  const setStatsPanelVisible = useUiShellStore((s) => s.setStatsPanelVisible);
  const propsPanelVisible = useUiShellStore((s) => s.panelVisibility.properties);

  return (
    <>
      <RibbonGroup label="Lienzo y Cartografía">
        {BASE_MAP_DEFS.map((def) => {
          const icon =
            def.id === 'cad' ? (
              <IconGrid />
            ) : def.id === 'googleSatellite' ? (
              <IconSat />
            ) : def.id === 'googleRoadmap' ? (
              <IconRoad />
            ) : (
              <Compass size={14} color="#FBBF24" style={{ filter: 'drop-shadow(0 0 6px rgba(251, 191, 36, 0.35))' }} />
            );
          return (
            <RibbonTool
              key={def.id}
              icon={icon}
              label={def.label}
              active={baseMap === def.id}
              onClick={() => setBaseMap(def.id)}
            />
          );
        })}
      </RibbonGroup>

      <RibbonGroup label="Módulos de Análisis">
        <RibbonTool
          icon={<BarChart3 size={14} color="#F59E0B" style={{ filter: 'drop-shadow(0 0 6px rgba(245, 158, 11, 0.38))' }} />}
          label="Estadísticas"
          active={statsPanelVisible}
          onClick={() => setStatsPanelVisible(!statsPanelVisible)}
        />
        <RibbonTool
          icon={<SlidersHorizontal size={14} color="#EC4899" style={{ filter: 'drop-shadow(0 0 6px rgba(236, 72, 153, 0.38))' }} />}
          label="Propiedades"
          active={propsPanelVisible}
          onClick={() => useUiShellStore.getState().setPanelVisibility('properties', !propsPanelVisible)}
        />
        <RibbonTool
          icon={<Table2 size={14} color="#2DD4BF" style={{ filter: 'drop-shadow(0 0 6px rgba(45, 212, 191, 0.38))' }} />}
          label="Atributos"
          onClick={() => {
            const s = useLayersStore.getState();
            const targetId = s.activeLayerId ?? s.layers[0]?.id;
            if (!targetId) {
              toast('No hay capas todavía.', { variant: 'info' });
              return;
            }
            useAttributeTableStore.getState().openForLayer(targetId);
          }}
        />
      </RibbonGroup>
    </>
  );
}
