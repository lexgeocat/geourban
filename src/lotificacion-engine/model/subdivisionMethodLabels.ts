export interface MethodLabelInfo {
  key: string;
  shortLabel: string;
  color: string;
}
export const SUBDIVISION_METHOD_INFO: Record<string, MethodLabelInfo> = {
  auto: {
    key: 'auto',
    shortLabel: '▣ Auto',
    color: 'var(--cad-accent)',
  },
  exact: {
    key: 'exact',
    shortLabel: '◈ Área exacta',
    color: 'var(--cad-accent-green)',
  },
  modo2: {
    key: 'modo2',
    shortLabel: '◆ Eje PCA',
    color: '#4dd0c4',
  },
};
