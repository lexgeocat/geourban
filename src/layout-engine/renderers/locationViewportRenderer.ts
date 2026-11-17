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
import {
  renderStreetAxes,
  renderStreetFallback,
  renderUnionedRoadNetworks,
  resolveDesignerColor,
} from './designerStyleHelpers';

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
  cadScaleOverride?: number;
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
    cadScaleOverride,
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

  const cadScale = cadScaleOverride ?? Math.max(1.5, canvasWidthPx / 1000);
  const isDesignerMode = config.display.viewportStyleMode === 'designer';
  const cadBlackInk = palette.isLight ? '#000000' : '#FFFFFF';
  const cadSecondaryInk = palette.isLight ? '#334155' : '#CBD5E1';
  const cadAxisInk = palette.isLight ? '#475569' : '#94A3B8';
  const designerCurbColor = palette.isLight ? '#475569' : '#CBD5E1';

  // 1. Red vial y aceras unionadas (cero cruces en intersecciones)
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
      roadLineWidth: Math.max(1.4, 0.9 * cadScale),
      curbLineWidth: Math.max(1.0, 0.65 * cadScale),
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
        roadLineWidth: Math.max(1.4, 0.9 * cadScale),
        curbLineWidth: Math.max(1.0, 0.65 * cadScale),
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
        Math.max(1.0, 0.65 * cadScale)
      );
      strokeRing(rb.roadOuter, rbColor, Math.max(1.4, 0.9 * cadScale));
      if (rb.island) strokeRing(rb.island, rbColor, Math.max(1.4, 0.9 * cadScale));
    }
  }

  renderStreetAxes({
    ctx,
    streets: carto.streets,
    roundabouts: carto.roundabouts,
    toScreen,
    axisStroke: isDesignerMode
      ? resolveDesignerColor(carto.streets[0]?.color ?? '#8b5cf6', 0.85, palette.isLight)
      : cadAxisInk,
    lineWidth: Math.max(0.9, 0.58 * cadScale),
    cadScale: cadScale * 0.75,
  });

  if (config.display.showStreetNames) {
    for (const st of carto.streets) {
      if (st.path.length < 2 || !st.name) continue;
      const [ax, ay] = toScreen(st.path[0]);
      const [bx, by] = toScreen(st.path[st.path.length - 1]);
      if (Math.hypot(bx - ax, by - ay) > 45) {
        let ang = Math.atan2(by - ay, bx - ax);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate((ax + bx) / 2, (ay + by) / 2);
        ctx.rotate(ang);
        ctx.font = '700 8.5px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = isDesignerMode
          ? resolveDesignerColor(st.color, 1, palette.isLight)
          : cadBlackInk;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.name.toUpperCase(), 0, 0);
        ctx.restore();
      }
    }
  }

  // 2. Manzanos, lotes, perímetros y círculos
  const sortedPolys = [...carto.polygons].sort((a, b) => a.zIndex - b.zIndex);
  for (const poly of sortedPolys) {
    if (poly.ring.length < 3) continue;
    const isSelectedTarget = isLotMode && poly.id === selectedLot.id;

    ctx.beginPath();
    poly.ring.forEach((pt, idx) => {
      const [sx, sy] = toScreen(pt);
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();

    const baseWidthFactor = Math.max(0.75, (poly.strokeWidth || 2) / 2);

    if (isDesignerMode) {
      const stroke = resolveDesignerColor(poly.color, 1, palette.isLight);
      if (isSelectedTarget) {
        ctx.fillStyle = resolveDesignerColor(poly.color, 0.22, palette.isLight);
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(2.4, 1.55 * cadScale * baseWidthFactor);
        ctx.stroke();
      } else {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1.3, 0.85 * cadScale * baseWidthFactor);
        ctx.stroke();
      }
    } else if (poly.kind === 'manzana') {
      ctx.strokeStyle = cadBlackInk;
      ctx.lineWidth = Math.max(1.7, 1.1 * cadScale);
      ctx.stroke();
    } else if (poly.kind === 'lote') {
      if (isSelectedTarget) {
        ctx.fillStyle = palette.isLight ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.2)';
        ctx.fill();
        ctx.strokeStyle = cadBlackInk;
        ctx.lineWidth = Math.max(2.5, 1.65 * cadScale);
        ctx.stroke();
      } else {
        ctx.strokeStyle = cadBlackInk;
        ctx.lineWidth = Math.max(1.25, 0.8 * cadScale);
        ctx.stroke();
      }
    } else if (poly.kind === 'perimetro') {
      ctx.strokeStyle = cadBlackInk;
      ctx.lineWidth = isLotMode ? Math.max(1.4, 0.9 * cadScale) : Math.max(2.2, 1.4 * cadScale);
      ctx.stroke();
    }
  }

  // Líneas y puntos en Ubicación
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
    ctx.lineWidth = Math.max(1.2, 0.85 * cadScale);
    ctx.stroke();
  }
  for (const pt of carto.points) {
    const [sx, sy] = toScreen(pt.coord);
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(3.2, 1.6 * cadScale), 0, Math.PI * 2);
    ctx.fillStyle = isDesignerMode
      ? resolveDesignerColor(pt.color, 1, palette.isLight)
      : cadBlackInk;
    ctx.fill();
  }

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
  ctx.lineWidth = Math.max(1.4, 1.0 * cadScale);
  ctx.strokeRect(boxRect.x, boxRect.y, boxRect.w, boxRect.h);

  ctx.restore();
  return widgetHitBoxes;
}
