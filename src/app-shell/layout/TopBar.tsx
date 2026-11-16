import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Wand2,
  Layers,
  FilePlus2,
  FolderOpen,
  Save,
  Printer,
  Undo2,
  Redo2,
  Minus,
  Square,
  Copy,
  X,
  FolderKanban,
} from 'lucide-react';
import { useDrawStore } from '@map-core/store/drawStore';
import { useUiShellStore, type RibbonTabId } from '../store/uiShellStore';
import { useTopBarActions } from '../hooks/useTopBarActions';
import { useProjectFileStore } from '@persistence-engine/store/projectFileStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { undo, redo, useCommandStack } from '@kernel/command/CommandStack';
import AppMenu from './topbar/AppMenu';
import { RibbonContext } from './topbar/RibbonContext';
import UrbanDesignTab from './topbar/ribbon/UrbanDesignTab';
import EditTab from './topbar/ribbon/EditTab';
import ViewTab from './topbar/ribbon/ViewTab';

const RIBBON_TABS: { id: RibbonTabId; label: string; icon: React.ReactNode }[] = [
  { id: 'map', label: 'Diseño Urbanístico', icon: <Compass size={13} color="#FF6B4A" /> },
  { id: 'edit', label: 'Edición Geométrica', icon: <Wand2 size={13} color="#A78BFA" /> },
  { id: 'view', label: 'Cartografía y Vista', icon: <Layers size={13} color="#38BDF8" /> },
];

