import MapView from '@map-core/Map';
import TopBar from './layout/TopBar';
import StatusBar from './layout/StatusBar';
import LeftSidebar from './layout/leftbar/LeftSidebar';
import LayerPanel from '@layers-engine/ui/LayerPanel';
import PropertyPanel from '@drawing-engine/ui/PropertyPanel';
import ManualDimensionInput from '@drawing-engine/ui/ManualDimensionInput';
import StatsPanel from './layout/StatsPanel';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import ProjectSetupModal from '@georef-engine/ui/ProjectSetupModal';
import ConfirmDialog from '@shared-ui/ConfirmDialog';
import ToastStack from '@shared-ui/ToastStack';
import SaveProjectModal from '@persistence-engine/ui/SaveProjectModal';
import OpenProjectModal from '@persistence-engine/ui/OpenProjectModal';
import LabelConfigModal from '@label-engine/ui/LabelConfigModal';
import AttributeTablePanel from '@attributes-engine/ui/AttributeTablePanel';
import { LayoutWorkspaceView } from '@layout-engine';
import { useUiShellStore } from './store/uiShellStore';

function App() {
  useKeyboardShortcuts();
  const workspaceView = useUiShellStore((s) => s.workspaceView);

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Vista de Mapa / Diseñador (siempre montada para conservar el estado de OpenLayers) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          top: 'var(--cad-topbar-height)',
          bottom: 'var(--cad-statusbar-height)',
          visibility: workspaceView === 'map' ? 'visible' : 'hidden',
          pointerEvents: workspaceView === 'map' ? 'auto' : 'none',
        }}
      >
        <MapView />
      </div>

      {/* Vista nativa de Layout Cartográfico (estilo ArcGIS Pro / Rust GIS) */}
      {workspaceView === 'layout' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            top: 'var(--cad-topbar-height)',
            bottom: 'var(--cad-statusbar-height)',
            zIndex: 15,
          }}
        >
          <LayoutWorkspaceView />
        </div>
      )}

      <TopBar />

      {/* Herramientas y paneles flotantes exclusivos del Mapa / Diseñador */}
      <div style={{ display: workspaceView === 'map' ? 'contents' : 'none' }}>
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
        <LayerPanel />
        <ManualDimensionInput />
        <AttributeTablePanel />
      </div>

      <ProjectSetupModal />
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
