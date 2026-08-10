import { autoName } from '@kernel/id/autoName';

/**
 * Estado interno compartido por `streetStore` y `roundaboutStore`:
 * contador de IDs auto-incremental por sesión de trazado.
 *
 * Antes era una variable de módulo mutable (`let nextId = 1`) duplicada
 * literalmente en ambos stores (Fase 5.1 del plan de limpieza).
 */
export function createIdCounter(): {
  next: (prefix: string) => string;
  reset: () => void;
} {
  let n = 1;
  return {
    next: (prefix: string) => `${prefix}${n++}`,
    reset: () => {
      n = 1;
    },
  };
}

/**
 * Genera el nombre legible de una entidad vial usando `autoName`.
 * Encapsula el patrón `autoName(state.list.length, prefix)` que estaba
 * duplicado en ambos stores.
 */
export function nextEntityName(count: number, prefix: string): string {
  return autoName(count, prefix);
}

/**
 * Renumera los nombres de las entidades restantes después de un remove,
 * para mantener la numeración continua (`Calle A`, `Calle B`, ...).
 *
 * Antes era un `forEach` inline duplicado en `removeStreet` y
 * `removeRoundabout`.
 */
export function renumberEntityNames<T extends { name: string }>(
  entities: T[],
  prefix: string,
): void {
  entities.forEach((e, i) => {
    e.name = autoName(i, prefix);
  });
}
