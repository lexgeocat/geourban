import React from 'react';
import { ChevronUp } from 'lucide-react';
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
            className={`topbar-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(tab.id);
              if (ribbonCollapsed) setRibbonCollapsed(false);
            }}
          >
            {tab.label}
          </button>
        ))}
        <div className="topbar-tab-spacer" />
        <button
          className={`topbar-collapse-btn ${ribbonCollapsed ? 'collapsed' : ''}`}
          onClick={() => setRibbonCollapsed(!ribbonCollapsed)}
          data-tooltip={ribbonCollapsed ? 'Expandir cinta' : 'Contraer cinta'}
          aria-label={ribbonCollapsed ? 'Expandir cinta' : 'Contraer cinta'}
          title={ribbonCollapsed ? 'Expandir cinta' : 'Contraer cinta'}
        >
          <ChevronUp />
        </button>
      </div>

      {!ribbonCollapsed && (
        <RibbonContext.Provider value={{ currentMode: mode, setMode }}>
          <div className="topbar-ribbon">
            {activeTab === 'map' && (
              <UrbanDesignTab
                lotsBusy={actions.lotsBusy}
                onOpenSubdivision={actions.handleOpenSubdivision}
                onGenerateLots={actions.handleGenerateLots}
              />
            )}
            {activeTab === 'edit' && (
              <EditTab onDeleteSelected={actions.handleDeleteSelected} />
            )}
            {activeTab === 'view' && <ViewTab />}
          </div>
        </RibbonContext.Provider>
      )}
    </div>
  );
}