import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FilePlus, FolderOpen, Save, LogOut, Info } from 'lucide-react';

export interface AppMenuActions {
  onNewProject: () => void;
  onSaveProject: () => void;
  onOpenProject: () => void;
  onAbout: () => void;
  onExit: () => void;
}

export default function AppMenu({ actions }: { actions: AppMenuActions }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (ref.current && !ref.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
    setOpen((v) => !v);
  };

  const runAndClose = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'center' }}>
      <button
        className={`topbar-app-menu ${open ? 'open' : ''}`}
        onClick={toggle}
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

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="app-menu-panel cad-panel-glass animate-fade-in"
            role="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 'var(--z-dropdown)' }}
          >
            <button role="menuitem" className="app-menu-item" onClick={() => runAndClose(actions.onNewProject)}>
              <FilePlus />
              <span>Nuevo proyecto</span>
              <span className="app-menu-shortcut">Ctrl+N</span>
            </button>
            <button role="menuitem" className="app-menu-item" onClick={() => runAndClose(actions.onOpenProject)}>
              <FolderOpen />
              <span>Abrir proyecto…</span>
              <span className="app-menu-shortcut">Ctrl+O</span>
            </button>
            <button role="menuitem" className="app-menu-item" onClick={() => runAndClose(actions.onSaveProject)}>
              <Save />
              <span>Guardar proyecto…</span>
              <span className="app-menu-shortcut">Ctrl+S</span>
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
          </div>,
          document.body,
        )}
    </div>
  );
}