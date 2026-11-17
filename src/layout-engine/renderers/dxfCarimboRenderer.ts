import { resolveDxfColor } from '../dxf/dxfParser';
import type { DxfDynamicFieldKey, DxfEntity, DxfTemplateDoc } from '../model/dxfTemplateModel';
import {
  resolveLayoutFontCss,
  resolveLayoutLineDash,
  type CadastralFormFields,
  type CarimboFitMode,
  type DxfEntityEdit,
  type ThemePalette,
} from '../model/layoutTypes';
import type { Rect } from './cartographicPrimitives';

export interface DynamicDxfValues {
  mainScale: number;
  locationScale: number;
  cadastral: CadastralFormFields;
  lotPerimeterM: string;
  frontStreetName: string;
  eastM: string;
  northM: string;
}

export interface DxfRenderedHitBox {
  id: string;
  entityType: DxfEntity['type'];
  summary: string;
  rect: Rect;
}

export interface DxfCarimboRenderOutput {
  fittedRect: Rect;
  dxfHitBoxes: DxfRenderedHitBox[];
}

/**
 * Reemplaza variables GIS Data-Driven {{TOKEN}} dentro de cualquier campo del carimbo o texto DXF.
 */
export function interpolateCarimboText(raw: string, values: DynamicDxfValues): string {
  if (!raw.includes('{{')) return raw;
  const c = values.cadastral;
  const tokens: Record<string, string> = {
    LOTE: c.lotCode || '—',
    MANZANO: c.manzanoCode || '—',
    AREA_M2: c.surfaceLevantamientoM2 || '—',
    SUP_LEVANTAMIENTO: c.surfaceLevantamientoM2 || '—',
    SUP_TESTIMONIO: c.surfaceTestimonioM2 || '—',
    SUP_UTIL: c.surfaceUtilM2 || '—',
    SUP_CONSTRUIDA: c.surfaceConstruidaM2 || '0.00 m²',
    PERIMETRO_M: values.lotPerimeterM || '—',
    FRENTE_M: c.frontM || '—',
    FRENTE: c.frontM || '—',
    FONDO_M: c.depthM || '—',
    FONDO: c.depthM || '—',
    PROPIETARIO: c.ownerName || '—',
    VENDEDOR: c.sellerOrProcess || '—',
    UBICACION: c.locationAddress || '—',
    VIA_FRENTE: values.frontStreetName || '—',
    MATRICULA: c.ddrrMatricula || '—',
    CATASTRAL: c.catastralCode || '—',
    USO_SUELO: c.landUse || '—',
    URBANIZACION: c.urbanizationName || '—',
    DISTRITO: c.district || '—',
    ZONA: c.zone || '—',
    MUNICIPIO: c.municipalityHeader || '—',
    JURISDICCION: c.jurisdictionSubtitle || '—',
    TITULO: c.planTitle || '—',
    ARQUITECTO: c.architectName || '—',
    REGISTRO: c.professionalRegistry || '—',
    FECHA: c.projectDate || '—',
    LAMINA: c.sheetCode || '01 / 01',
    ESTE_X: values.eastM || '—',
    NORTE_Y: values.northM || '—',
    ESCALA_PLANO: `1 : ${values.mainScale.toLocaleString('es-BO')}`,
    ESCALA_UBICACION: `1 : ${values.locationScale.toLocaleString('es-BO')}`,
  };

  return raw.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/gi, (full, key: string) => {
    const val = tokens[key.toUpperCase()];
    return val !== undefined ? val : full;
  });
}

