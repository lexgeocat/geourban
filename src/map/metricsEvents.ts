import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { FeatureMetrics } from '../geo/metrics';

type MetricsEventName = 'feature:metrics-invalidated' | 'feature:metrics-updated';

type MetricsEventPayload = {
  feature: Feature<Geometry>;
  metrics?: FeatureMetrics | null;
};

const metricsEventTarget = new EventTarget();

export function emitMetricsInvalidated(feature: Feature<Geometry>) {
  metricsEventTarget.dispatchEvent(
    new CustomEvent<MetricsEventPayload>('feature:metrics-invalidated', {
      detail: { feature },
    })
  );
}

export function emitMetricsUpdated(feature: Feature<Geometry>, metrics: FeatureMetrics | null) {
  metricsEventTarget.dispatchEvent(
    new CustomEvent<MetricsEventPayload>('feature:metrics-updated', {
      detail: { feature, metrics },
    })
  );
}

export function onMetricsEvent(
  eventName: MetricsEventName,
  listener: (payload: MetricsEventPayload) => void
) {
  const handler = (event: Event) => listener((event as CustomEvent<MetricsEventPayload>).detail);
  metricsEventTarget.addEventListener(eventName, handler);
  return () => metricsEventTarget.removeEventListener(eventName, handler);
}
