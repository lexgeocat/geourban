import type {
  DxfBBox,
  DxfDetectedViewports,
  DxfDynamicFieldKey,
  DxfDynamicFieldSlot,
  DxfLwPolylineEntity,
  DxfTextEntity,
} from '../model/dxfTemplateModel';
import type { ViewportBoxNormalized } from '../model/layoutTypes';
import type { ParsedDxfRaw } from './dxfParser';

interface RectDxf {
  entityId: string;
  layer: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
  area: number;
}

function polylineBBox(poly: DxfLwPolylineEntity): RectDxf | null {
  if (poly.points.length < 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  return {
    entityId: poly.id,
    layer: poly.layer,
    minX,
    minY,
    maxX,
    maxY,
    w,
    h,
    area: w * h,
  };
}

function isClosedPolygon(poly: DxfLwPolylineEntity): boolean {
  if (poly.closed) return true;
  if (poly.points.length < 4) return false;
  const first = poly.points[0];
  const last = poly.points[poly.points.length - 1];
  return Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-2;
}

function dxfRectToNormalized(rect: { minX: number; minY: number; maxX: number; maxY: number }, frame: DxfBBox): ViewportBoxNormalized {
  const fw = Math.max(1e-6, frame.maxX - frame.minX);
  const fh = Math.max(1e-6, frame.maxY - frame.minY);
  return {
    x: Math.max(0, Math.min(0.95, (rect.minX - frame.minX) / fw)),
    y: Math.max(0, Math.min(0.95, (frame.maxY - rect.maxY) / fh)),
    w: Math.max(0.05, Math.min(1, (rect.maxX - rect.minX) / fw)),
    h: Math.max(0.05, Math.min(1, (rect.maxY - rect.minY) / fh)),
  };
}

function detectDynamicSlots(texts: DxfTextEntity[]): DxfDynamicFieldSlot[] {
  const slots: DxfDynamicFieldSlot[] = [];
  const usedIds = new Set<string>();

  const pushSlot = (ent: DxfTextEntity | undefined, key: DxfDynamicFieldKey) => {
    if (!ent || usedIds.has(ent.id)) return;
    usedIds.add(ent.id);
    slots.push({
      entityId: ent.id,
      fieldKey: key,
      originalText: ent.text,
    });
  };

  // 1. Placeholders explícitos {{CAMPO}} para plantillas personalizadas DXF
  const placeholderMap: Array<[RegExp, DxfDynamicFieldKey]> = [
    [/\{\{\s*ESCALA_PLANO\s*\}\}/i, 'mainScaleValue'],
    [/\{\{\s*ESCALA_UBICACION\s*\}\}/i, 'locationScaleValue'],
    [/\{\{\s*TITULO\s*\}\}/i, 'planTitle'],
    [/\{\{\s*MUNICIPIO\s*\}\}/i, 'municipalityHeader'],
    [/\{\{\s*JURISDICCION\s*\}\}/i, 'jurisdictionSubtitle'],
    [/\{\{\s*PROPIETARIO\s*\}\}/i, 'ownerName'],
    [/\{\{\s*VENDEDOR\s*\}\}/i, 'sellerOrProcess'],
    [/\{\{\s*UBICACION\s*\}\}/i, 'locationAddress'],
    [/\{\{\s*DISTRITO\s*\}\}/i, 'district'],
    [/\{\{\s*ZONA\s*\}\}/i, 'zone'],
    [/\{\{\s*URBANIZACION\s*\}\}/i, 'urbanizationName'],
    [/\{\{\s*MANZANO\s*\}\}/i, 'manzanoCode'],
    [/\{\{\s*LOTE\s*\}\}/i, 'lotCode'],
    [/\{\{\s*SUP_TESTIMONIO\s*\}\}/i, 'surfaceTestimonioM2'],
    [/\{\{\s*SUP_LEVANTAMIENTO\s*\}\}/i, 'surfaceLevantamientoM2'],
    [/\{\{\s*SUP_UTIL\s*\}\}/i, 'surfaceUtilM2'],
    [/\{\{\s*SUP_CONSTRUIDA\s*\}\}/i, 'surfaceConstruidaM2'],
    [/\{\{\s*FRENTE(_M)?\s*\}\}/i, 'frontM'],
    [/\{\{\s*FONDO(_M)?\s*\}\}/i, 'depthM'],
    [/\{\{\s*USO_SUELO\s*\}\}/i, 'landUse'],
    [/\{\{\s*MATRICULA\s*\}\}/i, 'ddrrMatricula'],
    [/\{\{\s*CATASTRAL\s*\}\}/i, 'catastralCode'],
    [/\{\{\s*ARQUITECTO\s*\}\}/i, 'architectName'],
    [/\{\{\s*REGISTRO\s*\}\}/i, 'professionalRegistry'],
    [/\{\{\s*FECHA\s*\}\}/i, 'projectDate'],
    [/\{\{\s*LAMINA\s*\}\}/i, 'sheetCode'],
  ];

  for (const t of texts) {
    for (const [re, key] of placeholderMap) {
      if (re.test(t.text)) {
        pushSlot(t, key);
      }
    }
  }

  // Helper para buscar el texto de valor inmediatamente a la derecha (o ligeramente debajo) de una etiqueta
  const findValueNearLabel = (
    labelMatcher: (up: string) => boolean,
    opts?: { maxDx?: number; maxDy?: number; preferBelow?: boolean; excludeMatcher?: (up: string) => boolean }
  ): DxfTextEntity | undefined => {
    const label = texts.find((t) => labelMatcher(t.text.toUpperCase()));
    if (!label) return undefined;
    const maxDx = opts?.maxDx ?? 15;
    const maxDy = opts?.maxDy ?? 1.4;

    let best: DxfTextEntity | undefined;
    let bestScore = Infinity;

    for (const cand of texts) {
      if (cand.id === label.id || usedIds.has(cand.id)) continue;
      const up = cand.text.toUpperCase();
      if (opts?.excludeMatcher?.(up)) continue;
      const dx = cand.x - label.x;
      const dy = label.y - cand.y; // positivo si está debajo en coords DXF

      if (opts?.preferBelow) {
        if (Math.abs(dx) <= maxDx && dy > 0.1 && dy <= maxDy) {
          const score = Math.abs(dx) * 0.5 + dy * 4;
          if (score < bestScore) {
            bestScore = score;
            best = cand;
          }
        }
      } else if (dx > 0.3 && dx <= maxDx && Math.abs(dy) <= maxDy) {
        const score = dx + Math.abs(dy) * 5;
        if (score < bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    return best;
  };

  // 2. Mapeo automático por proximidad semántica (compatible con carimbo_plantilla.dxf y similares)
  pushSlot(
    findValueNearLabel((u) => u.startsWith('ESCALA:'), { maxDx: 14, maxDy: 1.5 }),
    'mainScaleValue'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('ESC:') || u === 'ESC: 1:', { maxDx: 10, maxDy: 1.0 }),
    'locationScaleValue'
  );

  // Encabezados institucionales superiores
  pushSlot(
    texts.find((t) => t.text.toUpperCase().includes('GOBIERNO AUTONOMO') || t.text.toUpperCase().includes('ALCALDIA')),
    'municipalityHeader'
  );
  pushSlot(
    texts.find((t) => t.text.toUpperCase().includes('JURISDICCION') || t.text.toUpperCase().includes('DEPARTAMENTO')),
    'jurisdictionSubtitle'
  );
  pushSlot(
    texts.find((t) => t.text.toUpperCase() === 'PLANO DE LOTE' || t.text.toUpperCase().startsWith('PLANO DE ')),
    'planTitle'
  );

  pushSlot(
    findValueNearLabel((u) => u.startsWith('PROPIETARIO:'), { maxDx: 14, maxDy: 1.2 }),
    'ownerName'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('VENDEDOR:'), { maxDx: 14, maxDy: 1.2 }),
    'sellerOrProcess'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('UBICACION:'), { maxDx: 14, maxDy: 1.4 }),
    'locationAddress'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('SUP. LOTE S/T'), { maxDx: 12, maxDy: 1.0 }),
    'surfaceTestimonioM2'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('SUP. LOTE S/L'), { maxDx: 12, maxDy: 1.0 }),
    'surfaceLevantamientoM2'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('SUP. UTIL'), { maxDx: 12, maxDy: 1.0 }),
    'surfaceUtilM2'
  );
  pushSlot(
    findValueNearLabel(
      (u) =>
        u.startsWith('SUP. CONSTRUIDA') ||
        u.startsWith('SUP. EDIFICADA') ||
        u.includes('CONSTRUIDA:'),
      { maxDx: 12, maxDy: 1.0 }
    ),
    'surfaceConstruidaM2'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('FRENTE:'), { maxDx: 10, maxDy: 1.0 }),
    'frontM'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('FONDO:'), { maxDx: 10, maxDy: 1.0 }),
    'depthM'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('USO DE SUELO') || u.startsWith('USO:'), { maxDx: 12, maxDy: 1.0 }),
    'landUse'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('FECHA:'), { maxDx: 10, maxDy: 1.0 }),
    'projectDate'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('LAMINA') || u.startsWith('LÁMINA'), { maxDx: 10, maxDy: 1.0 }),
    'sheetCode'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('REG. PROF') || u.startsWith('CAB:'), { maxDx: 10, maxDy: 1.0 }),
    'professionalRegistry'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('DISTRITO:'), { maxDx: 10, maxDy: 1.0 }),
    'district'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('ZONA:'), { maxDx: 10, maxDy: 1.0 }),
    'zone'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('URBANIZACION:'), { maxDx: 10, maxDy: 1.0 }),
    'urbanizationName'
  );
  pushSlot(
    findValueNearLabel((u) => u.startsWith('MANZANO:'), { maxDx: 10, maxDy: 1.0 }),
    'manzanoCode'
  );
  pushSlot(
    findValueNearLabel((u) => u.includes('DE LOTE:'), { maxDx: 10, maxDy: 1.0 }),
    'lotCode'
  );

  // Campos de manzana y lote en la barra del mapa de ubicación
  pushSlot(
    findValueNearLabel((u) => u === 'MANZANA:', { maxDx: 10, maxDy: 0.9 }),
    'locManzanoCode'
  );
  pushSlot(
    findValueNearLabel((u) => u === 'LOTE:', { maxDx: 10, maxDy: 0.9 }),
    'locLotCode'
  );

  // Matrícula debajo de MATRICULA / PTDA. No
  pushSlot(
    findValueNearLabel((u) => u.includes('MATRICULA'), { maxDx: 6, maxDy: 1.8, preferBelow: true }),
    'ddrrMatricula'
  );

  return slots;
}

