import ReactDOM from 'react-dom/client';
import { enableMapSet } from 'immer';
import { registerViasExtensions } from '@vias-engine/registerViasExtensions';
import App from '@app-shell/App';
import './index.css';

enableMapSet();
registerViasExtensions();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
);
