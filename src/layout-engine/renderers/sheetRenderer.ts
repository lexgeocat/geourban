import type { ExtractedCartography, LotCatalogItem } from '../extractors/cartographyExtractor';
import type { LayoutTemplateEntry } from '../model/dxfTemplateModel';
import {
  getEffectivePaperDimensionsMm,
  resolveLayoutFontCss,
  resolveLayoutLineDash,
  THEME_PALETTES,
  type CadastralFormFields,
  type LayoutConfig,
  type SheetAnnotationEntity,
  type SheetAnnotationKind,
  type ThemePalette,
  type ViewportBoxNormalized,
} from '../model/layoutTypes';
import {
  computeAutoLocationScale,
  computeAutoScale,
  drawLegendAndScalePanel,
  drawSurfaceBalancePanel,
  drawTitleBlockPanel,
  type Rect,
  type WidgetRenderedHitBox,
} from './cartographicPrimitives';
import {
  computeFittedDxfRect,
  interpolateCarimboText,
  renderDxfCarimbo,
  type DxfRenderedHitBox,
  type DynamicDxfValues,
} from './dxfCarimboRenderer';
import { renderLocationViewport } from './locationViewportRenderer';
import { renderMainViewport } from './mainViewportRenderer';

export interface AnnotationRenderedHitBox {
  id: string;
  kind: SheetAnnotationKind;
  rect: Rect;
}

export interface SheetRenderResult {
  widthPx: number;
  heightPx: number;
  paperWidthMm: number;
  paperHeightMm: number;
  innerRect: Rect;
  mainViewportRect: Rect;
  locationViewportRect: Rect;
  effectiveMainScale: number;
  effectiveLocationScale: number;
  dxfHitBoxes: DxfRenderedHitBox[];
  widgetHitBoxes: WidgetRenderedHitBox[];
  annotationHitBoxes: AnnotationRenderedHitBox[];
}

function normalizedBoxToRect(box: ViewportBoxNormalized, container: Rect): Rect {
  return {
    x: container.x + box.x * container.w,
    y: container.y + box.y * container.h,
    w: box.w * container.w,
    h: box.h * container.h,
  };
}

export function computeSheetGeometry(
  config: LayoutConfig,
  template: LayoutTemplateEntry
): {
  widthPx: number;
  heightPx: number;
  paperWidthMm: number;
  paperHeightMm: number;
  innerRect: Rect;
} {
  const { widthMm: paperWidthMm, heightMm: paperHeightMm } = getEffectivePaperDimensionsMm(config);
  const isLandscape = paperWidthMm >= paperHeightMm;

  const longEdgePx = 2400;
  const shortEdgePx = isLandscape
    ? Math.round(longEdgePx * (paperHeightMm / paperWidthMm))
    : Math.round(longEdgePx * (paperWidthMm / paperHeightMm));

  const widthPx = isLandscape ? longEdgePx : shortEdgePx;
  const heightPx = isLandscape ? shortEdgePx : longEdgePx;

  const pxPerMm = widthPx / paperWidthMm;
  const marginPx = Math.max(8, Math.round((config.marginMm || 8) * pxPerMm));

  const targetRect: Rect = {
    x: marginPx,
    y: marginPx,
    w: Math.max(200, widthPx - marginPx * 2),
    h: Math.max(200, heightPx - marginPx * 2),
  };

  if (template.dxfDoc) {
    const fittedRect = computeFittedDxfRect(targetRect, template.dxfDoc, config.carimboFitMode);
    return {
      widthPx,
      heightPx,
      paperWidthMm,
      paperHeightMm,
      innerRect: fittedRect,
    };
  }

  return {
    widthPx,
    heightPx,
    paperWidthMm,
    paperHeightMm,
    innerRect: {
      x: marginPx + 10,
      y: marginPx + 10,
      w: Math.max(200, widthPx - (marginPx + 10) * 2),
      h: Math.max(200, heightPx - (marginPx + 10) * 2),
    },
  };
}

