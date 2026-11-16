import type {
  DxfArcEntity,
  DxfBBox,
  DxfCircleEntity,
  DxfEntity,
  DxfHatchEntity,
  DxfLineEntity,
  DxfLwPolylineEntity,
  DxfTextEntity,
} from '../model/dxfTemplateModel';

export interface ParsedDxfRaw {
  bbox: DxfBBox;
  entities: DxfEntity[];
  layerColors: Record<string, number>;
}

/**
 * Repara secuencias UTF-8 leídas erróneamente como ANSI/Latin-1 (común en DXF de AutoCAD)
 * y limpia códigos de formato MTEXT (^I, \P, {\f...;...}, \A1;, etc.).
 */
export function cleanDxfText(raw: string): string {
  let s = raw;
  // Reparar mojibake UTF-8 -> CP1252 común en DXF
  s = s
    .replace(/mÂ²/g, 'm²')
    .replace(/Â²/g, '²')
    .replace(/NÂº/g, 'Nº')
    .replace(/Âº/g, 'º')
    .replace(/Â°/g, '°')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã©/g, 'é')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã±/g, 'ñ')
    .replace(/Ã‘/g, 'Ñ');

  // Reemplazar tabulaciones AutoCAD ^I y saltos \P
  s = s.replace(/\^I/g, ' ').replace(/\\P/gi, ' ').replace(/\\~/g, ' ');

  // Remover códigos de formato MTEXT como \A1; \fArial|b0...; \H1.2x; \W0.8; { }
  s = s.replace(/\\[fFhHwWcCqQtTaAlLoOpP][^;]*;/g, '');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function expandBBox(bbox: DxfBBox, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (x < bbox.minX) bbox.minX = x;
  if (y < bbox.minY) bbox.minY = y;
  if (x > bbox.maxX) bbox.maxX = x;
  if (y > bbox.maxY) bbox.maxY = y;
}

type GroupPair = { code: string; value: string };

function getFirstNum(pairs: GroupPair[], code: string, fallback = 0): number {
  const found = pairs.find((p) => p.code === code);
  if (!found) return fallback;
  const n = Number(found.value);
  return Number.isFinite(n) ? n : fallback;
}

function getFirstStr(pairs: GroupPair[], code: string, fallback = ''): string {
  const found = pairs.find((p) => p.code === code);
  return found ? found.value.trim() : fallback;
}

