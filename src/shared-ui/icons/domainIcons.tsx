import type { CSSProperties } from 'react';

const baseProps = {
  fill: 'none',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const iconStyle: CSSProperties = {
  width: 14,
  height: 14,
  flexShrink: 0,
};

/** Perímetro territorial — Esmeralda luminoso + nodos dorados */
export const IconPerimeter = () => (
  <svg viewBox="0 0 24 24" {...baseProps} style={iconStyle} aria-hidden="true">
    <path
      d="M4 8L9 4h9l2 5-3 9H7z"
      fill="rgba(16, 185, 129, 0.22)"
      stroke="#10B981"
      strokeDasharray="3 2"
    />
    <circle cx="9" cy="4" r="1.8" fill="#FBBF24" stroke="#0A0B0F" strokeWidth="0.8" />
    <circle cx="18" cy="4" r="1.8" fill="#34D399" stroke="#0A0B0F" strokeWidth="0.8" />
    <circle cx="20" cy="9" r="1.8" fill="#FBBF24" stroke="#0A0B0F" strokeWidth="0.8" />
    <circle cx="17" cy="18" r="1.8" fill="#34D399" stroke="#0A0B0F" strokeWidth="0.8" />
    <circle cx="7" cy="18" r="1.8" fill="#FBBF24" stroke="#0A0B0F" strokeWidth="0.8" />
    <circle cx="4" cy="8" r="1.8" fill="#34D399" stroke="#0A0B0F" strokeWidth="0.8" />
  </svg>
);

/** Subdividir / Lotificación — Ámbar dorado + Coral + Violeta */
export const IconSubdivide = () => (
  <svg viewBox="0 0 24 24" {...baseProps} style={iconStyle} aria-hidden="true">
    <rect x="3" y="3" width="8.5" height="8.5" rx="1.5" fill="rgba(245, 158, 11, 0.28)" stroke="#F59E0B" strokeWidth="1.8" />
    <rect x="12.5" y="3" width="8.5" height="8.5" rx="1.5" fill="rgba(255, 107, 74, 0.25)" stroke="#FF6B4A" strokeWidth="1.8" />
    <rect x="3" y="12.5" width="8.5" height="8.5" rx="1.5" fill="rgba(139, 92, 246, 0.25)" stroke="#A78BFA" strokeWidth="1.8" />
    <rect x="12.5" y="12.5" width="8.5" height="8.5" rx="1.5" fill="rgba(20, 184, 166, 0.25)" stroke="#2DD4BF" strokeWidth="1.8" />
  </svg>
);

/** Rotonda — Anillo vial violeta + isla central esmeralda */
export const IconRoundabout = () => (
  <svg viewBox="0 0 24 24" {...baseProps} style={iconStyle} aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="rgba(139, 92, 246, 0.18)" stroke="#A78BFA" strokeWidth="2.1" />
    <circle cx="12" cy="12" r="3.6" fill="rgba(16, 185, 129, 0.35)" stroke="#34D399" strokeWidth="1.8" />
  </svg>
);

export type SnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'intersection'
  | 'extension'
  | 'perpendicular'
  | 'nearest'
  | 'center';

const snapStyle = (s: number): CSSProperties => ({
  width: s,
  height: s,
  flexShrink: 0,
});

const snapProps = (color: string, s: number) => ({
  fill: 'none' as const,
  stroke: color,
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  style: snapStyle(s),
});

export function SnapIcon({
  type,
  color,
  size = 12,
}: {
  type: SnapKind;
  color: string;
  size?: number;
}) {
  const props = snapProps(color, size);
  switch (type) {
    case 'endpoint':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <rect x="2" y="2" width="8" height="8" rx="1.2" fill={`${color}33`} />
        </svg>
      );
    case 'midpoint':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <polygon points="6,1.5 10.2,8.8 1.8,8.8" fill={`${color}33`} />
        </svg>
      );
    case 'intersection':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <line x1="2" y1="2" x2="10" y2="10" />
          <line x1="10" y1="2" x2="2" y2="10" />
        </svg>
      );
    case 'extension':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <line x1="6" y1="1.8" x2="6" y2="10.2" />
          <line x1="1.8" y1="6" x2="10.2" y2="6" />
        </svg>
      );
    case 'perpendicular':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <polygon points="6,1.5 10.3,4.6 8.6,9.6 3.4,9.6 1.7,4.6" fill={`${color}2E`} />
        </svg>
      );
    case 'nearest':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <circle cx="6" cy="6" r="4.5" fill={`${color}2E`} />
        </svg>
      );
    case 'center':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <circle cx="6" cy="6" r="4.5" />
          <circle cx="6" cy="6" r="1.5" fill={color} stroke="none" />
        </svg>
      );
  }
}

/** Punto geodésico — Rosa coral brillante + halo ámbar */
export const IconPoint = () => (
  <svg viewBox="0 0 24 24" {...baseProps} style={iconStyle} aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" fill="rgba(244, 63, 94, 0.14)" stroke="#FB7185" strokeDasharray="2.5 2.5" />
    <circle cx="12" cy="12" r="3.6" fill="#FF6B4A" stroke="#FDE047" strokeWidth="1.4" />
  </svg>
);

/** Círculo geométrico — Cian eléctrico + núcleo violeta */
export const IconCircleShape = () => (
  <svg viewBox="0 0 24 24" {...baseProps} style={iconStyle} aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" fill="rgba(56, 189, 248, 0.2)" stroke="#38BDF8" strokeWidth="2.1" />
    <circle cx="12" cy="12" r="2.2" fill="#A78BFA" stroke="none" />
  </svg>
);

/** Polilínea — Trazo ámbar-coral con vértices multicolor */
export const IconPolyline = () => (
  <svg viewBox="0 0 24 24" {...baseProps} style={iconStyle} aria-hidden="true">
    <polyline points="3,18 9,8 14,14 21,5" stroke="#FBBF24" strokeWidth="2.2" />
    <circle cx="3" cy="18" r="2.1" fill="#FF6B4A" stroke="#0A0B0F" strokeWidth="0.8" />
    <circle cx="9" cy="8" r="2.1" fill="#38BDF8" stroke="#0A0B0F" strokeWidth="0.8" />
    <circle cx="14" cy="14" r="2.1" fill="#A78BFA" stroke="#0A0B0F" strokeWidth="0.8" />
    <circle cx="21" cy="5" r="2.1" fill="#34D399" stroke="#0A0B0F" strokeWidth="0.8" />
  </svg>
);