export function resolveDataDrivenCadastral(params: {
  carto: ExtractedCartography;
  config: LayoutConfig;
  selectedLot: LotCatalogItem | null;
  effectiveMainScale: number;
  effectiveLocationScale: number;
}): { effectiveCadastral: CadastralFormFields; dxfValues: DynamicDxfValues } {
  const { carto, config, selectedLot, effectiveMainScale, effectiveLocationScale } = params;
  const isLotMode = config.scopeMode === 'lot' && selectedLot !== null;
  const base = config.cadastral;

  let resolved: CadastralFormFields;

  if (isLotMode && config.dataDrivenEnabled) {
    const lotIdx = carto.lotsCatalog.findIndex((l) => l.id === selectedLot.id);
    const lotNumStr = lotIdx >= 0 ? String(lotIdx + 1).padStart(2, '0') : '01';
    const totalStr = String(carto.lotsCatalog.length).padStart(2, '0');
    const fa = selectedLot.featureAttributes;
    const ov = config.lotAttributeOverrides[selectedLot.id] ?? {};

    resolved = {
      ...base,
      lotCode: selectedLot.code || base.lotCode,
      manzanoCode: selectedLot.manzanoCode || base.manzanoCode,
      surfaceLevantamientoM2: `${selectedLot.areaM2.toFixed(2)} m²`,
      surfaceUtilM2: `${selectedLot.areaM2.toFixed(2)} m²`,
      frontM: `${selectedLot.frontM.toFixed(2)} m`,
      depthM: `${selectedLot.depthM.toFixed(2)} m`,
      surfaceTestimonioM2:
        ov.surfaceTestimonioM2 ??
        (fa.surfaceTestimonioM2 || fa.supTestimonio || base.surfaceTestimonioM2),
      surfaceConstruidaM2:
        ov.surfaceConstruidaM2 ??
        (fa.surfaceConstruidaM2 || fa.supConstruida || base.surfaceConstruidaM2),
      ownerName: ov.ownerName ?? (fa.ownerName || fa.propietario || base.ownerName),
      sellerOrProcess: ov.sellerOrProcess ?? (fa.sellerOrProcess || fa.tramite || base.sellerOrProcess),
      locationAddress: ov.locationAddress ?? (fa.locationAddress || fa.direccion || base.locationAddress),
      ddrrMatricula: ov.ddrrMatricula ?? (fa.ddrrMatricula || fa.matricula || base.ddrrMatricula),
      catastralCode: ov.catastralCode ?? (fa.catastralCode || fa.catastro || base.catastralCode),
      landUse: ov.landUse ?? (fa.landUse || fa.usoSuelo || base.landUse),
      sheetCode: base.sheetCode || `LÁM. ${lotNumStr} / ${totalStr}`,
    };
  } else {
    resolved = { ...base };
  }

  const dxfValues: DynamicDxfValues = {
    mainScale: effectiveMainScale,
    locationScale: effectiveLocationScale,
    cadastral: resolved,
    lotPerimeterM: isLotMode ? `${selectedLot.perimeterM.toFixed(2)} m` : `${carto.totalStreetLengthM.toFixed(2)} m`,
    frontStreetName: isLotMode ? selectedLot.frontStreetName : '',
    eastM: isLotMode ? selectedLot.centroid[0].toFixed(2) : carto.centroidMetric[0].toFixed(2),
    northM: isLotMode ? selectedLot.centroid[1].toFixed(2) : carto.centroidMetric[1].toFixed(2),
  };

  resolved = {
    ...resolved,
    planTitle: interpolateCarimboText(resolved.planTitle, dxfValues),
    municipalityHeader: interpolateCarimboText(resolved.municipalityHeader, dxfValues),
    jurisdictionSubtitle: interpolateCarimboText(resolved.jurisdictionSubtitle, dxfValues),
    ownerName: interpolateCarimboText(resolved.ownerName, dxfValues),
    sellerOrProcess: interpolateCarimboText(resolved.sellerOrProcess, dxfValues),
    locationAddress: interpolateCarimboText(resolved.locationAddress, dxfValues),
    urbanizationName: interpolateCarimboText(resolved.urbanizationName, dxfValues),
  };
  dxfValues.cadastral = resolved;

  return { effectiveCadastral: resolved, dxfValues };
}

