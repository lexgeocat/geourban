import { useRef, useState } from 'react';
import { BookmarkPlus, FileCode2, Palette, Scaling, Trash2, Upload } from 'lucide-react';
import { toast } from '@shared-ui/store/toastStore';
import {
  PAPER_DIMENSIONS_MM,
  type CarimboFitMode,
  type LayoutThemeId,
  type PaperOrientation,
  type PaperSizeId,
} from '../model/layoutTypes';
import { useLayoutStore } from '../store/layoutStore';
import { cardStyle, cardTitleStyle, fieldLabelStyle, inputStyle, segmentBtnStyle } from './sidebarStyles';

const MONOCHROME_THEMES: Array<{ id: LayoutThemeId; label: string; desc: string; swatch: string }> = [
  {
    id: 'monochrome-cad-white',
    label: 'Blanco Impresión (CTB B/N)',
    desc: 'Monocromo negro/gris',
    swatch: '#FFFFFF',
  },
  {
    id: 'autocad-model-dark',
    label: 'Negro AutoCAD (B/N)',
    desc: 'Monocromo blanco/gris',
    swatch: '#090C12',
  },
];

export default function SidebarPaperAndStylePanel() {
  const templates = useLayoutStore((s) => s.templates);
  const activeTemplateId = useLayoutStore((s) => s.activeTemplateId);
  const config = useLayoutStore((s) => s.config);

  const selectTemplate = useLayoutStore((s) => s.selectTemplate);
  const importCustomDxf = useLayoutStore((s) => s.importCustomDxf);
  const saveActiveTemplateToLibrary = useLayoutStore((s) => s.saveActiveTemplateToLibrary);
  const removeCustomTemplate = useLayoutStore((s) => s.removeCustomTemplate);

  const setPaperSize = useLayoutStore((s) => s.setPaperSize);
  const setOrientation = useLayoutStore((s) => s.setOrientation);
  const setCustomPaper = useLayoutStore((s) => s.setCustomPaper);
  const setMarginMm = useLayoutStore((s) => s.setMarginMm);
  const setCarimboFitMode = useLayoutStore((s) => s.setCarimboFitMode);
  const setCarimboScalePercent = useLayoutStore((s) => s.setCarimboScalePercent);
  const setTheme = useLayoutStore((s) => s.setTheme);

  const [saveName, setSaveName] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const unitFactor = config.customPaper.unit === 'in' ? 25.4 : 1;
  const customWidthDisplay = +(config.customPaper.widthMm / unitFactor).toFixed(2);
  const customHeightDisplay = +(config.customPaper.heightMm / unitFactor).toFixed(2);

  const activeTpl = templates.find((t) => t.id === activeTemplateId);

  const handleSaveTemplate = (asNew: boolean) => {
    const saved = saveActiveTemplateToLibrary(saveName.trim() || undefined, asNew);
    if (saved) {
      setSaveName('');
      toast(`Plantilla "${saved.name}" guardada permanentemente en tu biblioteca.`, {
        variant: 'success',
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (text.includes('\uFFFD')) {
        text = new TextDecoder('windows-1252').decode(buf);
      }
      if (!text.includes('SECTION') && !text.includes('ENTITIES')) {
        toast('El archivo no parece ser un DXF ASCII válido (guardalo como DXF ASCII en AutoCAD/QGIS).', {
          variant: 'warning',
          durationMs: 6000,
        });
        return;
      }
      const created = importCustomDxf(file.name, text);
      toast(`Carimbo "${created.name}" integrado y guardado en tus plantillas.`, {
        variant: 'success',
        durationMs: 4500,
      });
    } catch (err) {
      console.error('Error al importar plantilla DXF:', err);
      toast('No se pudo leer el archivo .dxf seleccionado.', { variant: 'error' });
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 1. Mis Plantillas & Guardado Persistente */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileCode2 size={14} color="#FBBF24" />
            <span>Plantillas (.DXF y Guardadas)</span>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid rgba(251, 191, 36, 0.45)',
              background: 'rgba(251, 191, 36, 0.14)',
              color: '#FBBF24',
              fontSize: '0.63rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Upload size={11} />
            <span>Importar .DXF</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".dxf"
            style={{ display: 'none' }}
            onChange={(e) => void handleFileChange(e)}
          />
        </div>

        {/* Barra para guardar modificaciones / carimbo actual */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            padding: 7,
            borderRadius: 8,
            background: 'var(--cad-bg-deep)',
            border: '1px solid var(--cad-border)',
          }}
        >
          <input
            type="text"
            placeholder="Nombre para guardar esta plantilla..."
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 5 }}>
            <button
              type="button"
              onClick={() => handleSaveTemplate(false)}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: '5px 7px',
                borderRadius: 6,
                border: '1px solid rgba(45, 212, 191, 0.45)',
                background: 'rgba(45, 212, 191, 0.14)',
                color: '#2DD4BF',
                fontSize: '0.63rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <BookmarkPlus size={12} />
              <span>{activeTpl?.saved ? 'Actualizar Guardada' : 'Guardar Plantilla'}</span>
            </button>
            {activeTpl?.saved && (
              <button
                type="button"
                onClick={() => handleSaveTemplate(true)}
                style={{
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--cad-border)',
                  background: 'var(--cad-bg-surface)',
                  color: 'var(--cad-text-dim)',
                  fontSize: '0.62rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Guardar Copia
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {templates.length === 0 && (
            <div
              style={{
                padding: '9px 10px',
                borderRadius: 8,
                border: '1px dashed var(--cad-border)',
                background: 'var(--cad-bg-deep)',
                fontSize: '0.62rem',
                color: 'var(--cad-text-muted)',
                textAlign: 'center',
              }}
            >
              Sin plantillas guardadas. Usá <strong>Importar .DXF</strong> o diseñá tu lámina en blanco y presioná <strong>Guardar Plantilla</strong>.
            </div>
          )}
          {templates.map((tpl) => {
            const active = tpl.id === activeTemplateId;
            const isDeletable = tpl.kind === 'dxf-custom' || tpl.saved === true;
            return (
              <div key={tpl.id} style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => selectTemplate(tpl.id)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    padding: '7px 9px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: `1px solid ${active ? 'rgba(251, 191, 36, 0.6)' : 'var(--cad-border)'}`,
                    background: active ? 'rgba(251, 191, 36, 0.1)' : 'var(--cad-bg-deep)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--cad-text)' }}>
                      {tpl.name}
                    </span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {tpl.saved && (
                        <span
                          style={{
                            fontSize: '0.55rem',
                            fontWeight: 700,
                            padding: '1px 4px',
                            borderRadius: 4,
                            background: 'rgba(45, 212, 191, 0.15)',
                            color: '#2DD4BF',
                          }}
                        >
                          Guardada
                        </span>
                      )}
                      {tpl.kind !== 'iso-procedural' && (
                        <span
                          style={{
                            fontSize: '0.55rem',
                            fontWeight: 700,
                            padding: '1px 4px',
                            borderRadius: 4,
                            background: 'rgba(56, 189, 248, 0.15)',
                            color: '#38BDF8',
                          }}
                        >
                          DXF
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.59rem', color: 'var(--cad-text-muted)', marginTop: 2 }}>
                    {tpl.description}
                  </div>
                </button>
                {isDeletable && (
                  <button
                    type="button"
                    onClick={() => removeCustomTemplate(tpl.id)}
                    title="Eliminar plantilla guardada"
                    style={{
                      padding: '0 7px',
                      borderRadius: 8,
                      border: '1px solid var(--cad-border)',
                      background: 'var(--cad-bg-deep)',
                      color: '#FB7185',
                      cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Estilo Visual Monocromático AutoCAD */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Palette size={14} color="#38BDF8" />
            <span>Estilo Visual CAD (Monocromo)</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {MONOCHROME_THEMES.map((th) => {
            const active = config.theme === th.id;
            return (
              <button
                key={th.id}
                type="button"
                onClick={() => setTheme(th.id)}
                style={{
                  padding: '7px 8px',
                  borderRadius: 8,
                  textAlign: 'left',
                  cursor: 'pointer',
                  border: `1px solid ${active ? '#38BDF8' : 'var(--cad-border)'}`,
                  background: active ? 'rgba(56, 189, 248, 0.14)' : 'var(--cad-bg-deep)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: th.swatch,
                      border: '1px solid #64748B',
                    }}
                  />
                  <span style={{ fontSize: '0.67rem', fontWeight: 700, color: 'var(--cad-text)' }}>
                    {th.label}
                  </span>
                </div>
                <div style={{ fontSize: '0.58rem', color: 'var(--cad-text-muted)', marginTop: 1 }}>
                  {th.desc}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Papel & Auto-Adecuación */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Scaling size={14} color="#A78BFA" />
            <span>Papel y Auto-Adecuación</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 6 }}>
          <div>
            <label style={fieldLabelStyle}>Formato de Papel</label>
            <select
              value={config.paperSize}
              onChange={(e) => setPaperSize(e.target.value as PaperSizeId)}
              style={inputStyle}
            >
              {(Object.keys(PAPER_DIMENSIONS_MM) as PaperSizeId[]).map((k) => (
                <option key={k} value={k}>
                  {PAPER_DIMENSIONS_MM[k].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={fieldLabelStyle}>Orientación</label>
            <select
              value={config.orientation}
              onChange={(e) => setOrientation(e.target.value as PaperOrientation)}
              style={inputStyle}
            >
              <option value="landscape">Horizontal</option>
              <option value="portrait">Vertical</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(
            [
              { id: 'OFICIO_BOL', tag: 'Oficio 8.5×13"' },
              { id: 'A4', tag: 'A4' },
              { id: 'A3', tag: 'A3' },
              { id: 'A2', tag: 'A2' },
              { id: 'A1', tag: 'A1' },
              { id: 'A0', tag: 'A0' },
              { id: 'CUSTOM', tag: 'Custom' },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPaperSize(p.id)}
              style={{
                padding: '3px 7px',
                borderRadius: 5,
                fontSize: '0.6rem',
                fontWeight: config.paperSize === p.id ? 700 : 500,
                cursor: 'pointer',
                border: `1px solid ${config.paperSize === p.id ? '#A78BFA' : 'var(--cad-border)'}`,
                background: config.paperSize === p.id ? 'rgba(167, 139, 250, 0.16)' : 'var(--cad-bg-deep)',
                color: config.paperSize === p.id ? '#C4B5FD' : 'var(--cad-text-muted)',
              }}
            >
              {p.tag}
            </button>
          ))}
        </div>

        {config.paperSize === 'CUSTOM' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.7fr', gap: 5 }}>
            <div>
              <label style={fieldLabelStyle}>Ancho ({config.customPaper.unit})</label>
              <input
                type="number"
                min={config.customPaper.unit === 'in' ? 4 : 100}
                step={config.customPaper.unit === 'in' ? 0.5 : 5}
                value={customWidthDisplay}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val) && val > 2) {
                    setCustomPaper({ widthMm: +(val * unitFactor).toFixed(2) });
                  }
                }}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>Alto ({config.customPaper.unit})</label>
              <input
                type="number"
                min={config.customPaper.unit === 'in' ? 4 : 100}
                step={config.customPaper.unit === 'in' ? 0.5 : 5}
                value={customHeightDisplay}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val) && val > 2) {
                    setCustomPaper({ heightMm: +(val * unitFactor).toFixed(2) });
                  }
                }}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>Unidad</label>
              <select
                value={config.customPaper.unit}
                onChange={(e) => setCustomPaper({ unit: e.target.value as 'mm' | 'in' })}
                style={inputStyle}
              >
                <option value="mm">mm</option>
                <option value="in">pulg</option>
              </select>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          <button
            type="button"
            onClick={() => setCarimboFitMode('adapt-sheet' as CarimboFitMode)}
            style={segmentBtnStyle(config.carimboFitMode === 'adapt-sheet', '#A78BFA')}
          >
            Adaptar al Papel
          </button>
          <button
            type="button"
            onClick={() => setCarimboFitMode('preserve-aspect' as CarimboFitMode)}
            style={segmentBtnStyle(config.carimboFitMode === 'preserve-aspect', '#A78BFA')}
          >
            Proporción DXF
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 8 }}>
          <div>
            <label style={fieldLabelStyle}>Margen ({config.marginMm} mm)</label>
            <input
              type="range"
              min={2}
              max={25}
              step={1}
              value={config.marginMm}
              onChange={(e) => setMarginMm(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={fieldLabelStyle}>Escala texto ({config.carimboScalePercent}%)</label>
            <input
              type="range"
              min={65}
              max={135}
              step={5}
              value={config.carimboScalePercent}
              onChange={(e) => setCarimboScalePercent(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
