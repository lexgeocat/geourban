import React, { useEffect, useRef, useState } from 'react';
import { FilePlus, LogOut, Info } from 'lucide-react';

export interface AppMenuActions {
  onNewProject: () => void;
  onAbout: () => void;
  onExit: () => void;
}

export default function AppMenu({ actions }: { actions: AppMenuActions }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const runAndClose = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        className={`topbar-app-menu ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú principal"
        title="Menú principal"
      >
        <span>GU</span>
        <svg className="app-menu-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="app-menu-panel cad-panel-glass animate-fade-in" role="menu">
          <button role="menuitem" className="app-menu-item" onClick={() => runAndClose(actions.onNewProject)}>
            <FilePlus />
            <span>Nuevo proyecto</span>
            <span className="app-menu-shortcut">Ctrl+N</span>
          </button>

          <div className="app-menu-divider" />
          <button role="menuitem" className="app-menu-item" onClick={() => runAndClose(actions.onAbout)}>
            <Info />
            <span>Acerca de GeoUrban</span>
          </button>
          <div className="app-menu-divider" />
          <button role="menuitem" className="app-menu-item danger" onClick={() => runAndClose(actions.onExit)}>
            <LogOut />
            <span>Salir</span>
          </button>
        </div>
      )}
    </div>
  );
}