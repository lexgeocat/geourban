import { useState } from 'react';
import { BookmarkPlus, FileCode2, Scaling, Trash2 } from 'lucide-react';
import { toast } from '@shared-ui/store/toastStore';
import type { CarimboFitMode } from '../model/layoutTypes';
import { useLayoutStore } from '../store/layoutStore';
import { cardStyle, cardTitleStyle, fieldLabelStyle, inputStyle, segmentBtnStyle } from './sidebarStyles';

export default function SidebarPaperAndStylePanel() {
  const templates = useLayoutStore((s) => s.templates);
  const activeTemplateId = useLayoutStore((s) => s.activeTemplateId);
  const config = useLayoutStore((s) => s.config);

  const selectTemplate = useLayoutStore((s) => s.selectTemplate);
  const saveActiveTemplateToLibrary = useLayoutStore((s) => s.saveActiveTemplateToLibrary);
  const removeCustomTemplate = useLayoutStore((s) => s.removeCustomTemplate);

  const setCustomPaper = useLayoutStore((s) => s.setCustomPaper);
  const setMarginMm = useLayoutStore((s) => s.setMarginMm);
  const setCarimboFitMode = useLayoutStore((s) => s.setCarimboFitMode);
  const setCarimboScalePercent = useLayoutStore((s) => s.setCarimboScalePercent);

  const [saveName, setSaveName] = useState('');

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 1. Biblioteca de Plantillas Guardadas y .DXF */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileCode2 size={14} color="#FBBF24" />
            <span>Biblioteca de Plantillas</span>
          </div>
        </div>

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
              <span>{activeTpl?.saved ? 'Actualizar' : 'Guardar'}</span>
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
                Copia
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
              Sin plantillas guardadas. Usá el ícono <strong>Importar .DXF</strong> en la barra superior o diseñá tu lámina y guardala aquí.
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
                    padding: '6px 8px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: `1px solid ${active ? 'rgba(251, 191, 36, 0.6)' : 'var(--cad-border)'}`,
                    background: active ? 'rgba(251, 191, 36, 0.1)' : 'var(--cad-bg-deep)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--cad-text)' }}>
                      {tpl.name}
                    </span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {tpl.saved && (
                        <span
                          style={{
                            fontSize: '0.54rem',
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
                            fontSize: '0.54rem',
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
                  <div style={{ fontSize: '0.58rem', color: 'var(--cad-text-muted)', marginTop: 2 }}>
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

      {/* 2. Medidas Personalizadas (solo cuando Papel === CUSTOM en la cinta) */}
      {config.paperSize === 'CUSTOM' && (
        <div style={cardStyle}>
          <div style={cardTitleStyle}>
            <span>Dimensiones Personalizadas</span>
          </div>
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
        </div>
      )}

      {/* 3. Márgenes y Auto-Adecuación de Carimbo */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Scaling size={14} color="#A78BFA" />
            <span>Ajuste de Carimbo y Márgenes</span>
          </div>
        </div>

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
