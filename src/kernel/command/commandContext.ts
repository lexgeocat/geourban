import type VectorSource from 'ol/source/Vector.js';
import type Map from 'ol/Map.js';

export interface CommandContext {
  drawSource: VectorSource;
  getMap: () => Map | null;
}

let _ctx: CommandContext | null = null;

export function setDrawContext(ctx: CommandContext): void {
  _ctx = ctx;
}

export function clearDrawContext(): void {
  _ctx = null;
}

export function getCommandContext(): CommandContext | null {
  return _ctx;
}
