/**
 * Constantes globales de la aplicación.
 */

/**
 * Constantes globales de la aplicación.
 */

// @ts-expect-error - Vite expone import.meta.env
const env = import.meta.env;

export const GOOGLE_MAPS_API_KEY = env.VITE_GOOGLE_MAPS_API_KEY || '';