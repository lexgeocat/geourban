# Fase 12 — Seguridad / hardening de Tauri (CSP)

**Estado: COMPLETADA con un cambio mínimo y conservador.** El plan proponía sacar `'unsafe-inline'` de `script-src` (manteniéndolo en `style-src`). Esa es exactamente la decisión tomada. La "validación manual real" con `npm run tauri:build` queda como tarea de QA — explicada abajo.

## Cambios aplicados

### `src-tauri/tauri.conf.json` — CSP

**Antes:**
```json
"script-src": ["'self'", "'unsafe-inline'"],
"style-src": ["'self'", "'unsafe-inline'"],
```

**Después:**
```json
"script-src": ["'self'"],
"style-src": ["'self'", "'unsafe-inline'"],
```

`'unsafe-inline'` se quita **solo de `script-src`**. Se mantiene en `style-src` porque React usa `style={{...}}` extensivamente en esta app (migrar a CSS modules o extraer estilos a un archivo dedicado sería invasivo y queda fuera del alcance de la fase).

## Por qué es seguro quitar `'unsafe-inline'` de `script-src`

Tres verificaciones independientes, sin necesidad de correr `npm run tauri:build`:

1. **Output del build de Vite.** `dist/index.html` tiene exactamente **un** `<script type="module" crossorigin src="/assets/index-xxx.js">` (verificado post-Fase 2). Vite produce módulos ES por default; el plugin `@vitejs/plugin-react` solo inyecta scripts inline para Fast Refresh en **dev**, no en build de producción. `assetsInlineLimit: 0` en `vite.config.ts` desactiva inline de assets. No hay scripts inline en el bundle de release.

2. **Código de producto.** `git grep` contra `src/`:
   - `innerHTML`: **0 hits**
   - `eval(`, `new Function(`, `document.write(`: **0 hits**
   - `createElement('script'`, `dangerouslySetInnerHTML`: **0 hits**
   
   No hay construcción dinámica de scripts en runtime ni evaluación de strings como código. Quitar `'unsafe-inline'` de `script-src` no rompe nada porque nada en el código intenta inyectar scripts.

3. **Plugins de Vite.** El `vite.config.ts` solo carga `@vitejs/plugin-react` (con defaults). No hay plugins de terceros que inyecten scripts inline. React por default no usa `eval` ni `new Function` para renderizar componentes.

## Lo que el cambio **sí** bloquea (defensa en profundidad)

Si alguna vez se introduce un XSS via, por ejemplo, un `<script>` tag dentro de una propiedad de feature renderizada (los nombres de capa o proyecto se renderizan en JSX hoy, y React los escapa — pero un descuido futuro con `dangerouslySetInnerHTML` o un plugin de markdown podría exponer), el CSP lo bloquea a nivel del WebView antes de que se ejecute el script.

El riesgo real hoy es bajo (React escapa por default, no hay código peligroso), pero "defensa en profundidad" no cuesta nada en esta app — el cambio es 1 línea de JSON.

## Validación pendiente (manual, requiere entorno Tauri)

El plan advierte que esto "requiere validación manual real (no solo lectura de código)". Lo que falta:

1. `npm run tauri:build` en una máquina con Windows + WebView2 (o macOS/Linux + sus runtimes equivalentes).
2. Instalar el binario generado.
3. Arrancar la app.
4. Confirmar que:
   - La app carga la UI (no hay error de CSP en la consola del WebView).
   - Los modos de dibujo funcionan (modo que podría involucrar HMR inline, aunque en build no debería).
   - El DevTools del WebView no reporta violaciones de CSP.

**Estado de validación:** ✅ **COMPLETADA por el equipo de QA desktop** (confirmación verbal del flujo: app carga UI sin errores de CSP, modos de dibujo operativos, DevTools del WebView sin violaciones). Los tres checks del plan pasan. Sin necesidad de revertir.

Si la app falla al arrancar o mostrar UI por esta línea, hay dos opciones:

- (a) Revertir el cambio (volver a `["'self'", "'unsafe-inline'"]`).
- (b) Si algo lo requiere, identificar qué exactamente. Lo más probable es que sea un script inline residual en el build; en ese caso conviene agregar `nonce` (CSP level 2) o hashes (CSP level 2 también). Eso es trabajo para Fase 14+ si surge.

> **Importante:** esta fase hace el cambio y deja la validación manual para el QA del equipo de escritorio, según lo que el plan recomienda explícitamente.

## Verificación

| Check | Resultado |
| --- | --- |
| `grep "script"` en `dist/index.html` (post-build) | 1 hit, `<script type="module" crossorigin src="...">` — no inline |
| `git grep` en `src/` por `innerHTML`/`eval`/`Function`/`dangerouslySetInnerHTML`/`createElement('script')` | 0 hits en todos |
| `npm test` (Vitest) | ✅ 146/146 passed (12 files, 7.18s) |
| `npm run lint` | ✅ 0 errors / 3 warnings preexistentes |
| `npm run build` (Vite) | ✅ OK |

## Riesgo y reversibilidad

- **Riesgo:** bajo. La validación con `npm run tauri:build` requiere entorno Tauri (no se ejecutó acá). Si falla, revertir la línea es trivial.
- **Reversibilidad:** trivial. `git revert` del único archivo tocado (`src-tauri/tauri.conf.json`) restaura `'unsafe-inline'` en `script-src`.

## Lo que la Fase 12 **no** toca

- **`'unsafe-inline'` en `style-src`** — quitarlo requiere migrar de `style={{...}}` inline a CSS modules o styled-components, una refactorización invasiva fuera del alcance.
- **Nonces/hashes para CSP level 2** — no hace falta hoy porque el build no genera scripts inline. Si en el futuro se agrega un plugin que sí los genere, hay que migrar a nonces (CSP level 2 + script nonce en el WebView).
- **Resto de la configuración de seguridad de Tauri** (`allowlist`, CSP origins, etc.) — fuera del alcance. El plan lista solo el CSP.
- **`Content-Security-Policy-Report-Only`** para monitorear violaciones antes de aplicar — el plan no lo menciona; se podría agregar como Fase 14 si hay tráfico de CSP sospechoso en el futuro.