function parseHatchEntity(id: string, layer: string, colorIndex: number, pairs: GroupPair[]): DxfHatchEntity | null {
  const patternName = getFirstStr(pairs, '2', 'SOLID');
  const solidFlag = Math.round(getFirstNum(pairs, '70', 1)) === 1 || patternName.toUpperCase() === 'SOLID';

  const loops: Array<Array<[number, number]>> = [];
  let idx = 0;

  while (idx < pairs.length) {
    const p = pairs[idx];
    if (p.code === '92') {
      const boundaryType = Math.round(Number(p.value) || 0);
      const isPolyline = (boundaryType & 2) !== 0;
      idx++;
      const loopPts: Array<[number, number]> = [];

      if (isPolyline) {
        let vertexCount = 0;
        while (idx < pairs.length && pairs[idx].code !== '93' && pairs[idx].code !== '97' && pairs[idx].code !== '92') {
          idx++;
        }
        if (idx < pairs.length && pairs[idx].code === '93') {
          vertexCount = Math.round(Number(pairs[idx].value) || 0);
          idx++;
        }
        let collected = 0;
        while (idx < pairs.length && collected < vertexCount) {
          if (pairs[idx].code === '10') {
            const vx = Number(pairs[idx].value);
            const vy = idx + 1 < pairs.length && pairs[idx + 1].code === '20' ? Number(pairs[idx + 1].value) : 0;
            if (Number.isFinite(vx) && Number.isFinite(vy)) {
              loopPts.push([vx, vy]);
            }
            collected++;
          }
          idx++;
        }
      } else {
        let edgeCount = 0;
        while (idx < pairs.length && pairs[idx].code !== '93' && pairs[idx].code !== '92') {
          idx++;
        }
        if (idx < pairs.length && pairs[idx].code === '93') {
          edgeCount = Math.round(Number(pairs[idx].value) || 0);
          idx++;
        }
        let edgesRead = 0;
        while (idx < pairs.length && edgesRead < edgeCount) {
          if (pairs[idx].code === '72') {
            const edgeType = Math.round(Number(pairs[idx].value) || 1);
            edgesRead++;
            idx++;
            if (edgeType === 1) {
              let x1 = 0,
                y1 = 0,
                x2 = 0,
                y2 = 0;
              while (idx < pairs.length && !['72', '97', '92', '75', '76'].includes(pairs[idx].code)) {
                const ep = pairs[idx];
                if (ep.code === '10') x1 = Number(ep.value);
                else if (ep.code === '20') y1 = Number(ep.value);
                else if (ep.code === '11') x2 = Number(ep.value);
                else if (ep.code === '21') y2 = Number(ep.value);
                idx++;
              }
              if (loopPts.length === 0) loopPts.push([x1, y1]);
              loopPts.push([x2, y2]);
              continue;
            }
          }
          idx++;
        }
      }
      if (loopPts.length >= 3) {
        loops.push(loopPts);
      }
      continue;
    }
    idx++;
  }

  if (loops.length === 0) return null;
  return {
    id,
    type: 'HATCH',
    layer,
    colorIndex,
    patternName,
    solid: solidFlag,
    loops,
  };
}

