# Modularización de `01-core.js`

## Qué se hizo

`01-core.js` (7,685 líneas) ya traía, en sus propios comentarios de banner
(`// [N] ... // (candidato a módulo: xxx.js · depende de: ...)`), un mapa de
modularización planeado pero nunca ejecutado. Este paquete ejecuta
exactamente ese mapa: **corta el archivo en 17 módulos**, en los mismos
puntos donde ya estaban los banners `[1]`…`[17]`, sin mover, reescribir ni
tocar una sola línea de lógica.

## Por qué son `<script>` clásicos y no ES Modules (`import`/`export`)

El propio archivo advertía: muchas funciones no se llaman desde dentro del
`.js` — se invocan desde atributos `onclick`/`onchange` en el HTML. Convertir
esto a ES Modules exigiría:
- Detectar cada identificador (función/variable) usado a través de secciones,
- Exportarlo e importarlo correctamente en cada módulo,
- Exponer manualmente en `window` todo lo que el HTML llama por `onclick`.

Eso es un refactor de alto riesgo en un archivo de este tamaño sin un AST
real de por medio. En cambio, cargar los 17 archivos como `<script>` **clásicos**
(sin `type="module"`), **en orden**, es 100% equivalente a tener el archivo
original completo: en JavaScript de navegador, las declaraciones `let`,
`const`, `class` y `function` de nivel superior en scripts clásicos comparten
el mismo scope global del documento, sin importar si están en el mismo
`<script>` o en varios. Cero riesgo de romper referencias, cero necesidad de
tocar el HTML más allá de reemplazar una línea por diecisiete.

## Verificación realizada (no es solo un "debería andar")

1. **Reconstrucción byte a byte**: concatenar los 17 módulos en orden
   reproduce `01-core.js` de forma **idéntica** (`diff` sin salida).
2. **Sintaxis por archivo**: `node --check` sobre cada uno de los 17 módulos
   (con su cabecera incluida) — sin errores. Esto confirma que cada corte
   cae exactamente en un límite de sentencia (ningún `function`/objeto quedó
   partido a la mitad).
3. Se revisaron los usos de `saveProject` / `triggerLoadProject` /
   `exportDXF` (las funciones que viven en otro archivo): solo se referencian
   como texto dentro de `getAttribute("onclick").includes(...)`, nunca se
   llaman directamente desde este código. Por lo tanto el orden de carga de
   *ese* otro archivo respecto a estos 17 módulos no afecta nada.

## Mapa de módulos y orden de carga obligatorio

| # | Archivo | Depende de (cargar antes) |
|---|---------|---------------------------|
| 01 | `01-translations.js` | (ninguna) |
| 02 | `02-i18n.js` | 01 (usa `TRANSLATIONS`) |
| 03 | `03-state.js` | (ninguna — casi todo lee/escribe este estado) |
| 04 | `04-history.js` | 03 |
| 05 | `05-coords.js` | 03 |
| 06 | `06-lot-params-ui.js` | 03, 04 |
| 07 | `07-canvas-interactions.js` | 03, 04, 05 |
| 08 | `08-street-fillets.js` | 05 |
| 09 | `09-polygon-engine.js` | 03 |
| 10 | `10-lot-subdivision.js` | 03, 09 |
| 11 | `11-sidebar-ui.js` | 03, 04, 09 |
| 12 | `12-equipamiento-render.js` | 09 |
| 13 | `13-render.js` | 03, 05, 08, 09, 12 |
| 14 | `14-project-actions.js` | 03, 04, 13 |
| 15 | `15-manual-slice.js` | 03, 09, 10 |
| 16 | `16-stats-view-menu.js` | 03, 09 |
| 17 | `17-plano-lote.js` | 03, 09 |

El orden numérico (01→17) ya respeta todas las dependencias — cargalos así
y no hace falta pensar en el resto de la tabla.

## Cambio necesario en el HTML

Donde antes había algo como:

```html
<script src="01-core.js"></script>
```

reemplazar por (mismo lugar, mismo orden relativo a los demás `<script>` que
ya tenías para DXF/KMZ/guardado de proyecto):

```html
<script src="01-translations.js"></script>
<script src="02-i18n.js"></script>
<script src="03-state.js"></script>
<script src="04-history.js"></script>
<script src="05-coords.js"></script>
<script src="06-lot-params-ui.js"></script>
<script src="07-canvas-interactions.js"></script>
<script src="08-street-fillets.js"></script>
<script src="09-polygon-engine.js"></script>
<script src="10-lot-subdivision.js"></script>
<script src="11-sidebar-ui.js"></script>
<script src="12-equipamiento-render.js"></script>
<script src="13-render.js"></script>
<script src="14-project-actions.js"></script>
<script src="15-manual-slice.js"></script>
<script src="16-stats-view-menu.js"></script>
<script src="17-plano-lote.js"></script>
```

No agregues `type="module"` ni `defer`/`async` a estos tags: deben ejecutarse
de forma síncrona y en este orden, igual que se ejecutaba el archivo único.

## Lo que NO se tocó (a propósito)

Los propios banners del archivo original señalan que hay "estado global
satélite" (`mznMethods`, `mznEquipamiento`, `_satMap`, `_satOverlay`,
`_geoOrigin`, `_satVisible`, `_rendering`) declarado físicamente dentro de
las secciones 9/10, que conceptualmente pertenece a `state.js`. Moverlo
ahí sería un segundo refactor con más riesgo (hay que rastrear cada
lectura/escritura) y no es necesario para que la modularización funcione:
como todos los módulos comparten scope global, ese estado sigue siendo
accesible desde cualquier módulo exactamente igual que antes. Se deja
documentado por si en el futuro se quiere dar ese paso, pero no se hizo acá
para cumplir con "sin dañar nada".
