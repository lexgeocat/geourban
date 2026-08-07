import React from 'react';
import MapView from './map/Map';
import TopBar from './components/layout/TopBar';
import StatusBar from './components/layout/StatusBar';
import LeftSidebar from './components/layout/leftbar/LeftSidebar';
import LayerPanel from './components/panels/LayerPanel';
import PropertyPanel from './components/panels/PropertyPanel';
import StatsPanel from './components/panels/StatsPanel';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import ProjectSetupModal from './components/modals/ProjectSetupModal';
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
      <LeftSidebar />

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
        </div>
      </div>
      <ProjectSetupModal />
      <LayerPanel />
      <ConfirmDialog />
      <SaveProjectModal />
      <OpenProjectModal />
      <ToastStack />

      <StatusBar />
    </div>
  );
}

export default App;