import { useEffect, useRef, useState } from 'react';
import {
  Bold,
  Frame,
  Italic,
  Maximize2,
  Minus,
  MousePointer,
  Plus,
  Redo2,
  RotateCcw,
  Square,
  Trash2,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import {
  getEffectivePaperDimensionsMm,
  type ActiveViewportTarget,
  type CanvasEditorTool,
  type CartoWidgetId,
  type LayoutFontFamily,
  type LayoutLineStyle,
  type SelectedCanvasItem,
  type ViewportBoxNormalized,
  type ViewportFocusTarget,
} from '../model/layoutTypes';
import type { Rect } from '../renderers/cartographicPrimitives';
import type { SheetRenderResult } from '../renderers/sheetRenderer';
import { useLayoutStore } from '../store/layoutStore';

interface InteractiveViewportCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  renderMetrics: SheetRenderResult | null;
}

type CornerHandle = 'nw' | 'ne' | 'sw' | 'se';

type DragAction =
  | {
      kind: 'cad-middle-pan';
      startClientX: number;
      startClientY: number;
      startPan: [number, number];
    }
  | {
      kind: 'pan-vp';
      target: ActiveViewportTarget;
      startClientX: number;
      startClientY: number;
      metersPerCssPx: number;
      lastDxMeters: number;
      lastDyMeters: number;
    }
  | {
      kind: 'move-vp-box';
      target: ActiveViewportTarget;
      startClientX: number;
      startClientY: number;
      initialBox: ViewportBoxNormalized;
      innerCssW: number;
      innerCssH: number;
    }
  | {
      kind: 'resize-vp-box';
      target: ActiveViewportTarget;
      handle: CornerHandle;
      startClientX: number;
      startClientY: number;
      initialBox: ViewportBoxNormalized;
      innerCssW: number;
      innerCssH: number;
    }
  | {
      kind: 'move-widget';
      id: CartoWidgetId;
      startClientX: number;
      startClientY: number;
      initialXNorm: number;
      initialYNorm: number;
      availCssW: number;
      availCssH: number;
    }
  | {
      kind: 'scale-widget';
      id: CartoWidgetId;
      handle: CornerHandle;
      startClientX: number;
      startClientY: number;
      initialScale: number;
    }
  | {
      kind: 'move-dxf';
      id: string;
      startClientX: number;
      startClientY: number;
      initialDxNorm: number;
      initialDyNorm: number;
      innerCssW: number;
      innerCssH: number;
    }
  | {
      kind: 'scale-dxf';
      id: string;
      handle: CornerHandle;
      startClientX: number;
      startClientY: number;
      initialScale: number;
    }
  | {
      kind: 'move-annotation';
      id: string;
      startClientX: number;
      startClientY: number;
      initialX: number;
      initialY: number;
      innerCssW: number;
      innerCssH: number;
    }
  | {
      kind: 'resize-annotation';
      id: string;
      handle: CornerHandle;
      startClientX: number;
      startClientY: number;
      initialX: number;
      initialY: number;
      initialW: number;
      initialH: number;
      innerCssW: number;
      innerCssH: number;
      isText: boolean;
      initialFontSize: number;
    }
  | {
      kind: 'draw-shape';
      shape: 'rect' | 'line';
      startNormX: number;
      startNormY: number;
      currentNormX: number;
      currentNormY: number;
      innerCssLeft: number;
      innerCssTop: number;
      innerCssW: number;
      innerCssH: number;
    };

interface ViewportOverlayBoxProps {
  target: ActiveViewportTarget;
  box: ViewportBoxNormalized;
  label: string;
  color: string;
  selected: boolean;
  editableBoxes: boolean;
  onViewportMouseDown: (
    e: React.MouseEvent,
    target: ActiveViewportTarget,
    mode: 'box' | CornerHandle
  ) => void;
}

function ViewportOverlayBox({
  target,
  box,
  label,
  color,
  selected,
  editableBoxes,
  onViewportMouseDown,
}: ViewportOverlayBoxProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
        border: editableBoxes
          ? `2px ${selected ? 'solid' : 'dashed'} ${color}`
          : selected
            ? `1px dashed ${color}66`
            : 'none',
        background: editableBoxes && selected ? `${color}0D` : 'transparent',
        boxSizing: 'border-box',
        pointerEvents: editableBoxes ? 'auto' : 'none',
        cursor: editableBoxes ? 'move' : 'default',
      }}
      onMouseDown={editableBoxes ? (e) => onViewportMouseDown(e, target, 'box') : undefined}
    >
      {editableBoxes && (
        <div
          style={{
            position: 'absolute',
            top: -19,
            left: 0,
            padding: '2px 7px',
            borderRadius: '4px 4px 0 0',
            background: color,
            color: '#0B0F17',
            fontSize: '0.62rem',
            fontWeight: 800,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {label}
        </div>
      )}

      {editableBoxes &&
        (['nw', 'ne', 'sw', 'se'] as const).map((handle) => {
          const isN = handle.includes('n');
          const isW = handle.includes('w');
          return (
            <div
              key={handle}
              onMouseDown={(e) => onViewportMouseDown(e, target, handle)}
              style={{
                position: 'absolute',
                width: 10,
                height: 10,
                borderRadius: 2,
                background: '#FFFFFF',
                border: `2px solid ${color}`,
                top: isN ? -5 : undefined,
                bottom: !isN ? -5 : undefined,
                left: isW ? -5 : undefined,
                right: !isW ? -5 : undefined,
                cursor: `${handle}-resize`,
              }}
            />
          );
        })}
    </div>
  );
}

interface SelectionHighlightOverlayProps {
  rect: Rect;
  sheetW: number;
  sheetH: number;
  label: string;
  onStartCornerDrag: (e: React.MouseEvent, handle: CornerHandle) => void;
}

