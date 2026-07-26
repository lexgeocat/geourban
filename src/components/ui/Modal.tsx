// src/components/ui/Modal.tsx
import * as Dialog from '@radix-ui/react-dialog';
import React from 'react';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Título accesible (lo anuncia el lector de pantalla al abrir). */
  title: string;
  /** Ocultar visualmente el título de Radix cuando el propio contenido
   *  ya renderiza un <h2> visible con el mismo texto (caso más común
   *  acá, para no duplicar el header). */
  visuallyHiddenTitle?: boolean;
  description?: string;
  width?: string | number;
  children: React.ReactNode;
  /** Diálogos "bloqueantes" (ej. setup inicial de proyecto): no se
   *  cierran con click afuera ni con Escape. */
  disableOutsideClose?: boolean;
}

const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function Modal({
  open,
  onOpenChange,
  title,
  visuallyHiddenTitle,
  description,
  width = 'min(560px, 92vw)',
  children,
  disableOutsideClose,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="cad-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
          }}
        />
        <Dialog.Content
          className="cad-panel-glass cad-modal-content"
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width,
            maxHeight: '90vh',
            overflow: 'auto',
            padding: '20px 22px',
            zIndex: 1001,
          }}
          onInteractOutside={disableOutsideClose ? (e) => e.preventDefault() : undefined}
          onEscapeKeyDown={disableOutsideClose ? (e) => e.preventDefault() : undefined}
        >
          <Dialog.Title style={visuallyHiddenTitle ? visuallyHiddenStyle : undefined}>
            {title}
          </Dialog.Title>
          {/* Radix exige describedBy o tira warning en dev; si no hay
              descripción explícita, usamos el título como fallback oculto. */}
          <Dialog.Description style={visuallyHiddenStyle}>
            {description ?? title}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}