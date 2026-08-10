import {
  MousePointer2,
  Hexagon,
  Slash,
  Square,
  SquareDashed,
  Lasso,
  Route,
  Eraser,
  Grid3x3,
  Satellite,
} from 'lucide-react';
import {
  IconPerimeter as DomainIconPerimeter,
  IconSubdivide as DomainIconSubdivide,
  IconRoundabout as DomainIconRoundabout,
} from '@shared-ui/icons/domainIcons';

export const IconCursor = () => <MousePointer2 size={18} aria-hidden="true" />;
export const IconPolygon = () => <Hexagon size={18} aria-hidden="true" />;
export const IconLine = () => <Slash size={18} aria-hidden="true" />;
export const IconRect = () => <Square size={18} aria-hidden="true" />;
export const IconRectDashed = () => <SquareDashed size={18} aria-hidden="true" />;
export const IconPerimeter = DomainIconPerimeter;
export const IconLasso = () => <Lasso size={18} aria-hidden="true" />;
export const IconStreet = () => <Route size={18} aria-hidden="true" />;
export const IconEraser = () => <Eraser size={18} aria-hidden="true" />;
export const IconSubdivide = DomainIconSubdivide;
export const IconLots = () => <Grid3x3 size={18} aria-hidden="true" />;
export const IconGrid = () => <Grid3x3 size={18} aria-hidden="true" />;
export const IconSat = () => <Satellite size={18} aria-hidden="true" />;
export const IconRoundabout = DomainIconRoundabout;
export const IconRoad = () => <Route size={18} aria-hidden="true" />;
