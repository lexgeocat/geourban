//===================INICIO IMPORTAR DXF=======================================================
const DXF_CURVE_RESOLUTION = 48; // puntos por círculo/arco completo
let _importPendingPts = null; // puntos en espera de confirmación

function triggerImportDXF() {
  _importPendingPts = null;
  imSetStatus("", "");
  document.getElementById("imFileName").style.display = "none";
  document.getElementById("imFileName").textContent = "";
  document.getElementById("imBtnImport").disabled = true;
  document.getElementById("importModal").classList.add("open");
}

function closeImportModal() {
  document.getElementById("importModal").classList.remove("open");
  _importPendingPts = null;
}

function imDragOver(e) {
  e.preventDefault();
  document.getElementById("imDrop").classList.add("dragover");
}

function imDragLeave(e) {
  document.getElementById("imDrop").classList.remove("dragover");
}

function imDrop(e) {
  e.preventDefault();
  document.getElementById("imDrop").classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) processImportFile(file);
}

function handleDXFFileSelected(input) {
  const file = input.files[0];
  if (file) processImportFile(file);
  input.value = "";
}

function imSetStatus(msg, type) {
  const el = document.getElementById("imStatus");
  if (!msg) {
    el.style.display = "none";
    return;
  }
  el.className = "im-status " + (type || "inf");
  el.textContent = msg;
  el.style.display = "";
}

function processImportFile(file) {
  if (!file.name.toLowerCase().endsWith(".dxf")) {
    imSetStatus("Error: el archivo debe ser .DXF", "err");
    return;
  }
  imSetStatus("Leyendo archivo...", "inf");
  const fnEl = document.getElementById("imFileName");
  fnEl.textContent = "📄 " + file.name;
  fnEl.style.display = "";
  document.getElementById("imBtnImport").disabled = true;
  _importPendingPts = null;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const pts = parseDXFToPoly(e.target.result);
      if (!pts || pts.length < 3) {
        imSetStatus(
          "No se encontró ningún polígono cerrado válido (mínimo 3 vértices).",
          "err",
        );
        return;
      }
      _importPendingPts = pts;
      imSetStatus(
        `✓ Listo: ${pts.length} vértices encontrados. Presioná "Importar" para cargar.`,
        "ok",
      );
      document.getElementById("imBtnImport").disabled = false;
    } catch (err) {
      imSetStatus("Error al parsear DXF: " + err.message, "err");
      console.error(err);
    }
  };
  reader.onerror = () => imSetStatus("Error al leer el archivo.", "err");
  reader.readAsText(file);
}

