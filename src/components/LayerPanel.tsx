import React from 'react';
import { useLayerStore } from '../store/layerStore';

type LayerOption = {
  key: 'osm' | 'satellite' | 'polygons';
  label: string;
};

const options: LayerOption[] = [
  { key: 'osm', label: 'OpenStreetMap' },
  { key: 'satellite', label: 'Capa satélite' },
  { key: 'polygons', label: 'Polígonos (10k)' },
];

export default function LayerPanel() {
  const visibility = useLayerStore((s) => s.visibility);
  const setVisibility = useLayerStore((s) => s.setVisibility);

  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label key={opt.key} className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={visibility[opt.key]}
            onChange={(e) => setVisibility(opt.key, e.target.checked)}
            className="form-checkbox h-4 w-4 text-indigo-600"
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}
