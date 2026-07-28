import React from 'react';
import { useDrawStore } from '../../../../store/map/drawStore';
import { useSelectionStore } from '../../../../store/map/selectionStore';
import { useStreetStore } from '../../../../store/entities/streetStore';
import { useRoundaboutStore } from '../../../../store/entities/roundaboutStore';
import { useGenerateLotsProgressStore } from '../../../../store/ui/generateLotsProgressStore';
import { RibbonGroup, RibbonTool } from '../RibbonPrimitives';
import { IconPolygon, IconLine, IconRect, IconGreen, IconEquip, IconStreet, IconRoundabout, IconSubdivide, IconLots, IconUrbanizacion, IconGeoref } from '../icons';

export interface InsertTabProps {
  lotsBusy: boolean;
  onOpenSubdivision: () => void;
  onGenerateLots: () => void;
}

export default function InsertTab({ lotsBusy, onOpenSubdivision, onGenerateLots }: InsertTabProps) {
  const setMode = useDrawStore((s) => s.setMode);
  const mode = useDrawStore((s) => s.mode);
  const setAreaKind = useDrawStore((s) => s.setAreaKind);
  const primarySelected = useSelectionStore((s) => s.primaryId !== null);
  const genLotsProgress = useGenerateLotsProgressStore();

  const rbDefaultRadiusM = useRoundaboutStore((s) => s.defaultRadiusM);
  const setRbDefaultRadius = useRoundaboutStore((s) => s.setDefaultRadius);
  const defaultWidthM = useStreetStore((s) => s.defaultWidthM);
  const setDefaultWidth = useStreetStore((s) => s.setDefaultWidth);
  const defaultSideWidthM = useStreetStore((s) => s.defaultSideWidthM);
  const setDefaultSideWidth = useStreetStore((s) => s.setDefaultSideWidth);

  return (
    <>
      <RibbonGroup label="Geometría">
        <RibbonTool mode="polygon" icon={<IconPolygon />} label="Polígono" shortcut="P" />
        <RibbonTool mode="line" icon={<IconLine />} label="Línea" shortcut="L" />
        <RibbonTool mode="rectangle" icon={<IconRect />} label="Rectángulo" shortcut="R" />
        <RibbonTool icon={<IconGreen />} label="Área verde" shortcut="Shift+G" onClick={() => { setAreaKind('area_verde'); setMode('polygon'); }} tooltip="Crear área verde (Shift+G)" />
        <RibbonTool icon={<IconEquip />} label="Equipamiento" shortcut="Shift+E" onClick={() => { setAreaKind('equipamiento'); setMode('polygon'); }} tooltip="Crear equipamiento (Shift+E)" />
      </RibbonGroup>
      <RibbonGroup label="Referencia">
        <RibbonTool icon={<IconUrbanizacion />} label="Urbanización" onClick={() => { setAreaKind('urbanizacion'); setMode('polygon'); }} tooltip="Crear polígono de Urbanización" />
        <RibbonTool icon={<IconGeoref />} label="Georreferenciado" onClick={() => { setAreaKind('georreferenciado'); setMode('polygon'); }} tooltip="Crear polígono Georreferenciado" />
      </RibbonGroup>
      <RibbonGroup label="Vialidad">
        <RibbonTool mode="street" icon={<IconStreet />} label="Trazar calle" shortcut="S" active={mode === 'street'} />
        <RibbonTool mode="roundabout" icon={<IconRoundabout />} label="Rotonda" shortcut="O" active={mode === 'roundabout'} />
        <div className="ribbon-inline-control">
          <input type="number" className="ribbon-inline-input" value={rbDefaultRadiusM} min={3} max={200} step={1}
            onChange={(e) => setRbDefaultRadius(parseFloat(e.target.value) || 12)} title="Radio de rotonda (m)" aria-label="Radio de rotonda en metros" />
          <span className="ribbon-inline-text">Radio rot. (m)</span>
        </div>
        <div className="ribbon-inline-control">
          <input type="number" className="ribbon-inline-input" value={defaultWidthM} min={1} max={50} step={1}
            onChange={(e) => setDefaultWidth(parseFloat(e.target.value) || 8)} title="Ancho de vía (m)" aria-label="Ancho de vía en metros" />
          <span className="ribbon-inline-text">Ancho (m)</span>
        </div>
        <div className="ribbon-inline-control">
          <input type="number" className="ribbon-inline-input" value={defaultSideWidthM} min={0} max={30} step={0.5}
            onChange={(e) => setDefaultSideWidth(Math.max(0, parseFloat(e.target.value) || 0))} title="Ancho de vereda (m)" aria-label="Ancho de vereda en metros" />
          <span className="ribbon-inline-text">Vereda (m)</span>
        </div>
      </RibbonGroup>
      <RibbonGroup label="Subdivisión">
        <RibbonTool icon={<IconSubdivide />} label="Subdividir" disabled={!primarySelected} onClick={onOpenSubdivision} />
        <RibbonTool
          icon={<IconLots />} label="Gen. Lotes" disabled={lotsBusy}
          badge={genLotsProgress.active ? genLotsProgress.processed : undefined} onClick={onGenerateLots}
        />
      </RibbonGroup>
    </>
  );
}