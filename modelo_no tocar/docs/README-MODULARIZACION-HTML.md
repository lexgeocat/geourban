# Modularización de `index.html`

## Qué se hizo

`index.html` (2,375 líneas) se cortó en **10 fragmentos**, en los límites
naturales de la página (`<head>`, header/toolbar, área principal
canvas+sidebar, barra de estado + calculadora, y cada uno de los 5 modales),
igual de "quirúrgico" que el corte de `01-core.js`.

## Por qué son fragmentos + build script, y no `fetch()` en vivo

HTML no tiene un equivalente a cargar varios `<script>` que compartan scope:
o el navegador ve un solo documento, o hay que inyectar los pedazos con
JavaScript (`fetch()` + `innerHTML`). Esa segunda opción se descartó a
propósito:
- `fetch()` de archivos locales falla por CORS si el proyecto se abre como
  `file://` (doble clic en `index.html`), que es como suelen abrirse estos
  proyectos sin servidor. Eso *rompería* la página — lo opuesto a "sin
  dañar nada".
- Agregaría una carrera asíncrona: el resto de los scripts asumen que el DOM
  ya existe completo al ejecutarse.

En su lugar, uso el mismo criterio que ya viene funcionando para el CSS/JS
de este proyecto (varios archivos, un paso de armado): los 10 fragmentos se
ensamblan en un `index.html` final con un pequeño script de build
(`build-html.js`). El archivo que efectivamente se sirve/abre es un HTML
normal y corriente — cero riesgo en runtime, la modularidad vive solo en
cómo lo editás.

## Verificación realizada

1. **Reconstrucción byte a byte del corte puro**: concatenar los 10
   fragmentos *sin las cabeceras de documentación que les agregué* reproduce
   `index.html` original de forma idéntica (`diff` sin salida).
2. **Aislar el único cambio de contenido real**: al generar el `index.html`
   final y quitarle los 10 bloques de cabecera agregados, la única diferencia
   contra el original es, como se esperaba, el bloque de `<script>` — nada
   más se tocó en las 2,375 líneas originales.
3. **Balance de etiquetas**: mismo número de `<div>` y `</div>` (122 y 122)
   entre el original y el `index.html` final; `html.parser` de Python lo
   parsea sin errores.
4. **Scripts**: 13 `<script src>` originales (4 CDN + 9 locales) →
   29 en el final (4 CDN + 17 módulos nuevos + los 8 archivos
   `02-calculator.js`…`09-print.js` que ya existían, intactos y en el mismo
   orden relativo).

## El único cambio de contenido (deliberado, no parte del "corte")

El corte en sí no modifica nada. Pero de regalo até esto con el trabajo
anterior: reemplacé

```html
<script src="01-core.js"></script>
```

por las 17 líneas que apuntan a los módulos generados en la tanda anterior
(`01-translations.js` … `17-plano-lote.js`), porque si no, todo ese trabajo
de modularizar el JS quedaba sin conectar acá. El resto de los `<script>`
(`02-calculator.js` a `09-print.js`) se dejaron exactamente donde estaban.

Si preferís mantener `01-core.js` como archivo único, es un cambio de una
línea en `fragments/09-scripts-footer.html` (volver a poner
`<script src="01-core.js"></script>` y borrar las 17 de abajo) y correr de
nuevo `node build-html.js`.

## Mapa de fragmentos

| # | Archivo | Contenido |
|---|---------|-----------|
| 00 | `00-head.html` | `<!doctype>`, `<html>`, `<head>` completo (metas, CSS, CDN scripts) |
| 01 | `01-header-toolbar.html` | Abre `<body>`, logo + toda la toolbar (`<header>` completo) |
| 02 | `02-main-canvas-sidebar.html` | `.main`: canvas, panel rápido del canvas, sidebar (manzanos/calles/stats/edición/slice) |
| 03 | `03-statusbar-calculator.html` | Barra de estado inferior + calculadora flotante |
| 04 | `04-modal-ortofoto-kmz.html` | Modal "Cargar Ortofoto KMZ" |
| 05 | `05-modal-import-kmz-kml.html` | Modal "Importar KMZ/KML" |
| 06 | `06-modal-import-dxf.html` | Modal "Importar Parcela desde DXF" |
| 07 | `07-modal-plano-lote.html` | Modal "Plano por Lote" |
| 08 | `08-modal-print.html` | Modal de impresión/plano general |
| 09 | `09-scripts-footer.html` | Todos los `<script>` + cierre `</body></html>` |

## Cómo editar / regenerar

```bash
# Editar cualquier fragments/*.html y después:
node build-html.js
# Esto sobreescribe index.html en la misma carpeta.
```

`build-html.js` no depende de ninguna librería externa (solo `fs`/`path` de
Node), así que corre con cualquier Node instalado, sin `npm install`.

## Qué archivo usar

- Para **producción / abrir tal cual**: `index.html` (ya generado, ya
  apunta a los 17 módulos JS).
- Para **editar la interfaz**: tocar el fragmento correspondiente en
  `fragments/` y correr `node build-html.js`.