function SelectionHighlightOverlay({
  rect,
  sheetW,
  sheetH,
  label,
  onStartCornerDrag,
}: SelectionHighlightOverlayProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${(rect.x / sheetW) * 100}%`,
        top: `${(rect.y / sheetH) * 100}%`,
        width: `${(rect.w / sheetW) * 100}%`,
        height: `${(rect.h / sheetH) * 100}%`,
        border: '1.5px dashed #38BDF8',
        background: 'rgba(56, 189, 248, 0.08)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 8,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -17,
          left: 0,
          padding: '1px 6px',
          borderRadius: 4,
          background: '#38BDF8',
          color: '#080C12',
          fontSize: '0.58rem',
          fontWeight: 800,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => {
        const isN = handle.includes('n');
        const isW = handle.includes('w');
        return (
          <div
            key={handle}
            onMouseDown={(e) => onStartCornerDrag(e, handle)}
            title="Arrastrá una esquina para escalar tamaño"
            style={{
              position: 'absolute',
              width: 10,
              height: 10,
              borderRadius: 2,
              background: '#FFFFFF',
              border: '2px solid #38BDF8',
              top: isN ? -5 : undefined,
              bottom: !isN ? -5 : undefined,
              left: isW ? -5 : undefined,
              right: !isW ? -5 : undefined,
              cursor: `${handle}-resize`,
              pointerEvents: 'auto',
            }}
          />
        );
      })}
    </div>
  );
}

const TOOL_BUTTONS: Array<{ id: CanvasEditorTool; label: string; icon: React.ReactNode }> = [
  { id: 'edit-elements', label: 'Seleccionar / Pan', icon: <MousePointer size={12} /> },
  { id: 'edit-viewport-box', label: 'Cajas VP', icon: <Frame size={12} /> },
  { id: 'draw-text', label: '+ Texto', icon: <Type size={12} /> },
  { id: 'draw-rect', label: '+ Recuadro', icon: <Square size={12} /> },
  { id: 'draw-line', label: '+ Línea', icon: <Minus size={12} /> },
];

const FLOAT_FOCUS_BUTTONS: Array<{ id: ViewportFocusTarget; label: string }> = [
  { id: 'sheet', label: 'Hoja' },
  { id: 'main', label: 'VP-1 Plano' },
  { id: 'location', label: 'VP-2 Ubic.' },
  { id: 'carimbo', label: 'Carimbo' },
];

function pointNearRectBorderOrInside(
  px: number,
  py: number,
  r: Rect,
  largeBorderOnly: boolean
): boolean {
  const pad = 6;
  const inOuter = px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
  if (!inOuter) return false;
  if (!largeBorderOnly || (r.w < 130 && r.h < 130)) {
    return true;
  }
  const innerMargin = 14;
  const inHole =
    px > r.x + innerMargin &&
    px < r.x + r.w - innerMargin &&
    py > r.y + innerMargin &&
    py < r.y + r.h - innerMargin;
  return !inHole;
}

function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

const smallBtnStyle: React.CSSProperties = {
  padding: '2px 5px',
  borderRadius: 4,
  border: '1px solid var(--cad-border)',
  background: '#090D16',
  color: '#F8FAFC',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function toggleStyleBtn(active: boolean): React.CSSProperties {
  return {
    padding: '3px 6px',
    borderRadius: 4,
    border: `1px solid ${active ? '#38BDF8' : 'var(--cad-border)'}`,
    background: active ? 'rgba(56, 189, 248, 0.22)' : '#090D16',
    color: active ? '#38BDF8' : '#CBD5E1',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.62rem',
    fontWeight: 700,
  };
}

export default function InteractiveViewportCanvas({
  canvasRef,
  renderMetrics,
}: InteractiveViewportCanvasProps) {
  const templates = useLayoutStore((s) => s.templates);
  const activeTemplateId = useLayoutStore((s) => s.activeTemplateId);
  const config = useLayoutStore((s) => s.config);
  const undoCount = useLayoutStore((s) => s.undoStack.length);
  const redoCount = useLayoutStore((s) => s.redoStack.length);
  const canvasTool = useLayoutStore((s) => s.canvasTool);
  const activeViewport = useLayoutStore((s) => s.activeViewport);
  const selectedItem = useLayoutStore((s) => s.selectedItem);
  const viewportFocusTarget = useLayoutStore((s) => s.viewportFocusTarget);
  const viewportFocusNonce = useLayoutStore((s) => s.viewportFocusNonce);
  const previewZoom = useLayoutStore((s) => s.previewZoom);
  const sheetPanPx = useLayoutStore((s) => s.sheetPanPx);

  const pushHistorySnapshot = useLayoutStore((s) => s.pushHistorySnapshot);
  const undoLayout = useLayoutStore((s) => s.undoLayout);
  const redoLayout = useLayoutStore((s) => s.redoLayout);

  const setCanvasTool = useLayoutStore((s) => s.setCanvasTool);
  const setActiveViewport = useLayoutStore((s) => s.setActiveViewport);
  const setSelectedItem = useLayoutStore((s) => s.setSelectedItem);
  const setViewportFocusTarget = useLayoutStore((s) => s.setViewportFocusTarget);
  const setPreviewZoom = useLayoutStore((s) => s.setPreviewZoom);
  const setSheetPanPx = useLayoutStore((s) => s.setSheetPanPx);
  const resetSheetView = useLayoutStore((s) => s.resetSheetView);

  const panViewport = useLayoutStore((s) => s.panViewport);
  const updateViewportBox = useLayoutStore((s) => s.updateViewportBox);
  const setMainScale = useLayoutStore((s) => s.setMainScale);
  const setLocationScale = useLayoutStore((s) => s.setLocationScale);
  const zoomViewportScale = useLayoutStore((s) => s.zoomViewportScale);

  const updateWidgetSpec = useLayoutStore((s) => s.updateWidgetSpec);
  const updateDxfEntityEdit = useLayoutStore((s) => s.updateDxfEntityEdit);
  const setDxfTextOverride = useLayoutStore((s) => s.setDxfTextOverride);
  const addSheetAnnotation = useLayoutStore((s) => s.addSheetAnnotation);
  const updateSheetAnnotation = useLayoutStore((s) => s.updateSheetAnnotation);
  const deleteSelectedCanvasItem = useLayoutStore((s) => s.deleteSelectedCanvasItem);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragAction | null>(null);
  const lastMidClickRef = useRef<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [draftShape, setDraftShape] = useState<{
    shape: 'rect' | 'line';
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const activeTemplate = templates.find((t) => t.id === activeTemplateId);

  const latestMetricsRef = useRef(renderMetrics);
  useEffect(() => {
    latestMetricsRef.current = renderMetrics;
  }, [renderMetrics]);

  // Centrar viewport al pulsar Hoja / VP-1 / VP-2 / Carimbo
  useEffect(() => {
    if (viewportFocusNonce === 0) return;
    const rafId = requestAnimationFrame(() => {
      const metrics = latestMetricsRef.current;
      const canvasEl = canvasRef.current;
      if (!metrics || !canvasEl) return;
      if (viewportFocusTarget === 'sheet') {
        setSheetPanPx([0, 0]);
        return;
      }
      let targetRect = metrics.innerRect;
      if (viewportFocusTarget === 'main') targetRect = metrics.mainViewportRect;
      else if (viewportFocusTarget === 'location') targetRect = metrics.locationViewportRect;
      else if (viewportFocusTarget === 'carimbo') {
        targetRect = {
          x: metrics.innerRect.x + metrics.innerRect.w * 0.66,
          y: metrics.innerRect.y + metrics.innerRect.h * 0.44,
          w: metrics.innerRect.w * 0.34,
          h: metrics.innerRect.h * 0.56,
        };
      }
      const cxNorm = (targetRect.x + targetRect.w / 2) / metrics.widthPx;
      const cyNorm = (targetRect.y + targetRect.h / 2) / metrics.heightPx;
      const cRect = canvasEl.getBoundingClientRect();
      setSheetPanPx([
        Math.round((0.5 - cxNorm) * cRect.width),
        Math.round((0.5 - cyNorm) * cRect.height),
      ]);
    });
    return () => cancelAnimationFrame(rafId);
  }, [viewportFocusTarget, viewportFocusNonce, setSheetPanPx, canvasRef]);

  // Atajos profesionales de teclado dentro del editor: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Supr, Esc
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target?.isContentEditable);

      const ctrlOrCmd = ev.ctrlKey || ev.metaKey;
      if (!typing && ctrlOrCmd && (ev.key === 'z' || ev.key === 'Z')) {
        ev.preventDefault();
        if (ev.shiftKey) useLayoutStore.getState().redoLayout();
        else useLayoutStore.getState().undoLayout();
        return;
      }
      if (!typing && ctrlOrCmd && (ev.key === 'y' || ev.key === 'Y')) {
        ev.preventDefault();
        useLayoutStore.getState().redoLayout();
        return;
      }
      if (!typing && (ev.key === 'Delete' || ev.key === 'Backspace')) {
        const sel = useLayoutStore.getState().selectedItem;
        if (sel) {
          ev.preventDefault();
          useLayoutStore.getState().deleteSelectedCanvasItem();
        }
        return;
      }
      if (ev.key === 'Escape' && !typing) {
        useLayoutStore.getState().setSelectedItem(null);
        useLayoutStore.getState().setCanvasTool('edit-elements');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const clientToSheetPx = (clientX: number, clientY: number): [number, number] | null => {
    const canvasEl = canvasRef.current;
    if (!canvasEl || !renderMetrics) return null;
    const rect = canvasEl.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * renderMetrics.widthPx;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * renderMetrics.heightPx;
    return [x, y];
  };

  const getInnerCssGeometry = () => {
    const canvasEl = canvasRef.current;
    if (!canvasEl || !renderMetrics) return null;
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = rect.width / renderMetrics.widthPx;
    const scaleY = rect.height / renderMetrics.heightPx;
    return {
      innerCssLeft: rect.left + renderMetrics.innerRect.x * scaleX,
      innerCssTop: rect.top + renderMetrics.innerRect.y * scaleY,
      innerCssW: renderMetrics.innerRect.w * scaleX,
      innerCssH: renderMetrics.innerRect.h * scaleY,
      scaleX,
      scaleY,
    };
  };

  const getMetersPerCssPx = (target: ActiveViewportTarget): number => {
    const canvasEl = canvasRef.current;
    if (!canvasEl || !renderMetrics) return 0.5;
    const rect = canvasEl.getBoundingClientRect();
    const { widthMm: paperWidthMm } = getEffectivePaperDimensionsMm(config);
    const scaleDenom =
      target === 'main' ? renderMetrics.effectiveMainScale : renderMetrics.effectiveLocationScale;
    const cssPxPerMm = rect.width / paperWidthMm;
    const cssPxPerMeter = (1000 / Math.max(10, scaleDenom)) * cssPxPerMm;
    return 1 / Math.max(1e-4, cssPxPerMeter);
  };

  const findHitAtSheetPoint = (
    px: number,
    py: number
  ): {
    item: SelectedCanvasItem;
    rect: Rect;
    containerRect?: Rect;
  } | null => {
    if (!renderMetrics) return null;

    const annHits = renderMetrics.annotationHitBoxes
      .filter((h) => pointNearRectBorderOrInside(px, py, h.rect, h.kind === 'rect'))
      .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h);
    if (annHits.length > 0) {
      return { item: { kind: 'annotation', id: annHits[0].id }, rect: annHits[0].rect };
    }

    const widHits = renderMetrics.widgetHitBoxes
      .filter((h) => pointNearRectBorderOrInside(px, py, h.rect, false))
      .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h);
    if (widHits.length > 0) {
      return {
        item: { kind: 'widget', id: widHits[0].id },
        rect: widHits[0].rect,
        containerRect: widHits[0].containerRect,
      };
    }

    const dxfHits = renderMetrics.dxfHitBoxes
      .filter((h) => pointNearRectBorderOrInside(px, py, h.rect, h.entityType === 'LWPOLYLINE' || h.entityType === 'HATCH'))
      .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h);
    if (dxfHits.length > 0) {
      return { item: { kind: 'dxf', id: dxfHits[0].id }, rect: dxfHits[0].rect };
    }

    return null;
  };

  const startCadMiddlePan = (e: React.MouseEvent): boolean => {
    if (e.button !== 1) return false;
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (now - lastMidClickRef.current < 320) {
      lastMidClickRef.current = 0;
      resetSheetView();
      return true;
    }
    lastMidClickRef.current = now;
    dragRef.current = {
      kind: 'cad-middle-pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPan: [...sheetPanPx],
    };
    setIsDragging(true);
    return true;
  };

  const handleViewportBoxMouseDown = (
    e: React.MouseEvent,
    target: ActiveViewportTarget,
    mode: 'box' | CornerHandle
  ) => {
    if (startCadMiddlePan(e)) return;
    if (e.button !== 0 || canvasTool !== 'edit-viewport-box') return;

    e.stopPropagation();
    e.preventDefault();
    setActiveViewport(target);
    const geom = getInnerCssGeometry();
    if (!geom) return;

    pushHistorySnapshot();
    const initialBox =
      target === 'main' ? { ...config.mainViewport.boxNormalized } : { ...config.locationViewport.boxNormalized };

    if (mode === 'box') {
      dragRef.current = {
        kind: 'move-vp-box',
        target,
        startClientX: e.clientX,
        startClientY: e.clientY,
        initialBox,
        innerCssW: geom.innerCssW,
        innerCssH: geom.innerCssH,
      };
    } else {
      dragRef.current = {
        kind: 'resize-vp-box',
        target,
        handle: mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        initialBox,
        innerCssW: geom.innerCssW,
        innerCssH: geom.innerCssH,
      };
    }
    setIsDragging(true);
  };

  const handleStageMouseDown = (e: React.MouseEvent) => {
    if (startCadMiddlePan(e)) return;
    if (e.button !== 0 || !renderMetrics) return;

    const geom = getInnerCssGeometry();
    if (!geom) return;

    if (canvasTool === 'draw-text') {
      const normX = Math.max(0.01, Math.min(0.92, (e.clientX - geom.innerCssLeft) / Math.max(10, geom.innerCssW)));
      const normY = Math.max(0.01, Math.min(0.92, (e.clientY - geom.innerCssTop) / Math.max(10, geom.innerCssH)));
      addSheetAnnotation('text', normX, normY, 0.2, 0.04, 'NUEVO TEXTO');
      return;
    }

    if (canvasTool === 'draw-rect' || canvasTool === 'draw-line') {
      const normX = Math.max(0, Math.min(0.98, (e.clientX - geom.innerCssLeft) / Math.max(10, geom.innerCssW)));
      const normY = Math.max(0, Math.min(0.98, (e.clientY - geom.innerCssTop) / Math.max(10, geom.innerCssH)));
      const shape = canvasTool === 'draw-rect' ? 'rect' : 'line';
      dragRef.current = {
        kind: 'draw-shape',
        shape,
        startNormX: normX,
        startNormY: normY,
        currentNormX: normX,
        currentNormY: normY,
        innerCssLeft: geom.innerCssLeft,
        innerCssTop: geom.innerCssTop,
        innerCssW: geom.innerCssW,
        innerCssH: geom.innerCssH,
      };
      setDraftShape({ shape, x: normX, y: normY, w: 0.01, h: 0.01 });
      setIsDragging(true);
      return;
    }

    // Modo unificado: seleccionar/mover objetos O encuadrar VP-1/VP-2 si se hace clic libre dentro de un viewport
    if (canvasTool === 'edit-elements' || canvasTool === 'pan-content') {
      const sheetPt = clientToSheetPx(e.clientX, e.clientY);
      if (!sheetPt) return;

      const hit = findHitAtSheetPoint(sheetPt[0], sheetPt[1]);
      if (hit && hit.item) {
        setSelectedItem(hit.item);
        pushHistorySnapshot();

        if (hit.item.kind === 'widget') {
          const wSpec = config.widgets[hit.item.id];
          const container = hit.containerRect ?? renderMetrics.mainViewportRect;
          const availCssW = Math.max(20, (container.w - hit.rect.w) * geom.scaleX);
          const availCssH = Math.max(20, (container.h - hit.rect.h) * geom.scaleY);
          dragRef.current = {
            kind: 'move-widget',
            id: hit.item.id,
            startClientX: e.clientX,
            startClientY: e.clientY,
            initialXNorm: wSpec.xNorm,
            initialYNorm: wSpec.yNorm,
            availCssW,
            availCssH,
          };
        } else if (hit.item.kind === 'dxf') {
          const edit = config.dxfEntityEdits[hit.item.id] ?? {};
          dragRef.current = {
            kind: 'move-dxf',
            id: hit.item.id,
            startClientX: e.clientX,
            startClientY: e.clientY,
            initialDxNorm: edit.dxNorm ?? 0,
            initialDyNorm: edit.dyNorm ?? 0,
            innerCssW: geom.innerCssW,
            innerCssH: geom.innerCssH,
          };
        } else if (hit.item.kind === 'annotation') {
          const ann = config.sheetAnnotations.find((a) => a.id === hit.item!.id);
          if (ann) {
            dragRef.current = {
              kind: 'move-annotation',
              id: ann.id,
              startClientX: e.clientX,
              startClientY: e.clientY,
              initialX: ann.x,
              initialY: ann.y,
              innerCssW: geom.innerCssW,
              innerCssH: geom.innerCssH,
            };
          }
        }
        setIsDragging(true);
        return;
      }

      // Si no tocó ningún objeto, verificar si está dentro de VP-2 o VP-1 para encuadrar su contenido mapa
      setSelectedItem(null);
      const vpTarget: ActiveViewportTarget | null = pointInRect(sheetPt[0], sheetPt[1], renderMetrics.locationViewportRect)
        ? 'location'
        : pointInRect(sheetPt[0], sheetPt[1], renderMetrics.mainViewportRect)
          ? 'main'
          : null;
      if (vpTarget) {
        setActiveViewport(vpTarget);
        pushHistorySnapshot();
        dragRef.current = {
          kind: 'pan-vp',
          target: vpTarget,
          startClientX: e.clientX,
          startClientY: e.clientY,
          metersPerCssPx: getMetersPerCssPx(vpTarget),
          lastDxMeters: 0,
          lastDyMeters: 0,
        };
        setIsDragging(true);
      }
    }
  };

  const handleStartScaleDrag = (e: React.MouseEvent, handle: CornerHandle) => {
    if (e.button !== 0 || !selectedItem) return;
    e.stopPropagation();
    e.preventDefault();
    const geom = getInnerCssGeometry();
    if (!geom) return;

    pushHistorySnapshot();

    if (selectedItem.kind === 'widget') {
      dragRef.current = {
        kind: 'scale-widget',
        id: selectedItem.id,
        handle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        initialScale: config.widgets[selectedItem.id].scale,
      };
    } else if (selectedItem.kind === 'dxf') {
      const edit = config.dxfEntityEdits[selectedItem.id] ?? {};
      dragRef.current = {
        kind: 'scale-dxf',
        id: selectedItem.id,
        handle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        initialScale: edit.scale ?? 1,
      };
    } else if (selectedItem.kind === 'annotation') {
      const ann = config.sheetAnnotations.find((a) => a.id === selectedItem.id);
      if (ann) {
        dragRef.current = {
          kind: 'resize-annotation',
          id: ann.id,
          handle,
          startClientX: e.clientX,
          startClientY: e.clientY,
          initialX: ann.x,
          initialY: ann.y,
          initialW: ann.w,
          initialH: ann.h,
          innerCssW: geom.innerCssW,
          innerCssH: geom.innerCssH,
          isText: ann.kind === 'text',
          initialFontSize: ann.fontSizePt ?? 14,
        };
      }
    }
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === 'draw-shape') {
      const nx = Math.max(0, Math.min(1, (e.clientX - drag.innerCssLeft) / Math.max(10, drag.innerCssW)));
      const ny = Math.max(0, Math.min(1, (e.clientY - drag.innerCssTop) / Math.max(10, drag.innerCssH)));
      drag.currentNormX = nx;
      drag.currentNormY = ny;
      setDraftShape({
        shape: drag.shape,
        x: drag.shape === 'rect' ? Math.min(drag.startNormX, nx) : drag.startNormX,
        y: drag.shape === 'rect' ? Math.min(drag.startNormY, ny) : drag.startNormY,
        w: drag.shape === 'rect' ? Math.abs(nx - drag.startNormX) : nx - drag.startNormX,
        h: drag.shape === 'rect' ? Math.abs(ny - drag.startNormY) : ny - drag.startNormY,
      });
      return;
    }

    const dxCss = e.clientX - drag.startClientX;
    const dyCss = e.clientY - drag.startClientY;

    if (drag.kind === 'cad-middle-pan') {
      setSheetPanPx([drag.startPan[0] + dxCss, drag.startPan[1] + dyCss]);
    } else if (drag.kind === 'pan-vp') {
      const totalDxM = -dxCss * drag.metersPerCssPx;
      const totalDyM = dyCss * drag.metersPerCssPx;
      const stepX = totalDxM - drag.lastDxMeters;
      const stepY = totalDyM - drag.lastDyMeters;
      drag.lastDxMeters = totalDxM;
      drag.lastDyMeters = totalDyM;
      panViewport(drag.target, stepX, stepY);
    } else if (drag.kind === 'move-vp-box') {
      const dxNorm = dxCss / Math.max(10, drag.innerCssW);
      const dyNorm = dyCss / Math.max(10, drag.innerCssH);
      updateViewportBox(drag.target, {
        ...drag.initialBox,
        x: Math.max(0, Math.min(1 - drag.initialBox.w, drag.initialBox.x + dxNorm)),
        y: Math.max(0, Math.min(1 - drag.initialBox.h, drag.initialBox.y + dyNorm)),
      });
    } else if (drag.kind === 'resize-vp-box') {
      const dxNorm = dxCss / Math.max(10, drag.innerCssW);
      const dyNorm = dyCss / Math.max(10, drag.innerCssH);
      const b = { ...drag.initialBox };
      if (drag.handle.includes('e')) b.w = Math.max(0.1, drag.initialBox.w + dxNorm);
      if (drag.handle.includes('s')) b.h = Math.max(0.1, drag.initialBox.h + dyNorm);
      if (drag.handle.includes('w')) {
        const nextX = Math.min(drag.initialBox.x + drag.initialBox.w - 0.1, drag.initialBox.x + dxNorm);
        b.w = drag.initialBox.w + (drag.initialBox.x - nextX);
        b.x = nextX;
      }
      if (drag.handle.includes('n')) {
        const nextY = Math.min(drag.initialBox.y + drag.initialBox.h - 0.1, drag.initialBox.y + dyNorm);
        b.h = drag.initialBox.h + (drag.initialBox.y - nextY);
        b.y = nextY;
      }
      updateViewportBox(drag.target, b);
    } else if (drag.kind === 'move-widget') {
      updateWidgetSpec(drag.id, {
        xNorm: drag.initialXNorm + dxCss / drag.availCssW,
        yNorm: drag.initialYNorm + dyCss / drag.availCssH,
      });
    } else if (drag.kind === 'scale-widget') {
      const sx = drag.handle.includes('w') ? -1 : 1;
      const sy = drag.handle.includes('n') ? -1 : 1;
      const factor = 1 + (dxCss * sx + dyCss * sy) / 140;
      updateWidgetSpec(drag.id, { scale: drag.initialScale * factor });
    } else if (drag.kind === 'move-dxf') {
      updateDxfEntityEdit(drag.id, {
        dxNorm: drag.initialDxNorm + dxCss / Math.max(10, drag.innerCssW),
        dyNorm: drag.initialDyNorm + dyCss / Math.max(10, drag.innerCssH),
      });
    } else if (drag.kind === 'scale-dxf') {
      const sx = drag.handle.includes('w') ? -1 : 1;
      const sy = drag.handle.includes('n') ? -1 : 1;
      const factor = Math.max(0.15, Math.min(5, drag.initialScale * (1 + (dxCss * sx + dyCss * sy) / 140)));
      updateDxfEntityEdit(drag.id, { scale: +factor.toFixed(2) });
    } else if (drag.kind === 'move-annotation') {
      updateSheetAnnotation(drag.id, {
        x: Math.max(0, Math.min(0.96, drag.initialX + dxCss / Math.max(10, drag.innerCssW))),
        y: Math.max(0, Math.min(0.96, drag.initialY + dyCss / Math.max(10, drag.innerCssH))),
      });
    } else if (drag.kind === 'resize-annotation') {
      const sx = drag.handle.includes('w') ? -1 : 1;
      const sy = drag.handle.includes('n') ? -1 : 1;
      if (drag.isText) {
        const nextPt = Math.max(
          6,
          Math.min(72, Math.round(drag.initialFontSize * (1 + (dxCss * sx + dyCss * sy) / 120)))
        );
        updateSheetAnnotation(drag.id, { fontSizePt: nextPt });
      } else {
        const dxNorm = dxCss / Math.max(10, drag.innerCssW);
        const dyNorm = dyCss / Math.max(10, drag.innerCssH);
        const nextPatch: { x?: number; y?: number; w: number; h: number } = {
          w: drag.initialW,
          h: drag.initialH,
        };
        if (drag.handle.includes('e')) nextPatch.w = drag.initialW + dxNorm;
        if (drag.handle.includes('s')) nextPatch.h = drag.initialH + dyNorm;
        if (drag.handle.includes('w')) {
          nextPatch.x = drag.initialX + dxNorm;
          nextPatch.w = drag.initialW - dxNorm;
        }
        if (drag.handle.includes('n')) {
          nextPatch.y = drag.initialY + dyNorm;
          nextPatch.h = drag.initialH - dyNorm;
        }
        updateSheetAnnotation(drag.id, nextPatch);
      }
    }
  };

  const handleMouseUp = () => {
    const drag = dragRef.current;
    if (drag?.kind === 'draw-shape') {
      if (drag.shape === 'rect') {
        const x = Math.min(drag.startNormX, drag.currentNormX);
        const y = Math.min(drag.startNormY, drag.currentNormY);
        const w = Math.max(0.05, Math.abs(drag.currentNormX - drag.startNormX));
        const h = Math.max(0.03, Math.abs(drag.currentNormY - drag.startNormY));
        addSheetAnnotation('rect', x, y, w, h);
      } else {
        const dw = drag.currentNormX - drag.startNormX;
        const dh = drag.currentNormY - drag.startNormY;
        const len = Math.hypot(dw, dh);
        addSheetAnnotation('line', drag.startNormX, drag.startNormY, len < 0.02 ? 0.14 : dw, len < 0.02 ? 0 : dh);
      }
      setDraftShape(null);
    }
    if (drag) {
      dragRef.current = null;
      setIsDragging(false);
    }
  };

  const handleStageWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!renderMetrics) return;

    // Alt + Rueda = Escalar el objeto seleccionado directamente
    if (e.altKey && selectedItem) {
      pushHistorySnapshot();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      if (selectedItem.kind === 'widget') {
        const w = config.widgets[selectedItem.id];
        updateWidgetSpec(selectedItem.id, { scale: w.scale + delta });
      } else if (selectedItem.kind === 'dxf') {
        const edit = config.dxfEntityEdits[selectedItem.id] ?? {};
        updateDxfEntityEdit(selectedItem.id, {
          scale: Math.max(0.15, Math.min(5, +((edit.scale ?? 1) + delta).toFixed(2))),
        });
      } else if (selectedItem.kind === 'annotation') {
        const ann = config.sheetAnnotations.find((a) => a.id === selectedItem.id);
        if (ann) {
          if (ann.kind === 'text') {
            updateSheetAnnotation(ann.id, { fontSizePt: Math.max(6, Math.min(72, (ann.fontSizePt ?? 14) + (e.deltaY < 0 ? 1 : -1))) });
          } else {
            const factor = e.deltaY < 0 ? 1.08 : 0.92;
            updateSheetAnnotation(ann.id, { w: ann.w * factor, h: ann.h * factor });
          }
        }
      }
      return;
    }

    // Ctrl + Rueda = siempre zoom de hoja
    if (e.ctrlKey) {
      setPreviewZoom(previewZoom + (e.deltaY < 0 ? 0.16 : -0.16));
      return;
    }

    // Si el puntero está dentro de VP-1 o VP-2 en modo principal, regula la escala 1:N en vivo
    const sheetPt = clientToSheetPx(e.clientX, e.clientY);
    if (sheetPt && (canvasTool === 'edit-elements' || canvasTool === 'pan-content')) {
      const vpHit: ActiveViewportTarget | null = pointInRect(
        sheetPt[0],
        sheetPt[1],
        renderMetrics.locationViewportRect
      )
        ? 'location'
        : pointInRect(sheetPt[0], sheetPt[1], renderMetrics.mainViewportRect)
          ? 'main'
          : null;
      if (vpHit) {
        const factor = e.deltaY < 0 ? 0.9 : 1.1;
        const baseScale =
          vpHit === 'main' ? renderMetrics.effectiveMainScale : renderMetrics.effectiveLocationScale;
        zoomViewportScale(vpHit, baseScale, factor);
        return;
      }
    }

    setPreviewZoom(previewZoom + (e.deltaY < 0 ? 0.16 : -0.16));
  };

  const aspectRatio = renderMetrics ? `${renderMetrics.widthPx} / ${renderMetrics.heightPx}` : '1.414 / 1';
  const innerLeftPct = renderMetrics ? (renderMetrics.innerRect.x / renderMetrics.widthPx) * 100 : 1;
  const innerTopPct = renderMetrics ? (renderMetrics.innerRect.y / renderMetrics.heightPx) * 100 : 1;
  const innerWidthPct = renderMetrics ? (renderMetrics.innerRect.w / renderMetrics.widthPx) * 100 : 98;
  const innerHeightPct = renderMetrics ? (renderMetrics.innerRect.h / renderMetrics.heightPx) * 100 : 98;

  const editableVpBoxes = canvasTool === 'edit-viewport-box';
  const effMainScale = renderMetrics?.effectiveMainScale ?? config.mainViewport.scaleDenominator;
  const effLocScale = renderMetrics?.effectiveLocationScale ?? config.locationViewport.scaleDenominator;

  // Localizar rectángulo y metadatos del elemento seleccionado actualmente
  let selectedRect: Rect | null = null;
  let selectedLabel = '';
  if (selectedItem && renderMetrics) {
    if (selectedItem.kind === 'widget') {
      const found = renderMetrics.widgetHitBoxes.find((h) => h.id === selectedItem.id);
      if (found) {
        selectedRect = found.rect;
        selectedLabel = found.label;
      }
    } else if (selectedItem.kind === 'annotation') {
      const found = renderMetrics.annotationHitBoxes.find((h) => h.id === selectedItem.id);
      if (found) {
        selectedRect = found.rect;
        selectedLabel = found.kind === 'text' ? 'Texto Libre' : found.kind === 'rect' ? 'Recuadro' : 'Línea';
      }
    } else if (selectedItem.kind === 'dxf') {
      const found = renderMetrics.dxfHitBoxes.find((h) => h.id === selectedItem.id);
      if (found) {
        selectedRect = found.rect;
        selectedLabel = found.summary;
      }
    }
  }

  const selectedWidget = selectedItem?.kind === 'widget' ? config.widgets[selectedItem.id] : null;
  const selectedAnn =
    selectedItem?.kind === 'annotation'
      ? config.sheetAnnotations.find((a) => a.id === selectedItem.id) ?? null
      : null;
  const selectedDxfEntity =
    selectedItem?.kind === 'dxf'
      ? activeTemplate?.dxfDoc?.entities.find((ent) => ent.id === selectedItem.id) ?? null
      : null;
  const selectedDxfEdit =
    selectedItem?.kind === 'dxf' ? config.dxfEntityEdits[selectedItem.id] ?? {} : null;

  const isDxfText = Boolean(
    selectedDxfEntity && (selectedDxfEntity.type === 'TEXT' || selectedDxfEntity.type === 'MTEXT')
  );
  const isDxfShape = Boolean(
    selectedDxfEntity &&
      (selectedDxfEntity.type === 'LINE' ||
        selectedDxfEntity.type === 'LWPOLYLINE' ||
        selectedDxfEntity.type === 'CIRCLE' ||
        selectedDxfEntity.type === 'ARC')
  );

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Barra superior CAD: Undo/Redo + Herramientas + Escala simultánea VP-1 / VP-2 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 10px',
          background: 'rgba(13, 17, 25, 0.96)',
          borderBottom: '1px solid var(--cad-border)',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {/* Undo / Redo */}
          <button
            type="button"
            disabled={undoCount === 0}
            onClick={undoLayout}
            title="Deshacer (Ctrl+Z)"
            style={{
              ...smallBtnStyle,
              padding: '4px 6px',
              opacity: undoCount === 0 ? 0.35 : 1,
              cursor: undoCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <Undo2 size={12} />
          </button>
          <button
            type="button"
            disabled={redoCount === 0}
            onClick={redoLayout}
            title="Rehacer (Ctrl+Y)"
            style={{
              ...smallBtnStyle,
              padding: '4px 6px',
              opacity: redoCount === 0 ? 0.35 : 1,
              cursor: redoCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <Redo2 size={12} />
          </button>

          <div style={{ width: 1, height: 16, background: 'var(--cad-border)', margin: '0 2px' }} />

          {TOOL_BUTTONS.map((tb) => {
            const active =
              canvasTool === tb.id || (tb.id === 'edit-elements' && canvasTool === 'pan-content');
            return (
              <button
                key={tb.id}
                type="button"
                onClick={() => setCanvasTool(tb.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  borderRadius: 6,
                  fontSize: '0.63rem',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  border: `1px solid ${active ? '#38BDF8' : 'var(--cad-border)'}`,
                  background: active ? 'rgba(56, 189, 248, 0.16)' : 'var(--cad-bg-surface)',
                  color: active ? '#38BDF8' : 'var(--cad-text-dim)',
                }}
              >
                {tb.icon}
                <span>{tb.label}</span>
              </button>
            );
          })}
        </div>

        {/* Controles en vivo de Escala VP-1 y VP-2 simultáneos */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#FF6B4A' }}>VP-1 1:</span>
            <button
              type="button"
              onClick={() => zoomViewportScale('main', effMainScale, 0.85)}
              title="Acercar escala VP-1"
              style={smallBtnStyle}
            >
              <Minus size={9} />
            </button>
            <input
              type="number"
              min={10}
              step={25}
              value={effMainScale}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 10) setMainScale('manual', n);
              }}
              style={{
                width: 52,
                padding: '2px 4px',
                borderRadius: 4,
                background: '#090D16',
                border: '1px solid rgba(255, 107, 74, 0.45)',
                color: '#F8FAFC',
                fontSize: '0.63rem',
                fontFamily: 'var(--font-mono)',
                textAlign: 'center',
              }}
            />
            <button
              type="button"
              onClick={() => zoomViewportScale('main', effMainScale, 1.15)}
              title="Alejar escala VP-1"
              style={smallBtnStyle}
            >
              <Plus size={9} />
            </button>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#2DD4BF' }}>VP-2 1:</span>
            <button
              type="button"
              onClick={() => zoomViewportScale('location', effLocScale, 0.85)}
              title="Acercar escala VP-2"
              style={smallBtnStyle}
            >
              <Minus size={9} />
            </button>
            <input
              type="number"
              min={50}
              step={100}
              value={effLocScale}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 50) setLocationScale('manual', n);
              }}
              style={{
                width: 54,
                padding: '2px 4px',
                borderRadius: 4,
                background: '#090D16',
                border: '1px solid rgba(45, 212, 191, 0.45)',
                color: '#F8FAFC',
                fontSize: '0.63rem',
                fontFamily: 'var(--font-mono)',
                textAlign: 'center',
              }}
            />
            <button
              type="button"
              onClick={() => zoomViewportScale('location', effLocScale, 1.15)}
              title="Alejar escala VP-2"
              style={smallBtnStyle}
            >
              <Plus size={9} />
            </button>
          </div>
        </div>
      </div>

      {/* Barra contextual profesional del objeto seleccionado */}
      {selectedItem && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '5px 10px',
            background: 'rgba(15, 23, 42, 0.97)',
            borderBottom: '1px solid rgba(56, 189, 248, 0.45)',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#38BDF8', marginRight: 2 }}>
              {selectedLabel || 'Objeto'}
            </span>

            {/* Propiedades tipográficas para Texto DXF */}
            {isDxfText && selectedDxfEntity && selectedDxfEdit && (
              <>
                <input
                  type="text"
                  value={selectedDxfEdit.text ?? config.dxfTextOverrides[selectedDxfEntity.id] ?? (selectedDxfEntity.type === 'TEXT' || selectedDxfEntity.type === 'MTEXT' ? selectedDxfEntity.text : '')}
                  onChange={(e) => setDxfTextOverride(selectedDxfEntity.id, e.target.value)}
                  style={{
                    padding: '3px 7px',
                    borderRadius: 5,
                    background: '#090D16',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    color: '#F8FAFC',
                    fontSize: '0.65rem',
                    minWidth: 150,
                  }}
                />
                <select
                  value={selectedDxfEdit.fontFamily ?? 'cad'}
                  onChange={(e) => {
                    pushHistorySnapshot();
                    updateDxfEntityEdit(selectedDxfEntity.id, {
                      fontFamily: e.target.value as LayoutFontFamily,
                    });
                  }}
                  style={{
                    padding: '3px 5px',
                    borderRadius: 4,
                    background: '#090D16',
                    border: '1px solid var(--cad-border)',
                    color: '#F8FAFC',
                    fontSize: '0.62rem',
                  }}
                >
                  <option value="cad">CAD Técnica</option>
                  <option value="sans">Sans Moderna</option>
                  <option value="mono">Monoespaciada</option>
                  <option value="serif">Formal Serif</option>
                </select>
                <button
                  type="button"
                  title="Negrilla"
                  onClick={() => {
                    pushHistorySnapshot();
                    updateDxfEntityEdit(selectedDxfEntity.id, { bold: !(selectedDxfEdit.bold ?? false) });
                  }}
                  style={toggleStyleBtn(Boolean(selectedDxfEdit.bold))}
                >
                  <Bold size={11} />
                </button>
                <button
                  type="button"
                  title="Cursiva"
                  onClick={() => {
                    pushHistorySnapshot();
                    updateDxfEntityEdit(selectedDxfEntity.id, { italic: !selectedDxfEdit.italic });
                  }}
                  style={toggleStyleBtn(Boolean(selectedDxfEdit.italic))}
                >
                  <Italic size={11} />
                </button>
                <button
                  type="button"
                  title="Subrayado"
                  onClick={() => {
                    pushHistorySnapshot();
                    updateDxfEntityEdit(selectedDxfEntity.id, { underline: !selectedDxfEdit.underline });
                  }}
                  style={toggleStyleBtn(Boolean(selectedDxfEdit.underline))}
                >
                  <Underline size={11} />
                </button>
              </>
            )}

            {/* Propiedades tipográficas para Texto Libre */}
            {selectedAnn && selectedAnn.kind === 'text' && (
              <>
                <input
                  type="text"
                  value={selectedAnn.text ?? ''}
                  onChange={(e) => updateSheetAnnotation(selectedAnn.id, { text: e.target.value })}
                  style={{
                    padding: '3px 7px',
                    borderRadius: 5,
                    background: '#090D16',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    color: '#F8FAFC',
                    fontSize: '0.65rem',
                    minWidth: 150,
                  }}
                />
                <select
                  value={selectedAnn.fontFamily ?? 'cad'}
                  onChange={(e) => {
                    pushHistorySnapshot();
                    updateSheetAnnotation(selectedAnn.id, {
                      fontFamily: e.target.value as LayoutFontFamily,
                    });
                  }}
                  style={{
                    padding: '3px 5px',
                    borderRadius: 4,
                    background: '#090D16',
                    border: '1px solid var(--cad-border)',
                    color: '#F8FAFC',
                    fontSize: '0.62rem',
                  }}
                >
                  <option value="cad">CAD Técnica</option>
                  <option value="sans">Sans Moderna</option>
                  <option value="mono">Monoespaciada</option>
                  <option value="serif">Formal Serif</option>
                </select>
                <button
                  type="button"
                  title="Negrilla"
                  onClick={() => {
                    pushHistorySnapshot();
                    updateSheetAnnotation(selectedAnn.id, { bold: !(selectedAnn.bold ?? true) });
                  }}
                  style={toggleStyleBtn(selectedAnn.bold ?? true)}
                >
                  <Bold size={11} />
                </button>
                <button
                  type="button"
                  title="Cursiva"
                  onClick={() => {
                    pushHistorySnapshot();
                    updateSheetAnnotation(selectedAnn.id, { italic: !selectedAnn.italic });
                  }}
                  style={toggleStyleBtn(Boolean(selectedAnn.italic))}
                >
                  <Italic size={11} />
                </button>
                <button
                  type="button"
                  title="Subrayado"
                  onClick={() => {
                    pushHistorySnapshot();
                    updateSheetAnnotation(selectedAnn.id, { underline: !selectedAnn.underline });
                  }}
                  style={toggleStyleBtn(Boolean(selectedAnn.underline))}
                >
                  <Underline size={11} />
                </button>
                <button
                  type="button"
                  title="Fondo opaco debajo del texto"
                  onClick={() => {
                    pushHistorySnapshot();
                    updateSheetAnnotation(selectedAnn.id, { fillOpaque: !selectedAnn.fillOpaque });
                  }}
                  style={toggleStyleBtn(Boolean(selectedAnn.fillOpaque))}
                >
                  Fondo
                </button>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontSize: '0.6rem', color: '#CBD5E1' }}>Tam:</span>
                  <button
                    type="button"
                    onClick={() => {
                      pushHistorySnapshot();
                      updateSheetAnnotation(selectedAnn.id, {
                        fontSizePt: Math.max(6, (selectedAnn.fontSizePt ?? 14) - 1),
                      });
                    }}
                    style={smallBtnStyle}
                  >
                    <Minus size={9} />
                  </button>
                  <span className="font-mono-cad" style={{ fontSize: '0.62rem', minWidth: 24, textAlign: 'center' }}>
                    {selectedAnn.fontSizePt ?? 14}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      pushHistorySnapshot();
                      updateSheetAnnotation(selectedAnn.id, {
                        fontSizePt: Math.min(72, (selectedAnn.fontSizePt ?? 14) + 1),
                      });
                    }}
                    style={smallBtnStyle}
                  >
                    <Plus size={9} />
                  </button>
                </div>
              </>
            )}

            {/* Control de escala para Widget */}
            {selectedWidget && (
              <>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: '0.61rem', color: '#CBD5E1' }}>Escala:</span>
                  <button
                    type="button"
                    onClick={() => {
                      pushHistorySnapshot();
                      updateWidgetSpec(selectedWidget.id, { scale: selectedWidget.scale - 0.12 });
                    }}
                    style={smallBtnStyle}
                  >
                    <Minus size={10} />
                  </button>
                  <span className="font-mono-cad" style={{ fontSize: '0.64rem', minWidth: 34, textAlign: 'center' }}>
                    {Math.round(selectedWidget.scale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      pushHistorySnapshot();
                      updateWidgetSpec(selectedWidget.id, { scale: selectedWidget.scale + 0.12 });
                    }}
                    style={smallBtnStyle}
                  >
                    <Plus size={10} />
                  </button>
                </div>

                {selectedWidget.id === 'numericScale' && (
                  <button
                    type="button"
                    onClick={() => {
                      pushHistorySnapshot();
                      updateWidgetSpec('numericScale', {
                        styleVariant: selectedWidget.styleVariant === 'badge' ? 'clean' : 'badge',
                      });
                    }}
                    style={toggleStyleBtn(selectedWidget.styleVariant !== 'badge')}
                  >
                    {selectedWidget.styleVariant === 'badge' ? 'Estilo: Recuadro' : 'Estilo: Limpio CAD'}
                  </button>
                )}
              </>
            )}

            {/* Control de escala, grosor y tipo de línea para entidades DXF */}
            {selectedDxfEntity && selectedDxfEdit && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.6rem', color: '#CBD5E1' }}>Escala:</span>
                <button
                  type="button"
                  onClick={() => {
                    pushHistorySnapshot();
                    updateDxfEntityEdit(selectedDxfEntity.id, {
                      scale: Math.max(0.2, +(Math.max(0.2, (selectedDxfEdit.scale ?? 1) - 0.1)).toFixed(2)),
                    });
                  }}
                  style={smallBtnStyle}
                >
                  <Minus size={10} />
                </button>
                <span className="font-mono-cad" style={{ fontSize: '0.63rem', minWidth: 34, textAlign: 'center' }}>
                  {Math.round((selectedDxfEdit.scale ?? 1) * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => {
                    pushHistorySnapshot();
                    updateDxfEntityEdit(selectedDxfEntity.id, {
                      scale: Math.min(4, +((selectedDxfEdit.scale ?? 1) + 0.1).toFixed(2)),
                    });
                  }}
                  style={smallBtnStyle}
                >
                  <Plus size={10} />
                </button>

                {isDxfShape && (
                  <>
                    <label style={{ fontSize: '0.6rem', color: '#CBD5E1', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <span>Grosor:</span>
                      <input
                        type="number"
                        min={0.3}
                        max={10}
                        step={0.3}
                        value={selectedDxfEdit.lineWidth ?? 1.5}
                        onChange={(e) =>
                          updateDxfEntityEdit(selectedDxfEntity.id, {
                            lineWidth: Math.max(0.3, Number(e.target.value) || 1.5),
                          })
                        }
                        style={{
                          width: 44,
                          padding: '2px 4px',
                          borderRadius: 4,
                          background: '#090D16',
                          border: '1px solid var(--cad-border)',
                          color: '#FFF',
                          fontSize: '0.62rem',
                        }}
                      />
                    </label>
                    <select
                      value={selectedDxfEdit.lineStyle ?? 'solid'}
                      onChange={(e) => {
                        pushHistorySnapshot();
                        updateDxfEntityEdit(selectedDxfEntity.id, {
                          lineStyle: e.target.value as LayoutLineStyle,
                        });
                      }}
                      style={{
                        padding: '3px 5px',
                        borderRadius: 4,
                        background: '#090D16',
                        border: '1px solid var(--cad-border)',
                        color: '#F8FAFC',
                        fontSize: '0.62rem',
                      }}
                    >
                      <option value="solid">Continua</option>
                      <option value="dashed">Segmentada</option>
                      <option value="dash-dot">Eje (-·-)</option>
                      <option value="dotted">Punteada</option>
                    </select>
                  </>
                )}
              </div>
            )}

            {/* Propiedades para Recuadros / Líneas añadidos */}
            {selectedAnn && selectedAnn.kind !== 'text' && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <label style={{ fontSize: '0.6rem', color: '#CBD5E1', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <span>Grosor:</span>
                  <input
                    type="number"
                    min={0.3}
                    max={10}
                    step={0.3}
                    value={selectedAnn.lineWidth ?? 1.6}
                    onChange={(e) =>
                      updateSheetAnnotation(selectedAnn.id, {
                        lineWidth: Math.max(0.3, Number(e.target.value) || 1.6),
                      })
                    }
                    style={{
                      width: 44,
                      padding: '2px 4px',
                      borderRadius: 4,
                      background: '#090D16',
                      border: '1px solid var(--cad-border)',
                      color: '#FFF',
                      fontSize: '0.62rem',
                    }}
                  />
                </label>
                <select
                  value={selectedAnn.lineStyle ?? (selectedAnn.dashed ? 'dashed' : 'solid')}
                  onChange={(e) => {
                    pushHistorySnapshot();
                    updateSheetAnnotation(selectedAnn.id, {
                      lineStyle: e.target.value as LayoutLineStyle,
                      dashed: e.target.value !== 'solid',
                    });
                  }}
                  style={{
                    padding: '3px 5px',
                    borderRadius: 4,
                    background: '#090D16',
                    border: '1px solid var(--cad-border)',
                    color: '#F8FAFC',
                    fontSize: '0.62rem',
                  }}
                >
                  <option value="solid">Continua</option>
                  <option value="dashed">Segmentada</option>
                  <option value="dash-dot">Eje (-·-)</option>
                  <option value="dotted">Punteada</option>
                </select>
                {selectedAnn.kind === 'rect' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        pushHistorySnapshot();
                        updateSheetAnnotation(selectedAnn.id, { doubleBorder: !selectedAnn.doubleBorder });
                      }}
                      style={toggleStyleBtn(Boolean(selectedAnn.doubleBorder))}
                    >
                      Doble Marco
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        pushHistorySnapshot();
                        updateSheetAnnotation(selectedAnn.id, { fillOpaque: !selectedAnn.fillOpaque });
                      }}
                      style={toggleStyleBtn(Boolean(selectedAnn.fillOpaque))}
                    >
                      Fondo
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={deleteSelectedCanvasItem}
            title="Borrar / Ocultar elemento seleccionado (Supr)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 5,
              border: '1px solid rgba(251, 113, 133, 0.5)',
              background: 'rgba(251, 113, 133, 0.16)',
              color: '#FB7185',
              fontSize: '0.62rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Trash2 size={11} />
            <span>Borrar (Supr)</span>
          </button>
        </div>
      )}

      {/* Píldora flotante inferior de enfoque rápido */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '4px 6px',
          borderRadius: 999,
          background: 'rgba(11, 15, 23, 0.9)',
          border: '1px solid rgba(148, 163, 184, 0.28)',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
        }}
      >
        {FLOAT_FOCUS_BUTTONS.map((btn) => {
          const active = viewportFocusTarget === btn.id;
          return (
            <button
              key={btn.id}
              type="button"
              onClick={() => setViewportFocusTarget(btn.id)}
              style={{
                padding: '3px 9px',
                borderRadius: 999,
                border: 'none',
                background: active ? 'rgba(45, 212, 191, 0.22)' : 'transparent',
                color: active ? '#2DD4BF' : '#CBD5E1',
                fontSize: '0.62rem',
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {btn.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={resetSheetView}
          title="Centrar vista (Doble clic medio)"
          style={{
            padding: '3px 7px',
            borderRadius: 999,
            border: 'none',
            background: 'transparent',
            color: '#94A3B8',
            fontSize: '0.61rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <RotateCcw size={10} />
          <Maximize2 size={10} />
        </button>
      </div>

      {/* Área de trabajo CAD tipo Paper Space */}
      <div
        ref={stageRef}
        onMouseDown={handleStageMouseDown}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleStageWheel}
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          cursor:
            canvasTool === 'draw-text' || canvasTool === 'draw-rect' || canvasTool === 'draw-line'
              ? 'crosshair'
              : isDragging
                ? 'grabbing'
                : 'default',
          background:
            'radial-gradient(circle at center, rgba(30, 41, 59, 0.45) 0%, rgba(7, 9, 14, 0.98) 100%)',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: `${Math.round(previewZoom * 92)}%`,
            flexShrink: 0,
            maxHeight: previewZoom <= 1 ? '96%' : undefined,
            aspectRatio,
            transform: `translate(${sheetPanPx[0]}px, ${sheetPanPx[1]}px)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.78), 0 0 0 1px rgba(255, 255, 255, 0.14)',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
            }}
          />

          {/* Cajas VP-1 / VP-2 editables */}
          {renderMetrics && (
            <div
              style={{
                position: 'absolute',
                left: `${innerLeftPct}%`,
                top: `${innerTopPct}%`,
                width: `${innerWidthPct}%`,
                height: `${innerHeightPct}%`,
                pointerEvents: 'none',
              }}
            >
              <ViewportOverlayBox
                target="main"
                box={config.mainViewport.boxNormalized}
                label={`VP-1 PLANO 1:${effMainScale.toLocaleString('es-BO')}`}
                color="#FF6B4A"
                selected={activeViewport === 'main'}
                editableBoxes={editableVpBoxes}
                onViewportMouseDown={handleViewportBoxMouseDown}
              />
              <ViewportOverlayBox
                target="location"
                box={config.locationViewport.boxNormalized}
                label={`VP-2 UBICACIÓN 1:${effLocScale.toLocaleString('es-BO')}`}
                color="#2DD4BF"
                selected={activeViewport === 'location'}
                editableBoxes={editableVpBoxes}
                onViewportMouseDown={handleViewportBoxMouseDown}
              />
            </div>
          )}

          {/* Borrador de recuadro o línea mientras se dibuja */}
          {draftShape && renderMetrics && (
            <div
              style={{
                position: 'absolute',
                left: `${innerLeftPct}%`,
                top: `${innerTopPct}%`,
                width: `${innerWidthPct}%`,
                height: `${innerHeightPct}%`,
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: `${(draftShape.shape === 'rect' ? draftShape.x : Math.min(draftShape.x, draftShape.x + draftShape.w)) * 100}%`,
                  top: `${(draftShape.shape === 'rect' ? draftShape.y : Math.min(draftShape.y, draftShape.y + draftShape.h)) * 100}%`,
                  width: `${Math.max(0.01, Math.abs(draftShape.w)) * 100}%`,
                  height: `${Math.max(0.01, Math.abs(draftShape.h)) * 100}%`,
                  border: '1.5px dashed #FF6B4A',
                  background: 'rgba(255, 107, 74, 0.08)',
                }}
              />
            </div>
          )}

          {/* Resaltado y 4 manejadores de esquina para escalar el elemento seleccionado */}
          {selectedRect && renderMetrics && (
            <SelectionHighlightOverlay
              rect={selectedRect}
              sheetW={renderMetrics.widthPx}
              sheetH={renderMetrics.heightPx}
              label={selectedLabel}
              onStartCornerDrag={handleStartScaleDrag}
            />
          )}
        </div>
      </div>
    </div>
  );
}