function executeImportDXF() {
  if (!_importPendingPts || _importPendingPts.length < 3) return;
  _snapshot();
  const utmZone = parseInt(document.getElementById("imUtmZone").value) || 19;
  const utmHemi = document.getElementById("imUtmHemi").value;
  let sumX = 0,
    sumY = 0;
  for (const p of _importPendingPts) {
    sumX += p.x;
    sumY += p.y;
  }
  const originUTM_X = sumX / _importPendingPts.length;
  const originUTM_Y = sumY / _importPendingPts.length;
  const originLatLng = _utmToLatLng(originUTM_X, originUTM_Y, utmZone, utmHemi);
  _geoOrigin = {
    utmX: originUTM_X,
    utmY: originUTM_Y,
    zone: utmZone,
    hemi: utmHemi,
    lat: originLatLng.lat,
    lng: originLatLng.lng,
  };
  const worldPts = _importPendingPts.map((p) => ({
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
  dxfGuideLines = (_dxfRawGeometries || [])
    .map((geom) => {
      const pts = Array.isArray(geom) ? geom : [];
      if (pts.length < 2) return null;
      return {
        pts: pts.map((p) => ({
          x: mw(p.x - originUTM_X),
          y: -mw(p.y - originUTM_Y),
        })),
      };
    })
    .filter((g) => g !== null && g.pts.length >= 2);
  _dxfRawGeometries = [];
  closePolygon();
  zoomToFitPoly(worldPts);
  closeImportModal();
  const guideLbl = document.getElementById("guideLinesLabel");
  if (guideLbl) {
    guideLbl.style.display = dxfGuideLines.length > 0 ? "flex" : "none";
  }
  document.getElementById("hintLabel").textContent =
    "Parcela importada desde DXF";
  setTimeout(() => {
    document.getElementById("hintLabel").textContent = "";
  }, 3000);
  if (_satVisible && _geoOrigin) {
    if (!_satMap) _initSatMap();
    setTimeout(() => {
      _satMap.invalidateSize();
      _alignLeafletToCanvas();
    }, 100);
  }
}

function parseDXFToPoly(text) {
  const raw = text.split("\n");
  const lines = raw.map((l) => l.trim());
  const n = lines.length;
  let i = 0;
  while (i < n - 1) {
    if (lines[i] === "2" && lines[i + 1].toUpperCase() === "ENTITIES") {
      i += 2;
      break;
    }
    i++;
  }

  const candidates = [];
  const openPolylines = [];
  const lineSegs = [];
  while (i < n) {
    if (lines[i] === "0") {
      const etype = (lines[i + 1] || "").toUpperCase();
      if (etype === "ENDSEC" || etype === "EOF") break;
      i += 2;

      if (etype === "LWPOLYLINE") {
        const r = dxfParseLWPolyline(lines, i);
        if (r.pts.length >= 3) {
          if (r.closed) candidates.push(r.pts);
          else openPolylines.push(r.pts);
        } else if (r.pts.length === 2) {
          lineSegs.push([r.pts[0], r.pts[1]]);
        }
        i = r.next;
      } else if (etype === "POLYLINE") {
        const r = dxfParsePolyline(lines, i);
        if (r.pts.length >= 3) {
          const f = r.pts[0],
            l = r.pts[r.pts.length - 1];
          const isClosed = Math.hypot(f.x - l.x, f.y - l.y) < 1e-6;
          if (isClosed) candidates.push(r.pts);
          else openPolylines.push(r.pts);
        } else if (r.pts.length === 2) {
          lineSegs.push([r.pts[0], r.pts[1]]);
        }
        i = r.next;
      } else if (etype === "ARC") {
        const r = dxfParseArc(lines, i);
        if (r.pts.length >= 2) openPolylines.push(r.pts);
        i = r.next;
      } else if (etype === "CIRCLE") {
        const r = dxfParseCircle(lines, i);
        if (r.pts.length >= 3) candidates.push(r.pts);
        i = r.next;
      } else if (etype === "SPLINE") {
        const r = dxfParseSpline(lines, i);
        if (r.pts.length >= 2) {
          const f = r.pts[0],
            l = r.pts[r.pts.length - 1];
          const isClosed = Math.hypot(f.x - l.x, f.y - l.y) < 1e-6;
          if (isClosed) candidates.push(r.pts);
          else openPolylines.push(r.pts);
        }
        i = r.next;
      } else if (etype === "LINE") {
        const r = dxfParseLine(lines, i);
        if (r.pts.length === 2) lineSegs.push([r.pts[0], r.pts[1]]);
        i = r.next;
      } else {
        while (i < n && lines[i] !== "0") i += 2;
      }
    } else {
      i++;
    }
  }

  _dxfRawGeometries = [...lineSegs.map((s) => [s[0], s[1]]), ...openPolylines];
  if (candidates.length === 0) {
    const allSegs = [...lineSegs];
    for (const op of openPolylines) {
      for (let k = 0; k < op.length - 1; k++) {
        allSegs.push([op[k], op[k + 1]]);
      }
    }
    if (allSegs.length >= 3) {
      const assembled = assembleLinesIntoPoly(allSegs);
      if (assembled && assembled.length >= 3) {
        _dxfRawGeometries.push(assembled);
        return dxfCleanPoly(assembled);
      }
    }
    if (openPolylines.length > 0) {
      const assembledOpen = assembleOpenPolylines(openPolylines);
      if (assembledOpen && assembledOpen.length >= 3) {
        _dxfRawGeometries.push(assembledOpen);
        return dxfCleanPoly(assembledOpen);
      }
    }
    return null;
  }

  let best = null,
    bestArea = -1;
  for (const c of candidates) {
    if (c.length < 3) continue;
    const a = dxfPolyArea(c);
    if (a > bestArea) {
      bestArea = a;
      best = c;
    }
  }

  return best ? dxfCleanPoly(best) : null;
}

function dxfPolyArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function dxfCleanPoly(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1],
      cur = pts[i];
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 1e-9) out.push(cur);
  }

  if (out.length > 1) {
    const f = out[0],
      l = out[out.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-9) out.pop();
  }
  return out;
}

