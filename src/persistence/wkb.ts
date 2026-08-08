// WKB solo cubre las geometrías que efectivamente persistimos/levantamos
// del drawSource (Polygon, LineString, MultiPolygon). Point no se usa
// porque ninguna feature persistible del modelo es puntual — cualquier
// 'Point' en un WKB externo se rechaza en decodeWkb con un error claro.
export type WkbGeometry =
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] };

const WKB_LINESTRING = 2;
const WKB_POLYGON = 3;
const WKB_MULTIPOLYGON = 6;

function computeWkbSize(geom: WkbGeometry): number {
  switch (geom.type) {
    case 'LineString':
      return 1 + 4 + 4 + geom.coordinates.length * 16;
    case 'Polygon': {
      let size = 1 + 4 + 4;
      for (const ring of geom.coordinates) size += 4 + ring.length * 16;
      return size;
    }
    case 'MultiPolygon': {
      let size = 1 + 4 + 4;
      for (const poly of geom.coordinates) {
        size += 1 + 4 + 4;
        for (const ring of poly) size += 4 + ring.length * 16;
      }
      return size;
    }
  }
}

export function encodeWkb(geom: WkbGeometry): Uint8Array {
  const buf = new ArrayBuffer(computeWkbSize(geom));
  const view = new DataView(buf);
  let offset = 0;

  const writeHeader = (type: number) => {
    view.setUint8(offset, 1); offset += 1;
    view.setUint32(offset, type, true); offset += 4;
  };
  const writeRing = (ring: [number, number][]) => {
    view.setUint32(offset, ring.length, true); offset += 4;
    for (const [x, y] of ring) {
      view.setFloat64(offset, x, true); offset += 8;
      view.setFloat64(offset, y, true); offset += 8;
    }
  };

  switch (geom.type) {
    case 'LineString':
      writeHeader(WKB_LINESTRING);
      writeRing(geom.coordinates);
      break;
    case 'Polygon':
      writeHeader(WKB_POLYGON);
      view.setUint32(offset, geom.coordinates.length, true); offset += 4;
      for (const ring of geom.coordinates) writeRing(ring);
      break;
    case 'MultiPolygon':
      writeHeader(WKB_MULTIPOLYGON);
      view.setUint32(offset, geom.coordinates.length, true); offset += 4;
      for (const poly of geom.coordinates) {
        writeHeader(WKB_POLYGON);
        view.setUint32(offset, poly.length, true); offset += 4;
        for (const ring of poly) writeRing(ring);
      }
      break;
  }
  return new Uint8Array(buf);
}

export function decodeWkb(bytes: Uint8Array): WkbGeometry {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const readHeader = (): number => {
    offset += 1;
    const type = view.getUint32(offset, true);
    offset += 4;
    return type;
  };
  const readRing = (): [number, number][] => {
    const n = view.getUint32(offset, true); offset += 4;
    const ring: [number, number][] = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = view.getFloat64(offset, true); offset += 8;
      const y = view.getFloat64(offset, true); offset += 8;
      ring[i] = [x, y];
    }
    return ring;
  };

  const type = readHeader();
  if (type === WKB_LINESTRING) {
    return { type: 'LineString', coordinates: readRing() };
  }
  if (type === WKB_POLYGON) {
    const n = view.getUint32(offset, true); offset += 4;
    const rings: [number, number][][] = new Array(n);
    for (let i = 0; i < n; i++) rings[i] = readRing();
    return { type: 'Polygon', coordinates: rings };
  }
  if (type === WKB_MULTIPOLYGON) {
    const n = view.getUint32(offset, true); offset += 4;
    const polys: [number, number][][][] = new Array(n);
    for (let i = 0; i < n; i++) {
      readHeader();
      const nRings = view.getUint32(offset, true); offset += 4;
      const rings: [number, number][][] = new Array(nRings);
      for (let r = 0; r < nRings; r++) rings[r] = readRing();
      polys[i] = rings;
    }
    return { type: 'MultiPolygon', coordinates: polys };
  }
  throw new Error(`WKB: tipo de geometría no soportado (${type})`);
}

const BASE64_CHUNK = 8192;

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