export function parseDxfString(dxfText: string): ParsedDxfRaw {
  const rawLines = dxfText.split(/\r?\n/);
  const pairs: GroupPair[] = [];
  for (let i = 0; i + 1 < rawLines.length; i += 2) {
    pairs.push({
      code: rawLines[i].trim(),
      value: rawLines[i + 1] ?? '',
    });
  }

  let currentSection: string | null = null;
  let currentHeaderVar: string | null = null;
  const headerExtMin: [number, number] = [Infinity, Infinity];
  const headerExtMax: [number, number] = [-Infinity, -Infinity];

  const layerColors: Record<string, number> = {};
  let inLayerTable = false;
  let curLayerName: string | null = null;
  let curLayerColor = 7;

  const entities: DxfEntity[] = [];
  let entitySeq = 0;
  let curEntType: string | null = null;
  let curEntPairs: GroupPair[] = [];
  let polylineAccum: Array<[number, number]> | null = null;
  let polylineMeta: { layer: string; colorIndex: number; closed: boolean } | null = null;

  const bbox: DxfBBox = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };

  const flushEntity = () => {
    if (!curEntType) return;
    const type = curEntType;
    const data = curEntPairs;
    curEntType = null;
    curEntPairs = [];

    const layer = getFirstStr(data, '8', '0');
    const colorIndex = Math.round(getFirstNum(data, '62', 256));
    const id = `dxf-ent-${entitySeq++}`;

    if (type === 'LINE') {
      const x1 = getFirstNum(data, '10');
      const y1 = getFirstNum(data, '20');
      const x2 = getFirstNum(data, '11');
      const y2 = getFirstNum(data, '21');
      expandBBox(bbox, x1, y1);
      expandBBox(bbox, x2, y2);
      const ent: DxfLineEntity = { id, type: 'LINE', layer, colorIndex, x1, y1, x2, y2 };
      entities.push(ent);
    } else if (type === 'LWPOLYLINE') {
      const points: Array<[number, number]> = [];
      for (let i = 0; i < data.length; i++) {
        if (data[i].code === '10') {
          const x = Number(data[i].value);
          let y = 0;
          if (i + 1 < data.length && data[i + 1].code === '20') {
            y = Number(data[i + 1].value);
          }
          if (Number.isFinite(x) && Number.isFinite(y)) {
            points.push([x, y]);
            expandBBox(bbox, x, y);
          }
        }
      }
      const flags = Math.round(getFirstNum(data, '70', 0));
      const closed = (flags & 1) === 1;
      if (points.length >= 2) {
        const ent: DxfLwPolylineEntity = { id, type: 'LWPOLYLINE', layer, colorIndex, points, closed };
        entities.push(ent);
      }
    } else if (type === 'POLYLINE') {
      const flags = Math.round(getFirstNum(data, '70', 0));
      polylineAccum = [];
      polylineMeta = { layer, colorIndex, closed: (flags & 1) === 1 };
    } else if (type === 'VERTEX' && polylineAccum) {
      const vx = getFirstNum(data, '10');
      const vy = getFirstNum(data, '20');
      polylineAccum.push([vx, vy]);
      expandBBox(bbox, vx, vy);
    } else if (type === 'SEQEND' && polylineAccum && polylineMeta) {
      if (polylineAccum.length >= 2) {
        const ent: DxfLwPolylineEntity = {
          id,
          type: 'LWPOLYLINE',
          layer: polylineMeta.layer,
          colorIndex: polylineMeta.colorIndex,
          points: polylineAccum,
          closed: polylineMeta.closed,
        };
        entities.push(ent);
      }
      polylineAccum = null;
      polylineMeta = null;
    } else if (type === 'CIRCLE') {
      const cx = getFirstNum(data, '10');
      const cy = getFirstNum(data, '20');
      const radius = getFirstNum(data, '40');
      expandBBox(bbox, cx - radius, cy - radius);
      expandBBox(bbox, cx + radius, cy + radius);
      const ent: DxfCircleEntity = { id, type: 'CIRCLE', layer, colorIndex, cx, cy, radius };
      entities.push(ent);
    } else if (type === 'ARC') {
      const cx = getFirstNum(data, '10');
      const cy = getFirstNum(data, '20');
      const radius = getFirstNum(data, '40');
      const startAngleDeg = getFirstNum(data, '50', 0);
      const endAngleDeg = getFirstNum(data, '51', 360);
      expandBBox(bbox, cx - radius, cy - radius);
      expandBBox(bbox, cx + radius, cy + radius);
      const ent: DxfArcEntity = {
        id,
        type: 'ARC',
        layer,
        colorIndex,
        cx,
        cy,
        radius,
        startAngleDeg,
        endAngleDeg,
      };
      entities.push(ent);
    } else if (type === 'TEXT' || type === 'MTEXT') {
      const x = getFirstNum(data, '10');
      const y = getFirstNum(data, '20');
      const height = Math.max(0.1, getFirstNum(data, '40', 0.35));
      const rotationDeg = getFirstNum(data, '50', 0);
      const rawText = data
        .filter((p) => p.code === '3' || p.code === '1')
        .map((p) => p.value)
        .join('');
      const text = cleanDxfText(rawText);
      expandBBox(bbox, x, y);
      if (text.length > 0) {
        const ent: DxfTextEntity = { id, type, layer, colorIndex, x, y, height, rotationDeg, text };
        entities.push(ent);
      }
    } else if (type === 'HATCH') {
      const hatch = parseHatchEntity(id, layer, colorIndex, data);
      if (hatch) {
        for (const loop of hatch.loops) {
          for (const pt of loop) {
            expandBBox(bbox, pt[0], pt[1]);
          }
        }
        entities.push(hatch);
      }
    }
  };

  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    const trimmedVal = value.trim();

    if (code === '0' && trimmedVal === 'SECTION') {
      const next = pairs[i + 1];
      if (next && next.code === '2') {
        currentSection = next.value.trim();
        i++;
      }
      continue;
    }

    if (code === '0' && trimmedVal === 'ENDSEC') {
      if (currentSection === 'ENTITIES') {
        flushEntity();
      }
      currentSection = null;
      inLayerTable = false;
      continue;
    }

    if (currentSection === 'HEADER') {
      if (code === '9') {
        currentHeaderVar = trimmedVal;
      } else if (currentHeaderVar === '$EXTMIN') {
        if (code === '10') headerExtMin[0] = Number(trimmedVal);
        if (code === '20') headerExtMin[1] = Number(trimmedVal);
      } else if (currentHeaderVar === '$EXTMAX') {
        if (code === '10') headerExtMax[0] = Number(trimmedVal);
        if (code === '20') headerExtMax[1] = Number(trimmedVal);
      }
    } else if (currentSection === 'TABLES') {
      if (code === '0' && trimmedVal === 'TABLE') {
        const next = pairs[i + 1];
        inLayerTable = Boolean(next && next.code === '2' && next.value.trim() === 'LAYER');
      } else if (code === '0' && trimmedVal === 'ENDTAB') {
        if (inLayerTable && curLayerName) {
          layerColors[curLayerName] = curLayerColor;
        }
        inLayerTable = false;
        curLayerName = null;
      } else if (inLayerTable) {
        if (code === '0' && trimmedVal === 'LAYER') {
          if (curLayerName) layerColors[curLayerName] = curLayerColor;
          curLayerName = null;
          curLayerColor = 7;
        } else if (code === '2') {
          curLayerName = trimmedVal;
        } else if (code === '62') {
          curLayerColor = Math.abs(Math.round(Number(trimmedVal) || 7));
        }
      }
    } else if (currentSection === 'ENTITIES') {
      if (code === '0') {
        flushEntity();
        curEntType = trimmedVal;
        curEntPairs = [];
      } else if (curEntType) {
        curEntPairs.push({ code, value });
      }
    }
  }

  // Usar bbox de entidades si es finito; respaldar con HEADER $EXTMIN/$EXTMAX
  if (!Number.isFinite(bbox.minX) || !Number.isFinite(bbox.maxX)) {
    bbox.minX = Number.isFinite(headerExtMin[0]) ? headerExtMin[0] : 0;
    bbox.minY = Number.isFinite(headerExtMin[1]) ? headerExtMin[1] : 0;
    bbox.maxX = Number.isFinite(headerExtMax[0]) ? headerExtMax[0] : 100;
    bbox.maxY = Number.isFinite(headerExtMax[1]) ? headerExtMax[1] : 70;
  }

  return { bbox, entities, layerColors };
}

