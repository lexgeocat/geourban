import React, { useRef } from 'react';
import { ChevronUp } from 'lucide-react';
import { useDrawStore } from '../../store/map/drawStore';
import { useUiShellStore, type RibbonTabId } from '../../store/ui/uiShellStore';
import { useCurrentProjectStore } from '../../store/project/currentProjectStore';
import { ProjectBrowserModal } from '../modals/ProjectBrowserModal';
import { useTopBarActions } from '../../hooks/useTopBarActions';
import AppMenu from './topbar/AppMenu';
import { RibbonContext } from './topbar/RibbonContext';
import MapTab from './topbar/ribbon/MapTab';
import EditTab from './topbar/ribbon/EditTab';
import InsertTab from './topbar/ribbon/InsertTab';
import ViewTab from './topbar/ribbon/ViewTab';

const RIBBON_TABS: { id: RibbonTabId; label: string }[] = [
  { id: 'map', label: 'Mapa' },
  { id: 'edit', label: 'Editar' },
  { id: 'insert', label: 'Insertar' },
  { id: 'view', label: 'Vista' },
];

const IMPORT_ACCEPT = '.geourban,.geojson,.json,.kml,.kmz,.shp,.gpkg,.dxf';

export default function TopBar() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);

  const activeTab = useUiShellStore((s) => s.activeTab);
  const setActiveTab = useUiShellStore((s) => s.setActiveTab);
  const ribbonCollapsed = useUiShellStore((s) => s.ribbonCollapsed);
  const setRibbonCollapsed = useUiShellStore((s) => s.setRibbonCollapsed);

  const currentProjectId = useCurrentProjectStore((s) => s.currentProjectId);

  const actions = useTopBarActions(fileInputRef);

  return (
    <>
      <div className="topbar-root">
        <input ref={fileInputRef} type="file" accept={IMPORT_ACCEPT} hidden onChange={actions.handleImport} />

        <div className="topbar-tabs">
          <AppMenu
            actions={{
              onNewProject: actions.handleNewProject,
              onImportClick: actions.handleImportClick,
              onOpenProjectBrowser: () => actions.setProjectBrowserOpen(true),
              onSave: actions.handleSave,
              onExport: actions.handleExport,
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
                <MapTab
                  lotsBusy={actions.lotsBusy}
                  onToggleEdit={actions.handleToggleEdit}
                  onDeleteSelected={actions.handleDeleteSelected}
                  onOpenSubdivision={actions.handleOpenSubdivision}
                  onGenerateLots={actions.handleGenerateLots}
                />
              )}
              {activeTab === 'edit' && (
                <EditTab
                  onToggleEdit={actions.handleToggleEdit}
                  onDeleteSelected={actions.handleDeleteSelected}
                  onFindOverlaps={actions.handleFindOverlaps}
                  onFindGaps={actions.handleFindGaps}
                />
              )}
              {activeTab === 'insert' && (
                <InsertTab
                  lotsBusy={actions.lotsBusy}
                  onOpenSubdivision={actions.handleOpenSubdivision}
                  onGenerateLots={actions.handleGenerateLots}
                />
              )}
              {activeTab === 'view' && <ViewTab />}
            </div>
          </RibbonContext.Provider>
        )}
      </div>

      <ProjectBrowserModal
        isOpen={actions.projectBrowserOpen}
        onClose={() => actions.setProjectBrowserOpen(false)}
        onOpenProject={actions.handleProjectOpen}
        onNewProject={actions.handleNewProject}
        currentProjectId={currentProjectId}
      />
    </>
  );
}