function resolveDynamicSlotText(
  fieldKey: DxfDynamicFieldKey,
  originalText: string,
  values: DynamicDxfValues
): string {
  const { mainScale, locationScale, cadastral } = values;
  let resolved: string;
  switch (fieldKey) {
    case 'mainScaleValue':
      resolved = `1 : ${mainScale.toLocaleString('es-BO')}`;
      break;
    case 'locationScaleValue':
      resolved = /^1\s*:/.test(originalText.trim())
        ? `1 : ${locationScale.toLocaleString('es-BO')}`
        : `${locationScale.toLocaleString('es-BO')}`;
      break;
    case 'planTitle':
      resolved = cadastral.planTitle || originalText;
      break;
    case 'municipalityHeader':
      resolved = cadastral.municipalityHeader || originalText;
      break;
    case 'jurisdictionSubtitle':
      resolved = cadastral.jurisdictionSubtitle || originalText;
      break;
    case 'ownerName':
      resolved = cadastral.ownerName || originalText;
      break;
    case 'sellerOrProcess':
      resolved = cadastral.sellerOrProcess || originalText;
      break;
    case 'locationAddress':
      resolved = cadastral.locationAddress || originalText;
      break;
    case 'district':
      resolved = cadastral.district || originalText;
      break;
    case 'zone':
      resolved = cadastral.zone || originalText;
      break;
    case 'urbanizationName':
      resolved = cadastral.urbanizationName || originalText;
      break;
    case 'manzanoCode':
    case 'locManzanoCode':
      resolved = cadastral.manzanoCode || originalText;
      break;
    case 'lotCode':
    case 'locLotCode':
      resolved = cadastral.lotCode || originalText;
      break;
    case 'surfaceTestimonioM2':
      resolved = cadastral.surfaceTestimonioM2 || originalText;
      break;
    case 'surfaceLevantamientoM2':
      resolved = cadastral.surfaceLevantamientoM2 || originalText;
      break;
    case 'surfaceUtilM2':
      resolved = cadastral.surfaceUtilM2 || originalText;
      break;
    case 'surfaceConstruidaM2':
      resolved = cadastral.surfaceConstruidaM2 || originalText;
      break;
    case 'frontM':
      resolved = cadastral.frontM || originalText;
      break;
    case 'depthM':
      resolved = cadastral.depthM || originalText;
      break;
    case 'landUse':
      resolved = cadastral.landUse || originalText;
      break;
    case 'ddrrMatricula':
      resolved = cadastral.ddrrMatricula || originalText;
      break;
    case 'catastralCode':
      resolved = cadastral.catastralCode || originalText;
      break;
    case 'architectName':
      resolved = cadastral.architectName || originalText;
      break;
    case 'professionalRegistry':
      resolved = cadastral.professionalRegistry || originalText;
      break;
    case 'projectDate':
      resolved = cadastral.projectDate || originalText;
      break;
    case 'sheetCode':
      resolved = cadastral.sheetCode || originalText;
      break;
  }
  return interpolateCarimboText(resolved, values);
}

/**
 * Calcula el rectángulo final ocupado por el carimbo DXF según el modo de ajuste al papel.
 */
export function computeFittedDxfRect(
  targetRect: Rect,
  dxfDoc: DxfTemplateDoc,
  carimboFitMode: CarimboFitMode
): Rect {
  const { bbox } = dxfDoc;
  const dxfW = Math.max(1e-6, bbox.maxX - bbox.minX);
  const dxfH = Math.max(1e-6, bbox.maxY - bbox.minY);
  if (carimboFitMode === 'adapt-sheet') {
    return { ...targetRect };
  }
  const uniformScale = Math.min(targetRect.w / dxfW, targetRect.h / dxfH);
  const renderedW = dxfW * uniformScale;
  const renderedH = dxfH * uniformScale;
  return {
    x: targetRect.x + (targetRect.w - renderedW) / 2,
    y: targetRect.y + (targetRect.h - renderedH) / 2,
    w: renderedW,
    h: renderedH,
  };
}

function padRect(minX: number, minY: number, maxX: number, maxY: number, minSize = 10): Rect {
  const w = maxX - minX;
  const h = maxY - minY;
  const padX = w < minSize ? (minSize - w) / 2 : 0;
  const padY = h < minSize ? (minSize - h) / 2 : 0;
  return {
    x: minX - padX,
    y: minY - padY,
    w: Math.max(minSize, w),
    h: Math.max(minSize, h),
  };
}

