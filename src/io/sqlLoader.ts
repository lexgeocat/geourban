import type initSqlJs from 'sql.js';
// Importar el .wasm como URL lo deja en `dist/sql.js/sql-wasm.wasm` y nos
// da una URL estable para `locateFile`. Sin esto, Vite no copia el
// binario y `locateFile` apuntaría al CDN externo (rompe offline).
// @ts-expect-error - sql.js no expone tipos para ?url
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Carga `sql.js` una sola vez y lo cachea. El `.wasm` se sirve desde un
 *  asset local (empaquetado por Vite bajo `/sql.js/sql-wasm.wasm`) para
 *  que la app funcione offline (sin CDN). En web el WASM se sirve desde
 *  el mismo bundle; en Tauri se incluye como asset del build. */
export function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => wasmUrl });
  }
  return sqlPromise;
}

/** Resetea la caché (útil en tests o para reintentar tras un fallo de carga). */
export function _resetSqlForTests(): void {
  sqlPromise = null;
}
