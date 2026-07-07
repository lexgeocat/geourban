import React from 'react';
import { useDrawStore } from '../store/drawStore';

export default function Toolbar() {
  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);

  const isActive = (m: typeof mode) => mode === m;

  return (
    <div className="flex space-x-2 p-2 bg-gray-50 border-b">
      <button
        onClick={() => setMode('polygon')}
        className={`px-3 py-1 rounded ${isActive('polygon') ? 'bg-indigo-600 text-white' : 'bg-white border'}`}
      >
        Dibujar Polígono
      </button>
      <button
        onClick={() => setMode('line')}
        className={`px-3 py-1 rounded ${isActive('line') ? 'bg-indigo-600 text-white' : 'bg-white border'}`}
      >
        Dibujar Línea
      </button>
      <button
        onClick={() => setMode('none')}
        className={`px-3 py-1 rounded ${isActive('none') ? 'bg-indigo-600 text-white' : 'bg-white border'}`}
      >
        Parar
      </button>
    </div>
  );
}
