import { type ClassValue, clsx } from 'clsx';

/**
 * Combina clases condicionalmente. Ya no pasa por tailwind-merge —
 * el proyecto no usa utilities de Tailwind en componentes (el diseño
 * vive en las clases `cad-*` de index.css), así que no hace falta
 * resolver conflictos de utilidades (ver plan-optimizacion-geourban.md,
 * Fase 4).
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}