/**
 * Convierte un índice ACI de AutoCAD (1..255) a color hexadecimal adaptado al tema.
 * En modo monocromo (estilo AutoCAD CTB o Model Space negro) convierte tintas cromáticas a escala técnica B/N.
 */
export function resolveDxfColor(
  colorIndex: number,
  layer: string,
  layerColors: Record<string, number>,
  defaultStroke: string,
  isLightSheet: boolean,
  isMonochrome = false
): string {
  const effectiveAci = colorIndex === 256 ? (layerColors[layer] ?? 7) : colorIndex;
  if (isMonochrome) {
    if (effectiveAci === 8 || effectiveAci === 9 || effectiveAci === 251 || effectiveAci === 252) {
      return isLightSheet ? '#4B5563' : '#9CA3AF';
    }
    return isLightSheet ? '#000000' : '#FFFFFF';
  }
  if (effectiveAci <= 0 || effectiveAci === 7 || effectiveAci === 255 || effectiveAci === 256) {
    return defaultStroke;
  }
  const aciMap: Record<number, string> = {
    1: '#DC2626',
    2: isLightSheet ? '#B45309' : '#FACC15',
    3: '#16A34A',
    4: '#0891B2',
    5: '#2563EB',
    6: '#9333EA',
    8: '#64748B',
    9: '#94A3B8',
    20: '#EA580C',
    30: '#D97706',
    40: '#CA8A04',
    140: '#0284C7',
    251: isLightSheet ? '#334155' : '#94A3B8',
    252: '#64748B',
  };
  return aciMap[effectiveAci] ?? defaultStroke;
}
