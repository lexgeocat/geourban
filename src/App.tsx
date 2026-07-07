import React from 'react';
import MapView from './map/Map';
import LayerPanel from './components/LayerPanel';

function App() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-100 p-4 overflow-y-auto border-r">
        <h2 className="text-lg font-semibold mb-4">Capas</h2>
        <LayerPanel />
      </aside>
      {/* Main map area */}
      <main className="flex-1">
        <MapView />
      </main>
    </div>
  );
}

export default App;