function bboxFromPoints(pts: Array<[number, number]>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function renderDxfCarimbo(params: {
  ctx: CanvasRenderingContext2D;
  targetRect: Rect;
  dxfDoc: DxfTemplateDoc;
  values: DynamicDxfValues;
  dxfTextOverrides: Record<string, string>;
  dxfEntityEdits: Record<string, DxfEntityEdit>;
  carimboFitMode: CarimboFitMode;
  carimboScalePercent: number;
  palette: ThemePalette;
  strokeScale?: number;
}): DxfCarimboRenderOutput {
  const {
    ctx,
    targetRect,
    dxfDoc,
    values,
    dxfTextOverrides,
    dxfEntityEdits,
    carimboFitMode,
    carimboScalePercent,
    palette,
    strokeScale = 1,
  } = params;
  const { bbox, entities, layerColors, detected } = dxfDoc;

  const dxfW = Math.max(1e-6, bbox.maxX - bbox.minX);
  const dxfH = Math.max(1e-6, bbox.maxY - bbox.minY);

  const fittedRect = computeFittedDxfRect(targetRect, dxfDoc, carimboFitMode);
  const scaleX = fittedRect.w / dxfW;
  const scaleY = fittedRect.h / dxfH;
  const textUniformScale = Math.sqrt(scaleX * scaleY) * (Math.max(60, Math.min(140, carimboScalePercent)) / 100);

  const toCanvas = (x: number, y: number): [number, number] => [
    fittedRect.x + (x - bbox.minX) * scaleX,
    fittedRect.y + (bbox.maxY - y) * scaleY,
  ];

  const slotByEntityId = new Map<string, DxfDynamicFieldKey>();
  for (const s of detected.dynamicSlots) {
    slotByEntityId.set(s.entityId, s.fieldKey);
  }

  const dxfHitBoxes: DxfRenderedHitBox[] = [];

  const getEditTransform = (entId: string) => {
    const edit = dxfEntityEdits[entId];
    return {
      edit,
      dxPx: (edit?.dxNorm ?? 0) * fittedRect.w,
      dyPx: (edit?.dyNorm ?? 0) * fittedRect.h,
      scale: Math.max(0.15, Math.min(5, edit?.scale ?? 1)),
    };
  };

  ctx.save();

  // 1. HATCH (SOLID y achurado técnico ANSI31)
  for (const ent of entities) {
    if (ent.type !== 'HATCH') continue;
    const { edit, dxPx, dyPx, scale } = getEditTransform(ent.id);
    if (edit?.deleted) continue;

    const strokeCol = resolveDxfColor(
      ent.colorIndex,
      ent.layer,
      layerColors,
      palette.dxfHatchFill,
      palette.isLight,
      palette.isMonochrome
    );

    const allCanvasPts: Array<[number, number]> = [];
    const mappedLoops = ent.loops.map((loop) =>
      loop.map((pt) => {
        const cpt = toCanvas(pt[0], pt[1]);
        allCanvasPts.push(cpt);
        return cpt;
      })
    );
    if (allCanvasPts.length === 0) continue;
    const rawBBox = bboxFromPoints(allCanvasPts);
    const centerX = (rawBBox.minX + rawBBox.maxX) / 2;
    const centerY = (rawBBox.minY + rawBBox.maxY) / 2;

    const transformPt = (pt: [number, number]): [number, number] => [
      centerX + (pt[0] - centerX) * scale + dxPx,
      centerY + (pt[1] - centerY) * scale + dyPx,
    ];

    const finalPts: Array<[number, number]> = [];
    for (const loop of mappedLoops) {
      if (loop.length < 3) continue;
      const tLoop = loop.map(transformPt);
      tLoop.forEach((p) => finalPts.push(p));

      ctx.save();
      ctx.beginPath();
      tLoop.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt[0], pt[1]);
        else ctx.lineTo(pt[0], pt[1]);
      });
      ctx.closePath();

      if (ent.solid) {
        ctx.fillStyle = strokeCol;
        ctx.globalAlpha = palette.isMonochrome ? (palette.isLight ? 0.88 : 0.82) : palette.isLight ? 0.85 : 0.72;
        ctx.fill();
      } else {
        ctx.clip();
        const lb = bboxFromPoints(tLoop);
        ctx.strokeStyle = palette.borderInner;
        ctx.globalAlpha = palette.isMonochrome ? 0.35 : 0.28;
        ctx.lineWidth = edit?.lineWidth ?? 1;
        const step = 8;
        const h = lb.maxY - lb.minY;
        ctx.beginPath();
        for (let sx = lb.minX - h; sx <= lb.maxX + h; sx += step) {
          ctx.moveTo(sx, lb.maxY);
          ctx.lineTo(sx + h, lb.minY);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    if (finalPts.length > 0) {
      const fb = bboxFromPoints(finalPts);
      dxfHitBoxes.push({
        id: ent.id,
        entityType: 'HATCH',
        summary: `Achurado (${ent.patternName || 'SOLID'})`,
        rect: padRect(fb.minX, fb.minY, fb.maxX, fb.maxY),
      });
    }
  }

  // 2. Polilíneas, líneas, círculos y arcos
  for (const ent of entities) {
    if (ent.type === 'HATCH' || ent.type === 'TEXT' || ent.type === 'MTEXT') continue;
    const { edit, dxPx, dyPx, scale } = getEditTransform(ent.id);
    if (edit?.deleted) continue;

    const strokeCol = resolveDxfColor(
      ent.colorIndex,
      ent.layer,
      layerColors,
      palette.dxfStrokeDefault,
      palette.isLight,
      palette.isMonochrome
    );
    ctx.strokeStyle = strokeCol;
    const defaultLw = ent.layer.toUpperCase() === 'TRAZO' ? 2.4 : 1.15;
    const lwBase = edit?.lineWidth ?? defaultLw;
    ctx.lineWidth = lwBase * strokeScale;
    ctx.setLineDash(resolveLayoutLineDash(edit?.lineStyle, ctx.lineWidth));

    if (ent.type === 'LINE') {
      const p1 = toCanvas(ent.x1, ent.y1);
      const p2 = toCanvas(ent.x2, ent.y2);
      const cx = (p1[0] + p2[0]) / 2;
      const cy = (p1[1] + p2[1]) / 2;
      const x1 = cx + (p1[0] - cx) * scale + dxPx;
      const y1 = cy + (p1[1] - cy) * scale + dyPx;
      const x2 = cx + (p2[0] - cx) * scale + dxPx;
      const y2 = cy + (p2[1] - cy) * scale + dyPx;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      dxfHitBoxes.push({
        id: ent.id,
        entityType: 'LINE',
        summary: `Línea (${ent.layer})`,
        rect: padRect(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), 10),
      });
    } else if (ent.type === 'LWPOLYLINE') {
      if (ent.points.length < 2) continue;
      const rawPts = ent.points.map((pt) => toCanvas(pt[0], pt[1]));
      const rb = bboxFromPoints(rawPts);
      const cx = (rb.minX + rb.maxX) / 2;
      const cy = (rb.minY + rb.maxY) / 2;
      const finalPts: Array<[number, number]> = rawPts.map(([px, py]) => [
        cx + (px - cx) * scale + dxPx,
        cy + (py - cy) * scale + dyPx,
      ]);

      ctx.beginPath();
      finalPts.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt[0], pt[1]);
        else ctx.lineTo(pt[0], pt[1]);
      });
      if (ent.closed) ctx.closePath();
      ctx.stroke();

      const fb = bboxFromPoints(finalPts);
      dxfHitBoxes.push({
        id: ent.id,
        entityType: 'LWPOLYLINE',
        summary: ent.closed ? `Recuadro / Polígono (${ent.layer})` : `Polilínea (${ent.layer})`,
        rect: padRect(fb.minX, fb.minY, fb.maxX, fb.maxY, 10),
      });
    } else if (ent.type === 'CIRCLE') {
      const [cRawX, cRawY] = toCanvas(ent.cx, ent.cy);
      const cx = cRawX + dxPx;
      const cy = cRawY + dyPx;
      const rx = ent.radius * scaleX * scale;
      const ry = ent.radius * scaleY * scale;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();

      dxfHitBoxes.push({
        id: ent.id,
        entityType: 'CIRCLE',
        summary: `Círculo (${ent.layer})`,
        rect: padRect(cx - rx, cy - ry, cx + rx, cy + ry, 10),
      });
    } else if (ent.type === 'ARC') {
      const [cRawX, cRawY] = toCanvas(ent.cx, ent.cy);
      const cx = cRawX + dxPx;
      const cy = cRawY + dyPx;
      const rx = ent.radius * scaleX * scale;
      const ry = ent.radius * scaleY * scale;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        rx,
        ry,
        0,
        (-ent.endAngleDeg * Math.PI) / 180,
        (-ent.startAngleDeg * Math.PI) / 180
      );
      ctx.stroke();

      dxfHitBoxes.push({
        id: ent.id,
        entityType: 'ARC',
        summary: `Arco (${ent.layer})`,
        rect: padRect(cx - rx, cy - ry, cx + rx, cy + ry, 10),
      });
    }
  }

  // 3. Textos DXF con mover, escalar, editar texto y borrar
  for (const ent of entities) {
    if (ent.type !== 'TEXT' && ent.type !== 'MTEXT') continue;
    const { edit, dxPx, dyPx, scale } = getEditTransform(ent.id);
    if (edit?.deleted) continue;

    const explicitOverride = edit?.text ?? dxfTextOverrides[ent.id];
    const dynamicKey = slotByEntityId.get(ent.id);

    let displayText: string;
    if (explicitOverride !== undefined) {
      displayText = interpolateCarimboText(explicitOverride, values);
    } else if (dynamicKey) {
      displayText = resolveDynamicSlotText(dynamicKey, ent.text, values);
    } else {
      displayText = interpolateCarimboText(ent.text, values);
    }

    const [rawTx, rawTy] = toCanvas(ent.x, ent.y);
    const tx = rawTx + dxPx;
    const ty = rawTy + dyPx;
    const fontSizePx = Math.max(6.5, Math.min(44, ent.height * textUniformScale * 1.18 * scale));
    const isValueSlot = Boolean(dynamicKey) || explicitOverride !== undefined;

    const textCol =
      dynamicKey === 'mainScaleValue' || dynamicKey === 'locationScaleValue' || dynamicKey === 'planTitle'
        ? palette.accentPrimary
        : isValueSlot
          ? palette.textPrimary
          : resolveDxfColor(
              ent.colorIndex,
              ent.layer,
              layerColors,
              palette.dxfTextDefault,
              palette.isLight,
              palette.isMonochrome
            );

    ctx.save();
    ctx.translate(tx, ty);
    if (ent.rotationDeg !== 0) {
      ctx.rotate((-ent.rotationDeg * Math.PI) / 180);
    }
    const isBold = edit?.bold !== undefined ? edit.bold : isValueSlot;
    const fontStylePrefix = `${edit?.italic ? 'italic ' : ''}${isBold ? '700' : '500'}`;
    ctx.font = `${fontStylePrefix} ${fontSizePx.toFixed(1)}px ${resolveLayoutFontCss(edit?.fontFamily)}`;
    ctx.fillStyle = textCol;
    ctx.textAlign = 'left';
    ctx.textBaseline = ent.type === 'MTEXT' ? 'top' : 'bottom';

    const maxWidth =
      isValueSlot &&
      displayText.length > 26 &&
      dynamicKey !== 'municipalityHeader' &&
      dynamicKey !== 'jurisdictionSubtitle'
        ? Math.max(40, 14 * scaleX * scale)
        : undefined;

    if (maxWidth !== undefined) {
      ctx.fillText(displayText, 0, 0, maxWidth);
    } else {
      ctx.fillText(displayText, 0, 0);
    }

    const measuredW = Math.min(
      maxWidth ?? Infinity,
      Math.max(16, ctx.measureText(displayText || ' ').width)
    );
    if (edit?.underline && measuredW > 0) {
      const uy = ent.type === 'MTEXT' ? fontSizePx * 1.05 : fontSizePx * 0.06;
      ctx.strokeStyle = textCol;
      ctx.lineWidth = Math.max(0.9, fontSizePx * 0.075);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, uy);
      ctx.lineTo(measuredW, uy);
      ctx.stroke();
    }
    ctx.restore();

    const localTop = ent.type === 'MTEXT' ? 0 : -fontSizePx * 1.1;
    const localBot = ent.type === 'MTEXT' ? fontSizePx * 1.15 : fontSizePx * 0.12;
    const rad = (-ent.rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    const corners: Array<[number, number]> = [
      [0, localTop],
      [measuredW, localTop],
      [measuredW, localBot],
      [0, localBot],
    ].map(([lx, ly]) => [tx + lx * cosR - ly * sinR, ty + lx * sinR + ly * cosR]);

    const tb = bboxFromPoints(corners);
    dxfHitBoxes.push({
      id: ent.id,
      entityType: ent.type,
      summary: `Texto: ${displayText.slice(0, 28)}`,
      rect: padRect(tb.minX, tb.minY, tb.maxX, tb.maxY, 10),
    });
  }

  ctx.restore();
  return { fittedRect, dxfHitBoxes };
}
