//===================INICIO IMPORTAR KMZ/KML===================================================
function toggleImportMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById("importMenu");
  const isOpen = menu.style.display === "block";
  menu.style.display = isOpen ? "none" : "block";
  if (!isOpen) {
    // Cerrar al hacer clic fuera
    setTimeout(() => {
      document.addEventListener("click", _closeImportMenuOnce);
    }, 0);
  }
}

function _closeImportMenuOnce() {
  closeImportMenu();
  document.removeEventListener("click", _closeImportMenuOnce);
}

function closeImportMenu() {
  const menu = document.getElementById("importMenu");
  if (menu) menu.style.display = "none";
}

let _kmzPendingPts = null;

function triggerImportKMZ() {
  _kmzPendingPts = null;
  kmzSetStatus("", "");
  document.getElementById("kmzFileName").style.display = "none";
  document.getElementById("kmzFileName").textContent = "";
  document.getElementById("kmzBtnImport").disabled = true;
  document.getElementById("importKMZModal").style.display = "flex";
}

function closeImportKMZModal() {
  document.getElementById("importKMZModal").style.display = "none";
  _kmzPendingPts = null;
}

function kmzDragOver(e) {
  e.preventDefault();
  document.getElementById("kmzDrop").style.borderColor = "#56d364";
  document.getElementById("kmzDrop").style.color = "#56d364";
}

function kmzDragLeave(e) {
  document.getElementById("kmzDrop").style.borderColor = "#30363d";
  document.getElementById("kmzDrop").style.color = "#8b949e";
}

function kmzDropHandler(e) {
  e.preventDefault();
  document.getElementById("kmzDrop").style.borderColor = "#30363d";
  document.getElementById("kmzDrop").style.color = "#8b949e";
  const file = e.dataTransfer.files[0];
  if (file) processKMZFile(file);
}

function handleKMZFileSelected(input) {
  const file = input.files[0];
  if (file) processKMZFile(file);
  input.value = "";
}

function kmzSetStatus(msg, type) {
  const el = document.getElementById("kmzStatus");
  if (!msg) {
    el.style.display = "none";
    return;
  }
  const colors = {
    ok: { bg: "#1a3a1f", color: "#3fb950", border: "#3fb95044" },
    err: { bg: "#3d1f1e", color: "#f85149", border: "#f8514944" },
    inf: { bg: "#1c2128", color: "#e3b341", border: "#e3b34144" },
  };
  const c = colors[type] || colors.inf;
  el.style.background = c.bg;
  el.style.color = c.color;
  el.style.border = "1px solid " + c.border;
  el.textContent = msg;
  el.style.display = "";
}

async function processKMZFile(file) {
  const name = file.name.toLowerCase();
  const fnEl = document.getElementById("kmzFileName");
  fnEl.textContent = "📄 " + file.name;
  fnEl.style.display = "";
  document.getElementById("kmzBtnImport").disabled = true;
  _kmzPendingPts = null;
  kmzSetStatus("Procesando archivo...", "inf");

  try {
    let kmlText = "";

    if (name.endsWith(".kmz")) {
      kmlText = await _loadKMZAsKML(file);
    } else if (name.endsWith(".kml")) {
      kmlText = await _readFileAsText(file);
    } else {
      kmzSetStatus("Error: el archivo debe ser .KMZ o .KML", "err");
      return;
    }

    const pts = _parseKMLToPoly(kmlText);

    if (!pts || pts.length < 3) {
      kmzSetStatus(
        "No se encontró ningún polígono válido (mínimo 3 vértices).",
        "err",
      );
      return;
    }

    _kmzPendingPts = pts;
    kmzSetStatus(
      `✓ Listo: ${pts.length} vértices encontrados. Presioná "Importar".`,
      "ok",
    );
    document.getElementById("kmzBtnImport").disabled = false;
  } catch (err) {
    kmzSetStatus("Error al procesar el archivo: " + err.message, "err");
    console.error("[KMZ Import]", err);
  }
}

async function _loadKMZAsKML(file) {
  if (typeof JSZip === "undefined") {
    await _loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    );
  }
  const buffer = await _readFileAsArrayBuffer(file);
  const zip = await JSZip.loadAsync(buffer);
  let kmlFile = zip.file("doc.kml");
  if (!kmlFile) {
    const kmlFiles = Object.keys(zip.files).filter((n) =>
      n.toLowerCase().endsWith(".kml"),
    );
    if (kmlFiles.length === 0)
      throw new Error("No se encontró ningún archivo KML dentro del KMZ");
    kmlFile = zip.file(kmlFiles[0]);
  }

  return await kmlFile.async("text");
}

function _readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.onerror = () => reject(new Error("No se pudo leer el archivo"));
    r.readAsText(file);
  });
}

function _readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.onerror = () => reject(new Error("No se pudo leer el archivo"));
    r.readAsArrayBuffer(file);
  });
}

function _loadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar: " + url));
    document.head.appendChild(s);
  });
}

