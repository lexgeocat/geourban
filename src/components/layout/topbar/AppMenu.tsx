import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Save, Download, FilePlus, LogOut, Info, ChevronRight } from 'lucide-react';
import type { ExportFormat } from '../../../io';

export interface AppMenuActions {
  onNewProject: () => void;
  onImportClick: () => void;
  onOpenProjectBrowser: () => void;
  onSave: () => void;
  onExport: (format: ExportFormat) => void;
  onAbout: () => void;
  onExit: () => void;
}

const EXPORT_OPTIONS: Array<{ fmt: ExportFormat; label: string }> = [
  { fmt: 'geourban', label: 'GeoUrban (.geourban)' },
  { fmt: 'geojson', label: 'GeoJSON (.geojson)' },
  { fmt: 'kml', label: 'KML (.kml)' },
  { fmt: 'kmz', label: 'KMZ (.kmz)' },
  { fmt: 'shp', label: 'Shapefile (.shp)' },
  { fmt: 'gpkg', label: 'GeoPackage (.gpkg)' },
  { fmt: 'dxf', label: 'DXF (.dxf)' },
  { fmt: 'png', label: 'PNG (.png)' },
  { fmt: 'svg', label: 'SVG (.svg)' },
];

export default function AppMenu({ actions }: { actions: AppMenuActions }) {
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const runAndClose = (fn: () => void) => {
    setOpen(false);
    setExportOpen(false);
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

          <button role="menuitem" className="app-menu-item" onClick={() => runAndClose(actions.onImportClick)}>
            <FolderOpen />
            <span>Importar…</span>
            <span className="app-menu-shortcut">Ctrl+O</span>
          </button>

          <button role="menuitem" className="app-menu-item" onClick={() => runAndClose(actions.onOpenProjectBrowser)}>
            <FolderOpen />
            <span>Abrir proyecto…</span>
          </button>

          <button role="menuitem" className="app-menu-item" onClick={() => runAndClose(actions.onSave)}>
            <Save />
            <span>Guardar</span>
            <span className="app-menu-shortcut">Ctrl+S</span>
          </button>

          <div
            className="app-menu-item has-submenu"
            onMouseEnter={() => setExportOpen(true)}
            onMouseLeave={() => setExportOpen(false)}
          >
            <Download />
            <span>Exportar</span>
            <ChevronRight className="app-menu-caret" />
            {exportOpen && (
              <div className="app-menu-submenu">
                {EXPORT_OPTIONS.map((o) => (
                  <button
                    key={o.fmt}
                    role="menuitem"
                    className="app-menu-item"
                    onClick={() => runAndClose(() => actions.onExport(o.fmt))}
                  >
                    <span style={{ width: 14 }} />
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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