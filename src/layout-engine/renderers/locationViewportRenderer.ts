import type { ExtractedCartography, LotCatalogItem } from '../extractors/cartographyExtractor';
import type { LayoutConfig, ThemePalette } from '../model/layoutTypes';
import {
  drawGraphicScaleBar,
  drawNorthArrow,
  getCachedOsmTile,
  placeWidgetRect,
  type Rect,
  type WidgetRenderedHitBox,
} from './cartographicPrimitives';

export function renderLocationViewport(params: {
  ctx: CanvasRenderingContext2D;
  boxRect: Rect;
  carto: ExtractedCartography;
  selectedLot: LotCatalogItem | null;
  locationScale: number;
  paperWidthMm: number;
  canvasWidthPx: number;
  config: LayoutConfig;
  palette: ThemePalette;
  drawHeaderStrip?: boolean;
}): WidgetRenderedHitBox[] {
  const {
    ctx,
    boxRect,
    carto,
    selectedLot,
    locationScale,
    paperWidthMm,
    canvasWidthPx,
    config,
    palette,
    drawHeaderStrip = false,
  } = params;

  const widgetHitBoxes: WidgetRenderedHitBox[] = [];

  ctx.save();
  ctx.fillStyle = palette.locMapBg;
  ctx.fillRect(boxRect.x, boxRect.y, boxRect.w, boxRect.h);

  let mapBox = boxRect;
  if (drawHeaderStrip) {
    const headerH = 24;
    ctx.fillStyle = palette.panelHeaderBg;
    ctx.fillRect(boxRect.x, boxRect.y, boxRect.w, headerH);
    ctx.font = '800 10px "Space Grotesk", sans-serif';
    ctx.fillStyle = palette.panelHeaderText;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('PLANO DE UBICACIÓN', boxRect.x + 8, boxRect.y + headerH / 2);

    ctx.font = '700 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = palette.panelHeaderText;
    ctx.textAlign = 'right';
    ctx.fillText(`ESC. 1:${locationScale.toLocaleString('es-BO')}`, boxRect.x + boxRect.w - 8, boxRect.y + headerH / 2);

    mapBox = {
      x: boxRect.x + 2,
      y: boxRect.y + headerH + 2,
      w: Math.max(20, boxRect.w - 4),
      h: Math.max(20, boxRect.h - headerH - 4),
    };
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(mapBox.x, mapBox.y, mapBox.w, mapBox.h);
  ctx.clip();

  const isLotMode = config.scopeMode === 'lot' && selectedLot !== null;
  const pxPerMm = canvasWidthPx / paperWidthMm;
  const pxPerMeter = (1000 / Math.max(50, locationScale)) * pxPerMm;

  const defaultCenter: [number, number] = isLotMode
    ? [
        (selectedLot.manzanoBBox[0] + selectedLot.manzanoBBox[2]) / 2,
        (selectedLot.manzanoBBox[1] + selectedLot.manzanoBBox[3]) / 2,
      ]
    : carto.centroidMetric;

  const [panX, panY] = config.locationViewport.panOffsetMetric;
  const cxMetric = defaultCenter[0] + panX;
  const cyMetric = defaultCenter[1] + panY;

  const toScreen = (pt: [number, number]): [number, number] => [
    mapBox.x + mapBox.w / 2 + (pt[0] - cxMetric) * pxPerMeter,
    mapBox.y + mapBox.h / 2 - (pt[1] - cyMetric) * pxPerMeter,
  ];

  // Opcional: Mosaicos OSM de contexto
  let anyTileDrawn = false;
  if (config.display.showLocationOsmTiles) {
    const [lon, lat] = carto.centroidLonLat;
    const z = Math.max(12, Math.min(17, Math.round(17 - Math.log2(Math.max(500, locationScale) / 500))));
    const n = Math.pow(2, z);
    const exactTileX = ((lon + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const exactTileY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const centerTileX = Math.floor(exactTileX);
    const centerTileY = Math.floor(exactTileY);
    const offX = (exactTileX - centerTileX) * 256;
    const offY = (exactTileY - centerTileY) * 256;

    const mapCx = mapBox.x + mapBox.w / 2;
    const mapCy = mapBox.y + mapBox.h / 2;

    ctx.save();
    ctx.globalAlpha = palette.isMonochrome ? 0.28 : 0.35;
    if (palette.isMonochrome) {
      ctx.filter = palette.isLight ? 'grayscale(100%) contrast(115%)' : 'grayscale(100%) invert(90%) contrast(110%)';
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = ((centerTileX + dx) % n + n) % n;
        const ty = Math.max(0, Math.min(n - 1, centerTileY + dy));
        const tileImg = getCachedOsmTile(z, tx, ty);
        if (tileImg && tileImg.complete && tileImg.naturalWidth > 0) {
          ctx.drawImage(tileImg, mapCx - offX + dx * 256, mapCy - offY + dy * 256, 256, 256);
          anyTileDrawn = true;
        }
      }
    }
    ctx.restore();
  }

  if (!anyTileDrawn && config.display.showGrid) {
    ctx.strokeStyle = palette.gridMinor;
    ctx.lineWidth = 0.7;
    const gridPx = 32;
    for (let x = mapBox.x; x <= mapBox.x + mapBox.w; x += gridPx) {
      ctx.beginPath();
      ctx.moveTo(x, mapBox.y);
      ctx.lineTo(x, mapBox.y + mapBox.h);
      ctx.stroke();
    }
    for (let y = mapBox.y; y <= mapBox.y + mapBox.h; y += gridPx) {
      ctx.beginPath();
      ctx.moveTo(mapBox.x, y);
      ctx.lineTo(mapBox.x + mapBox.w, y);
      ctx.stroke();
    }
  }

  // 1. Calles
  for (const st of carto.streets) {
    if (st.path.length < 2) continue;
    const roadW = Math.max(2, st.widthM * pxPerMeter);
    ctx.beginPath();
    st.path.forEach((pt, idx) => {
      const [sx, sy] = toScreen(pt);
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = palette.streetRoadFill;
    ctx.lineWidth = roadW;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = palette.borderInner;
    ctx.lineWidth = 0.7;
    ctx.stroke();

    if (config.display.showStreetNames && st.name && st.path.length >= 2) {
      const [ax, ay] = toScreen(st.path[0]);
      const [bx, by] = toScreen(st.path[st.path.length - 1]);
      if (Math.hypot(bx - ax, by - ay) > 45) {
        let ang = Math.atan2(by - ay, bx - ax);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate((ax + bx) / 2, (ay + by) / 2);
        ctx.rotate(ang);
        ctx.font = '700 8px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = palette.textSecondary;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.name.toUpperCase(), 0, 0);
        ctx.restore();
      }
    }
  }

  // 2. Manzanos y lotes
  for (const poly of carto.polygons) {
    if (poly.ring.length < 3) continue;
    const isSelectedTarget = isLotMode && poly.id === selectedLot.id;

    ctx.beginPath();
    poly.ring.forEach((pt, idx) => {
      const [sx, sy] = toScreen(pt);
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();

    if (poly.kind === 'manzana') {
      ctx.fillStyle = palette.manzanaFill;
      if (!poly.subdivided) ctx.fill();
      ctx.strokeStyle = palette.borderOuter;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    } else if (poly.kind === 'lote') {
      if (isSelectedTarget) {
        ctx.fillStyle = palette.accentPrimary;
        ctx.globalAlpha = palette.isMonochrome ? 0.55 : 0.68;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = palette.accentPrimary;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      } else {
        ctx.fillStyle = palette.loteFill;
        ctx.fill();
        ctx.strokeStyle = palette.borderInner;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    } else if (poly.kind === 'perimetro') {
      ctx.strokeStyle = isLotMode ? palette.borderInner : palette.accentPrimary;
      ctx.lineWidth = isLotMode ? 1.2 : 2.2;
      ctx.stroke();
    }
  }

  // 3. Mira y etiqueta objetivo
  const targetPt = isLotMode ? selectedLot.centroid : carto.centroidMetric;
  const [tx, ty] = toScreen(targetPt);

  ctx.strokeStyle = palette.accentPrimary;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(tx, ty, 16, 0, Math.PI * 2);
  ctx.stroke();

  const tag = isLotMode ? `LOTE ${selectedLot.code}` : 'ÁREA DEL PROYECTO';
  ctx.font = '800 8.5px "Space Grotesk", sans-serif';
  const tw = ctx.measureText(tag).width + 10;
  const pillX = Math.max(mapBox.x + 6, Math.min(mapBox.x + mapBox.w - tw - 6, tx + 10));
  const pillY = Math.max(mapBox.y + 6, Math.min(mapBox.y + mapBox.h - 22, ty - 24));
  ctx.fillStyle = palette.accentPrimary;
  ctx.fillRect(pillX, pillY, tw, 15);
  ctx.fillStyle = palette.isMonochrome ? palette.sheetBg : '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, pillX + 5, pillY + 7.5);

  // Norte mini (movible y escalable)
  const wLocN = config.widgets.locationNorthArrow;
  if (config.display.showLocationNorthArrow && wLocN.visible) {
    const r = Math.max(8, Math.min(38, 14 * wLocN.scale));
    const nRect = placeWidgetRect(mapBox, wLocN, r * 2 + 4, r * 2 + 4);
    drawNorthArrow(ctx, nRect.x + nRect.w / 2, nRect.y + nRect.h / 2, r, palette);
    widgetHitBoxes.push({
      id: 'locationNorthArrow',
      label: 'Norte (Ubicación)',
      rect: nRect,
      containerRect: mapBox,
    });
  }

  // Escala gráfica mini (movible y escalable)
  const wLocS = config.widgets.locationGraphicScale;
  if (config.display.showLocationScaleBar && wLocS.visible && mapBox.w > 130 && mapBox.h > 90) {
    const sc = Math.max(0.55, Math.min(2.4, wLocS.scale));
    const sbW = Math.min(mapBox.w * 0.85, 148 * sc);
    const sbH = 32 * sc;
    const sbRect = placeWidgetRect(mapBox, wLocS, sbW, sbH);
    ctx.fillStyle = palette.panelBg;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(sbRect.x, sbRect.y, sbRect.w, sbRect.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.borderInner;
    ctx.lineWidth = Math.max(0.8, 0.9 * sc);
    ctx.strokeRect(sbRect.x, sbRect.y, sbRect.w, sbRect.h);
    drawGraphicScaleBar(ctx, sbRect, locationScale, palette, true);
    widgetHitBoxes.push({
      id: 'locationGraphicScale',
      label: 'Escala Gráfica (Ubicación)',
      rect: sbRect,
      containerRect: mapBox,
    });
  }

  ctx.restore(); // End mapBox clip

  // Marco del viewport de ubicación
  ctx.strokeStyle = palette.borderOuter;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(boxRect.x, boxRect.y, boxRect.w, boxRect.h);

  ctx.restore();
  return widgetHitBoxes;
}
