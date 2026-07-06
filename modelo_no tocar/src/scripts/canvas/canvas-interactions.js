// =====================================================================
// MÓDULO 07/17 · 07-canvas-interactions.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js, 04-history.js, 05-coords.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [7] MODOS DE DIBUJO E INTERACCIÓN DEL MOUSE (canvas)
// (candidato a módulo: canvas-interactions.js · depende de: [3],[4],[5])
// Nota: justo después de getCP() hay 7 líneas top-level que registran
// los listeners del canvas (mousemove/down/up/click/dblclick/wheel/
// contextmenu) — al modularizar, mantenerlas como parte del init de
// este módulo (deben ejecutarse una sola vez, tras crear `canvas`).
// =====================================================================
function setMode(m) {
  if (m === "street" && !polyClosed) return;
  if (m === "slice" && !polyClosed) return;
  mode = m;
  streetStart = null;
  selStreetId = null;
  dragHandle = null;
  ["btnPolygon", "btnStreet", "btnEdit", "btnSlice"].forEach((id) =>
    document
      .getElementById(id)
      .classList.toggle(
        "active",
        id === "btn" + m.charAt(0).toUpperCase() + m.slice(1),
      ),
  );
  canvas.style.cursor = m === "edit" ? "default" : "crosshair";
  document.getElementById("modeLabel").textContent =
    {
      polygon: t("modoParcela"),
      street: t("modoTrazarCalle"),
      edit: t("modoEditarCalles"),
      slice: t("modoSubdivision"),
    }[m] || "";
  document.getElementById("slicePanel").style.display =
    m === "slice" ? "block" : "none";
  if (m === "slice") {
    populateSliceMznSel();
    updateSliceCalc();
  }
  updateInstr();
  render();
}

function updateInstr() {
  const el = document.getElementById("instrBox");
  if (!polyClosed) {
    el.innerHTML = `<div class="s">${t("instrP1")}</div><div class="s" style="color:#8b949e">${t("instrP1b")}</div>`;
  } else if (mode === "street") {
    el.innerHTML = `<div class="s">${t("instrP2")}</div><div class="s" style="color:#8b949e">${t("instrP2b")}</div>`;
  } else if (mode === "edit") {
    el.innerHTML = `<div class="s">${t("instrEdit")}</div>`;
  } else {
    el.innerHTML = `<div class="s">${t("instrCerrada")}</div>`;
  }
}

