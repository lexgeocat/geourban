import ReactDOM from 'react-dom/client';
import { enableMapSet } from 'immer';
import App from './App';
import './index.css';
import './geo/customProjections';
enableMapSet();
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
);
