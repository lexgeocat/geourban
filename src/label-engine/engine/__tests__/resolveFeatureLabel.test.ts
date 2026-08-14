import { describe, it, expect } from 'vitest';
import Feature from 'ol/Feature.js';
import Polygon from 'ol/geom/Polygon.js';
import { resolveFeatureLabel, resolveEntityLabelFromClass } from '@label-engine/engine/resolveFeatureLabel';
import {
  defaultLabelClass,
  type LabelClass,
} from '@label-engine/model/labelClass';
import { defaultLabelStyleConfig } from '@label-engine/model/labelModel';

function polygonFeature(labelConfig?: ReturnType<typeof defaultLabelStyleConfig>, labelText?: string): Feature<Polygon> {
  const f = new Feature<Polygon>({
    geometry: new Polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]),
  });
  if (labelConfig) f.set('labelConfig', labelConfig);
  if (labelText !== undefined) f.set('labelText', labelText);
  return f;
}

describe('resolveFeatureLabel', () => {
  it('returns source=override when feature has labelConfig (compat B11)', () => {
    const cfg = defaultLabelStyleConfig({ enabled: true, color: '#ff0000' });
    const f = polygonFeature(cfg, 'A-1');
    const r = resolveFeatureLabel(f, undefined, { orderIndex: 0, total: 1, parentCode: 'A' });
    expect(r.source).toBe('override');
    expect(r.text).toBe('A-1');
    expect(r.style.color).toBe('#ff0000');
  });

  it('uses class when no override and class enabled', () => {
    const cls: LabelClass = {
      ...defaultLabelClass('L', defaultLabelStyleConfig({ enabled: true, color: '#00ff00' })),
      enabled: true,
    };
    const f = polygonFeature();
    const r = resolveFeatureLabel(f, cls, { orderIndex: 0, total: 3, parentCode: 'A' });
    expect(r.source).toBe('class');
    expect(r.style.enabled).toBe(true);
  });

  it('returns source=none when no override and no class', () => {
    const f = polygonFeature();
    const r = resolveFeatureLabel(f, undefined);
    expect(r.source).toBe('none');
    expect(r.text).toBe('');
  });

  it('returns source=none when class is disabled', () => {
    const cls: LabelClass = {
      ...defaultLabelClass('L', defaultLabelStyleConfig({ enabled: true })),
      enabled: false,
    };
    const f = polygonFeature();
    const r = resolveFeatureLabel(f, cls);
    expect(r.source).toBe('none');
  });

  it('drops when zoom is outside visibleMinZoom/MaxZoom', () => {
    const cls: LabelClass = {
      ...defaultLabelClass('L', defaultLabelStyleConfig({ enabled: true })),
      enabled: true,
      style: { ...defaultLabelStyleConfig({ enabled: true }), visibleMinZoom: 10, visibleMaxZoom: 15 },
    };
    const f = polygonFeature();
    const r = resolveFeatureLabel(f, cls, { zoom: 5 });
    expect(r.source).toBe('class');
    expect(r.text).toBe('');
  });

  it('applies numbering mode from class when provided', () => {
    const cls: LabelClass = {
      ...defaultLabelClass('L', defaultLabelStyleConfig({ enabled: true })),
      enabled: true,
      numbering: { mode: 'roman-upper', restartPerParent: false },
    };
    const f = polygonFeature();
    const r = resolveFeatureLabel(f, cls, { orderIndex: 2, total: 5, parentCode: 'A' });
    expect(r.text).toBe('III');
  });
});

describe('resolveEntityLabelFromClass', () => {
  it('returns source=class when class enabled', () => {
    const cls: LabelClass = {
      ...defaultLabelClass('L', defaultLabelStyleConfig({ enabled: true })),
      enabled: true,
    };
    const r = resolveEntityLabelFromClass(cls, 'Av. Principal');
    expect(r.source).toBe('class');
    expect(r.text).toBe('Av. Principal');
  });

  it('returns source=none when class disabled', () => {
    const cls: LabelClass = {
      ...defaultLabelClass('L', defaultLabelStyleConfig()),
      enabled: false,
    };
    const r = resolveEntityLabelFromClass(cls, 'Av.');
    expect(r.source).toBe('none');
  });
});
