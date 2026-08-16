import { Style } from 'ol/style.js';
import type Map from 'ol/Map.js';
import { createLiveDrawingLabelStyle } from './styleFactory';
import { projectPathToMetricPlane } from '@georef-engine/metrics';

const LABEL_PX_OFFSET = 14;
const MIN_LABEL_LEN_MAP_UNITS = 0.3;
const MIN_LABEL_LEN_M = 0.3;

export function buildSegmentLiveLabels(map: Map, sketchCoords: number[][]): Style[] {
  if (sketchCoords.length < 2) return [];
  const labels: Style[] = [];
  const skRes = map.getView().getResolution() ?? 1;
  const totalSegments = sketchCoords.length - 1;

  for (let i = 0; i < sketchCoords.length - 1; i++) {
    const a = sketchCoords[i];
    const b = sketchCoords[i + 1];
    if (!a || !b) continue;
    const sdx = b[0] - a[0];
    const sdy = b[1] - a[1];
    const segLen = Math.hypot(sdx, sdy);
    if (segLen < MIN_LABEL_LEN_MAP_UNITS) continue;

    const [aM, bM] = projectPathToMetricPlane([a, b] as Array<[number, number]>);
    const liveLen = aM && bM ? Math.hypot(bM[0] - aM[0], bM[1] - aM[1]) : 0;
    if (liveLen < MIN_LABEL_LEN_M) continue;

    const midX = (a[0] + b[0]) / 2;
    const midY = (a[1] + b[1]) / 2;
    const angle = Math.atan2(sdy, sdx);
    let textAngle = angle;
    if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
    const perpLen = LABEL_PX_OFFSET * skRes;
    const perpNx = -sdy / segLen;
    const perpNy = sdx / segLen;
    const labelX = midX + perpNx * perpLen;
    const labelY = midY + perpNy * perpLen;

    const isLastSegment = i === totalSegments - 1;
    const label = liveLen >= 100 ? liveLen.toFixed(1) + ' m' : liveLen.toFixed(2) + ' m';

    labels.push(
      createLiveDrawingLabelStyle(label, [labelX, labelY], textAngle, true, isLastSegment)
    );
  }
  return labels;
}
