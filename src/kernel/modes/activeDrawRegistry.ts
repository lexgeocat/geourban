import type Draw from 'ol/interaction/Draw.js';

let currentDrawRef: { current: Draw | null } | null = null;

export function registerActiveDrawRef(ref: { current: Draw | null }): void {
  currentDrawRef = ref;
}

export function getActiveDraw(): Draw | null {
  return currentDrawRef?.current ?? null;
}
