import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './geo/customProjections';

// Nota: StrictMode monta/desmonta/remonta los efectos a proposito en dev.
// OpenLayers con capas WebGL (WebGLVectorLayer) no tolera bien ese doble
// ciclo: corrompe el contexto WebGL y produce crashes intermitentes de
// hit-detection (forEachFeatureAtCoordinate). Se retira para este proyecto.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
);
