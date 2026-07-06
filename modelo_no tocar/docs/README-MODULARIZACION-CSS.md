# Modularización de `styles.css`

## Qué se hizo

`styles.css` (896 líneas) se cortó en **10 módulos**, respetando el orden
original de arriba a abajo — nada se reordenó ni se agrupó "por tema" a
la fuerza, porque en CSS el orden importa para la cascada quien gana
cuando dos reglas con la misma especificidad se pisan.

Dato clave que encontré al mapear el archivo: `.btn` está definido **dos
veces** (línea 48 y línea 752, bajo el comentario `/* botones unificados */`).
La segunda definición pisa a la primera a propósito (agrega variantes
`.blue/.green/.red/.purple/.cyan` y cambia el tamaño). Por eso el corte
preserva la posición física de cada bloque tal cual estaba: el módulo
`01-header-toolbar.css` (con el `.btn` viejo) se sigue cargando antes que
`09-buttons-calculator.css` (con el `.btn` que lo reemplaza), igual que en
el original.

## Por qué esto NO necesita build script (a diferencia del HTML)

A diferencia de HTML, los navegadores sí saben incluir múltiples hojas de
estilo nativamente: varios `<link rel="stylesheet">` se aplican en el orden
en que aparecen, exactamente como si fueran un solo archivo concatenado.
No hace falta ningún paso de armado ni arriesgar nada con `fetch()` — por
eso actualicé directamente `fragments/00-head.html` (del paquete de HTML)
para que cargue los 10 CSS en orden, y regeneré `index.html` con
`node build-html.js`.

## Verificación realizada

1. **Reconstrucción byte a byte**: concatenar los 10 módulos (sin las
   cabeceras de documentación que les agregué) reproduce `styles.css`
   original de forma idéntica (`diff` sin salida).
2. **Balance de llaves**: 138 `{` y 138 `}` en el original; la suma de cada
   módulo individual da exactamente los mismos totales, y cada módulo por
   separado tiene sus propias llaves balanceadas (ningún selector quedó
   cortado a la mitad).
3. **Aislé el único cambio real** en `index.html`: al regenerar el HTML y
   quitar los bloques de cabecera que agregué, la única diferencia contra
   el `index.html` original es el bloque de `<link>` (más el bloque de
   `<script>` de la modularización anterior) — nada más de las 2,375 líneas
   originales cambió.
4. `html.parser` de Python parsea el `index.html` final sin errores; los
   `<link rel="stylesheet">` pasaron de 12 (10 locales + 2 CDN) — antes eran
   3 (1 local + 2 CDN).

## Mapa de módulos (orden = orden de carga = orden de cascada)

| # | Archivo | Contenido |
|---|---------|-----------|
| 00 | `00-base.css` | Reset (`*`) y estilos base de `<body>` |
| 01 | `01-header-toolbar.css` | `header`, `h1`, `.toolbar`, `.btn` (versión **original**), `.sep`, `.sc` (control de ancho de calle) |
| 02 | `02-layout.css` | `.main`, `.canvas-wrap`, `canvas`, `.sidebar` (contenedor) |
| 03 | `03-sidebar-components.css` | `.instr`, `.lot-params` completo, `.card`, `.lot-sub-item` |
| 04 | `04-statusbar.css` | `.sbar`, `.coords`, `.lc` |
| 05 | `05-edit-panel.css` | `#editPanel` completo |
| 06 | `06-stats-panel.css` | `#statsPanel` (tabla, filas, barras — parte principal) |
| 07 | `07-import-modal.css` | `#importModal` / `#importModalBox` (esqueleto reusado por los demás modales) |
| 08 | `08-equipamiento.css` | Filas `sp-equip` de `#statsPanel` + `.equip-badge` (viven acá en el original, después del modal) |
| 09 | `09-buttons-calculator.css` | **Redefine** `.btn` (a propósito, pisa la versión de `01`) + variantes de color + `.cbtn*` de la calculadora |

## Si preferís volver a un solo archivo

Es un cambio de una línea en `fragments/00-head.html` (volver a
`<link rel="stylesheet" href="styles.css" />` y borrar los 10 `<link>` de
abajo) y correr `node build-html.js`.