export function detectDxfTemplateViewports(parsed: ParsedDxfRaw): DxfDetectedViewports {
  const { bbox, entities } = parsed;
  const closedRects: RectDxf[] = [];

  for (const ent of entities) {
    if (ent.type === 'LWPOLYLINE' && isClosedPolygon(ent)) {
      const r = polylineBBox(ent);
      if (r) closedRects.push(r);
    }
  }

  // Marco exterior: mayor polígono cerrado o bbox total
  closedRects.sort((a, b) => b.area - a.area);
  const frameBBox: DxfBBox =
    closedRects.length > 0 && closedRects[0].area > (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY) * 0.55
      ? {
          minX: closedRects[0].minX,
          minY: closedRects[0].minY,
          maxX: closedRects[0].maxX,
          maxY: closedRects[0].maxY,
        }
      : bbox;

  const fw = Math.max(1e-6, frameBBox.maxX - frameBBox.minX);
  const fh = Math.max(1e-6, frameBBox.maxY - frameBBox.minY);
  const frameArea = fw * fh;

  const texts = entities.filter((e): e is DxfTextEntity => e.type === 'TEXT' || e.type === 'MTEXT');

  // 1. Detectar Viewport de Ubicación:
  // Prioridad A: Capa nombrada VP_UBICACION / UBICACION / LOCATION
  let locRect: RectDxf | undefined = closedRects.find((r) =>
    /^(vp[_-]?ubicacion|ubicacion|location)$/i.test(r.layer.trim())
  );

  // Prioridad B: Caja rectangular vacía debajo de etiqueta UBICACION / CROQUIS / ESC: 1:
  if (!locRect) {
    const emptyBoxes = closedRects.filter((r) => {
      if (r.area >= frameArea * 0.5 || r.area <= frameArea * 0.03) return false;
      // Verificar que no contenga textos interiores
      const textsInside = texts.filter(
        (t) => t.x > r.minX + 0.5 && t.x < r.maxX - 0.5 && t.y > r.minY + 0.5 && t.y < r.maxY - 0.5
      );
      return textsInside.length === 0;
    });

    if (emptyBoxes.length > 0) {
      // Buscar el más grande en zona inferior/derecha o cercano a "UBICACION"
      emptyBoxes.sort((a, b) => b.area - a.area);
      locRect = emptyBoxes[0];
    }
  }

  const locationFrameEntityIds = locRect
    ? closedRects
        .filter(
          (r) =>
            Math.abs(r.minX - locRect!.minX) < 0.05 &&
            Math.abs(r.maxX - locRect!.maxX) < 0.05 &&
            Math.abs(r.minY - locRect!.minY) < 0.05 &&
            Math.abs(r.maxY - locRect!.maxY) < 0.05
        )
        .map((r) => r.entityId)
    : [];

  const locationViewportBox: ViewportBoxNormalized = locRect
    ? dxfRectToNormalized(locRect, frameBBox)
    : { x: 0.62, y: 0.58, w: 0.34, h: 0.36 };

  // 2. Detectar Viewport Principal:
  // Prioridad A: Capa nombrada VP_PLANO / VP_PRINCIPAL / MAIN_VIEWPORT
  const explicitMainRect = closedRects.find((r) =>
    /^(vp[_-]?plano|vp[_-]?principal|main[_-]?viewport)$/i.test(r.layer.trim())
  );

  let mainViewportBox: ViewportBoxNormalized;
  if (explicitMainRect) {
    mainViewportBox = dxfRectToNormalized(explicitMainRect, frameBBox);
  } else {
    // Calcular la zona libre del marco que no ocupa el carimbo lateral/inferior
    const nonFrameItems = closedRects.filter((r) => r.area < frameArea * 0.55 && r.area > frameArea * 0.01);
    const rightColMinX = nonFrameItems.reduce((acc, r) => {
      if (r.minX > frameBBox.minX + fw * 0.45) {
        return Math.min(acc, r.minX);
      }
      return acc;
    }, frameBBox.maxX);

    const hasRightSidebar = rightColMinX < frameBBox.maxX - fw * 0.15;
    if (hasRightSidebar) {
      const pad = Math.min(fw, fh) * 0.022;
      mainViewportBox = dxfRectToNormalized(
        {
          minX: frameBBox.minX + pad,
          minY: frameBBox.minY + pad,
          maxX: rightColMinX - pad * 0.8,
          maxY: frameBBox.maxY - pad,
        },
        frameBBox
      );
    } else {
      mainViewportBox = { x: 0.02, y: 0.03, w: 0.96, h: 0.7 };
    }
  }

  const dynamicSlots = detectDynamicSlots(texts);

  return {
    frameBBox,
    mainViewportBox,
    locationViewportBox,
    dynamicSlots,
    locationFrameEntityIds,
  };
}
