//===================  INICIO ORTOFOTO KMZ ====================================================
function triggerOrthoKMZ() {
  orthoSetStatus("", "");
  document.getElementById("orthoKmzFileName").style.display = "none";
  document.getElementById("orthoKmzBtnLoad").disabled = true;
  document.getElementById("orthoKmzModal").style.display = "flex";
  // Actualizar slider con opacidad actual
  const sliderVal = Math.round(_orthoOpacity * 100);
  document.getElementById("orthoOpacitySlider").value = sliderVal;
  document.getElementById("orthoOpacityVal").textContent = sliderVal + "%";
  window._orthoPendingFile = null;
}

function closeOrthoKmzModal() {
  document.getElementById("orthoKmzModal").style.display = "none";
  window._orthoPendingFile = null;
}

function orthoKmzDragOver(e) {
  e.preventDefault();
  document.getElementById("orthoKmzDrop").style.borderColor = "#a5d6ff";
  document.getElementById("orthoKmzDrop").style.color = "#a5d6ff";
}
function orthoKmzDragLeave(e) {
  document.getElementById("orthoKmzDrop").style.borderColor = "#30363d";
  document.getElementById("orthoKmzDrop").style.color = "#8b949e";
}
function orthoKmzDropHandler(e) {
  e.preventDefault();
  document.getElementById("orthoKmzDrop").style.borderColor = "#30363d";
  document.getElementById("orthoKmzDrop").style.color = "#8b949e";
  const file = e.dataTransfer.files[0];
  if (file) _prepareOrthoFile(file);
}
function orthoKmzFileSelected(input) {
  const file = input.files[0];
  if (file) _prepareOrthoFile(file);
  input.value = "";
}

function orthoSetStatus(msg, type) {
  const el = document.getElementById("orthoKmzStatus");
  if (!msg) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.textContent = msg;
  const styles = {
    ok: {
      bg: "#1a3a1f",
      color: "#3fb950",
      border: "1px solid #3fb95044",
    },
    err: {
      bg: "#3d1f1e",
      color: "#f85149",
      border: "1px solid #f8514944",
    },
    inf: {
      bg: "#1c2128",
      color: "#e3b341",
      border: "1px solid #e3b34144",
    },
  };
  const s = styles[type] || styles.inf;
  el.style.background = s.bg;
  el.style.color = s.color;
  el.style.border = s.border;
}

function _prepareOrthoFile(file) {
  if (!file.name.toLowerCase().endsWith(".kmz")) {
    orthoSetStatus("Solo se admiten archivos .KMZ", "err");
    return;
  }
  window._orthoPendingFile = file;
  const fnEl = document.getElementById("orthoKmzFileName");
  fnEl.textContent = "📎 " + file.name;
  fnEl.style.display = "block";
  document.getElementById("orthoKmzBtnLoad").disabled = false;
  orthoSetStatus('Archivo listo. Presioná "Cargar Ortofoto".', "ok");
}

async function executeLoadOrthoKMZ() {
  const file = window._orthoPendingFile;
  if (!file) return;

  if (!_geoOrigin) {
    orthoSetStatus(
      "⚠ Primero importá una parcela desde KMZ/KML para establecer el origen geográfico.",
      "err",
    );
    return;
  }

  _orthoOpacity =
    parseInt(document.getElementById("orthoOpacitySlider").value) / 100;
  closeOrthoKmzModal();
  await _loadOrthoKMZ(file);
}

