import MapView from '@map-core/Map';
import TopBar from './layout/TopBar';
import StatusBar from './layout/StatusBar';
import LeftSidebar from './layout/leftbar/LeftSidebar';
import LayerPanel from '@layers-engine/ui/LayerPanel';
import PropertyPanel from '@drawing-engine/ui/PropertyPanel';
import StatsPanel from './layout/StatsPanel';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import ProjectSetupModal from '@georef-engine/ui/ProjectSetupModal';
import ConfirmDialog from '@shared-ui/ConfirmDialog';
import ToastStack from '@shared-ui/ToastStack';
import SaveProjectModal from '@persistence-engine/ui/SaveProjectModal';
import OpenProjectModal from '@persistence-engine/ui/OpenProjectModal';
import LabelConfigModal from '@label-engine/ui/LabelConfigModal';

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
      <LabelConfigModal />
      <ToastStack />

      <StatusBar />
    </div>
  );
}

export default App;