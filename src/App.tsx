import React, { useEffect } from 'react';
import MapView from './map/Map';
import TopBar from './components/TopBar';
import StatusBar from './components/StatusBar';
import LayerPanel from './components/LayerPanel';
import SubdivisionDialog from './components/SubdivisionDialog';
import PropertyPanel from './components/PropertyPanel';
import StatsPanel from './components/StatsPanel';
import SelectionFilterPanel from './components/SelectionFilterPanel';
import { startAutosave } from './io/persistence';
import { writeProjectFromOlFeatures } from './io/geojson';
import { useMapStore } from './store/mapStore';
import { useLayerStore } from './store/layerStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import ProjectSetupModal from './components/ProjectSetupModal';
import ManzanoPanel from './components/ManzanoPanel';

function App() {
  useKeyboardShortcuts();

  useEffect(() => {
    return startAutosave(() => {
      const drawSource = useMapStore.getState().drawSource;
      const viewConfig = useMapStore.getState().viewConfig;
      const baseMap = useLayerStore.getState().baseMap;
      const features = drawSource?.getFeatures() ?? [];
      const project = writeProjectFromOlFeatures(features);
      project.baseMap = baseMap;
      project.view = { center: viewConfig.center, zoom: viewConfig.zoom };
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
        </div>
      </div>
      <ProjectSetupModal />
      <SubdivisionDialog />

      <SelectionFilterPanel />

      <LayerPanel />

      <StatusBar />
    </div>
  );
}

export default App;