export default function TopBar() {
  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);

  const activeTab = useUiShellStore((s) => s.activeTab);
  const setActiveTab = useUiShellStore((s) => s.setActiveTab);
  const ribbonCollapsed = useUiShellStore((s) => s.ribbonCollapsed);
  const setRibbonCollapsed = useUiShellStore((s) => s.setRibbonCollapsed);

  const currentProjectName = useProjectFileStore((s) => s.currentName);
  const layerCount = useLayersStore((s) => s.layers.length);
  const streetCount = useStreetStore((s) => s.streets.length);
  const canUndo = useCommandStack((s) => s.canUndo);
  const canRedo = useCommandStack((s) => s.canRedo);

  const actions = useTopBarActions();

  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [isMaximized, setIsMaximized] = useState(true);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.ribbonCollapsed = String(ribbonCollapsed);
  }, [ribbonCollapsed]);

  useEffect(() => {
    const isNative = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!isNative) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        setIsMaximized(await win.isMaximized());
        unlisten = await win.onResized(async () => {
          setIsMaximized(await win.isMaximized());
        });
      } catch {
        // Ignore in browser preview
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!ribbonCollapsed || !popoverPos) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-ribbon-menu]')) return;
      for (const btn of tabRefs.current.values()) {
        if (btn.contains(target)) return;
      }
      setPopoverPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverPos(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ribbonCollapsed, popoverPos]);

  const handleTabClick = (tabId: RibbonTabId) => {
    if (ribbonCollapsed && tabId === activeTab && popoverPos) {
      setPopoverPos(null);
      return;
    }
    setActiveTab(tabId);
    if (ribbonCollapsed) {
      const btn = tabRefs.current.get(tabId);
      const rect = btn?.getBoundingClientRect();
      setPopoverPos(
        rect ? { top: rect.bottom + 6, left: Math.max(4, Math.min(rect.left, window.innerWidth - 240)) } : null,
      );
    } else {
      setPopoverPos(null);
    }
  };

  const handleWindowMinimize = async () => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  };

  const handleWindowToggleMaximize = async () => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await win.toggleMaximize();
    setIsMaximized(await win.isMaximized());
  };

  const handleWindowClose = () => {
    void actions.handleExit();
  };

  const renderTabContent = (tabId: RibbonTabId) => {
    if (tabId === 'map') {
      return <UrbanDesignTab />;
    }
    if (tabId === 'edit') {
      return <EditTab onDeleteSelected={actions.handleDeleteSelected} />;
    }
    return <ViewTab />;
  };

  const activeLabel = RIBBON_TABS.find((t) => t.id === activeTab)?.label ?? '';

  return (
    <div className="topbar-root">
      <div className="topbar-tabs" data-tauri-drag-region>
        <AppMenu
          actions={{
            onNewProject: actions.handleNewProject,
            onSaveProject: actions.handleSaveProject,
            onOpenProject: actions.handleOpenProject,
            onOpenLayout: () => useUiShellStore.getState().setLayoutModalOpen(true),
            onAbout: actions.handleAbout,
            onExit: actions.handleExit,
          }}
        />

        {/* Quick Access Toolbar Capsule */}
        <div className="topbar-qat" role="toolbar" aria-label="Acciones rápidas">
          <button
            type="button"
            className="topbar-qat-btn"
            onClick={actions.handleNewProject}
            title="Nuevo proyecto (Ctrl+N)"
            aria-label="Nuevo proyecto"
          >
            <FilePlus2 size={13} color="#34D399" />
          </button>
          <button
            type="button"
            className="topbar-qat-btn"
            onClick={actions.handleOpenProject}
            title="Abrir proyecto (Ctrl+O)"
            aria-label="Abrir proyecto"
          >
            <FolderOpen size={13} color="#FBBF24" />
          </button>
          <button
            type="button"
            className="topbar-qat-btn"
            onClick={actions.handleSaveProject}
            title="Guardar proyecto (Ctrl+S)"
            aria-label="Guardar proyecto"
          >
            <Save size={13} color="#38BDF8" />
          </button>
          <button
            type="button"
            className="topbar-qat-btn"
            onClick={() => useUiShellStore.getState().setLayoutModalOpen(true)}
            title="Generar Layout Cartográfico (Ctrl+P)"
            aria-label="Generar Layout Cartográfico"
          >
            <Printer size={13} color="#FF6B4A" />
          </button>
          <span className="topbar-qat-sep" aria-hidden="true" />
          <button
            type="button"
            className="topbar-qat-btn"
            onClick={undo}
            disabled={!canUndo}
            title="Deshacer (Ctrl+Z)"
            aria-label="Deshacer"
          >
            <Undo2 size={13} color="#818CF8" />
          </button>
          <button
            type="button"
            className="topbar-qat-btn"
            onClick={redo}
            disabled={!canRedo}
            title="Rehacer (Ctrl+Y)"
            aria-label="Rehacer"
          >
            <Redo2 size={13} color="#C084FC" />
          </button>
        </div>

        {/* Segmented Workspace Switcher */}
        <div className="topbar-tab-list" role="tablist" aria-label="Módulos de estudio">
          {RIBBON_TABS.map((tab) => (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              className={`topbar-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => handleTabClick(tab.id)}
              aria-haspopup="menu"
              aria-expanded={ribbonCollapsed && activeTab === tab.id && !!popoverPos}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Center Draggable Window Titlebar & Project Telemetry */}
        <div
          className="topbar-drag-center"
          data-tauri-drag-region
          onDoubleClick={() => void handleWindowToggleMaximize()}
        >
          <button
            type="button"
            className="topbar-project-pill"
            onClick={actions.handleOpenProject}
            title="Click para abrir o cambiar de proyecto"
          >
            <FolderKanban size={12} color="#FF6B4A" />
            <span className="topbar-project-name">
              {currentProjectName ?? 'Proyecto sin guardar'}
            </span>
            <span className="topbar-project-meta">
              {layerCount} {layerCount === 1 ? 'capa' : 'capas'} · {streetCount} {streetCount === 1 ? 'vía' : 'vías'}
            </span>
          </button>
        </div>

        {/* Right Controls: Ribbon Collapse + Integrated Window Controls */}
        <div className="topbar-right-controls">
          <button
            className="topbar-collapse-btn"
            onClick={() => {
              setRibbonCollapsed(!ribbonCollapsed);
              setPopoverPos(null);
            }}
            data-tooltip={ribbonCollapsed ? 'Expandir barra de estudio' : 'Contraer barra de estudio'}
            aria-label={ribbonCollapsed ? 'Expandir barra de estudio' : 'Contraer barra de estudio'}
            title={ribbonCollapsed ? 'Expandir barra de estudio' : 'Contraer barra de estudio'}
          >
            {ribbonCollapsed ? <ChevronDown /> : <ChevronUp />}
          </button>

          <div className="topbar-window-controls" aria-label="Controles de ventana">
            <button
              type="button"
              className="topbar-win-btn"
              onClick={() => void handleWindowMinimize()}
              title="Minimizar ventana"
              aria-label="Minimizar ventana"
            >
              <Minus size={13} />
            </button>
            <button
              type="button"
              className="topbar-win-btn"
              onClick={() => void handleWindowToggleMaximize()}
              title={isMaximized ? 'Restaurar tamaño' : 'Maximizar ventana'}
              aria-label={isMaximized ? 'Restaurar tamaño' : 'Maximizar ventana'}
            >
              {isMaximized ? <Copy size={11} /> : <Square size={11} />}
            </button>
            <button
              type="button"
              className="topbar-win-btn close"
              onClick={handleWindowClose}
              title="Cerrar GeoUrban Studio"
              aria-label="Cerrar GeoUrban Studio"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      {!ribbonCollapsed && (
        <RibbonContext.Provider value={{ currentMode: mode, setMode }}>
          <div className="topbar-ribbon">{renderTabContent(activeTab)}</div>
        </RibbonContext.Provider>
      )}

      {ribbonCollapsed &&
        popoverPos &&
        activeTab &&
        createPortal(
          <RibbonContext.Provider value={{ currentMode: mode, setMode }}>
            <div
              ref={popoverRef}
              role="menu"
              aria-label={`Herramientas de ${activeLabel}`}
              className="ribbon-popover cad-panel-glass animate-fade-in"
              style={{ top: popoverPos.top, left: popoverPos.left }}
            >
              <div className="ribbon-popover-title">{activeLabel}</div>
              {renderTabContent(activeTab)}
            </div>
          </RibbonContext.Provider>,
          document.body,
        )}
    </div>
  );
}