function _parseKMLToPoly(kmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, "application/xml");

  const polygons = doc.getElementsByTagNameNS("*", "Polygon");
  let bestPts = null;
  let bestArea = -1;
  for (let pi = 0; pi < polygons.length; pi++) {
    const poly = polygons[pi];
    const outerEls = poly.getElementsByTagNameNS("*", "outerBoundaryIs");
    const src = outerEls.length > 0 ? outerEls[0] : poly;
    const coordEls = src.getElementsByTagNameNS("*", "coordinates");
    if (coordEls.length === 0) continue;
    const pts = _parseKMLCoordinates(coordEls[0].textContent);
    if (pts.length < 3) continue;
    const area = _kmlApproxArea(pts);
    if (area > bestArea) {
      bestArea = area;
      bestPts = pts;
    }
  }

  if (!bestPts) {
    const rings = doc.getElementsByTagNameNS("*", "LinearRing");
    for (let ri = 0; ri < rings.length; ri++) {
      const coordEls = rings[ri].getElementsByTagNameNS("*", "coordinates");
      if (coordEls.length === 0) continue;
      const pts = _parseKMLCoordinates(coordEls[0].textContent);
      if (pts.length < 3) continue;
      const area = _kmlApproxArea(pts);
      if (area > bestArea) {
        bestArea = area;
        bestPts = pts;
      }
    }
  }

  if (!bestPts) {
    const lines = doc.getElementsByTagNameNS("*", "LineString");
    for (let li = 0; li < lines.length; li++) {
      const coordEls = lines[li].getElementsByTagNameNS("*", "coordinates");
      if (coordEls.length === 0) continue;
      const pts = _parseKMLCoordinates(coordEls[0].textContent);
      if (pts.length < 3) continue;
      const first = pts[0],
        last = pts[pts.length - 1];
      const isClosed = Math.hypot(first.x - last.x, first.y - last.y) < 1e-9;
      if (!isClosed) continue;
      const area = _kmlApproxArea(pts);
      if (area > bestArea) {
        bestArea = area;
        bestPts = pts;
      }
    }
  }

  return bestPts;
}

function _parseKMLCoordinates(raw) {
  const tokens = raw.trim().split(/[\s\n\r]+/);
  const pts = [];
  for (const tok of tokens) {
    const parts = tok.trim().split(",");
    if (parts.length < 2) continue;
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (isNaN(lng) || isNaN(lat)) continue;
    const zone = Math.floor((lng + 180) / 6) + 1;
    const hemi = lat >= 0 ? "north" : "south";
    const projStr =
      hemi === "south"
        ? `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`
        : `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
    const wgs84 = "+proj=longlat +datum=WGS84 +no_defs";
    const utm = proj4(wgs84, projStr, [lng, lat]);
    pts.push({ x: utm[0], y: utm[1], lat, lng, zone, hemi });
  }

  if (pts.length > 1) {
    const f = pts[0],
      l = pts[pts.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) pts.pop();
  }
  return pts;
}

function _kmlApproxArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function executeImportKMZ() {
  if (!_kmzPendingPts || _kmzPendingPts.length < 3) return;
  _snapshot();
  let sumX = 0,
    sumY = 0;
  for (const p of _kmzPendingPts) {
    sumX += p.x;
    sumY += p.y;
  }
  const originUTM_X = sumX / _kmzPendingPts.length;
  const originUTM_Y = sumY / _kmzPendingPts.length;
  const zone = _kmzPendingPts[0].zone;
  const hemi = _kmzPendingPts[0].hemi;
  const originLatLng = _utmToLatLng(originUTM_X, originUTM_Y, zone, hemi);
  _geoOrigin = {
    utmX: originUTM_X,
    utmY: originUTM_Y,
    zone,
    hemi,
    lat: originLatLng.lat,
    lng: originLatLng.lng,
  };

  const worldPts = _kmzPendingPts.map((p) => ({
    x: mw(p.x - originUTM_X),
    y: -mw(p.y - originUTM_Y),
  }));

  polyPts = worldPts;
  polyClosed = false;
  streets = [];
  manzanos = [];
  lotSubdivisions = [];
  sliceLots = [];
  sliceSubMzn = null;
  sliceSubPhase = "none";
  sliceSelectingFrente = null;
  sliceSelectingAux = null;
  sliceAdjacentSegs = [];
  selStreetId = null;
  dragHandle = null;
  mznSegments = {};
  pickingSegForMzn = -1;
  streetIdCtr = 0;
  closePolygon();
  zoomToFitPoly(worldPts);
  closeImportKMZModal();
  document.getElementById("hintLabel").textContent = `✓ Parcela importada desde KMZ/KML · Zona UTM ${zone}${hemi === "south" ? "S" : "N"}`;
  setTimeout(() => {
    document.getElementById("hintLabel").textContent = "";
  }, 4000);
  if (_satVisible && _geoOrigin) {
    if (!_satMap) _initSatMap();
    setTimeout(() => {
      _satMap.invalidateSize();
      _alignLeafletToCanvas();
    }, 100);
  }
}
//===================  FIN IMPORTAR KMZ/KML ===================================================