async function _loadOrthoKMZ(file) {
  if (typeof JSZip === "undefined") {
    await _loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    );
  }
  const hintLbl = document.getElementById("hintLabel");
  const prevHint = hintLbl ? hintLbl.textContent : "";
  if (hintLbl) hintLbl.textContent = "⏳ Cargando ortofoto…";

  try {
    const ab = await _readFileAsArrayBuffer(file);
    const zip = await JSZip.loadAsync(ab);
    const kmlEntry =
      zip.file("doc.kml") ||
      zip.file(
        Object.keys(zip.files).find((n) => n.toLowerCase().endsWith(".kml")) ||
          "",
      );
    if (!kmlEntry) throw new Error("No se encontró KML dentro del KMZ");
    const kmlText = await kmlEntry.async("string");
    const kmlDoc = new DOMParser().parseFromString(kmlText, "text/xml");
    const overlays = Array.from(kmlDoc.querySelectorAll("GroundOverlay"));
    if (!overlays.length)
      throw new Error("El KMZ no contiene imágenes GroundOverlay");
    _orthoTileUrls.forEach((u) => URL.revokeObjectURL(u));
    _orthoTileUrls = [];
    const tiles = [];
    let gLngMin = Infinity,
      gLatMin = Infinity,
      gLngMax = -Infinity,
      gLatMax = -Infinity;

    for (const ov of overlays) {
      const href = ov.querySelector("Icon > href")?.textContent?.trim();
      if (!href) continue;
      let n, s, e, w;
      const llb = ov.querySelector("LatLonBox");
      const llq = ov.querySelector("LatLonQuad");
      if (llb) {
        n = parseFloat(llb.querySelector("north")?.textContent);
        s = parseFloat(llb.querySelector("south")?.textContent);
        e = parseFloat(llb.querySelector("east")?.textContent);
        w = parseFloat(llb.querySelector("west")?.textContent);
      } else if (llq) {
        const pts4 = llq
          .querySelector("coordinates")
          ?.textContent?.trim()
          .split(/\s+/)
          .map((c) => c.split(",").map(Number));
        if (pts4 && pts4.length === 4) {
          w = Math.min(...pts4.map((p) => p[0]));
          e = Math.max(...pts4.map((p) => p[0]));
          s = Math.min(...pts4.map((p) => p[1]));
          n = Math.max(...pts4.map((p) => p[1]));
        }
      }
      if (!isFinite(n) || !isFinite(s) || !isFinite(e) || !isFinite(w))
        continue;
      const imgEntry =
        zip.files[href] ||
        zip.files[href.replace(/^.*\//, "")] ||
        Object.values(zip.files).find((f) =>
          f.name.endsWith(href.split("/").pop()),
        );
      if (!imgEntry) continue;

      const ext = href.split(".").pop().toLowerCase();
      const mime =
        {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
        }[ext] || "image/jpeg";
      const blob = new Blob([await imgEntry.async("arraybuffer")], {
        type: mime,
      });
      const url = URL.createObjectURL(blob);
      _orthoTileUrls.push(url);

      tiles.push({ url, n, s, e, w });
      if (w < gLngMin) gLngMin = w;
      if (e > gLngMax) gLngMax = e;
      if (s < gLatMin) gLatMin = s;
      if (n > gLatMax) gLatMax = n;
    }

    if (!tiles.length) throw new Error("No se procesaron tiles de imagen");
    const zone = _geoOrigin.zone,
      hemi = _geoOrigin.hemi;
    const projStr =
      hemi === "south"
        ? `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`
        : `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
    const wgs84 = "+proj=longlat +datum=WGS84 +no_defs";

    function ll2utm(lng, lat) {
      const r = proj4(wgs84, projStr, [lng, lat]);
      return { x: r[0], y: r[1] };
    }

    const swGlobal = ll2utm(gLngMin, gLatMin);
    const neGlobal = ll2utm(gLngMax, gLatMax);
    _orthoExtentM = {
      xMin: swGlobal.x,
      yMin: swGlobal.y,
      xMax: neGlobal.x,
      yMax: neGlobal.y,
    };
    const imgObjects = await Promise.all(
      tiles.map(
        (t) =>
          new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => res({ img, n: t.n, s: t.s, e: t.e, w: t.w });
            img.onerror = () =>
              rej(new Error("Error al cargar tile: " + t.url));
            img.src = t.url;
          }),
      ),
    );

    const CANVAS_RES = 4096;
    const mW = _orthoExtentM.xMax - _orthoExtentM.xMin;
    const mH = _orthoExtentM.yMax - _orthoExtentM.yMin;
    const aspect = mW / mH;
    let cW, cH;
    if (aspect >= 1) {
      cW = CANVAS_RES;
      cH = Math.round(CANVAS_RES / aspect);
    } else {
      cH = CANVAS_RES;
      cW = Math.round(CANVAS_RES * aspect);
    }
    const comp = document.createElement("canvas");
    comp.width = cW;
    comp.height = cH;
    const cCtx = comp.getContext("2d");
    for (const { img, n, s, e, w } of imgObjects) {
      const swT = ll2utm(w, s);
      const neT = ll2utm(e, n);
      const px = ((swT.x - _orthoExtentM.xMin) / mW) * cW;
      const py = (1 - (neT.y - _orthoExtentM.yMin) / mH) * cH;
      const pw = ((neT.x - swT.x) / mW) * cW;
      const ph = ((neT.y - swT.y) / mH) * cH;
      cCtx.drawImage(img, px, py, pw, ph);
    }

    _orthoCanvas = comp;
    _orthoVisible = true;
    const orthoLbl = document.getElementById("orthoVisLabel");
    const orthoChk = document.getElementById("orthoVisChk");
    if (orthoLbl) {
      orthoLbl.style.display = "flex";
    }
    if (orthoChk) {
      orthoChk.checked = true;
    }
    if (hintLbl)
      hintLbl.textContent = `🛰️ Ortofoto cargada · ${tiles.length} tile(s) · Zona ${zone}${hemi === "south" ? "S" : "N"}`;
    setTimeout(() => {
      if (hintLbl) hintLbl.textContent = "";
    }, 4000);

    render();
  } catch (err) {
    console.error("[OrthoKMZ]", err);
    if (hintLbl) hintLbl.textContent = "❌ " + err.message;
    setTimeout(() => {
      if (hintLbl) hintLbl.textContent = prevHint;
    }, 5000);
  }
}

function removeOrthoLayer() {
  _orthoTileUrls.forEach((u) => URL.revokeObjectURL(u));
  _orthoTileUrls = [];
  _orthoCanvas = null;
  _orthoExtentM = null;
  const orthoLbl = document.getElementById("orthoVisLabel");
  if (orthoLbl) orthoLbl.style.display = "none";
  render();
}

function drawOrthoOnCanvas() {
  if (!_orthoCanvas || !_orthoExtentM || !_geoOrigin || !_orthoVisible) return;
  const { xMin, yMin, xMax, yMax } = _orthoExtentM;
  const toWorld = (utmX, utmY) => ({
    x: (utmX - _geoOrigin.utmX) / MPP,
    y: -(utmY - _geoOrigin.utmY) / MPP,
  });

  const sw = toWorld(xMin, yMin);
  const ne = toWorld(xMax, yMax);
  const swC = toC(sw.x, sw.y);
  const neC = toC(ne.x, ne.y);
  const cx = neC.x - swC.x;
  const cy = swC.y - neC.y;
  ctx.save();
  ctx.globalAlpha = _orthoOpacity;
  ctx.drawImage(_orthoCanvas, neC.x - cx, neC.y, cx, cy);
  ctx.globalAlpha = 1;
  ctx.restore();
}
//===================  FIN ORTOFOTO KMZ  ======================================================
