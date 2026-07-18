import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import GeoJSON from 'ol/format/GeoJSON.js';
import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext, getCommandContext } from './Command';
import { useHistoryStore } from '../store/historyStore';
import { useMapStore } from '../store/mapStore';
import { useSelectionStore } from '../store/selectionStore';
import { refreshSourceMetrics } from '../geo/metrics';
import { ClearFeaturesCommand } from './ClearFeaturesCommand';
import { AddFeaturesCommand } from './AddFeaturesCommand';

const geoJsonFormat = new GeoJSON();

type RunResult =
  | { ok: true; command: Command }
  | { ok: false; error: string };

type CommandStackState = {
  /** Último comando ejecutado (para coalescing). */
  lastCommandLabel: string | null;
  lastCommandAt: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Ejecuta un comando. Único punto de entrada para mutar drawSource. */
  run: (command: Command) => Promise<RunResult>;
  undo: () => boolean;
  redo: () => boolean;
  clear: () => void;
  /** Sólo refresca canUndo/canRedo leyendo de historyStore. */
  refresh: () => void;
};

const COALESCE_WINDOW_MS = 250;

export const useCommandStack = create<CommandStackState>()(
  immer((set, get) => ({
    lastCommandLabel: null,
    lastCommandAt: 0,
    canUndo: false,
    canRedo: false,

    run: async (command) => {
      const ctx = getCommandContext();
      if (!ctx) return { ok: false, error: 'drawSource no inicializado' };

      const now = Date.now();
      const within = now - get().lastCommandAt < COALESCE_WINDOW_MS;
      const skipSnapshot = within && get().lastCommandLabel === (command.coalesceKey ?? command.label);

      try {
        await command.execute(ctx);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      if (!skipSnapshot) {
        useHistoryStore.getState().pushState(ctx.drawSource.getFeatures());
      }

      set((s) => {
        s.lastCommandLabel = command.coalesceKey ?? command.label;
        s.lastCommandAt = now;
        s.canUndo = useHistoryStore.getState().canUndo;
        s.canRedo = useHistoryStore.getState().canRedo;
      });
      return { ok: true, command };
    },

    undo: () => {
      const hist = useHistoryStore.getState();
      // Snapshot "anterior" es el que queremos restaurar.
      const restored = hist.undo();
      if (!restored) {
        get().refresh();
        return false;
      }
      const ctx = getCommandContext();
      if (ctx) {
        applyRestoredSnapshot(ctx.drawSource, restored);
      }
      set((s) => {
        s.canUndo = useHistoryStore.getState().canUndo;
        s.canRedo = useHistoryStore.getState().canRedo;
        s.lastCommandLabel = null;
        s.lastCommandAt = 0;
      });
      return true;
    },

    redo: () => {
      const hist = useHistoryStore.getState();
      const restored = hist.redo();
      if (!restored) {
        get().refresh();
        return false;
      }
      const ctx = getCommandContext();
      if (ctx) {
        applyRestoredSnapshot(ctx.drawSource, restored);
      }
      set((s) => {
        s.canUndo = useHistoryStore.getState().canUndo;
        s.canRedo = useHistoryStore.getState().canRedo;
        s.lastCommandLabel = null;
        s.lastCommandAt = 0;
      });
      return true;
    },

    clear: () => {
      useHistoryStore.getState().clear();
      set((s) => {
        s.lastCommandLabel = null;
        s.lastCommandAt = 0;
        s.canUndo = false;
        s.canRedo = false;
      });
    },

    refresh: () => {
      set((s) => {
        s.canUndo = useHistoryStore.getState().canUndo;
        s.canRedo = useHistoryStore.getState().canRedo;
      });
    },
  })),
);

function applyRestoredSnapshot(
  drawSource: VectorSource,
  geojson: object[],
) {
  const features = geoJsonFormat.readFeatures(
    { type: 'FeatureCollection', features: geojson as never },
    { featureProjection: 'EPSG:3857' },
  ) as Feature<Geometry>[];
  const commandStack = useCommandStack.getState();
  commandStack.run(new ClearFeaturesCommand());
  commandStack.run(new AddFeaturesCommand(features));
  drawSource.changed();
  refreshSourceMetrics(drawSource);
  useSelectionStore.getState().clear();
  useMapStore.getState().restoreDrawFeatures({ type: 'FeatureCollection', features: geojson });
}

// ─── Helpers exportados ─────────────────────────────────────────────────

/** API imperativa para casos donde se quiere `await` directamente. */
export async function runCommand(command: Command): Promise<RunResult> {
  return useCommandStack.getState().run(command);
}

export function undo(): boolean {
  return useCommandStack.getState().undo();
}

export function redo(): boolean {
  return useCommandStack.getState().redo();
}

export { type CommandContext };
