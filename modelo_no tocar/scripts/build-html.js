#!/usr/bin/env node
// =====================================================================
// build-html.js — ensambla index.html a partir de los fragmentos de
// /fragments, en orden numérico. Es la contraparte del split: si editás
// un fragmento, corré `node build-html.js` para regenerar index.html.
// =====================================================================
const fs = require("fs");
const path = require("path");

const FRAG_DIR = path.join(__dirname, "..", "src", "templates");
const OUT_FILE = path.join(__dirname, "..", "index.html");

const ORDER = [
  "partials/head.html",
  "partials/header-toolbar.html",
  "partials/main-canvas-sidebar.html",
  "partials/statusbar-calculator.html",
  "modals/modal-ortofoto-kmz.html",
  "modals/modal-import-kmz-kml.html",
  "modals/modal-import-dxf.html",
  "modals/modal-plano-lote.html",
  "modals/modal-print.html",
  "partials/scripts-footer.html",
];

let out = "";
for (const name of ORDER) {
  const p = path.join(FRAG_DIR, name);
  if (!fs.existsSync(p)) {
    console.error(`✗ Falta el fragmento: ${name}`);
    process.exit(1);
  }
  out += fs.readFileSync(p, "utf8");
}

fs.writeFileSync(OUT_FILE, out, "utf8");
console.log(`✓ index.html generado a partir de ${ORDER.length} fragmentos (${out.split("\n").length} líneas).`);
