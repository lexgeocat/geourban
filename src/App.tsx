import React from 'react';
import MapView from './map/Map';
import LayerPanel from './components/LayerPanel';
import Toolbar from './components/Toolbar';
import TopBar from './components/TopBar';
import StatusBar from './components/StatusBar';

function App() {
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
        {/* Toolbar and LayerPanel need pointer events */}
        <div style={{ pointerEvents: 'auto' }}>
          <Toolbar />
        </div>
        <div style={{ pointerEvents: 'auto' }}>
          <LayerPanel />
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

export default App;