function dxfParseLWPolyline(lines, start) {
  const pts = [],
    bulges = [];
  let i = start,
    isClosed = false;
  let j = start;
  while (j < lines.length && lines[j] !== "0") {
    const code = lines[j].trim();
    const val = (lines[j + 1] || "").trim();
    if (code === "70") isClosed = (parseInt(val, 10) & 1) !== 0;
    j += 2;
  }

  i = start;
  let pendingX = null;

  while (i < lines.length && lines[i] !== "0") {
    const code = lines[i].trim();
    const val = (lines[i + 1] || "").trim();

    if (code === "10") {
      pendingX = parseFloat(val);
      i += 2;
    } else if (code === "20") {
      // Y del vértice actual
      const y = parseFloat(val);
      if (pendingX !== null) {
        pts.push({ x: pendingX, y });
        pendingX = null;
      }
      i += 2;
    } else if (code === "30") {
      i += 2;
    } else if (code === "42") {
      while (bulges.length < pts.length - 1) bulges.push(0);
      bulges.push(parseFloat(val));
      i += 2;
    } else {
      i += 2;
    }
  }

  while (bulges.length < pts.length) bulges.push(0);
  if (!isClosed && pts.length > 1) {
    const f = pts[0],
      l = pts[pts.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1.0) {
      isClosed = true;
      pts.pop();
      bulges.pop();
    }
  }

  return {
    pts: dxfExpandBulges(pts, bulges, isClosed),
    closed: isClosed,
    next: i,
  };
}

function dxfParsePolyline(lines, start) {
  let i = start,
    isClosed = false;
  while (
    i < lines.length &&
    !(lines[i] === "0" && (lines[i + 1] || "").toUpperCase() === "VERTEX") &&
    !(lines[i] === "0" && (lines[i + 1] || "").toUpperCase() === "SEQEND")
  ) {
    if (lines[i] === "70") isClosed = (parseInt(lines[i + 1]) & 1) !== 0;
    i += 2;
  }
  const pts = [],
    bulges = [];
  while (i < lines.length) {
    const etype = (lines[i + 1] || "").toUpperCase();
    if (lines[i] === "0" && etype === "SEQEND") {
      i += 2;
      break;
    }
    if (lines[i] === "0" && etype === "VERTEX") {
      i += 2;
      let x = 0,
        y = 0,
        b = 0;
      while (i < lines.length && lines[i] !== "0") {
        if (lines[i] === "10") x = parseFloat(lines[i + 1]);
        else if (lines[i] === "20") y = parseFloat(lines[i + 1]);
        else if (lines[i] === "42") b = parseFloat(lines[i + 1]);
        i += 2;
      }
      pts.push({ x, y });
      bulges.push(b);
    } else {
      i += 2;
    }
  }
  return { pts: dxfExpandBulges(pts, bulges, isClosed), next: i };
}

function dxfExpandBulges(pts, bulges, isClosed) {
  if (pts.length === 0) return [];
  const out = [];
  const count = isClosed ? pts.length : pts.length - 1;
  for (let j = 0; j < count; j++) {
    const p0 = pts[j],
      p1 = pts[(j + 1) % pts.length];
    out.push(p0);
    const b = bulges[j] || 0;
    if (Math.abs(b) > 1e-10) {
      const arcPts = dxfBulgeToArc(p0, p1, b);
      out.push(...arcPts.slice(1, -1));
    }
  }
  if (!isClosed) out.push(pts[pts.length - 1]);
  return out;
}

function dxfBulgeToArc(p0, p1, bulge) {
  const dx = p1.x - p0.x,
    dy = p1.y - p0.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-10) return [p0, p1];
  const angle = 4 * Math.atan(Math.abs(bulge));
  const radius = chord / (2 * Math.sin(angle / 2));
  const sagitta = radius * (1 - Math.cos(angle / 2));
  const midX = (p0.x + p1.x) / 2,
    midY = (p0.y + p1.y) / 2;
  const perpX = -dy / chord,
    perpY = dx / chord;
  const dir = bulge > 0 ? 1 : -1;
  const cx = midX + dir * perpX * (radius - sagitta);
  const cy = midY + dir * perpY * (radius - sagitta);
  const a0 = Math.atan2(p0.y - cy, p0.x - cx);
  const a1 = Math.atan2(p1.y - cy, p1.x - cx);
  let da = a1 - a0;
  if (bulge > 0 && da < 0) da += 2 * Math.PI;
  if (bulge < 0 && da > 0) da -= 2 * Math.PI;
  const steps = Math.max(
    8,
    Math.ceil((Math.abs(da) * DXF_CURVE_RESOLUTION) / (2 * Math.PI)),
  );
  const out = [];
  for (let k = 0; k <= steps; k++) {
    const a = a0 + (da * k) / steps;
    out.push({
      x: cx + radius * Math.cos(a),
      y: cy + radius * Math.sin(a),
    });
  }
  return out;
}

