import React, { useEffect } from 'react';
import MapView from './map/Map';
import TopBar from './components/layout/TopBar';
import StatusBar from './components/layout/StatusBar';
import LayerPanel from './components/panels/LayerPanel';
import SubdivisionDialog from './components/modals/SubdivisionDialog';
import PropertyPanel from './components/panels/PropertyPanel';
import StatsPanel from './components/panels/StatsPanel';
import { startAutosave } from './io/persistence';
import { writeProjectFromOlFeatures } from './io/geojson';
import { useMapStore } from './store/map/mapStore';
import { useUiShellStore } from './store/ui/uiShellStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useLayersStore } from './store/entities/layersRegistryStore';
import ProjectSetupModal from './components/modals/ProjectSetupModal';
import ManzanoPanel from './components/panels/ManzanoPanel';
import RoundaboutPanel from './components/panels/RoundaboutPanel';
import StreetPanel from './components/panels/StreetPanel';
import LayerResolverModal from './components/modals/LayerResolverModal';

function App() {
  useKeyboardShortcuts();

  useEffect(() => {
    return startAutosave(() => {
      const drawSource = useMapStore.getState().drawSource;
      const viewConfig = useMapStore.getState().viewConfig;
      const baseMap = useUiShellStore.getState().baseMap;
      const features = drawSource?.getFeatures() ?? [];
      const project = writeProjectFromOlFeatures(features);
      project.baseMap = baseMap;
      project.view = { center: viewConfig.center, zoom: viewConfig.zoom };
      project.layers = useLayersStore.getState().layers;
      project.activeLayerId = useLayersStore.getState().activeLayerId;
      return project;
    });
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Map takes the full screen */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          top: 'var(--cad-topbar-height)',
          bottom: 'var(--cad-statusbar-height)',
        }}
      >
        <MapView />
      </div>

      {/* UI overlays */}
      <TopBar />

      <div
        style={{
          position: 'absolute',
          top: 'var(--cad-topbar-height)',
          left: 0,
          right: 0,
          bottom: 'var(--cad-statusbar-height)',
          pointerEvents: 'none',
        }}
      >
        {/* Side panels need pointer events */}
        <div style={{ pointerEvents: 'auto' }}>
          <PropertyPanel />
        </div>
<div style={{ pointerEvents: 'auto' }}>
      <StatsPanel />
      <ManzanoPanel />
      <RoundaboutPanel />
      <StreetPanel />
    </div>
      </div>
      <ProjectSetupModal />
      <SubdivisionDialog />
      <LayerResolverModal />

      <LayerPanel />

      <StatusBar />
    </div>
  );
}

export default App;
