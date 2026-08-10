/**
 * Componentes RGB de los colores del tema oscuro GeoUrban.
 *
 * Se exportan como tripletas separadas por comas (sin `rgb(...)`/`rgba(...)`)
 * para que se puedan **interpolar** con un alpha distinto en cada callsite
 * sin tener que redefinir el color base:
 *
 *   import { CAD_BG_DEEPEST_RGB } from '@kernel/theme/colors';
 *   const bg = `rgba(${CAD_BG_DEEPEST_RGB}, 0.85)`; // → rgba(13, 17, 23, 0.85)
 *
 * Esto evita la proliferación de literales `rgba(13, 17, 23, X)` hardcoded
 * con alphas ligeramente distintos que vimos en el codebase (toast, label
 * painter, styleFactory, etc.).
 *
 * La fuente de verdad CSS sigue siendo `--cad-bg-deepest` en `src/index.css`;
 * estos triplets deben quedar en sync con esa variable. Si en el futuro se
 * cambia el valor CSS, hay que cambiar también el triplet acá.
 */

export const CAD_BG_DEEPEST_RGB = '13, 17, 23';
