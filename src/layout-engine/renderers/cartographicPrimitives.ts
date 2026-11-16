import type { ExtractedCartography } from '../extractors/cartographyExtractor';
import {
  LOCATION_PRESET_SCALES,
  MAIN_PRESET_SCALES,
  type CartoWidgetId,
  type CartoWidgetSpec,
  type LayoutConfig,
  type ThemePalette,
} from '../model/layoutTypes';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetRenderedHitBox {
  id: CartoWidgetId;
  label: string;
  rect: Rect;
  containerRect: Rect;
}

export function placeWidgetRect(
  container: Rect,
  spec: Pick<CartoWidgetSpec, 'xNorm' | 'yNorm'>,
  boxW: number,
  boxH: number
): Rect {
  const maxDx = Math.max(0, container.w - boxW);
  const maxDy = Math.max(0, container.h - boxH);
  return {
    x: container.x + Math.max(0, Math.min(1, spec.xNorm)) * maxDx,
    y: container.y + Math.max(0, Math.min(1, spec.yNorm)) * maxDy,
    w: boxW,
    h: boxH,
  };
}

export function computeAutoScale(
  bboxMetric: [number, number, number, number],
  viewportWidthMm: number,
  viewportHeightMm: number,
  candidates: number[] = MAIN_PRESET_SCALES,
  marginFactor = 1.25
): number {
  const spanX = Math.max(8, bboxMetric[2] - bboxMetric[0]);
  const spanY = Math.max(8, bboxMetric[3] - bboxMetric[1]);
  const rawScaleX = (spanX * marginFactor) / (Math.max(20, viewportWidthMm) / 1000);
  const rawScaleY = (spanY * marginFactor) / (Math.max(20, viewportHeightMm) / 1000);
  const rawScale = Math.max(rawScaleX, rawScaleY);

  for (const candidate of candidates) {
    if (candidate >= rawScale) return candidate;
  }
  return Math.max(100, Math.ceil(rawScale / 500) * 500);
}

export function computeAutoLocationScale(
  bboxMetric: [number, number, number, number],
  viewportWidthMm: number,
  viewportHeightMm: number
): number {
  return computeAutoScale(bboxMetric, viewportWidthMm, viewportHeightMm, LOCATION_PRESET_SCALES, 2.2);
}

export function chooseGridIntervalM(scaleDenominator: number): number {
  if (scaleDenominator <= 150) return 5;
  if (scaleDenominator <= 300) return 10;
  if (scaleDenominator <= 600) return 20;
  if (scaleDenominator <= 1250) return 50;
  if (scaleDenominator <= 2500) return 100;
  if (scaleDenominator <= 5000) return 200;
  if (scaleDenominator <= 10000) return 500;
  return 1000;
}

// Caché compartida de mosaicos OSM para el mapa de ubicación
const osmTileCache = new Map<string, HTMLImageElement>();

export function getCachedOsmTile(z: number, x: number, y: number): HTMLImageElement | undefined {
  return osmTileCache.get(`${z}/${x}/${y}`);
}

export function prefetchOsmTilesForLocation(
  lon: number,
  lat: number,
  zoom: number,
  onTileLoaded: () => void
): void {
  const z = Math.max(3, Math.min(18, Math.round(zoom)));
  const n = Math.pow(2, z);
  const centerTileX = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const centerTileY = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = ((centerTileX + dx) % n + n) % n;
      const ty = Math.max(0, Math.min(n - 1, centerTileY + dy));
      const key = `${z}/${tx}/${ty}`;
      if (osmTileCache.has(key)) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => onTileLoaded();
      img.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
      osmTileCache.set(key, img);
    }
  }
}