function dxfParseArc(lines, start) {
  let i = start,
    cx = 0,
    cy = 0,
    r = 0,
    a0 = 0,
    a1 = 360;
  while (i < lines.length && lines[i] !== "0") {
    if (lines[i] === "10") cx = parseFloat(lines[i + 1]);
    else if (lines[i] === "20") cy = parseFloat(lines[i + 1]);
    else if (lines[i] === "40") r = parseFloat(lines[i + 1]);
    else if (lines[i] === "50") a0 = parseFloat(lines[i + 1]);
    else if (lines[i] === "51") a1 = parseFloat(lines[i + 1]);
    i += 2;
  }
  let da = a1 - a0;
  if (da <= 0) da += 360;
  const steps = Math.max(8, Math.ceil((da / 360) * DXF_CURVE_RESOLUTION));
  const pts = [];
  for (let k = 0; k <= steps; k++) {
    const a = ((a0 + (da * k) / steps) * Math.PI) / 180;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return { pts, next: i };
}

function dxfParseCircle(lines, start) {
  let i = start,
    cx = 0,
    cy = 0,
    r = 0;
  while (i < lines.length && lines[i] !== "0") {
    if (lines[i] === "10") cx = parseFloat(lines[i + 1]);
    else if (lines[i] === "20") cy = parseFloat(lines[i + 1]);
    else if (lines[i] === "40") r = parseFloat(lines[i + 1]);
    i += 2;
  }
  const pts = [];
  for (let k = 0; k < DXF_CURVE_RESOLUTION; k++) {
    const a = (2 * Math.PI * k) / DXF_CURVE_RESOLUTION;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return { pts, next: i };
}

function dxfParseSpline(lines, start) {
  let i = start;
  const ctrl = [],
    fit = [];
  let deg = 3;
  while (i < lines.length && lines[i] !== "0") {
    if (lines[i] === "71") {
      deg = parseInt(lines[i + 1]);
      i += 2;
    } else if (lines[i] === "10") {
      const x = parseFloat(lines[i + 1]);
      i += 2;
      if (lines[i] === "20") {
        ctrl.push({ x, y: parseFloat(lines[i + 1]) });
        i += 2;
      }
    } else if (lines[i] === "11") {
      const x = parseFloat(lines[i + 1]);
      i += 2;
      if (lines[i] === "21") {
        fit.push({ x, y: parseFloat(lines[i + 1]) });
        i += 2;
      }
    } else {
      i += 2;
    }
  }
  const src = fit.length > 1 ? fit : ctrl;
  const pts = [];
  for (let k = 0; k <= DXF_CURVE_RESOLUTION; k++) {
    const t = k / DXF_CURVE_RESOLUTION;
    const p = dxfBezier(src, t);
    pts.push(p);
  }
  return { pts, next: i };
}

function dxfParseLine(lines, start) {
  let i = start,
    x1 = 0,
    y1 = 0,
    x2 = 0,
    y2 = 0;
  while (i < lines.length && lines[i] !== "0") {
    if (lines[i] === "10") x1 = parseFloat(lines[i + 1]);
    else if (lines[i] === "20") y1 = parseFloat(lines[i + 1]);
    else if (lines[i] === "11") x2 = parseFloat(lines[i + 1]);
    else if (lines[i] === "21") y2 = parseFloat(lines[i + 1]);
    i += 2;
  }
  return {
    pts: [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ],
    next: i,
  };
}

function dxfBezier(cp, t) {
  let pts = cp.map((p) => ({ ...p }));
  while (pts.length > 1) {
    const nxt = [];
    for (let k = 0; k < pts.length - 1; k++)
      nxt.push({
        x: pts[k].x + t * (pts[k + 1].x - pts[k].x),
        y: pts[k].y + t * (pts[k + 1].y - pts[k].y),
      });
    pts = nxt;
  }
  return pts[0] || { x: 0, y: 0 };
}

function assembleLinesIntoPoly(segments) {
  if (!segments || segments.length === 0) return null;
  const EPS = 1e-3; // tolerancia en metros (más permisiva para DXF reales)
  const segs = segments.map((s) => ({
    a: { x: s[0].x, y: s[0].y },
    b: { x: s[1].x, y: s[1].y },
    used: false,
  }));

  function nearPt(p, q) {
    return Math.hypot(p.x - q.x, p.y - q.y) < EPS;
  }

  let startIdx = 0,
    maxLen = -1;
  for (let i = 0; i < segs.length; i++) {
    const l = Math.hypot(segs[i].b.x - segs[i].a.x, segs[i].b.y - segs[i].a.y);
    if (l > maxLen) {
      maxLen = l;
      startIdx = i;
    }
  }

  segs[startIdx].used = true;
  const poly = [{ ...segs[startIdx].a }, { ...segs[startIdx].b }];
  let safety = 0;
  while (safety++ < segs.length * 3) {
    const last = poly[poly.length - 1];
    let found = false;
    for (const seg of segs) {
      if (seg.used) continue;
      if (nearPt(last, seg.a)) {
        seg.used = true;
        if (nearPt(seg.b, poly[0])) return poly; // cerrado
        poly.push({ ...seg.b });
        found = true;
        break;
      }
      if (nearPt(last, seg.b)) {
        seg.used = true;
        if (nearPt(seg.a, poly[0])) return poly; // cerrado
        poly.push({ ...seg.a });
        found = true;
        break;
      }
    }

    if (!found) break;
  }

  if (poly.length >= 3) {
    const first = poly[0],
      last2 = poly[poly.length - 1];
    if (Math.hypot(first.x - last2.x, first.y - last2.y) < 2.0) {
      return poly;
    }
  }
  return poly.length >= 3 ? poly : null;
}

function assembleOpenPolylines(polylines) {
  if (!polylines || polylines.length === 0) return null;
  const EPS = 1e-3;
  function nearPt(p, q) {
    return Math.hypot(p.x - q.x, p.y - q.y) < EPS;
  }
  const chains = polylines.map((pl) => ({
    pts: pl.map((p) => ({ ...p })),
    used: false,
  }));
  let startIdx = 0,
    maxLen = -1;
  for (let i = 0; i < chains.length; i++) {
    const c = chains[i];
    let l = 0;
    for (let k = 0; k < c.pts.length - 1; k++) {
      l += Math.hypot(c.pts[k + 1].x - c.pts[k].x, c.pts[k + 1].y - c.pts[k].y);
    }
    if (l > maxLen) {
      maxLen = l;
      startIdx = i;
    }
  }

  chains[startIdx].used = true;
  const poly = [...chains[startIdx].pts];
  let safety = 0;

  while (safety++ < chains.length * 3) {
    const first = poly[0];
    const last = poly[poly.length - 1];

    if (poly.length > 3 && nearPt(first, last)) {
      poly.pop(); // quitar duplicado del cierre
      return poly;
    }

    let found = false;
    for (const chain of chains) {
      if (chain.used) continue;
      const cf = chain.pts[0];
      const cl = chain.pts[chain.pts.length - 1];

      if (nearPt(last, cf)) {
        chain.used = true;
        poly.push(...chain.pts.slice(1));
        found = true;
        break;
      }
      if (nearPt(last, cl)) {
        chain.used = true;
        poly.push(...[...chain.pts].reverse().slice(1));
        found = true;
        break;
      }
      if (nearPt(first, cl)) {
        chain.used = true;
        poly.unshift(...chain.pts.slice(0, -1));
        found = true;
        break;
      }
      if (nearPt(first, cf)) {
        chain.used = true;
        poly.unshift(...[...chain.pts].reverse().slice(0, -1));
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  if (poly.length >= 3) {
    const first = poly[0],
      last = poly[poly.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 2.0) {
      return poly;
    }
    if (poly.length >= 4) return poly;
  }

  return null;
}
//===================FIN IMPORTAR DXF==========================================================
