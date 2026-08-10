/**
 * Info visible en el panel del usuario (botones + colores).
 *
 * NOTA: las descripciones largas de cada método (`description`) estaban
 * declaradas previamente en este archivo como campo de la interface, pero
 * no se consumían en ningún lado. Se movieron a los comentarios arriba de
 * cada entrada de `SUBDIVISION_METHOD_INFO` por si se quieren usar en
 * tooltips o ayuda contextual más adelante.
 */
export interface MethodLabelInfo {
  key: string;
  shortLabel: string;
  color: string;
}

/**
 * Auto (Cabecera + Cuerpo) — genera 1 fila de lotes angostos en cada
 * extremo (junto a las esquinas) y un cuerpo central a doble frente. Es
 * el método recomendado para manzanos rectangulares o trapezoidales
 * típicos.
 */
export const SUBDIVISION_METHOD_INFO: Record<string, MethodLabelInfo> = {
  auto: {
    key: 'auto',
    shortLabel: '▣ Auto',
    color: 'var(--cad-accent)',
  },
  /**
   * Área exacta (cuadrícula ideal) — busca que cada lote tenga
   * exactamente el área objetivo, con cortes alineados a un cuadrilátero
   * ideal. Último lote puede ser remanente.
   */
  exact: {
    key: 'exact',
    shortLabel: '◈ Área exacta',
    color: 'var(--cad-accent-green)',
  },
  /**
   * Eje principal (PCA) — subdivide usando el eje principal (PCA).
   * Detecta polígonos angostos y adapta la dirección de corte
   * automáticamente. Genera lotes con el área objetivo indicada.
   */
  modo2: {
    key: 'modo2',
    shortLabel: '◆ Eje PCA',
    color: '#4dd0c4',
  },
};