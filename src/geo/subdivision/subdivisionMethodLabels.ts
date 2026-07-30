export interface MethodLabelInfo {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
}

export const SUBDIVISION_METHOD_INFO: Record<string, MethodLabelInfo> = {
  auto: {
    key: 'auto',
    label: 'Auto (Cabecera + Cuerpo)',
    shortLabel: '▣ Auto',
    description: 'Genera 1 fila de lotes angostos en cada extremo (junto a las esquinas) y un cuerpo central a doble frente. Es el método recomendado para manzanos rectangulares o trapezoidales típicos.',
    color: 'var(--cad-accent)',
  },
  exact: {
    key: 'exact',
    label: 'Área exacta (cuadrícula ideal)',
    shortLabel: '◈ Área exacta',
    description: 'Busca que cada lote tenga exactamente el área objetivo, con cortes alineados a un cuadrilátero ideal. Último lote puede ser remanente.',
    color: 'var(--cad-accent-green)',
  },
  modo2: {
    key: 'modo2',
    label: 'Eje principal (PCA)',
    shortLabel: '◆ Eje PCA',
    description: 'Subdivide usando el eje principal (PCA). Detecta polígonos angostos y adapta la dirección de corte automáticamente. Genera lotes con el área objetivo indicada.',
    color: '#4dd0c4',
  },
  'manual-slice': {
    key: 'manual-slice',
    label: 'Manual (bisección de línea)',
    shortLabel: '✂ Manual',
    description: 'Seleccioná un frente del polígono y un segmento auxiliar (dirección de corte). El sistema bisecta para generar un sub-manzano con el área indicada.',
    color: '#f59e0b',
  },
};