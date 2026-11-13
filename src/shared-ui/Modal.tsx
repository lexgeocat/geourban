import * as Dialog from '@radix-ui/react-dialog';
import React from 'react';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  visuallyHiddenTitle?: boolean;
  description?: string;
  width?: string | number;
  children: React.ReactNode;
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
  width = 'min(520px, 92vw)',
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
            background: 'rgba(6, 7, 11, 0.72)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 'var(--z-modal-overlay)',
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
            padding: '22px 24px',
            borderRadius: 16,
            border: '1px solid rgba(255, 255, 255, 0.11)',
            boxShadow:
              '0 24px 64px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 107, 74, 0.12), inset 0 1px 0 0 rgba(255, 255, 255, 0.12)',
            zIndex: 'var(--z-modal)',
          }}
          onInteractOutside={disableOutsideClose ? (e) => e.preventDefault() : undefined}
          onEscapeKeyDown={disableOutsideClose ? (e) => e.preventDefault() : undefined}
        >
          <Dialog.Title style={visuallyHiddenTitle ? visuallyHiddenStyle : undefined}>
            {title}
          </Dialog.Title>
          <Dialog.Description style={visuallyHiddenStyle}>
            {description ?? title}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
