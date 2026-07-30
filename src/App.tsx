import React from 'react';
import MapView from './map/Map';
import TopBar from './components/layout/TopBar';
import StatusBar from './components/layout/StatusBar';
import LayerPanel from './components/panels/LayerPanel';
import SubdivisionDialog from './components/modals/SubdivisionDialog';
import PropertyPanel from './components/panels/PropertyPanel';
import StatsPanel from './components/panels/StatsPanel';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import ProjectSetupModal from './components/modals/ProjectSetupModal';
import ManzanoPanel from './components/panels/ManzanoPanel';
import RoundaboutPanel from './components/panels/RoundaboutPanel';
import StreetPanel from './components/panels/StreetPanel';
import DebugPanel from './components/debug/DebugPanel';
import ConfirmDialog from './components/modals/ConfirmDialog';
import ToastStack from './components/ui/ToastStack';
import SaveProjectModal from './components/modals/SaveProjectModal';
import OpenProjectModal from './components/modals/OpenProjectModal';

function App() {
  useKeyboardShortcuts();

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', overflow: 'hidden' }}>
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
      <LayerPanel />
      <ConfirmDialog />
      <SaveProjectModal />
      <OpenProjectModal />
      <ToastStack />

      <StatusBar />
      <DebugPanel />
    </div>
  );
}

export default App;