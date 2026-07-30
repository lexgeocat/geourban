export function createIdFactory(defaultPrefix = 'id') {
  let counter = 0;
  return (prefix: string = defaultPrefix): string => {
    counter += 1;
    return `${prefix}-${Date.now()}-${counter.toString(36)}`;
  };
}

export const nextId = createIdFactory();

/**
 * Generador de IDs único y centralizado, basado en `crypto.randomUUID()`.
 * Usa la API moderna disponible en todo runtime soportado (Tauri/navegador
 * evergreen); fallback defensivo a `Date.now()+Math.random()` para entornos
 * sin la API (muy raro).
 *
 * Reemplaza los `Date.now() + Math.random()` ad-hoc que aparecían
 * desparramados por el código y generaban riesgo de colisión entre
 * proyectos generados en el mismo milisegundo.
 */
export function newId(prefix?: string): string {
  let unique: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    unique = crypto.randomUUID();
  } else {
    unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return prefix ? `${prefix}-${unique}` : unique;
}

