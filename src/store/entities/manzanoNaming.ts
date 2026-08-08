import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { getFeatureKind } from '../../core/objectModel';
import { autoLetterCode } from '../../lib/autoName';

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
