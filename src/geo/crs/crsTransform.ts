import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { transform } from 'ol/proj.js';

type CoordFn = (c: Position) => Position;

function mapGeometryCoords(geom: Geometry, fn: CoordFn): Geometry {
  switch (geom.type) {
    case 'Point':
      return { ...geom, coordinates: fn(geom.coordinates) };
    case 'MultiPoint':
    case 'LineString':
      return { ...geom, coordinates: geom.coordinates.map(fn) };
    case 'Polygon':
    case 'MultiLineString':
      return { ...geom, coordinates: geom.coordinates.map((ring) => ring.map(fn)) };
    case 'MultiPolygon':
      return { ...geom, coordinates: geom.coordinates.map((poly) => poly.map((ring) => ring.map(fn))) };
    case 'GeometryCollection':
      return { ...geom, geometries: geom.geometries.map((g) => mapGeometryCoords(g, fn)) };
    default:
      return geom;
  }
}

export function mapFeatureCollectionCoords(fc: FeatureCollection, fn: CoordFn): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f: Feature) => ({
      ...f,
      geometry: f.geometry ? mapGeometryCoords(f.geometry, fn) : f.geometry,
    })),
  };
}

/** Reproyecta toda la colección. No hace nada si source === dest (evita transformaciones innecesarias). */
export function reprojectFeatureCollection(
  fc: FeatureCollection,
  sourceCrs: string,
  destCrs: string
): FeatureCollection {
  if (sourceCrs === destCrs) return fc;
  return mapFeatureCollectionCoords(fc, (c) => transform(c as number[], sourceCrs, destCrs) as Position);
}

export function collectionCentroidLonLat(fc: FeatureCollection): [number, number] {
  let sx = 0, sy = 0, n = 0;
  const visit = (geom: Geometry) => {
    switch (geom.type) {
      case 'Point': sx += geom.coordinates[0]; sy += geom.coordinates[1]; n++; return;
      case 'MultiPoint':
      case 'LineString':
        for (const c of geom.coordinates) { sx += c[0]; sy += c[1]; n++; } return;
      case 'Polygon':
      case 'MultiLineString':
        for (const ring of geom.coordinates) for (const c of ring) { sx += c[0]; sy += c[1]; n++; } return;
      case 'MultiPolygon':
        for (const poly of geom.coordinates) for (const ring of poly) for (const c of ring) { sx += c[0]; sy += c[1]; n++; } return;
      case 'GeometryCollection':
        geom.geometries.forEach(visit); return;
    }
  };
  for (const f of fc.features) if (f.geometry) visit(f.geometry);
  return n === 0 ? [0, 0] : [sx / n, sy / n];
}

export function utmWkt(zone: number, hemisphere: 'N' | 'S'): string {
  const centralMeridian = -183 + 6 * zone;
  const falseNorthing = hemisphere === 'S' ? 10000000 : 0;
  const name = `WGS 84 / UTM zone ${zone}${hemisphere}`;
  return (
    `PROJCS["${name}",` +
    `GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],` +
    `PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],` +
    `PROJECTION["Transverse_Mercator"],` +
    `PARAMETER["latitude_of_origin",0],` +
    `PARAMETER["central_meridian",${centralMeridian}],` +
    `PARAMETER["scale_factor",0.9996],` +
    `PARAMETER["false_easting",500000],` +
    `PARAMETER["false_northing",${falseNorthing}],` +
    `UNIT["metre",1]]`
  );
}