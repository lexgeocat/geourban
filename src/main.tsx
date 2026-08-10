import ReactDOM from 'react-dom/client';
import { enableMapSet } from 'immer';
import App from '@app-shell/App';
import './index.css';
enableMapSet();
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
);
