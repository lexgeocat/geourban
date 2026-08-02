declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson';
  function shp(input: ArrayBuffer | string): Promise<FeatureCollection | FeatureCollection[]>;
  export default shp;
}

declare module 'dxf-parser' {
  export interface IEntity {
    type: string;
    vertices?: Array<{ x: number; y: number; z?: number }>;
    start?: { x: number; y: number; z?: number };
    end?: { x: number; y: number; z?: number };
    position?: { x: number; y: number; z?: number };
    shape?: boolean;
    closed?: boolean;
    radius?: number;
    startAngle?: number;
    endAngle?: number;
  }
  export interface IDxf {
    entities?: IEntity[];
  }
  export default class DxfParser {
    parseSync(source: string): IDxf | null;
  }
}

declare module 'dxf-writer' {
  export default class Drawing {
    constructor();
    drawLine(x1: number, y1: number, x2: number, y2: number): void;
    drawPolyline(points: [number, number][], closed?: boolean): void;
    drawCircle(x: number, y: number, radius: number): void;
    drawArc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
    drawLinearDimension(x1: number, y1: number, x2: number, y2: number, textX: number, textY: number, text: string): void;
    drawPoint(x: number, y: number): void;
    toDxfString(): string;
  }
}