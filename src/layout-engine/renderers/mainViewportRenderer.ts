import type { ExtractedCartography, LotCatalogItem } from '../extractors/cartographyExtractor';
import type { CadastralFormFields, LayoutConfig, ThemePalette } from '../model/layoutTypes';
import {
  chooseGridIntervalM,
  drawGraphicScaleBar,
  drawNorthArrow,
  placeWidgetRect,
  type Rect,
  type WidgetRenderedHitBox,
} from './cartographicPrimitives';
import {
  renderStreetAxes,
  renderStreetFallback,
  renderUnionedRoadNetworks,
  resolveDesignerColor,
} from './designerStyleHelpers';
import { interpolateCarimboText, type DynamicDxfValues } from './dxfCarimboRenderer';

function drawVertexTableOverlay(
  ctx: CanvasRenderingContext2D,
  mapRect: Rect,
  lot: LotCatalogItem,
  config: LayoutConfig,
  palette: ThemePalette
): WidgetRenderedHitBox | null {
  const rows = lot.vertices;
  const spec = config.widgets.coordTable;
  if (rows.length === 0 || !spec.visible || !config.display.showVertexTable) return null;

  const sc = Math.max(0.45, Math.min(2.4, spec.scale));
  const maxRows = Math.min(rows.length, 10);
  const rowH = 15 * sc;
  const headerH = 19 * sc;
  const titleH = 19 * sc;
  const tableW = Math.min(mapRect.w * 0.9, 345 * sc);
  const tableH = titleH + headerH + maxRows * rowH + 6 * sc;

  if (tableW < 150 || mapRect.h < tableH + 20) return null;

  const rect = placeWidgetRect(mapRect, spec, tableW, tableH);
  const { x: tx, y: ty } = rect;

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = palette.panelBg;
  ctx.fillRect(tx, ty, tableW, tableH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = palette.borderOuter;
  ctx.lineWidth = Math.max(0.9, 1.3 * sc);
  ctx.strokeRect(tx, ty, tableW, tableH);

  ctx.fillStyle = palette.panelHeaderBg;
  ctx.fillRect(tx, ty, tableW, titleH);
  ctx.font = `800 ${(9.2 * sc).toFixed(1)}px "Space Grotesk", sans-serif`;
  ctx.fillStyle = palette.panelHeaderText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`CUADRO DE COORDENADAS UTM — LOTE ${lot.code}`, tx + 8 * sc, ty + titleH / 2, tableW - 14 * sc);

  const cols = [0.11, 0.21, 0.18, 0.25, 0.25].map((r) => r * tableW);
  const colStarts: number[] = [];
  let acc = tx;
  for (const w of cols) {
    colStarts.push(acc);
    acc += w;
  }

  const headY = ty + titleH;
  ctx.fillStyle = palette.gridMinor;
  ctx.fillRect(tx, headY, tableW, headerH);
  ctx.strokeStyle = palette.borderInner;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(tx, headY + headerH);
  ctx.lineTo(tx + tableW, headY + headerH);
  ctx.stroke();

  const headers = ['VÉRT.', 'LADO', 'DIST.(m)', 'ESTE (X)', 'NORTE (Y)'];
  ctx.font = `700 ${(7.8 * sc).toFixed(1)}px "Space Grotesk", sans-serif`;
  ctx.fillStyle = palette.textPrimary;
  ctx.textAlign = 'center';
  headers.forEach((h, i) => {
    ctx.fillText(h, colStarts[i] + cols[i] / 2, headY + headerH / 2, cols[i] - 4);
  });

  for (let i = 0; i < maxRows; i++) {
    const r = rows[i];
    const ry = headY + headerH + i * rowH;
    ctx.font = `600 ${(7.8 * sc).toFixed(1)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = i % 2 === 0 ? palette.textPrimary : palette.textSecondary;
    ctx.textAlign = 'center';
    ctx.fillText(r.vertexLabel, colStarts[0] + cols[0] / 2, ry + rowH / 2);
    ctx.fillText(r.sideLabel, colStarts[1] + cols[1] / 2, ry + rowH / 2);
    ctx.fillText(r.distanceM.toFixed(2), colStarts[2] + cols[2] / 2, ry + rowH / 2);
    ctx.fillText(r.eastM.toFixed(2), colStarts[3] + cols[3] / 2, ry + rowH / 2);
    ctx.fillText(r.northM.toFixed(2), colStarts[4] + cols[4] / 2, ry + rowH / 2);

    ctx.strokeStyle = palette.gridMinor;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(tx, ry + rowH);
    ctx.lineTo(tx + tableW, ry + rowH);
    ctx.stroke();
  }

  ctx.restore();
  return {
    id: 'coordTable',
    label: 'Cuadro Coordenadas UTM',
    rect,
    containerRect: mapRect,
  };
}

function drawExtraDataBoxOverlay(
  ctx: CanvasRenderingContext2D,
  mapRect: Rect,
  config: LayoutConfig,
  cadastral: CadastralFormFields,
  dxfValues: DynamicDxfValues,
  palette: ThemePalette
): WidgetRenderedHitBox | null {
  const spec = config.widgets.extraDataBox;
  if (!spec.visible || !config.display.showExtraDataBox) return null;

  const rows: Array<{ label: string; value: string }> = [];
  if (cadastral.surfaceConstruidaM2.trim()) {
    rows.push({
      label: 'SUP. CONSTRUIDA',
      value: interpolateCarimboText(cadastral.surfaceConstruidaM2.trim(), dxfValues),
    });
  }
  if (cadastral.landUse.trim()) {
    rows.push({
      label: 'USO DE SUELO',
      value: interpolateCarimboText(cadastral.landUse.trim(), dxfValues),
    });
  }

  for (const cf of config.customFields) {
    if (!cf.visible) continue;
    const val = interpolateCarimboText(cf.value, dxfValues);
    rows.push({
      label: cf.label.toUpperCase(),
      value: val || '—',
    });
  }

  if (rows.length === 0) return null;

  const sc = Math.max(0.45, Math.min(2.4, spec.scale));
  const maxRows = Math.min(rows.length, 8);
  const rowH = 15 * sc;
  const titleH = 18 * sc;
  const boxW = Math.min(mapRect.w * 0.85, 255 * sc);
  const boxH = titleH + maxRows * rowH + 6 * sc;

  if (boxW < 120 || mapRect.h < boxH + 16) return null;

  const rect = placeWidgetRect(mapRect, spec, boxW, boxH);
  const { x: bx, y: by } = rect;

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = palette.panelBg;
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = palette.borderOuter;
  ctx.lineWidth = Math.max(0.9, 1.2 * sc);
  ctx.strokeRect(bx, by, boxW, boxH);

  ctx.fillStyle = palette.panelHeaderBg;
  ctx.fillRect(bx, by, boxW, titleH);
  ctx.font = `800 ${(8.2 * sc).toFixed(1)}px "Space Grotesk", sans-serif`;
  ctx.fillStyle = palette.panelHeaderText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('DATOS ADICIONALES', bx + 7 * sc, by + titleH / 2, boxW - 14 * sc);

  for (let i = 0; i < maxRows; i++) {
    const r = rows[i];
    const ry = by + titleH + i * rowH;
    ctx.font = `700 ${(7.6 * sc).toFixed(1)}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = palette.textSecondary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.label, bx + 7 * sc, ry + rowH / 2, boxW * 0.48);

    ctx.font = `700 ${(8 * sc).toFixed(1)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = palette.textPrimary;
    ctx.textAlign = 'right';
    ctx.fillText(r.value, bx + boxW - 7 * sc, ry + rowH / 2, boxW * 0.46);

    ctx.strokeStyle = palette.gridMinor;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(bx + 5 * sc, ry + rowH);
    ctx.lineTo(bx + boxW - 5 * sc, ry + rowH);
    ctx.stroke();
  }

  ctx.restore();
  return {
    id: 'extraDataBox',
    label: 'Cuadro Datos Adicionales',
    rect,
    containerRect: mapRect,
  };
}

export function renderMainViewport(params: {
  ctx: CanvasRenderingContext2D;
  frame: Rect;
  carto: ExtractedCartography;
  selectedLot: LotCatalogItem | null;
  scaleDenominator: number;
  paperWidthMm: number;
  canvasWidthPx: number;
  config: LayoutConfig;
  effectiveCadastral: CadastralFormFields;
  dxfValues: DynamicDxfValues;
  palette: ThemePalette;
  cadScaleOverride?: number;
}): WidgetRenderedHitBox[] {
  const {
    ctx,
    frame,
    carto,
    selectedLot,
    scaleDenominator,
    paperWidthMm,
    canvasWidthPx,
    config,
    effectiveCadastral,
    dxfValues,
    palette,
    cadScaleOverride,
  } = params;

  const widgetHitBoxes: WidgetRenderedHitBox[] = [];

  const gutterPx = config.display.showGrid
    ? Math.max(20, Math.min(28, Math.min(frame.w, frame.h) * 0.045))
    : Math.max(6, Math.min(10, Math.min(frame.w, frame.h) * 0.015));

  const mapRect: Rect = {
    x: frame.x + gutterPx,
    y: frame.y + gutterPx,
    w: Math.max(40, frame.w - gutterPx * 2),
    h: Math.max(40, frame.h - gutterPx * 2),
  };

  const isLotMode = config.scopeMode === 'lot' && selectedLot !== null;
  const cadScale = cadScaleOverride ?? Math.max(1.5, canvasWidthPx / 1000);

  ctx.save();
  ctx.fillStyle = palette.panelBg;
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
  ctx.strokeStyle = palette.borderOuter;
  ctx.lineWidth = Math.max(1.8, 1.2 * cadScale);
  ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);

  ctx.fillStyle = palette.mapBg;
  ctx.fillRect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);

  const pxPerMm = canvasWidthPx / paperWidthMm;
  const pxPerMeter = (1000 / Math.max(10, scaleDenominator)) * pxPerMm;

  const baseCenter = isLotMode ? selectedLot.centroid : carto.centroidMetric;
  const [panX, panY] = config.mainViewport.panOffsetMetric;
  const cxMetric = baseCenter[0] + panX;
  const cyMetric = baseCenter[1] + panY;

  const toScreen = (pt: [number, number]): [number, number] => [
    mapRect.x + mapRect.w / 2 + (pt[0] - cxMetric) * pxPerMeter,
    mapRect.y + mapRect.h / 2 - (pt[1] - cyMetric) * pxPerMeter,
  ];

  const halfSpanX = mapRect.w / 2 / pxPerMeter;
  const halfSpanY = mapRect.h / 2 / pxPerMeter;
  const viewMinX = cxMetric - halfSpanX;
  const viewMaxX = cxMetric + halfSpanX;
  const viewMinY = cyMetric - halfSpanY;
  const viewMaxY = cyMetric + halfSpanY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
  ctx.clip();

  // 1. Grilla UTM
  const gridStepM =
    config.display.gridIntervalMode === 'manual'
      ? Math.max(1, config.display.gridIntervalMeters || 10)
      : chooseGridIntervalM(scaleDenominator);
  const firstGridX = Math.ceil(viewMinX / gridStepM) * gridStepM;
  const firstGridY = Math.ceil(viewMinY / gridStepM) * gridStepM;

  if (config.display.showGrid) {
    const minorStep = gridStepM / 2;
    const firstMinorX = Math.ceil(viewMinX / minorStep) * minorStep;
    const firstMinorY = Math.ceil(viewMinY / minorStep) * minorStep;

    ctx.strokeStyle = palette.gridMinor;
    ctx.lineWidth = Math.max(0.7, 0.48 * cadScale);
    ctx.beginPath();
    for (let gx = firstMinorX; gx <= viewMaxX; gx += minorStep) {
      const [sx] = toScreen([gx, cyMetric]);
      ctx.moveTo(sx, mapRect.y);
      ctx.lineTo(sx, mapRect.y + mapRect.h);
    }
    for (let gy = firstMinorY; gy <= viewMaxY; gy += minorStep) {
      const [, sy] = toScreen([cxMetric, gy]);
      ctx.moveTo(mapRect.x, sy);
      ctx.lineTo(mapRect.x + mapRect.w, sy);
    }
    ctx.stroke();

    ctx.strokeStyle = palette.gridMajor;
    ctx.lineWidth = Math.max(1.0, 0.72 * cadScale);
    ctx.beginPath();
    for (let gx = firstGridX; gx <= viewMaxX; gx += gridStepM) {
      const [sx] = toScreen([gx, cyMetric]);
      ctx.moveTo(sx, mapRect.y);
      ctx.lineTo(sx, mapRect.y + mapRect.h);
    }
    for (let gy = firstGridY; gy <= viewMaxY; gy += gridStepM) {
      const [, sy] = toScreen([cxMetric, gy]);
      ctx.moveTo(mapRect.x, sy);
      ctx.lineTo(mapRect.x + mapRect.w, sy);
    }
    ctx.stroke();

    ctx.strokeStyle = palette.gridText;
    ctx.lineWidth = Math.max(1.0, 0.75 * cadScale);
    const crossArm = 3.5 * (cadScale * 0.7);
    for (let gx = firstGridX; gx <= viewMaxX; gx += gridStepM) {
      for (let gy = firstGridY; gy <= viewMaxY; gy += gridStepM) {
        const [sx, sy] = toScreen([gx, gy]);
        ctx.beginPath();
        ctx.moveTo(sx - crossArm, sy);
        ctx.lineTo(sx + crossArm, sy);
        ctx.moveTo(sx, sy - crossArm);
        ctx.lineTo(sx, sy + crossArm);
        ctx.stroke();
      }
    }
  }

  const isDesignerMode = config.display.viewportStyleMode === 'designer';
  const cadBlackInk = palette.isLight ? '#000000' : '#FFFFFF';
  const cadSecondaryInk = palette.isLight ? '#334155' : '#CBD5E1';
  const cadAxisInk = palette.isLight ? '#475569' : '#94A3B8';

  // 2. Red vial y aceras unionadas (cero cruces en intersecciones cuando roadNets está disponible)
  const designerCurbColor = palette.isLight ? '#475569' : '#CBD5E1';
  const roadNets = carto.roadNets ?? [];

  if (roadNets.length > 0) {
    renderUnionedRoadNetworks({
      ctx,
      roadNets,
      toScreen,
      resolveColors: (group) => ({
        roadStroke: isDesignerMode
          ? resolveDesignerColor(group.color, 1, palette.isLight)
          : cadBlackInk,
        curbStroke: isDesignerMode ? designerCurbColor : cadSecondaryInk,
      }),
      roadLineWidth: Math.max(1.8, 1.15 * cadScale),
      curbLineWidth: Math.max(1.2, 0.78 * cadScale),
    });
  } else {
    for (const st of carto.streets) {
      if (st.path.length < 2) continue;
      renderStreetFallback({
        ctx,
        street: st,
        toScreen,
        pxPerMeter,
        roadStroke: isDesignerMode
          ? resolveDesignerColor(st.color, 1, palette.isLight)
          : cadBlackInk,
        curbStroke: isDesignerMode ? designerCurbColor : cadSecondaryInk,
        roadLineWidth: Math.max(1.8, 1.15 * cadScale),
        curbLineWidth: Math.max(1.2, 0.78 * cadScale),
      });
    }
    for (const rb of carto.roundabouts) {
      const rbColor = isDesignerMode
        ? resolveDesignerColor(rb.color, 1, palette.isLight)
        : cadBlackInk;
      const strokeRing = (ring: [number, number][], stroke: string, lw: number) => {
        if (ring.length < 3) return;
        ctx.beginPath();
        ring.forEach((pt, idx) => {
          const [sx, sy] = toScreen(pt);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.stroke();
      };
      strokeRing(
        rb.sideOuter,
        isDesignerMode ? designerCurbColor : cadSecondaryInk,
        Math.max(1.2, 0.78 * cadScale)
      );
      strokeRing(rb.roadOuter, rbColor, Math.max(1.8, 1.15 * cadScale));
      if (rb.island) strokeRing(rb.island, rbColor, Math.max(1.8, 1.15 * cadScale));
    }
  }

  // Ejes viales segmentados + etiquetas de calle
  renderStreetAxes({
    ctx,
    streets: carto.streets,
    roundabouts: carto.roundabouts,
    toScreen,
    axisStroke: isDesignerMode
      ? resolveDesignerColor(carto.streets[0]?.color ?? '#8b5cf6', 0.9, palette.isLight)
      : cadAxisInk,
    lineWidth: Math.max(1.1, 0.72 * cadScale),
    cadScale,
  });

  if (config.display.showStreetNames) {
    for (const st of carto.streets) {
      if (st.path.length < 2 || !st.name) continue;
      let bestIdx = 0;
      let bestLen = 0;
      for (let i = 0; i < st.path.length - 1; i++) {
        const d = Math.hypot(st.path[i + 1][0] - st.path[i][0], st.path[i + 1][1] - st.path[i][1]);
        if (d > bestLen) {
          bestLen = d;
          bestIdx = i;
        }
      }
      const [ax, ay] = toScreen(st.path[bestIdx]);
      const [bx, by] = toScreen(st.path[bestIdx + 1]);
      if (Math.hypot(bx - ax, by - ay) > 45) {
        let ang = Math.atan2(by - ay, bx - ax);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate((ax + bx) / 2, (ay + by) / 2);
        ctx.rotate(ang);
        ctx.font = `700 ${(9.5 * (cadScale * 0.5)).toFixed(1)}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillStyle = isDesignerMode
          ? resolveDesignerColor(st.color, 1, palette.isLight)
          : cadBlackInk;
        ctx.strokeStyle = palette.mapBg;
        ctx.lineWidth = Math.max(2.5, 1.8 * cadScale);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lbl = `${st.name.toUpperCase()} (${st.widthM.toFixed(1)}m)`;
        ctx.strokeText(lbl, 0, 0);
        ctx.fillText(lbl, 0, 0);
        ctx.restore();
      }
    }
  }

  // 4. Polígonos con grosores reales tipo plumilla CAD (sin opacidad lavada ni hacheado)
  const sortedPolys = [...carto.polygons].sort((a, b) => {
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    const order = { perimetro: 0, manzana: 1, circulo: 2, lote: 3 };
    return order[a.kind] - order[b.kind];
  });

  for (const poly of sortedPolys) {
    if (poly.ring.length < 3) continue;
    const isTargetLot = isLotMode && poly.id === selectedLot.id;
    if (isLotMode && !isTargetLot && !config.display.showNeighbors && poly.kind === 'lote') {
      continue;
    }

    ctx.beginPath();
    poly.ring.forEach((pt, idx) => {
      const [sx, sy] = toScreen(pt);
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();

    const baseWidthFactor = Math.max(0.75, (poly.strokeWidth || 2) / 2);

    if (isDesignerMode) {
      const designerStroke = resolveDesignerColor(poly.color, 1, palette.isLight);
      if (isTargetLot) {
        ctx.strokeStyle = designerStroke;
        ctx.lineWidth = Math.max(3.2, 2.0 * cadScale * baseWidthFactor);
        ctx.stroke();
      } else {
        ctx.strokeStyle = designerStroke;
        ctx.lineWidth = Math.max(1.8, 1.15 * cadScale * baseWidthFactor);
        ctx.stroke();
      }
    } else if (poly.kind === 'perimetro') {
      ctx.save();
      ctx.strokeStyle = cadBlackInk;
      ctx.lineWidth = Math.max(2.4, 1.6 * cadScale);
      ctx.setLineDash([12 * cadScale * 0.65, 5 * cadScale * 0.65, 3 * cadScale * 0.65, 5 * cadScale * 0.65]);
      ctx.stroke();
      ctx.restore();
    } else if (poly.kind === 'manzana') {
      ctx.strokeStyle = cadBlackInk;
      ctx.lineWidth = Math.max(2.2, 1.35 * cadScale * baseWidthFactor);
      ctx.stroke();
    } else if (poly.kind === 'lote') {
      if (isTargetLot) {
        ctx.strokeStyle = cadBlackInk;
        ctx.lineWidth = Math.max(3.6, 2.15 * cadScale * baseWidthFactor);
        ctx.stroke();
      } else {
        ctx.strokeStyle = cadBlackInk;
        ctx.lineWidth = Math.max(1.6, 1.0 * cadScale * baseWidthFactor);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = cadBlackInk;
      ctx.lineWidth = Math.max(1.8, 1.15 * cadScale * baseWidthFactor);
      ctx.stroke();
    }

    if (config.display.showLotLabels && poly.kind !== 'perimetro') {
      const [cxPx, cyPx] = toScreen(poly.centroid);
      if (isTargetLot) {
        const titleColor = isDesignerMode
          ? resolveDesignerColor(poly.color, 1, palette.isLight)
          : cadBlackInk;
        ctx.font = '800 14px "Space Grotesk", sans-serif';
        ctx.fillStyle = titleColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`LOTE ${poly.code}`, cxPx, cyPx - 10);
        ctx.font = '700 11.5px "JetBrains Mono", monospace';
        ctx.fillStyle = palette.textPrimary;
        ctx.fillText(`SUP: ${poly.areaM2.toFixed(2)} m²`, cxPx, cyPx + 7);
        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        ctx.fillStyle = palette.textSecondary;
        ctx.fillText(`MZN. ${selectedLot.manzanoCode}`, cxPx, cyPx + 22);
      } else if (poly.kind === 'lote') {
        let minPxX = Infinity,
          maxPxX = -Infinity,
          minPxY = Infinity,
          maxPxY = -Infinity;
        for (const pt of poly.ring) {
          const [px, py] = toScreen(pt);
          if (px < minPxX) minPxX = px;
          if (px > maxPxX) maxPxX = px;
          if (py < minPxY) minPxY = py;
          if (py > maxPxY) maxPxY = py;
        }
        const bw = maxPxX - minPxX;
        const bh = maxPxY - minPxY;
        if (bw > 22 && bh > 14) {
          ctx.font = `700 ${bw > 44 ? 10.5 : 8.5}px "JetBrains Mono", monospace`;
          ctx.fillStyle = palette.textPrimary;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(isLotMode ? `Col. L-${poly.code}` : poly.code, cxPx, cyPx);
        }
      } else if (poly.kind === 'manzana' && !poly.subdivided) {
        ctx.font = '800 12px "Space Grotesk", sans-serif';
        ctx.fillStyle = isDesignerMode
          ? resolveDesignerColor(poly.color, 1, palette.isLight)
          : cadBlackInk;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(poly.code, cxPx, cyPx - 6);
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = palette.textSecondary;
        ctx.fillText(`${poly.areaM2.toFixed(1)} m²`, cxPx, cyPx + 7);
      }
    }

    const drawDimensions =
      config.display.showLotDimensions &&
      (isTargetLot || poly.kind === 'lote' || (poly.kind === 'manzana' && !poly.subdivided));
    if (drawDimensions) {
      for (let i = 0; i < poly.ring.length - 1; i++) {
        const p0 = poly.ring[i];
        const p1 = poly.ring[i + 1];
        const segLenM = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const [x0, y0] = toScreen(p0);
        const [x1, y1] = toScreen(p1);
        const segPx = Math.hypot(x1 - x0, y1 - y0);
        if (segPx > 32 && segLenM >= 0.5) {
          let ang = Math.atan2(y1 - y0, x1 - x0);
          if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
          ctx.save();
          ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
          ctx.rotate(ang);
          ctx.font = `${isTargetLot ? '800 11px' : '700 8.5px'} "JetBrains Mono", monospace`;
          ctx.fillStyle = palette.textPrimary;
          ctx.strokeStyle = palette.mapBg;
          ctx.lineWidth = Math.max(3, 2 * cadScale);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const dimText = `${segLenM.toFixed(2)} m`;
          ctx.strokeText(dimText, 0, isTargetLot ? -4 : -2);
          ctx.fillText(dimText, 0, isTargetLot ? -4 : -2);
          ctx.restore();
        }
      }
    }
  }

  // 5. Vértices V1..Vn
  if (isLotMode && config.display.showVertexMarkers) {
    const markerColor = isDesignerMode
      ? resolveDesignerColor(
          carto.polygons.find((p) => p.id === selectedLot.id)?.color ?? '#58a6ff',
          1,
          palette.isLight
        )
      : cadBlackInk;
    const vRadius = Math.max(7, 4.2 * cadScale);
    for (const v of selectedLot.vertices) {
      const [vx, vy] = toScreen([v.eastM, v.northM]);
      ctx.beginPath();
      ctx.arc(vx, vy, vRadius, 0, Math.PI * 2);
      ctx.fillStyle = markerColor;
      ctx.fill();
      ctx.strokeStyle = palette.sheetBg;
      ctx.lineWidth = Math.max(1.5, 0.9 * cadScale);
      ctx.stroke();

      ctx.font = `800 ${Math.max(8, Math.round(vRadius * 0.88))}px "JetBrains Mono", monospace`;
      ctx.fillStyle = palette.sheetBg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(v.vertexLabel, vx, vy);
    }
  }

  // 6. Líneas y Puntos auxiliares
  for (const ln of carto.lines) {
    if (ln.path.length < 2) continue;
    ctx.beginPath();
    ln.path.forEach((pt, idx) => {
      const [sx, sy] = toScreen(pt);
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = isDesignerMode
      ? resolveDesignerColor(ln.color, 1, palette.isLight)
      : cadBlackInk;
    ctx.lineWidth = Math.max(1.8, 1.15 * cadScale * Math.max(0.75, (ln.strokeWidth || 2) / 2));
    ctx.stroke();
  }
  for (const pt of carto.points) {
    const [sx, sy] = toScreen(pt.coord);
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(4.5, 2.5 * cadScale), 0, Math.PI * 2);
    ctx.fillStyle = isDesignerMode
      ? resolveDesignerColor(pt.color, 1, palette.isLight)
      : cadBlackInk;
    ctx.fill();
    ctx.strokeStyle = palette.sheetBg;
    ctx.lineWidth = Math.max(1.4, 0.8 * cadScale);
    ctx.stroke();
  }

  // 7. Widgets Móviles y Escalables dentro del Mapa
  if (selectedLot) {
    const tableHit = drawVertexTableOverlay(ctx, mapRect, selectedLot, config, palette);
    if (tableHit) widgetHitBoxes.push(tableHit);
  }

  const extraHit = drawExtraDataBoxOverlay(ctx, mapRect, config, effectiveCadastral, dxfValues, palette);
  if (extraHit) widgetHitBoxes.push(extraHit);

  // Norte Principal (movible y escalable)
  const wNorth = config.widgets.northArrow;
  if (config.display.showNorthArrow && wNorth.visible) {
    const r = Math.max(12, Math.min(68, 26 * wNorth.scale));
    const nRect = placeWidgetRect(mapRect, wNorth, r * 2 + 6, r * 2 + 6);
    drawNorthArrow(ctx, nRect.x + nRect.w / 2, nRect.y + nRect.h / 2, r, palette);
    widgetHitBoxes.push({
      id: 'northArrow',
      label: 'Norte (Plano)',
      rect: nRect,
      containerRect: mapRect,
    });
  }

  // Escala Numérica Principal (limpia tipo AutoCAD o Recuadro completo, movible y escalable)
  const wNumScale = config.widgets.numericScale;
  if (config.display.showScaleTextBadge && wNumScale.visible) {
    const sc = Math.max(0.55, Math.min(2.6, wNumScale.scale));
    const isBadge = wNumScale.styleVariant === 'badge';

    if (isBadge) {
      const badgeW = Math.min(mapRect.w * 0.85, 250 * sc);
      const badgeH = 34 * sc;
      const bRect = placeWidgetRect(mapRect, wNumScale, badgeW, badgeH);
      ctx.fillStyle = palette.panelBg;
      ctx.strokeStyle = palette.borderOuter;
      ctx.lineWidth = Math.max(1, 1.2 * sc);
      ctx.fillRect(bRect.x, bRect.y, bRect.w, bRect.h);
      ctx.strokeRect(bRect.x, bRect.y, bRect.w, bRect.h);
      ctx.fillStyle = palette.accentPrimary;
      ctx.fillRect(bRect.x, bRect.y, 4.5 * sc, bRect.h);

      ctx.font = `800 ${(9.8 * sc).toFixed(1)}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = palette.textPrimary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(
        isLotMode ? `PLANO — LOTE ${selectedLot.code}` : 'PLANTA GENERAL DE URBANIZACIÓN',
        bRect.x + 10 * sc,
        bRect.y + 4 * sc,
        bRect.w - 14 * sc
      );
      ctx.font = `600 ${(8.5 * sc).toFixed(1)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = palette.textSecondary;
      ctx.fillText(
        `ESCALA 1:${scaleDenominator.toLocaleString('es-BO')} · ${carto.epsgCode}`,
        bRect.x + 10 * sc,
        bRect.y + 18 * sc,
        bRect.w - 14 * sc
      );
      widgetHitBoxes.push({
        id: 'numericScale',
        label: 'Escala Numérica',
        rect: bRect,
        containerRect: mapRect,
      });
    } else {
      const mainLabel = `ESCALA 1 : ${scaleDenominator.toLocaleString('es-BO')}`;
      ctx.font = `800 ${(13 * sc).toFixed(1)}px "Space Grotesk", sans-serif`;
      const textW = ctx.measureText(mainLabel).width + 14 * sc;
      const boxH = 24 * sc;
      const bRect = placeWidgetRect(mapRect, wNumScale, Math.min(mapRect.w * 0.85, textW), boxH);
      ctx.save();
      ctx.fillStyle = palette.mapBg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(bRect.x, bRect.y, bRect.w, bRect.h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.textPrimary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(mainLabel, bRect.x + 6 * sc, bRect.y + bRect.h / 2);
      ctx.strokeStyle = palette.textPrimary;
      ctx.lineWidth = Math.max(1, 1.3 * sc);
      ctx.beginPath();
      ctx.moveTo(bRect.x + 6 * sc, bRect.y + bRect.h - 2 * sc);
      ctx.lineTo(bRect.x + bRect.w - 6 * sc, bRect.y + bRect.h - 2 * sc);
      ctx.stroke();
      ctx.restore();
      widgetHitBoxes.push({
        id: 'numericScale',
        label: 'Escala Numérica',
        rect: bRect,
        containerRect: mapRect,
      });
    }
  }

  // Barra de Escala Gráfica (movible y escalable)
  const wSb = config.widgets.graphicScale;
  if (config.display.showGraphicScaleBar && wSb.visible && mapRect.w > 180 && mapRect.h > 100) {
    const sc = Math.max(0.55, Math.min(2.6, wSb.scale));
    const sbW = Math.min(mapRect.w * 0.8, 195 * sc);
    const sbH = 42 * sc;
    const sbRect = placeWidgetRect(mapRect, wSb, sbW, sbH);
    ctx.fillStyle = palette.panelBg;
    ctx.globalAlpha = 0.94;
    ctx.fillRect(sbRect.x, sbRect.y, sbRect.w, sbRect.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.borderInner;
    ctx.lineWidth = Math.max(0.8, 1 * sc);
    ctx.strokeRect(sbRect.x, sbRect.y, sbRect.w, sbRect.h);
    drawGraphicScaleBar(ctx, sbRect, scaleDenominator, palette, true);
    widgetHitBoxes.push({
      id: 'graphicScale',
      label: 'Escala Gráfica (Plano)',
      rect: sbRect,
      containerRect: mapRect,
    });
  }

  ctx.restore(); // Fin clip mapRect

  // Borde interno del mapa
  ctx.strokeStyle = palette.borderOuter;
  ctx.lineWidth = Math.max(1.6, 1.1 * cadScale);
  ctx.strokeRect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);

  // Coordenadas perimetrales E / N
  if (config.display.showGrid) {
    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = palette.gridText;
    ctx.strokeStyle = palette.borderOuter;
    ctx.lineWidth = Math.max(1.1, 0.8 * cadScale);

    for (let gx = firstGridX; gx <= viewMaxX; gx += gridStepM) {
      const [sx] = toScreen([gx, cyMetric]);
      if (sx < mapRect.x + 26 || sx > mapRect.x + mapRect.w - 26) continue;
      const lbl = `${Math.round(gx)}E`;
      ctx.beginPath();
      ctx.moveTo(sx, mapRect.y);
      ctx.lineTo(sx, mapRect.y - 5);
      ctx.moveTo(sx, mapRect.y + mapRect.h);
      ctx.lineTo(sx, mapRect.y + mapRect.h + 5);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(lbl, sx, mapRect.y - 6);
      ctx.textBaseline = 'top';
      ctx.fillText(lbl, sx, mapRect.y + mapRect.h + 6);
    }

    for (let gy = firstGridY; gy <= viewMaxY; gy += gridStepM) {
      const [, sy] = toScreen([cxMetric, gy]);
      if (sy < mapRect.y + 26 || sy > mapRect.y + mapRect.h - 26) continue;
      const lbl = `${Math.round(gy)}N`;
      ctx.beginPath();
      ctx.moveTo(mapRect.x, sy);
      ctx.lineTo(mapRect.x - 5, sy);
      ctx.moveTo(mapRect.x + mapRect.w, sy);
      ctx.lineTo(mapRect.x + mapRect.w + 5, sy);
      ctx.stroke();

      ctx.save();
      ctx.translate(mapRect.x - 8, sy);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(lbl, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.translate(mapRect.x + mapRect.w + 8, sy);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(lbl, 0, 0);
      ctx.restore();
    }
  }

  ctx.restore();
  return widgetHitBoxes;
}
