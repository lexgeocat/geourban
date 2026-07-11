/// <reference types="vite/client" />

declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson';
  function shp(input: ArrayBuffer | string): Promise<FeatureCollection | FeatureCollection[]>;
  export default shp;
}

declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: typeof Database;
  }
  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    exec(sql: string): QueryExecResult[];
    close(): void;
  }
  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }
  export type SqlValue = string | number | Uint8Array | null;
  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
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
  }
  export interface IDxf {
    entities?: IEntity[];
  }
  export default class DxfParser {
    parseSync(source: string): IDxf | null;
  }
}