function renderSheetAnnotations(params: {
  ctx: CanvasRenderingContext2D;
  annotations: SheetAnnotationEntity[];
  containerRect: Rect;
  widthPx: number;
  dxfValues: DynamicDxfValues;
  palette: ThemePalette;
}): AnnotationRenderedHitBox[] {
  const { ctx, annotations, containerRect, widthPx, dxfValues, palette } = params;
  const hitBoxes: AnnotationRenderedHitBox[] = [];
  const pxScale = widthPx / 1200;

  for (const ann of annotations) {
    const xPx = containerRect.x + ann.x * containerRect.w;
    const yPx = containerRect.y + ann.y * containerRect.h;
    const wPx = ann.w * containerRect.w;
    const hPx = ann.h * containerRect.h;

    ctx.save();
    if (ann.kind === 'rect') {
      if (ann.fillOpaque) {
        ctx.fillStyle = palette.panelBg;
        ctx.fillRect(xPx, yPx, wPx, hPx);
      }
      const lw = (ann.lineWidth ?? 1.5) * (pxScale * 0.65);
      const effStyle = ann.lineStyle ?? (ann.dashed ? 'dashed' : 'solid');
      ctx.strokeStyle = palette.dxfStrokeDefault;
      ctx.lineWidth = lw;
      ctx.setLineDash(resolveLayoutLineDash(effStyle, lw));
      ctx.strokeRect(xPx, yPx, wPx, hPx);

      if (ann.doubleBorder && wPx > 14 && hPx > 14) {
        const inset = Math.max(4, lw * 2.4);
        ctx.lineWidth = Math.max(0.7, lw * 0.65);
        ctx.strokeRect(xPx + inset, yPx + inset, wPx - inset * 2, hPx - inset * 2);
      }
      hitBoxes.push({
        id: ann.id,
        kind: 'rect',
        rect: { x: xPx, y: yPx, w: Math.max(14, wPx), h: Math.max(14, hPx) },
      });
    } else if (ann.kind === 'line') {
      const x2 = xPx + wPx;
      const y2 = yPx + hPx;
      const lw = (ann.lineWidth ?? 1.8) * (pxScale * 0.65);
      const effStyle = ann.lineStyle ?? (ann.dashed ? 'dashed' : 'solid');
      ctx.strokeStyle = palette.dxfStrokeDefault;
      ctx.lineWidth = lw;
      ctx.setLineDash(resolveLayoutLineDash(effStyle, lw));
      ctx.beginPath();
      ctx.moveTo(xPx, yPx);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const minX = Math.min(xPx, x2);
      const minY = Math.min(yPx, y2);
      const rawW = Math.abs(wPx);
      const rawH = Math.abs(hPx);
      hitBoxes.push({
        id: ann.id,
        kind: 'line',
        rect: {
          x: rawW < 12 ? minX - (12 - rawW) / 2 : minX,
          y: rawH < 12 ? minY - (12 - rawH) / 2 : minY,
          w: Math.max(12, rawW),
          h: Math.max(12, rawH),
        },
      });
    } else if (ann.kind === 'text') {
      const display = interpolateCarimboText(ann.text || 'TEXTO INDEPENDIENTE', dxfValues);
      const fontPx = Math.max(9, Math.min(96, (ann.fontSizePt ?? 12) * pxScale));
      const isBold = ann.bold !== undefined ? ann.bold : true;
      const fontStylePrefix = `${ann.italic ? 'italic ' : ''}${isBold ? '700' : '500'}`;
      ctx.font = `${fontStylePrefix} ${fontPx.toFixed(1)}px ${resolveLayoutFontCss(ann.fontFamily)}`;
      const textW = Math.max(24, ctx.measureText(display).width);
      const boxH = fontPx * 1.25;

      if (ann.fillOpaque) {
        ctx.fillStyle = palette.panelBg;
        ctx.fillRect(xPx - 4, yPx - 2, textW + 8, boxH + 4);
      }
      ctx.fillStyle = palette.dxfTextDefault;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(display, xPx, yPx);

      if (ann.underline) {
        ctx.strokeStyle = palette.dxfTextDefault;
        ctx.lineWidth = Math.max(0.9, fontPx * 0.075);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(xPx, yPx + fontPx * 1.06);
        ctx.lineTo(xPx + textW, yPx + fontPx * 1.06);
        ctx.stroke();
      }

      hitBoxes.push({
        id: ann.id,
        kind: 'text',
        rect: { x: xPx - 3, y: yPx - 2, w: textW + 8, h: boxH + 4 },
      });
    }
    ctx.restore();
  }

  return hitBoxes;
}

