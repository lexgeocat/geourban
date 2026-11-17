import { useState } from 'react';
import {
  Eraser,
  FileCheck2,
  FileEdit,
  MousePointerClick,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from '@shared-ui/store/toastStore';
import type { LotCatalogItem } from '../extractors/cartographyExtractor';
import type { DxfTemplateDoc, DxfTextEntity } from '../model/dxfTemplateModel';
import { useLayoutStore } from '../store/layoutStore';
import { cardStyle, cardTitleStyle, fieldLabelStyle, inputStyle } from './sidebarStyles';

interface SidebarCarimboFieldsPanelProps {
  activeDxfDoc?: DxfTemplateDoc;
  selectedLot: LotCatalogItem | null;
}

const DATA_TOKENS = [
  '{{LOTE}}',
  '{{MANZANO}}',
  '{{AREA_M2}}',
  '{{SUP_CONSTRUIDA}}',
  '{{FRENTE_M}}',
  '{{FONDO_M}}',
  '{{PROPIETARIO}}',
  '{{ESCALA_PLANO}}',
  '{{LAMINA}}',
];

export default function SidebarCarimboFieldsPanel({
  activeDxfDoc,
  selectedLot,
}: SidebarCarimboFieldsPanelProps) {
  const config = useLayoutStore((s) => s.config);
  const selectedItem = useLayoutStore((s) => s.selectedItem);

  const setCadastralField = useLayoutStore((s) => s.setCadastralField);
  const clearAllCadastralFields = useLayoutStore((s) => s.clearAllCadastralFields);
  const fillCadastralFromSelectedLot = useLayoutStore((s) => s.fillCadastralFromSelectedLot);

  const addCustomField = useLayoutStore((s) => s.addCustomField);
  const updateCustomField = useLayoutStore((s) => s.updateCustomField);
  const removeCustomField = useLayoutStore((s) => s.removeCustomField);

  const setCanvasTool = useLayoutStore((s) => s.setCanvasTool);
  const setSelectedItem = useLayoutStore((s) => s.setSelectedItem);
  const setDxfTextOverride = useLayoutStore((s) => s.setDxfTextOverride);
  const updateDxfEntityEdit = useLayoutStore((s) => s.updateDxfEntityEdit);
  const restoreAllDxfEntities = useLayoutStore((s) => s.restoreAllDxfEntities);

  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const [dxfQuery, setDxfQuery] = useState('');

  const handleAddCustom = () => {
    if (!newLabel.trim() && !newValue.trim()) return;
    addCustomField(newLabel.trim() || 'Dato Extra', newValue.trim(), 'carimbo');
    setNewLabel('');
    setNewValue('');
  };

  const dxfTextEntities: DxfTextEntity[] = activeDxfDoc
    ? activeDxfDoc.entities.filter((e): e is DxfTextEntity => e.type === 'TEXT' || e.type === 'MTEXT')
    : [];

  const filteredDxfTexts = dxfQuery.trim()
    ? dxfTextEntities.filter((t) => t.text.toLowerCase().includes(dxfQuery.trim().toLowerCase()))
    : dxfTextEntities;

  const hasDxfEdits = Object.keys(config.dxfEntityEdits).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 1. Autocompletado de Datos del Lote */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <span>Atributos del Carimbo</span>
        </div>

        <div style={{ display: 'flex', gap: 5 }}>
          <button
            type="button"
            onClick={() => {
              fillCadastralFromSelectedLot(selectedLot);
              toast('Datos rellenados desde la geometría/atributos del lote actual.', { variant: 'success' });
            }}
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '5px 8px',
              borderRadius: 6,
              border: '1px solid rgba(45, 212, 191, 0.4)',
              background: 'rgba(45, 212, 191, 0.12)',
              color: '#2DD4BF',
              fontSize: '0.62rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Sparkles size={11} />
            <span>Llenar desde Lote</span>
          </button>
          <button
            type="button"
            onClick={() => {
              clearAllCadastralFields();
              toast('Campos de carimbo vaciados.', { variant: 'info' });
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 8px',
              borderRadius: 6,
              border: '1px solid var(--cad-border)',
              background: 'var(--cad-bg-deep)',
              color: 'var(--cad-text-dim)',
              fontSize: '0.62rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Eraser size={11} />
            <span>Vaciar</span>
          </button>
        </div>
      </div>

      {/* 2. Campos del Carimbo (vacíos por defecto, 100% personalizables) */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileCheck2 size={14} color="#34D399" />
            <span>Datos del Carimbo (Limpios / Editables)</span>
          </div>
        </div>

        {(
          [
            { key: 'municipalityHeader', label: 'Entidad / Gobierno Municipal', ph: 'Opcional...' },
            { key: 'planTitle', label: 'Título del Plano (admite {{LOTE}})', ph: 'Ej. PLANO DE LOTE' },
            { key: 'ownerName', label: 'Propietario', ph: 'Nombre del propietario...' },
            { key: 'locationAddress', label: 'Ubicación / Dirección', ph: 'Av. / Calle...' },
            { key: 'urbanizationName', label: 'Urbanización / Proyecto', ph: 'Opcional...' },
          ] as const
        ).map((f) => (
          <div key={f.key}>
            <label style={fieldLabelStyle}>{f.label}</label>
            <input
              type="text"
              placeholder={f.ph}
              value={config.cadastral[f.key]}
              onChange={(e) => setCadastralField(f.key, e.target.value)}
              style={inputStyle}
            />
          </div>
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          <div>
            <label style={fieldLabelStyle}>Sup. Construida (m²)</label>
            <input
              type="text"
              placeholder="Ej. 165.40 m²"
              value={config.cadastral.surfaceConstruidaM2}
              onChange={(e) => setCadastralField('surfaceConstruidaM2', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={fieldLabelStyle}>Sup. Testimonio</label>
            <input
              type="text"
              placeholder="Ej. 300.00 m²"
              value={config.cadastral.surfaceTestimonioM2}
              onChange={(e) => setCadastralField('surfaceTestimonioM2', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={fieldLabelStyle}>Matrícula DD.RR.</label>
            <input
              type="text"
              placeholder="Ptda. / Matrícula..."
              value={config.cadastral.ddrrMatricula}
              onChange={(e) => setCadastralField('ddrrMatricula', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={fieldLabelStyle}>Cód. Catastral</label>
            <input
              type="text"
              placeholder="00-00-00"
              value={config.cadastral.catastralCode}
              onChange={(e) => setCadastralField('catastralCode', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={fieldLabelStyle}>Distrito / Zona</label>
            <div style={{ display: 'grid', gridTemplateColumns: '0.7fr 1.3fr', gap: 4 }}>
              <input
                type="text"
                placeholder="D"
                value={config.cadastral.district}
                onChange={(e) => setCadastralField('district', e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Zona"
                value={config.cadastral.zone}
                onChange={(e) => setCadastralField('zone', e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div>
            <label style={fieldLabelStyle}>Profesional / Reg.</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 4 }}>
              <input
                type="text"
                placeholder="Arq. / Top."
                value={config.cadastral.architectName}
                onChange={(e) => setCadastralField('architectName', e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Reg."
                value={config.cadastral.professionalRegistry}
                onChange={(e) => setCadastralField('professionalRegistry', e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div>
            <label style={fieldLabelStyle}>Fecha</label>
            <input
              type="text"
              placeholder="dd/mm/aaaa"
              value={config.cadastral.projectDate}
              onChange={(e) => setCadastralField('projectDate', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={fieldLabelStyle}>Lámina Nº</label>
            <input
              type="text"
              placeholder="Ej. 01 / 01"
              value={config.cadastral.sheetCode}
              onChange={(e) => setCadastralField('sheetCode', e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      {/* 3. Datos Extra Personalizados */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} color="#FF6B4A" />
            <span>Datos Adicionales (Cuadro Técnico)</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {DATA_TOKENS.map((tok) => (
            <button
              key={tok}
              type="button"
              onClick={() => setNewValue((prev) => (prev ? `${prev} ${tok}` : tok))}
              style={{
                padding: '2px 5px',
                borderRadius: 4,
                fontSize: '0.55rem',
                fontFamily: 'var(--font-mono)',
                border: '1px solid var(--cad-border)',
                background: 'var(--cad-bg-deep)',
                color: '#38BDF8',
                cursor: 'pointer',
              }}
            >
              {tok}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr auto', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Dato (ej. Sup. Const)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Valor o {{TOKEN}}"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={handleAddCustom}
            style={{
              padding: '5px 8px',
              borderRadius: 6,
              border: '1px solid rgba(255, 107, 74, 0.5)',
              background: 'rgba(255, 107, 74, 0.18)',
              color: '#FF6B4A',
              fontSize: '0.64rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            +
          </button>
        </div>

        {config.customFields.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {config.customFields.map((cf) => (
              <div
                key={cf.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr 1.2fr auto',
                  gap: 4,
                  alignItems: 'center',
                }}
              >
                <input
                  type="checkbox"
                  checked={cf.visible}
                  onChange={(e) => updateCustomField(cf.id, { visible: e.target.checked })}
                />
                <input
                  type="text"
                  value={cf.label}
                  onChange={(e) => updateCustomField(cf.id, { label: e.target.value })}
                  style={inputStyle}
                />
                <input
                  type="text"
                  value={cf.value}
                  onChange={(e) => updateCustomField(cf.id, { value: e.target.value })}
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => removeCustomField(cf.id)}
                  style={{
                    padding: 4,
                    border: 'none',
                    background: 'transparent',
                    color: '#FB7185',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Editor Rápido de Textos y Entidades del .DXF */}
      {activeDxfDoc && (
        <div style={cardStyle}>
          <div style={cardTitleStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileEdit size={14} color="#38BDF8" />
              <span>Acomodar / Editar Textos .DXF ({dxfTextEntities.length})</span>
            </div>
            {hasDxfEdits && (
              <button
                type="button"
                onClick={restoreAllDxfEntities}
                title="Restaurar todas las líneas, recuadros y textos borrados del DXF"
                style={{
                  padding: '3px 6px',
                  borderRadius: 5,
                  border: '1px solid var(--cad-border)',
                  background: 'var(--cad-bg-deep)',
                  color: '#FBBF24',
                  fontSize: '0.58rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <RotateCcw size={10} />
                <span>Restaurar DXF</span>
              </button>
            )}
          </div>

          <input
            type="text"
            placeholder="Filtrar texto del .DXF..."
            value={dxfQuery}
            onChange={(e) => setDxfQuery(e.target.value)}
            style={inputStyle}
          />

          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              paddingRight: 2,
            }}
          >
            {filteredDxfTexts.map((ent) => {
              const edit = config.dxfEntityEdits[ent.id];
              const isDeleted = Boolean(edit?.deleted);
              const isSelected = selectedItem?.kind === 'dxf' && selectedItem.id === ent.id;
              return (
                <div
                  key={ent.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: 4,
                    borderRadius: 6,
                    opacity: isDeleted ? 0.5 : 1,
                    background: isSelected ? 'rgba(56, 189, 248, 0.14)' : 'var(--cad-bg-deep)',
                    border: `1px solid ${isSelected ? '#38BDF8' : 'var(--cad-border)'}`,
                  }}
                >
                  <input
                    type="text"
                    disabled={isDeleted}
                    value={edit?.text ?? config.dxfTextOverrides[ent.id] ?? ent.text}
                    onChange={(e) => setDxfTextOverride(ent.id, e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    type="button"
                    title="Seleccionar en lámina para mover o escalar"
                    onClick={() => {
                      setCanvasTool('edit-elements');
                      setSelectedItem({ kind: 'dxf', id: ent.id });
                    }}
                    style={{
                      padding: '4px 5px',
                      borderRadius: 5,
                      border: '1px solid var(--cad-border)',
                      background: 'var(--cad-bg-surface)',
                      color: '#38BDF8',
                      cursor: 'pointer',
                    }}
                  >
                    <MousePointerClick size={11} />
                  </button>
                  <button
                    type="button"
                    title={isDeleted ? 'Restaurar texto' : 'Ocultar / borrar texto del carimbo'}
                    onClick={() => updateDxfEntityEdit(ent.id, { deleted: !isDeleted })}
                    style={{
                      padding: '4px 5px',
                      borderRadius: 5,
                      border: '1px solid var(--cad-border)',
                      background: 'var(--cad-bg-surface)',
                      color: isDeleted ? '#2DD4BF' : '#FB7185',
                      cursor: 'pointer',
                    }}
                  >
                    {isDeleted ? <RotateCcw size={11} /> : <Trash2 size={11} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
