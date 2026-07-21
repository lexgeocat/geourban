import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;
let sqlPromise: Promise<SqlJsStatic> | null = null;
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
