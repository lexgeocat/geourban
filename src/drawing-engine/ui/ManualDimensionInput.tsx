import { useEffect, useRef, useState } from 'react';
import { unByKey } from 'ol/Observable.js';
import { useDrawStore, type DrawMode } from '@map-core/store/drawStore';
import { useMapStore } from '@map-core/store/mapStore';
import { getActiveDraw } from '@kernel/modes/activeDrawRegistry';
import { getDrawSketchAnchor, getDrawSketchCurrentPoint } from '@kernel/geometry/sketchAnchor';
import { projectPathToMetricPlane } from '@georef-engine/metrics';

const MANUAL_INPUT_MODES = new Set<DrawMode>(['polygon', 'line', 'polyline']);

function computeMapPointAtDistance(
  anchor: [number, number],
  directionPoint: [number, number],
  meters: number
): [number, number] {
  const dx = directionPoint[0] - anchor[0];
  const dy = directionPoint[1] - anchor[1];
  const dirLen = Math.hypot(dx, dy);
  if (dirLen < 1e-9) return anchor;
  const ux = dx / dirLen;
  const uy = dy / dirLen;
  const eps = Math.max(dirLen * 0.05, 0.05);
  const probe: [number, number] = [anchor[0] + ux * eps, anchor[1] + uy * eps];
  const [aM, bM] = projectPathToMetricPlane([anchor, probe]);
  const metersPerEps = aM && bM ? Math.hypot(bM[0] - aM[0], bM[1] - aM[1]) : 0;
  const mapUnitsPerMeter = metersPerEps > 1e-9 ? eps / metersPerEps : 1;
  const mapDist = meters * mapUnitsPerMeter;
  return [anchor[0] + ux * mapDist, anchor[1] + uy * mapDist];
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

export default function ManualDimensionInput() {
  const mode = useDrawStore((s) => s.mode);
  const mapInstance = useMapStore((s) => s.mapInstance);
  const [value, setValue] = useState('');
  const [screenPos, setScreenPos] = useState<{ left: number; top: number } | null>(null);
  const pointerMapCoordRef = useRef<number[] | null>(null);
  const valueRef = useRef('');
  const active = MANUAL_INPUT_MODES.has(mode);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!active) {
      setValue('');
      setScreenPos(null);
    }
  }, [active, mode]);

  useEffect(() => {
    if (!mapInstance || !active) return;
    const key = mapInstance.on('pointermove', (evt) => {
      pointerMapCoordRef.current = evt.coordinate;
      if (valueRef.current) {
        setScreenPos({ left: evt.pixel[0] + 14, top: evt.pixel[1] + 14 });
      }
    });
    return () => {
      unByKey(key);
    };
  }, [mapInstance, active]);

  useEffect(() => {
    if (!active) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const draw = getActiveDraw();
      if (!draw) return;

      if (/^[0-9.]$/.test(e.key)) {
        e.preventDefault();
        setValue((v) => v + e.key);
        const coord = pointerMapCoordRef.current;
        if (coord && mapInstance) {
          const px = mapInstance.getPixelFromCoordinate(coord);
          if (px) setScreenPos({ left: px[0] + 14, top: px[1] + 14 });
        }
        return;
      }
      if (e.key === 'Backspace') {
        if (!valueRef.current) return;
        e.preventDefault();
        setValue((v) => v.slice(0, -1));
        return;
      }
      if (e.key === 'Escape') {
        if (!valueRef.current) return;
        setValue('');
        setScreenPos(null);
        return;
      }
      if (e.key === 'Enter') {
        if (!valueRef.current) return;
        e.preventDefault();
        const meters = parseFloat(valueRef.current);
        setValue('');
        setScreenPos(null);
        if (!Number.isFinite(meters) || meters <= 0) return;

        const anchor = getDrawSketchAnchor(draw);
        const current = getDrawSketchCurrentPoint(draw) ?? pointerMapCoordRef.current ?? undefined;
        if (!anchor || !current) return;

        const target = computeMapPointAtDistance(
          anchor as [number, number],
          current as [number, number],
          meters
        );
        draw.appendCoordinates([target]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, mapInstance]);

  if (!active || !screenPos || !value) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: screenPos.left,
        top: screenPos.top,
        zIndex: 'var(--z-tooltip)',
        background: 'var(--cad-bg-deepest)',
        border: '1px solid var(--cad-accent)',
        borderRadius: 4,
        padding: '3px 8px',
        fontSize: '0.75rem',
        fontFamily: 'JetBrains Mono, monospace',
        color: 'var(--cad-accent)',
        pointerEvents: 'none',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
      }}
    >
      {value} m ⏎
    </div>
  );
}