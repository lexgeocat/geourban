import type React from 'react';

export const cardStyle: React.CSSProperties = {
  padding: 11,
  borderRadius: 11,
  background: 'var(--cad-bg-surface)',
  border: '1px solid var(--cad-border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

export const cardTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  fontSize: '0.73rem',
  fontWeight: 700,
  color: 'var(--cad-text)',
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  borderRadius: 6,
  background: 'var(--cad-bg-deep)',
  border: '1px solid var(--cad-border)',
  color: 'var(--cad-text)',
  fontSize: '0.69rem',
  boxSizing: 'border-box',
};

export const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.61rem',
  color: 'var(--cad-text-muted)',
  display: 'block',
  marginBottom: 2,
};

export function segmentBtnStyle(active: boolean, accentHex = '#FF6B4A'): React.CSSProperties {
  return {
    padding: '7px 8px',
    borderRadius: 7,
    fontSize: '0.69rem',
    fontWeight: 700,
    cursor: 'pointer',
    border: `1px solid ${active ? accentHex : 'var(--cad-border)'}`,
    background: active ? `${accentHex}20` : 'var(--cad-bg-deep)',
    color: active ? accentHex : 'var(--cad-text-dim)',
    textAlign: 'center',
  };
}