export function renderCartographicSheet(params: {
  canvas: HTMLCanvasElement;
  carto: ExtractedCartography;
  config: LayoutConfig;
  template: LayoutTemplateEntry;
  selectedLot: LotCatalogItem | null;
  brandIcon: HTMLImageElement | null;
}): SheetRenderResult {
  const { canvas, carto, config, template, selectedLot, brandIcon } = params;
  const palette = THEME_PALETTES[config.theme];

  const { widthPx, heightPx, paperWidthMm, paperHeightMm, innerRect } = computeSheetGeometry(
    config,
    template
  );

  if (canvas.width !== widthPx || canvas.height !== heightPx) {
    canvas.width = widthPx;
    canvas.height = heightPx;
  }

  const mainRect = normalizedBoxToRect(config.mainViewport.boxNormalized, innerRect);
  const locRect = normalizedBoxToRect(config.locationViewport.boxNormalized, innerRect);

  const mainVpWidthMm = ((mainRect.w - 48) / widthPx) * paperWidthMm;
  const mainVpHeightMm = ((mainRect.h - 48) / heightPx) * paperHeightMm;
  const locVpWidthMm = (locRect.w / widthPx) * paperWidthMm;
  const locVpHeightMm = (locRect.h / heightPx) * paperHeightMm;

  const isLotMode = config.scopeMode === 'lot' && selectedLot !== null;
  const targetMainBBox = isLotMode ? selectedLot.bboxMetric : carto.bboxMetric;
  const targetLocBBox = isLotMode ? selectedLot.manzanoBBox : carto.bboxMetric;

  const autoMainScale = computeAutoScale(targetMainBBox, mainVpWidthMm, mainVpHeightMm);
  const effectiveMainScale =
    config.mainViewport.scaleMode === 'auto' ? autoMainScale : config.mainViewport.scaleDenominator;

  const autoLocScale = computeAutoLocationScale(targetLocBBox, locVpWidthMm, locVpHeightMm);
  const effectiveLocationScale =
    config.locationViewport.scaleMode === 'auto'
      ? autoLocScale
      : config.locationViewport.scaleDenominator;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      widthPx,
      heightPx,
      paperWidthMm,
      paperHeightMm,
      innerRect,
      mainViewportRect: mainRect,
      locationViewportRect: locRect,
      effectiveMainScale,
      effectiveLocationScale,
      dxfHitBoxes: [],
      widgetHitBoxes: [],
      annotationHitBoxes: [],
    };
  }

  ctx.save();
  ctx.fillStyle = palette.sheetBg;
  ctx.fillRect(0, 0, widthPx, heightPx);

  const { effectiveCadastral, dxfValues } = resolveDataDrivenCadastral({
    carto,
    config,
    selectedLot,
    effectiveMainScale,
    effectiveLocationScale,
  });

  let dxfHitBoxes: DxfRenderedHitBox[] = [];
  const widgetHitBoxes: WidgetRenderedHitBox[] = [];

  if (template.dxfDoc) {
    const dxfOut = renderDxfCarimbo({
      ctx,
      targetRect: innerRect,
      dxfDoc: template.dxfDoc,
      values: dxfValues,
      dxfTextOverrides: config.dxfTextOverrides,
      dxfEntityEdits: config.dxfEntityEdits,
      carimboFitMode: config.carimboFitMode,
      carimboScalePercent: config.carimboScalePercent,
      palette,
    });
    dxfHitBoxes = dxfOut.dxfHitBoxes;

    widgetHitBoxes.push(
      ...renderLocationViewport({
        ctx,
        boxRect: locRect,
        carto,
        selectedLot,
        locationScale: effectiveLocationScale,
        paperWidthMm,
        canvasWidthPx: widthPx,
        config,
        palette,
        drawHeaderStrip: false,
      })
    );

    widgetHitBoxes.push(
      ...renderMainViewport({
        ctx,
        frame: mainRect,
        carto,
        selectedLot,
        scaleDenominator: effectiveMainScale,
        paperWidthMm,
        canvasWidthPx: widthPx,
        config,
        effectiveCadastral,
        dxfValues,
        palette,
      })
    );
  } else {
    // Marco exterior técnico limpio
    const pxPerMm = widthPx / paperWidthMm;
    const margin = Math.max(8, Math.round((config.marginMm || 8) * pxPerMm));
    ctx.strokeStyle = palette.borderOuter;
    ctx.lineWidth = 2.6;
    ctx.strokeRect(margin, margin, widthPx - margin * 2, heightPx - margin * 2);
    ctx.lineWidth = 0.9;
    ctx.strokeRect(margin + 5, margin + 5, widthPx - (margin + 5) * 2, heightPx - (margin + 5) * 2);

    widgetHitBoxes.push(
      ...renderMainViewport({
        ctx,
        frame: mainRect,
        carto,
        selectedLot,
        scaleDenominator: effectiveMainScale,
        paperWidthMm,
        canvasWidthPx: widthPx,
        config,
        effectiveCadastral,
        dxfValues,
        palette,
      })
    );

    widgetHitBoxes.push(
      ...renderLocationViewport({
        ctx,
        boxRect: locRect,
        carto,
        selectedLot,
        locationScale: effectiveLocationScale,
        paperWidthMm,
        canvasWidthPx: widthPx,
        config,
        palette,
        drawHeaderStrip: !template.isBlankSheet,
      })
    );

    if (!template.isBlankSheet) {
      const gap = 14;
      let statsRect: Rect;
      let legendRect: Rect;
      let titleRect: Rect;

      if (template.isoPreset === 'banda-inferior') {
        const rowY = innerRect.y + innerRect.h * 0.71;
        const bottomH = innerRect.h * 0.275;
        const w1 = innerRect.w * 0.23;
        const w2 = innerRect.w * 0.25;
        const w3 = innerRect.w * 0.22;
        const w4 = innerRect.w - w1 - w2 - w3 - gap * 3;
        statsRect = { x: innerRect.x + w1 + gap, y: rowY, w: w2, h: bottomH };
        legendRect = { x: statsRect.x + w2 + gap, y: rowY, w: w3, h: bottomH };
        titleRect = { x: legendRect.x + w3 + gap, y: rowY, w: w4, h: bottomH };
      } else {
        const colX = innerRect.x + innerRect.w * 0.695;
        const colW = innerRect.w * 0.285;
        const statsY = innerRect.y + innerRect.h * 0.34 + gap;
        const statsH = innerRect.h * 0.22;
        const legH = innerRect.h * 0.2;
        const titleH = innerRect.y + innerRect.h - (statsY + statsH + legH + gap * 2);
        statsRect = { x: colX, y: statsY, w: colW, h: statsH };
        legendRect = { x: colX, y: statsY + statsH + gap, w: colW, h: legH };
        titleRect = { x: colX, y: statsY + statsH + legH + gap * 2, w: colW, h: titleH };
      }

      drawSurfaceBalancePanel(ctx, statsRect, carto, palette);
      drawLegendAndScalePanel(ctx, legendRect, carto, effectiveMainScale, palette, config.display.showGraphicScaleBar);
      drawTitleBlockPanel(
        ctx,
        titleRect,
        carto,
        effectiveMainScale,
        { ...config, cadastral: effectiveCadastral },
        palette,
        brandIcon
      );
    }
  }

  // Anotaciones libres sobre la lámina (textos independientes, recuadros y líneas añadidas)
  const annotationHitBoxes = renderSheetAnnotations({
    ctx,
    annotations: config.sheetAnnotations,
    containerRect: innerRect,
    widthPx,
    dxfValues,
    palette,
  });

  ctx.restore();

  return {
    widthPx,
    heightPx,
    paperWidthMm,
    paperHeightMm,
    innerRect,
    mainViewportRect: mainRect,
    locationViewportRect: locRect,
    effectiveMainScale,
    effectiveLocationScale,
    dxfHitBoxes,
    widgetHitBoxes,
    annotationHitBoxes,
  };
}
