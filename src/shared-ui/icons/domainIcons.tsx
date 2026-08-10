import type { CSSProperties } from 'react';

const baseProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const iconStyle: CSSProperties = {
  width: 13,
  height: 13,
  flexShrink: 0,
};

export const IconPerimeter = () => (
  <svg viewBox="0 0 24 24" {...baseProps} style={iconStyle} aria-hidden="true">
    <path d="M4 8L9 4h9l2 5-3 9H7z" strokeDasharray="3 2" />
    <circle cx="9" cy="4" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="18" cy="4" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="20" cy="9" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="17" cy="18" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="7" cy="18" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="4" cy="8" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSubdivide = () => (
  <svg viewBox="0 0 24 24" {...baseProps} style={iconStyle} aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);

export const IconRoundabout = () => (
  <svg viewBox="0 0 24 24" {...baseProps} style={iconStyle} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
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
  strokeWidth: 1.5,
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
          <rect x="2" y="2" width="8" height="8" />
        </svg>
      );
    case 'midpoint':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <polygon points="6,1.5 9.9,8.3 2.1,8.3" />
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
          <line x1="6" y1="2" x2="6" y2="10" />
          <line x1="2" y1="6" x2="10" y2="6" />
        </svg>
      );
    case 'perpendicular':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <polygon points="6,1.5 10.3,4.6 8.6,9.6 3.4,9.6 1.7,4.6" />
        </svg>
      );
    case 'nearest':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <circle cx="6" cy="6" r="4.5" />
        </svg>
      );
    case 'center':
      return (
        <svg viewBox="0 0 12 12" {...props}>
          <circle cx="6" cy="6" r="4.5" />
        </svg>
      );
  }
}
