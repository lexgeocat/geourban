// src/layers-engine/ui/LayerDropIndicator.tsx

interface LayerDropIndicatorProps {
  /** Color de acento (de la capa que se está arrastrando). */
  color?: string;
}

/**
 * Línea de inserción que indica dónde va a caer la capa arrastrada.
 *
 * Estructura: contenedor de 6px de alto con `position: relative`, y la
 * línea (2px) absolutamente posicionada en el centro. El alto del
 * contenedor "abre" un hueco entre dos filas, así la línea nunca se
 * superpone con el contenido de una fila.
 */
export function LayerDropIndicator({ color = 'var(--cad-accent)' }: LayerDropIndicatorProps) {
  return (
    <div
      aria-hidden="true"
      data-layer-drop-indicator="true"
      style={{
        position: 'relative',
        height: 6,
        margin: '1px 4px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 2,
          transform: 'translateY(-50%)',
          background: color,
          borderRadius: 2,
          boxShadow: `0 0 8px ${color}aa, 0 0 0 1px ${color}33`,
        }}
      />
    </div>
  );
}
