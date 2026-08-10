// ─────────────────────────────────────────────────────────────────────────
// NOTA ARQUITECTÓNICA — CONTADOR GLOBAL MUTABLE (Fase 6.3 del plan)
//
// Este módulo usa una variable de módulo mutable (`let nextSeq = 0`)
// en vez de vivir dentro de un store Zustand. Esto es **intencional**
// y rompe el patrón del resto de la app (todo el estado mutable vive
// en stores Zustand: `useMapStore`, `useDrawStore`, `useLayersStore`,
// `useStreetStore`, `useRoundaboutStore`, etc.).
//
// ¿Por qué no está en un store? El contador `nextSeq` se lee y
// muta desde `recomputeManzanos.ts`, que corre dentro de un Web Worker
// (`@kernel/native/geoWorkerClient`). Los stores Zustand están
// acoplados al ciclo de vida del thread principal de React y **no
// son accesibles** desde el worker. Usar un módulo plano (que se
// importa en el bundle del worker) es la forma estándar de mantener
// estado compartido entre el thread principal y los workers.
//
// El estado se resetea explícitamente en los puntos correctos:
//   - `resetManzanoSeq()` — al iniciar un proyecto nuevo
//     (`useTopBarActions.ts:37`).
//   - `reseedManzanoSeqFromSource(src)` — al cargar un proyecto
//     guardado (`projectFile.ts:249`), basándose en el `mznSeq`
//     máximo de las features existentes.
//
// Riesgo de patrón inconsistente: si alguien refactoriza este módulo
// para mover el contador a un store Zustand **sin darse cuenta** de
// que se usa desde el worker, el contador quedará desincronizado
// silenciosamente (los nuevos manzanos empezarán desde `A` cada vez,
// pisando códigos existentes). Antes de cualquier refactor acá,
// verificar que el callsite en `recomputeManzanos.ts:922,970` sigue
// funcionando con la nueva implementación.
// ─────────────────────────────────────────────────────────────────────────

import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { getFeatureKind } from '@kernel/domain-model/featureModel';
import { autoLetterCode } from '@kernel/id/autoName';

let nextSeq = 0;

export function nextManzanoSeq(): number {
  return nextSeq++;
}

export function resetManzanoSeq(): void {
  nextSeq = 0;
}

export function reseedManzanoSeqFromSource(src: VectorSource): void {
  let max = -1;
  src.forEachFeature((f) => {
    const feature = f as Feature<Geometry>;
    if (getFeatureKind(feature) !== 'manzana') return;
    const seq = feature.get('mznSeq') as number | undefined;
    if (typeof seq === 'number' && seq > max) max = seq;
  });
  nextSeq = max + 1;
}

export function manzanoCodeFromSeq(seq: number | undefined): string {
  return typeof seq === 'number' ? autoLetterCode(seq) : '?';
}