function getCP(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
canvas.addEventListener("mousemove", onMove);
canvas.addEventListener("mousedown", onDown);
canvas.addEventListener("mouseup", onUp);
canvas.addEventListener("click", onClick);
canvas.addEventListener("dblclick", onDbl);
canvas.addEventListener("wheel", onWheel, { passive: false });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function onMove(e) {
  const cp = getCP(e);
  mousePos = cp;
  if (isPanning) {
    pan.x += cp.x - panStart.x;
    pan.y += cp.y - panStart.y;
    panStart = cp;
    if (_satVisible && _geoOrigin && _satMap && !_alignPending) {
      const worldCX = (canvas.width / 2 - pan.x) / zoom;
      const worldCY = (canvas.height / 2 - pan.y) / zoom;
      const centerLL = _worldToLatLng(worldCX, worldCY);
      const mppCanvas = MPP / zoom;
      const zExact = _mppToLeafletZoom(centerLL.lat, mppCanvas);
      const zLeaflet = Math.max(2, Math.min(21, Math.round(zExact)));
      _satMap.stop();
      _satMap.setView([centerLL.lat, centerLL.lng], zLeaflet, {
        animate: false,
        duration: 0,
        noMoveStart: true,
      });
    }
    render();
    return;
  }
  if (dragHandle) {
    const wp = toW(cp.x, cp.y),
      s = streets.find((s) => s.id === dragHandle.id);
    if (s) {
      if (dragHandle.which === "body") {
        s.start = {
          x: wp.x + dragHandle.offsetStart.x,
          y: wp.y + dragHandle.offsetStart.y,
        };
        s.end = {
          x: wp.x + dragHandle.offsetEnd.x,
          y: wp.y + dragHandle.offsetEnd.y,
        };
      } else if (dragHandle.which === "start" || dragHandle.which === "end") {
        const fixed = dragHandle.which === "start" ? s.end : s.start;
        const dx = dragHandle.origEnd.x - dragHandle.origStart.x;
        const dy = dragHandle.origEnd.y - dragHandle.origStart.y;
        const len = Math.sqrt(dx * dx + dy * dy);

        if (len > 1e-6) {
          const ux = dx / len,
            uy = dy / len; // dirección original
          const perpDist = Math.abs(
            (wp.x - fixed.x) * -uy + (wp.y - fixed.y) * ux,
          );
          const SNAP_AXIS = mw(1.5);

          if (perpDist < SNAP_AXIS) {
            const dot = (wp.x - fixed.x) * ux + (wp.y - fixed.y) * uy;
            s[dragHandle.which] = {
              x: fixed.x + dot * ux,
              y: fixed.y + dot * uy,
            };
            dragHandle.freeMode = false;
          } else {
            s[dragHandle.which] = { x: wp.x, y: wp.y };
            dragHandle.freeMode = true;
          }
        } else {
          s[dragHandle.which] = { x: wp.x, y: wp.y };
          dragHandle.freeMode = true;
        }
      }
      recomputeManzanos();
      updateSidebar();
      if (selStreetId === s.id) fillPanel(s);
    }
    render();
    return;
  }
  const wp = toW(cp.x, cp.y);
  const mp = ptWM(wp);
  document.getElementById("coordsLabel").textContent =
    `X: ${mp.x.toFixed(1)}m  Y: ${mp.y.toFixed(1)}m`;
  if (mode === "street" && polyClosed) {
    snapTarget = snapToVertex(wp);
  } else {
    snapTarget = null;
  }
  if (mode === "edit") {
    let cursorStyle = "default";
    for (const s of streets) {
      const sc = toC(s.start.x, s.start.y),
        ec = toC(s.end.x, s.end.y);
      if (
        Math.hypot(cp.x - sc.x, cp.y - sc.y) < 11 ||
        Math.hypot(cp.x - ec.x, cp.y - ec.y) < 11
      ) {
        cursorStyle = "grab";
        break;
      }
      if (distPtSeg(cp, sc, ec) < 10) {
        cursorStyle = "move";
        break;
      }
    }
    canvas.style.cursor = cursorStyle;
  }
  render();
}

function onDown(e) {
  const cp = getCP(e);
  if (e.button === 1 || e.button === 2) {
    isPanning = true;
    panStart = cp;
    canvas.style.cursor = "grabbing";
    return;
  }
  if (e.button === 0 && mode === "edit") {
    for (const s of streets) {
      const sc = toC(s.start.x, s.start.y),
        ec = toC(s.end.x, s.end.y);
      if (Math.hypot(cp.x - sc.x, cp.y - sc.y) < 11) {
        dragHandle = {
          id: s.id,
          which: "start",
          freeMode: false,
          origStart: { ...s.start },
          origEnd: { ...s.end },
        };
        selStreetId = s.id;
        fillPanel(s);
        render();
        return;
      }
      if (Math.hypot(cp.x - ec.x, cp.y - ec.y) < 11) {
        dragHandle = {
          id: s.id,
          which: "end",
          freeMode: false,
          origStart: { ...s.start },
          origEnd: { ...s.end },
        };
        selStreetId = s.id;
        fillPanel(s);
        render();
        return;
      }
    }
    for (const s of streets) {
      const sc = toC(s.start.x, s.start.y),
        ec = toC(s.end.x, s.end.y);
      if (distPtSeg(cp, sc, ec) < 10) {
        const wp = toW(cp.x, cp.y);
        dragHandle = {
          id: s.id,
          which: "body",
          offsetStart: { x: s.start.x - wp.x, y: s.start.y - wp.y },
          offsetEnd: { x: s.end.x - wp.x, y: s.end.y - wp.y },
        };
        selStreetId = s.id;
        fillPanel(s);
        render();
        return;
      }
    }
  }
}

function onUp(e) {
  if (e.button === 1 || e.button === 2) {
    isPanning = false;
    canvas.style.cursor = mode === "edit" ? "default" : "crosshair";
  }
  if (dragHandle) {
    _snapshot();
    dragHandle = null;
    canvas.style.cursor = "default";
  }
}

function onClick(e) {
  if (e.button !== 0 || isPanning || dragHandle) return;
  const cp = getCP(e),
    wp = toW(cp.x, cp.y);
  if (sliceSubPhase === "pickFrente") {
    const mzn = manzanos[sliceMznIdx];
    if (!mzn) {
      sliceSubPhase = "none";
      return;
    }
    const pts = mzn.pts,
      n = pts.length;
    let bestDist = Infinity,
      bestSeg = null,
      bestIdx = -1;
    for (let i = 0; i < n; i++) {
      const a = pts[i],
        b = pts[(i + 1) % n];
      const ac = toC(a.x, a.y),
        bc = toC(b.x, b.y);
      const d = distPtSeg(cp, ac, bc);
      if (d < bestDist) {
        bestDist = d;
        bestSeg = { a, b, i };
        bestIdx = i;
      }
    }

    if (bestSeg && bestDist < 20) {
      sliceSelectingFrente = bestSeg;
      sliceAdjacentSegs = [
        {
          a: pts[(bestIdx - 1 + n) % n],
          b: pts[bestIdx],
          i: (bestIdx - 1 + n) % n,
        },
        {
          a: pts[(bestIdx + 1) % n],
          b: pts[(bestIdx + 2) % n],
          i: (bestIdx + 1) % n,
        },
      ];
      sliceCutLineMode = false;
      sliceCutLineStep = 0;
      sliceCutLineP1 = null;
      sliceCutLineP2 = null;
      document.getElementById("slicePhaseCHintAux").style.display = "";
      document.getElementById("slicePhaseCHintLine").style.display = "none";
      document.getElementById("btnSliceCutLine").style.display = "";
      sliceSubPhase = "pickAux";
      document.getElementById("slicePhaseB").style.display = "none";
      document.getElementById("slicePhaseC").style.display = "";
      render();
    }

    return;
  }

  if (sliceSubPhase === "pickAux") {
    const mzn = manzanos[sliceMznIdx];
    if (!mzn) {
      sliceSubPhase = "none";
      return;
    }

    if (sliceCutLineMode) {
      const snapC = _slicePerpSnap(cp, mzn.pts);
      const usePt = snapC ? toW(snapC.x, snapC.y) : wp;
      if (sliceCutLineStep === 0) {
        sliceCutLineP1 = usePt;
        sliceCutLineStep = 1;
        document.getElementById("sliceCutLineStepTxt").textContent =
          t("slicePunto2");
      } else {
        sliceCutLineP2 = usePt;
        sliceRunBisectManzanoFromLine();
      }
      render();
      return;
    }

    const pts = mzn.pts,
      n = pts.length;
    let bestDist = Infinity,
      bestSeg = null;
    for (let i = 0; i < n; i++) {
      if (!sliceAdjacentSegs.some((s) => s.i === i)) continue;
      const a = pts[i],
        b = pts[(i + 1) % n];
      const ac = toC(a.x, a.y),
        bc = toC(b.x, b.y);
      const d = distPtSeg(cp, ac, bc);
      if (d < bestDist) {
        bestDist = d;
        bestSeg = { a, b, i };
      }
    }
    if (!bestSeg || bestDist > 30) return;
    sliceSelectingAux = bestSeg;
    sliceRunBisectManzano();
    return;
  }

  if (slicePickingSeg) {
    if (!sliceSubMzn) {
      slicePickingSeg = false;
      return;
    }
    const pts = sliceSubMzn.pts,
      n = pts.length;
    let bestDist = Infinity,
      bestP1 = null,
      bestP2 = null;
    for (let i = 0; i < n; i++) {
      const a = pts[i],
        b = pts[(i + 1) % n];
      const ac = toC(a.x, a.y),
        bc = toC(b.x, b.y);
      const d = distPtSeg(cp, ac, bc);
      if (d < bestDist) {
        bestDist = d;
        bestP1 = a;
        bestP2 = b;
      }
    }
    if (bestP1 && bestDist < 20) {
      const ddx = bestP2.x - bestP1.x,
        ddy = bestP2.y - bestP1.y;
      const ll = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      sliceCutDirX = ddx / ll;
      sliceCutDirY = ddy / ll;
      sliceFrenteMidX = (bestP1.x + bestP2.x) / 2;
      sliceFrenteMidY = (bestP1.y + bestP2.y) / 2;
      slicePickingSeg = false;
      document.getElementById("sliceSegHint").style.display = "none";
      document.getElementById("sliceSegInfo").style.display = "";
      updateSliceCalc();
    }
    render();
    return;
  }

  if (mode === "polygon" && !polyClosed) {
    if (polyPts.length >= 3) {
      const fc = toC(polyPts[0].x, polyPts[0].y);
      if (Math.hypot(cp.x - fc.x, cp.y - fc.y) < 14) {
        closePolygon();
        return;
      }
    }
    _snapshot();
    polyPts.push({ x: wp.x, y: wp.y });
    if (polyPts.length >= 3)
      document.getElementById("btnClose").style.display = "";
    render();
    return;
  }

  if (pickingSegForMzn >= 0 && polyClosed && manzanos.length > 0) {
    const mzn = manzanos[pickingSegForMzn];
    if (mzn) {
      const pts = mzn.pts,
        n = pts.length;
      let bestDist = Infinity,
        bestAx = null,
        bestAy = null,
        bestP1 = null,
        bestP2 = null;
      for (let i = 0; i < n; i++) {
        const a = pts[i],
          b = pts[(i + 1) % n];
        const d = distPtSeg(wp, a, b);
        if (d < bestDist) {
          bestDist = d;
          const ddx = b.x - a.x,
            ddy = b.y - a.y;
          const ll = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          bestAx = ddx / ll;
          bestAy = ddy / ll;
          bestP1 = a;
          bestP2 = b;
        }
      }
      if (bestDist < 20 / zoom) {
        mznSegments[pickingSegForMzn] = {
          ax: bestAx,
          ay: bestAy,
          p1: bestP1,
          p2: bestP2,
        };
        pickingSegForMzn = -1;
        document.getElementById("segHint").style.display = "none";
        updateLpCalc();
        updateSidebar();
        render();
      }
    }
    return;
  }

  if (mode === "street" && polyClosed) {
    const snapped = snapTarget || wp;
    if (!streetStart) {
      streetStart = { x: snapped.x, y: snapped.y };
      document.getElementById("hintLabel").textContent = t("hint2doClic");
    } else {
      _snapshot();
      streets.push({
        id: ++streetIdCtr,
        start: { ...streetStart },
        end: { x: snapped.x, y: snapped.y },
        width: swVal,
      });
      streetStart = null;
      document.getElementById("hintLabel").textContent = "";
      recomputeManzanos();
      updateSidebar();
    }
    render();
    return;
  }

  if (mode === "edit") {
    for (const s of streets) {
      const sc = toC(s.start.x, s.start.y),
        ec = toC(s.end.x, s.end.y);
      if (distPtSeg(cp, sc, ec) < 10) {
        selStreetId = s.id;
        fillPanel(s);
        updateSidebar();
        render();
        return;
      }
    }
    selStreetId = null;
    closePanel();
    updateSidebar();
    render();
  }
}

function onDbl(e) {
  if (mode === "polygon" && !polyClosed && polyPts.length >= 3) closePolygon();
}
function onWheel(e) {
  e.preventDefault();
  const cp = getCP(e);
  if (_satVisible && _geoOrigin && _satMap) {
    const delta = e.deltaY < 0 ? 0.75 : -0.75;
    const currentZ = _satMap.getZoom();
    const newZ = Math.max(2, Math.min(21, currentZ + delta));
    const latLngCursor = _satMap.containerPointToLatLng([cp.x, cp.y]);
    _satMap.stop();
    _satMap.setView([latLngCursor.lat, latLngCursor.lng], newZ, {
      animate: false,
      duration: 0,
      noMoveStart: true,
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!_satMap || !_geoOrigin) return;
        _readLeafletAndUpdateCanvas();
      });
    });
    return;
  }

  const f = e.deltaY < 0 ? 1.1 : 0.91;
  const wx = (cp.x - pan.x) / zoom,
    wy = (cp.y - pan.y) / zoom;
  zoom = Math.max(0.04, Math.min(100, zoom * f));
  pan.x = cp.x - wx * zoom;
  pan.y = cp.y - wy * zoom;
  render();
}

