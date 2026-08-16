import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useDrawStore } from '@map-core/store/drawStore';
import { useUiShellStore, type RibbonTabId } from '../store/uiShellStore';
import { useTopBarActions } from '../hooks/useTopBarActions';
import AppMenu from './topbar/AppMenu';
import { RibbonContext } from './topbar/RibbonContext';
import UrbanDesignTab from './topbar/ribbon/UrbanDesignTab';
import EditTab from './topbar/ribbon/EditTab';
import ViewTab from './topbar/ribbon/ViewTab';

const RIBBON_TABS: { id: RibbonTabId; label: string }[] = [
  { id: 'map', label: 'Diseño Urbanístico' },
  { id: 'edit', label: 'Editar' },
  { id: 'view', label: 'Vista' },
];

export default function TopBar() {
  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);

  const activeTab = useUiShellStore((s) => s.activeTab);
  const setActiveTab = useUiShellStore((s) => s.setActiveTab);
  const ribbonCollapsed = useUiShellStore((s) => s.ribbonCollapsed);
  const setRibbonCollapsed = useUiShellStore((s) => s.setRibbonCollapsed);

  const actions = useTopBarActions();

  /* Popover de tab contraído: posición anclada bajo el tab activo */
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.ribbonCollapsed = String(ribbonCollapsed);
  }, [ribbonCollapsed]);

  useEffect(() => {
    if (!ribbonCollapsed || !popoverPos) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      /* Menús desplegables portaleados (RibbonToolDropdown) viven en <body>:
         un clic en ellos no debe cerrar el popover antes de completar la selección */
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
        rect ? { top: rect.bottom + 4, left: Math.max(4, Math.min(rect.left, window.innerWidth - 240)) } : null,
      );
    } else {
      setPopoverPos(null);
    }
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
      <div className="topbar-tabs">
        <AppMenu
          actions={{
            onNewProject: actions.handleNewProject,
            onSaveProject: actions.handleSaveProject,
            onOpenProject: actions.handleOpenProject,
            onAbout: actions.handleAbout,
            onExit: actions.handleExit,
          }}
        />

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
            {tab.label}
          </button>
        ))}
        <div className="topbar-tab-spacer" />
        <button
          className="topbar-collapse-btn"
          onClick={() => {
            setRibbonCollapsed(!ribbonCollapsed);
            setPopoverPos(null);
          }}
          data-tooltip={ribbonCollapsed ? 'Expandir cinta' : 'Contraer cinta'}
          aria-label={ribbonCollapsed ? 'Expandir cinta' : 'Contraer cinta'}
          title={ribbonCollapsed ? 'Expandir cinta' : 'Contraer cinta'}
        >
          {ribbonCollapsed ? <ChevronDown /> : <ChevronUp />}
        </button>
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