export function drawNorthArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  palette: ThemePalette
): void {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = palette.panelBg;
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, radius * 0.06);
  ctx.strokeStyle = palette.borderOuter;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.82, 0, Math.PI * 2);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = palette.borderInner;
  ctx.stroke();

  const tipY = -radius * 0.72;
  const tailY = radius * 0.54;
  const halfW = radius * 0.24;

  // Ala izquierda rellena
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(-halfW, 0);
  ctx.lineTo(0, -radius * 0.12);
  ctx.closePath();
  ctx.fillStyle = palette.accentPrimary;
  ctx.fill();

  // Ala derecha contrastada (hueca en CAD monocromo, contraste en color)
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(halfW, 0);
  ctx.lineTo(0, -radius * 0.12);
  ctx.closePath();
  if (palette.isMonochrome) {
    ctx.fillStyle = palette.sheetBg;
    ctx.fill();
    ctx.strokeStyle = palette.textPrimary;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  } else {
    ctx.fillStyle = palette.textPrimary;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(0, tailY);
  ctx.lineTo(-halfW * 0.75, 0);
  ctx.lineTo(0, -radius * 0.12);
  ctx.lineTo(halfW * 0.75, 0);
  ctx.closePath();
  ctx.strokeStyle = palette.textSecondary;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  ctx.font = `800 ${Math.max(8, Math.round(radius * 0.34))}px "Space Grotesk", "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = palette.accentPrimary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, radius * 0.54);

  ctx.restore();
}

export function drawGraphicScaleBar(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  scaleDenominator: number,
  palette: ThemePalette,
  compact = false
): void {
  ctx.save();

  let segMeters: number;
  if (scaleDenominator <= 75) segMeters = 1;
  else if (scaleDenominator <= 150) segMeters = 2;
  else if (scaleDenominator <= 300) segMeters = 5;
  else if (scaleDenominator <= 600) segMeters = 10;
  else if (scaleDenominator <= 1250) segMeters = 20;
  else if (scaleDenominator <= 2500) segMeters = 50;
  else if (scaleDenominator <= 5000) segMeters = 100;
  else if (scaleDenominator <= 10000) segMeters = 200;
  else segMeters = 500;

  const numMajorSegments = 4;
  const barW = Math.min(rect.w * 0.86, rect.w - 16);
  const segPx = barW / numMajorSegments;
  const startX = rect.x + (rect.w - barW) / 2;
  const scaleRatio = Math.max(0.55, rect.h / (compact ? 42 : 58));
  const barY = rect.y + rect.h * 0.43;
  const barH = Math.max(4, (compact ? 7 : 10) * scaleRatio);

  const titleFontPx = Math.max(6.5, (compact ? 9.5 : 11) * scaleRatio);
  ctx.font = `800 ${titleFontPx.toFixed(1)}px "JetBrains Mono", monospace`;
  ctx.fillStyle = palette.textPrimary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`ESC. 1 : ${scaleDenominator.toLocaleString('es-BO')}`, rect.x + rect.w / 2, rect.y + 3 * scaleRatio);

  const subPx = segPx / 2;
  for (let s = 0; s < 2; s++) {
    const sx = startX + s * subPx;
    ctx.fillStyle = s % 2 === 0 ? palette.textPrimary : palette.sheetBg;
    ctx.fillRect(sx, barY, subPx, barH);
    ctx.strokeStyle = palette.borderOuter;
    ctx.lineWidth = Math.max(0.8, 1.1 * scaleRatio);
    ctx.strokeRect(sx, barY, subPx, barH);
  }

  for (let i = 1; i < numMajorSegments; i++) {
    const bx = startX + i * segPx;
    ctx.fillStyle = i % 2 === 0 ? palette.textPrimary : palette.sheetBg;
    ctx.fillRect(bx, barY, segPx, barH);
    ctx.strokeStyle = palette.borderOuter;
    ctx.lineWidth = Math.max(0.8, 1.1 * scaleRatio);
    ctx.strokeRect(bx, barY, segPx, barH);
  }

  const numFontPx = Math.max(6, (compact ? 8 : 9.2) * scaleRatio);
  ctx.font = `600 ${numFontPx.toFixed(1)}px "JetBrains Mono", monospace`;
  ctx.fillStyle = palette.textSecondary;
  ctx.textBaseline = 'top';
  for (let i = 0; i <= numMajorSegments; i++) {
    const tx = startX + i * segPx;
    const valM = i * segMeters;
    ctx.textAlign = i === numMajorSegments ? 'right' : i === 0 ? 'left' : 'center';
    ctx.fillText(i === numMajorSegments ? `${valM}m` : `${valM}`, tx, barY + barH + 2.5 * scaleRatio);
  }

  ctx.restore();
}

export function drawSurfaceBalancePanel(
  ctx: CanvasRenderingContext2D,
  panel: Rect,
  carto: ExtractedCartography,
  palette: ThemePalette
): void {
  ctx.save();
  ctx.fillStyle = palette.panelBg;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = palette.borderOuter;
  ctx.lineWidth = 1.8;
  ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);

  const headerH = 26;
  ctx.fillStyle = palette.panelHeaderBg;
  ctx.fillRect(panel.x, panel.y, panel.w, headerH);
  ctx.font = '800 11px "Space Grotesk", sans-serif';
  ctx.fillStyle = palette.panelHeaderText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('CUADRO DE SUPERFICIES Y BALANCE URBANO', panel.x + 10, panel.y + headerH / 2);

  const pad = 10;
  let curY = panel.y + headerH + 8;
  const leftX = panel.x + pad;
  const rightX = panel.x + panel.w - pad;

  const totalM2 = Math.max(1, carto.totalAreaM2);
  const rows = [
    {
      label: 'Superficie Total',
      val: `${carto.totalAreaM2.toFixed(2)} m² (${(carto.totalAreaM2 / 10000).toFixed(3)} ha)`,
      pct: '100.0%',
      bold: true,
    },
    {
      label: `Útil Lotes (${carto.lotCount} und.)`,
      val: `${carto.lotAreaM2.toFixed(2)} m²`,
      pct: `${((carto.lotAreaM2 / totalM2) * 100).toFixed(1)}%`,
      bold: false,
    },
    {
      label: `Manzanos (${carto.manzanoCount} mzn.)`,
      val: `${carto.manzanoAreaM2.toFixed(2)} m²`,
      pct: `${((carto.manzanoAreaM2 / totalM2) * 100).toFixed(1)}%`,
      bold: false,
    },
    {
      label: `Red Vial (${carto.streetCount} vías · ${carto.totalStreetLengthM.toFixed(0)} m)`,
      val: `${carto.streetAreaM2.toFixed(2)} m²`,
      pct: `${Math.min(100, (carto.streetAreaM2 / totalM2) * 100).toFixed(1)}%`,
      bold: false,
    },
  ];

  const rowH = 20;
  for (const r of rows) {
    if (curY + rowH > panel.y + panel.h - 6) break;
    ctx.font = `${r.bold ? '700' : '600'} 9.5px "Plus Jakarta Sans", sans-serif`;
    ctx.fillStyle = r.bold ? palette.textPrimary : palette.textSecondary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.label, leftX, curY + rowH / 2);

    ctx.font = `${r.bold ? '700' : '600'} 9.5px "JetBrains Mono", monospace`;
    ctx.fillStyle = palette.textPrimary;
    ctx.textAlign = 'right';
    ctx.fillText(`${r.val} [${r.pct}]`, rightX, curY + rowH / 2);

    ctx.strokeStyle = palette.gridMinor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftX, curY + rowH);
    ctx.lineTo(rightX, curY + rowH);
    ctx.stroke();

    curY += rowH;
  }

  ctx.restore();
}

export function drawLegendAndScalePanel(
  ctx: CanvasRenderingContext2D,
  panel: Rect,
  carto: ExtractedCartography,
  scaleDenominator: number,
  palette: ThemePalette,
  showScaleBar = true
): void {
  ctx.save();
  ctx.fillStyle = palette.panelBg;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = palette.borderOuter;
  ctx.lineWidth = 1.8;
  ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);

  const headerH = 26;
  ctx.fillStyle = palette.panelHeaderBg;
  ctx.fillRect(panel.x, panel.y, panel.w, headerH);
  ctx.font = '800 11px "Space Grotesk", sans-serif';
  ctx.fillStyle = palette.panelHeaderText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(showScaleBar ? 'SIMBOLOGÍA Y ESCALA' : 'SIMBOLOGÍA TÉCNICA', panel.x + 10, panel.y + headerH / 2);

  const scaleH = showScaleBar ? Math.min(70, Math.max(54, panel.h * 0.36)) : 0;
  const legendAreaH = panel.h - headerH - scaleH - 6;
  const pad = 10;
  let curY = panel.y + headerH + 6;

  const itemH = Math.min(19, Math.max(14, Math.floor(legendAreaH / Math.max(1, carto.legend.length))));
  for (const item of carto.legend) {
    if (curY + itemH > panel.y + headerH + legendAreaH) break;
    const swX = panel.x + pad;
    const swY = curY + 2;
    const swW = 20;
    const swH = itemH - 5;
    const ink = palette.isMonochrome ? palette.textPrimary : item.color;

    if (item.kind === 'polygon' || item.kind === 'roundabout') {
      ctx.fillStyle = palette.isMonochrome ? palette.gridMinor : `${ink}33`;
      ctx.fillRect(swX, swY, swW, swH);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(swX, swY, swW, swH);
    } else if (item.kind === 'street') {
      ctx.fillStyle = palette.streetRoadFill;
      ctx.fillRect(swX, swY + 2, swW, swH - 4);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(swX, swY + swH / 2);
      ctx.lineTo(swX + swW, swY + swH / 2);
      ctx.stroke();
    } else if (item.kind === 'line') {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(swX, swY + swH / 2);
      ctx.lineTo(swX + swW, swY + swH / 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(swX + swW / 2, swY + swH / 2, 3.8, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
    }

    ctx.font = '600 9.5px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = palette.textPrimary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.label, swX + swW + 8, curY + itemH / 2);

    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillStyle = palette.textMuted;
    ctx.textAlign = 'right';
    ctx.fillText(`[${item.count}]`, panel.x + panel.w - pad, curY + itemH / 2);

    curY += itemH;
  }

  if (showScaleBar) {
    const scaleRect: Rect = {
      x: panel.x + 6,
      y: panel.y + panel.h - scaleH,
      w: panel.w - 12,
      h: scaleH - 4,
    };
    ctx.strokeStyle = palette.borderInner;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panel.x + 8, scaleRect.y - 2);
    ctx.lineTo(panel.x + panel.w - 8, scaleRect.y - 2);
    ctx.stroke();

    drawGraphicScaleBar(ctx, scaleRect, scaleDenominator, palette);
  }
  ctx.restore();
}

export function drawTitleBlockPanel(
  ctx: CanvasRenderingContext2D,
  panel: Rect,
  carto: ExtractedCartography,
  mainScale: number,
  config: LayoutConfig,
  palette: ThemePalette,
  brandIcon: HTMLImageElement | null
): void {
  ctx.save();
  ctx.fillStyle = palette.panelBg;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = palette.borderOuter;
  ctx.lineWidth = 2;
  ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);

  ctx.fillStyle = palette.accentPrimary;
  ctx.fillRect(panel.x, panel.y, panel.w, 5);

  const pad = 12;
  const logoSize = Math.min(48, panel.h * 0.34);
  const logoX = panel.x + pad;
  const logoY = panel.y + 12;

  if (brandIcon && brandIcon.complete && brandIcon.naturalWidth > 0) {
    if (palette.isMonochrome) {
      ctx.save();
      ctx.filter = 'grayscale(100%) contrast(120%)';
      ctx.drawImage(brandIcon, logoX, logoY, logoSize, logoSize);
      ctx.restore();
    } else {
      ctx.drawImage(brandIcon, logoX, logoY, logoSize, logoSize);
    }
  } else {
    ctx.fillStyle = palette.panelHeaderBg;
    ctx.fillRect(logoX, logoY, logoSize, logoSize);
  }

  const textLeft = logoX + logoSize + 10;
  ctx.font = '800 9.5px "Space Grotesk", sans-serif';
  ctx.fillStyle = palette.accentPrimary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(config.cadastral.municipalityHeader || 'URBIGEO · GEOURBAN STUDIO', textLeft, logoY, panel.w - pad * 2 - logoSize - 12);

  ctx.font = '800 13px "Space Grotesk", sans-serif';
  ctx.fillStyle = palette.textPrimary;
  ctx.fillText(
    (config.cadastral.urbanizationName || config.cadastral.planTitle).toUpperCase(),
    textLeft,
    logoY + 13,
    panel.w - pad * 2 - logoSize - 12
  );

  ctx.font = '600 9.5px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = palette.textSecondary;
  ctx.fillText(config.cadastral.planTitle, textLeft, logoY + 31, panel.w - pad * 2 - logoSize - 12);

  const gridTop = logoY + logoSize + 10;
  const gridH = panel.y + panel.h - gridTop - 8;
  if (gridH > 26) {
    ctx.strokeStyle = palette.borderInner;
    ctx.lineWidth = 1;
    ctx.strokeRect(panel.x + pad, gridTop, panel.w - pad * 2, gridH);

    const colW = (panel.w - pad * 2) / 3;
    const rowH = gridH / 2;

    ctx.beginPath();
    ctx.moveTo(panel.x + pad + colW, gridTop);
    ctx.lineTo(panel.x + pad + colW, gridTop + gridH);
    ctx.moveTo(panel.x + pad + colW * 2, gridTop);
    ctx.lineTo(panel.x + pad + colW * 2, gridTop + gridH);
    ctx.moveTo(panel.x + pad, gridTop + rowH);
    ctx.lineTo(panel.x + panel.w - pad, gridTop + rowH);
    ctx.stroke();

    const dateStr = config.cadastral.projectDate || new Date().toLocaleDateString('es-BO');
    const supLabel = config.cadastral.surfaceConstruidaM2
      ? `${config.cadastral.surfaceLevantamientoM2 || '—'} / Const. ${config.cadastral.surfaceConstruidaM2}`
      : config.cadastral.surfaceLevantamientoM2 || carto.epsgCode;

    const cells: Array<{ col: number; row: number; k: string; v: string }> = [
      { col: 0, row: 0, k: 'PROPIETARIO', v: config.cadastral.ownerName || '—' },
      { col: 1, row: 0, k: 'PROYECTISTA', v: config.cadastral.architectName || 'UrbiGeo' },
      { col: 2, row: 0, k: 'FECHA / REV.', v: `${dateStr} · Rev.${config.cadastral.revision}` },
      { col: 0, row: 1, k: 'SUP. / CONSTR.', v: supLabel },
      { col: 1, row: 1, k: 'ESCALA PLANTA', v: `1 : ${mainScale.toLocaleString('es-BO')} (${config.paperSize})` },
      { col: 2, row: 1, k: 'LÁMINA Nº', v: config.cadastral.sheetCode || '01/01' },
    ];

    for (const cell of cells) {
      const cx = panel.x + pad + cell.col * colW + 6;
      const cy = gridTop + cell.row * rowH + 4;
      ctx.font = '700 7.5px "Space Grotesk", sans-serif';
      ctx.fillStyle = palette.textMuted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(cell.k, cx, cy);

      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.fillStyle = palette.textPrimary;
      ctx.fillText(cell.v, cx, cy + 11, colW - 10);
    }
  }

  ctx.restore();
}
