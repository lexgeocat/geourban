import ReactDOM from 'react-dom/client';
import { enableMapSet } from 'immer';
import App from './App';
import './index.css';
import './geo/customProjections';

// Immer necesita enableMapSet() para poder mutar Sets/Maps dentro de
// producers. selectionStore guarda selectedIds como Set<string|number>;
// sin esto, add()/remove() explotan en runtime con
// "The plugin for 'MapSet' has not been loaded into Immer".
enableMapSet();

// Nota: StrictMode monta/desmonta/remonta los efectos a proposito en dev.
// OpenLayers con capas WebGL (WebGLVectorLayer) no tolera bien ese doble
// ciclo: corrompe el contexto WebGL y produce crashes intermitentes de
// hit-detection (forEachFeatureAtCoordinate). Se retira para este proyecto.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
);
