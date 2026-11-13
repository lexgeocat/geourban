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
  Scissors,
  PenLine,
  Map as MapIcon,
} from 'lucide-react';
import {
  IconPerimeter as DomainIconPerimeter,
  IconSubdivide as DomainIconSubdivide,
  IconRoundabout as DomainIconRoundabout,
  IconPoint as DomainIconPoint,
  IconCircleShape as DomainIconCircleShape,
  IconPolyline as DomainIconPolyline,
} from '@shared-ui/icons/domainIcons';

export const IconCursor = () => (
  <MousePointer2
    size={17}
    color="#818CF8"
    fill="rgba(129, 140, 248, 0.24)"
    style={{ filter: 'drop-shadow(0 0 5px rgba(129, 140, 248, 0.35))' }}
    aria-hidden="true"
  />
);

export const IconPolygon = () => (
  <Hexagon
    size={17}
    color="#34D399"
    fill="rgba(52, 211, 153, 0.22)"
    style={{ filter: 'drop-shadow(0 0 5px rgba(52, 211, 153, 0.35))' }}
    aria-hidden="true"
  />
);

export const IconLine = () => (
  <Slash
    size={17}
    color="#FBBF24"
    strokeWidth={2.4}
    style={{ filter: 'drop-shadow(0 0 5px rgba(251, 191, 36, 0.4))' }}
    aria-hidden="true"
  />
);

export const IconRect = () => (
  <Square
    size={17}
    color="#2DD4BF"
    fill="rgba(45, 212, 191, 0.22)"
    style={{ filter: 'drop-shadow(0 0 5px rgba(45, 212, 191, 0.35))' }}
    aria-hidden="true"
  />
);

export const IconRectDashed = () => (
  <SquareDashed
    size={17}
    color="#38BDF8"
    style={{ filter: 'drop-shadow(0 0 5px rgba(56, 189, 248, 0.38))' }}
    aria-hidden="true"
  />
);

export const IconPerimeter = DomainIconPerimeter;

export const IconLasso = () => (
  <Lasso
    size={17}
    color="#C084FC"
    style={{ filter: 'drop-shadow(0 0 5px rgba(192, 132, 252, 0.38))' }}
    aria-hidden="true"
  />
);

export const IconStreet = () => (
  <Route
    size={17}
    color="#A78BFA"
    style={{ filter: 'drop-shadow(0 0 5px rgba(167, 139, 250, 0.4))' }}
    aria-hidden="true"
  />
);

export const IconEraser = () => (
  <Eraser
    size={17}
    color="#FB7185"
    fill="rgba(251, 113, 133, 0.2)"
    style={{ filter: 'drop-shadow(0 0 5px rgba(251, 113, 133, 0.35))' }}
    aria-hidden="true"
  />
);

export const IconSubdivide = DomainIconSubdivide;

export const IconLots = () => (
  <Grid3x3
    size={17}
    color="#F59E0B"
    style={{ filter: 'drop-shadow(0 0 5px rgba(245, 158, 11, 0.38))' }}
    aria-hidden="true"
  />
);

export const IconGrid = () => (
  <Grid3x3
    size={17}
    color="#FF6B4A"
    style={{ filter: 'drop-shadow(0 0 5px rgba(255, 107, 74, 0.38))' }}
    aria-hidden="true"
  />
);

export const IconSat = () => (
  <Satellite
    size={17}
    color="#38BDF8"
    style={{ filter: 'drop-shadow(0 0 5px rgba(56, 189, 248, 0.38))' }}
    aria-hidden="true"
  />
);

export const IconRoundabout = DomainIconRoundabout;

export const IconRoad = () => (
  <MapIcon
    size={17}
    color="#34D399"
    fill="rgba(52, 211, 153, 0.16)"
    style={{ filter: 'drop-shadow(0 0 5px rgba(52, 211, 153, 0.35))' }}
    aria-hidden="true"
  />
);

export const IconPoint = DomainIconPoint;
export const IconCircleShape = DomainIconCircleShape;
export const IconPolyline = DomainIconPolyline;

export const IconSplit = () => (
  <Scissors
    size={17}
    color="#F472B6"
    style={{ filter: 'drop-shadow(0 0 5px rgba(244, 114, 182, 0.38))' }}
    aria-hidden="true"
  />
);

export const IconEditVertices = () => (
  <PenLine
    size={17}
    color="#FF6B4A"
    style={{ filter: 'drop-shadow(0 0 5px rgba(255, 107, 74, 0.38))' }}
    aria-hidden="true"
  />
);
