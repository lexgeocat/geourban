//===================INICIO EXPORTAR DXF=======================================================
function exportDXF() {
  _exportDXFInternal();
}

function _exportDXFInternal() {
  if (manzanos.length === 0 && streets.length === 0) {
    alert("No hay datos para exportar.");
    return;
  }
  const utmOffX = _geoOrigin ? _geoOrigin.utmX : 0;
  const utmOffY = _geoOrigin ? _geoOrigin.utmY : 0;
  function toUTM(p) {
    return {
      x: utmOffX + wm(p.x),
      y: utmOffY - wm(p.y), // Y invertida: mundo usa Y hacia abajo, UTM hacia arriba
    };
  }

  function tryExport() {
    try {
      const DxfWriter =
        window.DxfWriter ||
        (window["@tarikjabiri/dxf"] && window["@tarikjabiri/dxf"].DxfWriter) ||
        (window["@tarikjabiri/dxf"] && window["@tarikjabiri/dxf"].default);

      if (typeof DxfWriter !== "function")
        throw new Error("DxfWriter no disponible");
      const dxf = new DxfWriter();
      dxf.addLayer("MANZANOS", 5, "CONTINUOUS");
      dxf.addLayer("LOTES", 3, "CONTINUOUS");
      dxf.addLayer("LOTES-REM", 30, "CONTINUOUS");
      dxf.addLayer("CALLES", 1, "CONTINUOUS");
      dxf.addLayer("EJES-CALLE", 4, "CONTINUOUS");
      dxf.addLayer("VEREDAS", 6, "CONTINUOUS");
      dxf.addLayer("EJES-MZN", 2, "CONTINUOUS");
      dxf.addLayer("TEXTO", 7, "CONTINUOUS");

      for (let i = 0; i < manzanos.length; i++) {
        const l = manzanos[i];
        const pts_utm = l.pts.map((p) => toUTM(p));
        dxf.setCurrentLayerName("MANZANOS");
        dxf.addLWPolyline(pts_utm, { flags: 1 });

        const cen = centroid(l.pts);
        const cenUTM = toUTM(cen);
        dxf.setCurrentLayerName("TEXTO");
        dxf.addText(`Mzo. ${i + 1}`, { x: cenUTM.x, y: cenUTM.y + 1.0 }, 1.0);
        dxf.addText(
          `${polyAreaM2(l.pts).toFixed(1)} m2`,
          { x: cenUTM.x, y: cenUTM.y - 0.3 },
          0.6,
        );

        const swPts = buildSidewalkWorldPts(l.pts);
        if (swPts && swPts.length >= 3) {
          dxf.setCurrentLayerName("VEREDAS");
          dxf.addLWPolyline(
            swPts.map((p) => toUTM(p)),
            { flags: 1 },
          );
        }

        if (mznSegments[i]) {
          const seg = mznSegments[i];
          dxf.setCurrentLayerName("EJES-MZN");
          dxf.addLWPolyline([toUTM(seg.p1), toUTM(seg.p2)], { flags: 0 });
        }

        const unifiedExport = [];
        const subExp = lotSubdivisions.find((s) => s.mznIdx === i);
        if (subExp) subExp.lots.forEach((lt) => unifiedExport.push(lt));
        sliceLots
          .filter((sd) => sd.mznIdx === i)
          .forEach((sd) => sd.lots.forEach((lt) => unifiedExport.push(lt)));

        unifiedExport.forEach((lt, j) => {
          const lpts_utm = lt.pts.map((p) => toUTM(p));
          dxf.setCurrentLayerName(lt.isRemnant ? "LOTES-REM" : "LOTES");
          dxf.addLWPolyline(lpts_utm, { flags: 1 });
          const lcen = centroid(lt.pts);
          const lcenUTM = toUTM(lcen);
          const la = lt.areaM2 !== undefined ? lt.areaM2 : polyAreaM2(lt.pts);
          let ltAngDeg = 0;
          {
            let maxLen = -1;
            const lp = lt.pts,
              ln = lp.length;
            for (let k = 0; k < ln; k++) {
              const a = lp[k],
                b = lp[(k + 1) % ln];
              const dl = Math.hypot(b.x - a.x, b.y - a.y);
              if (dl > maxLen) {
                maxLen = dl;
                ltAngDeg =
                  (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
              }
            }
            if (ltAngDeg > 90) ltAngDeg -= 180;
            if (ltAngDeg < -90) ltAngDeg += 180;
          }

          const angRad = (ltAngDeg * Math.PI) / 180;
          const perpX = -Math.sin(angRad);
          const perpY = Math.cos(angRad);
          const offsetM = 0.6;
          dxf.setCurrentLayerName("TEXTO");
          dxf.addText(
            `L${j + 1}`,
            {
              x: lcenUTM.x + perpX * offsetM,
              y: lcenUTM.y + perpY * offsetM,
            },
            0.8,
            { rotation: ltAngDeg },
          );
          dxf.addText(
            `${la.toFixed(1)}m2`,
            {
              x: lcenUTM.x - perpX * offsetM,
              y: lcenUTM.y - perpY * offsetM,
            },
            0.5,
            { rotation: ltAngDeg },
          );
          const ltN = lt.pts.length;
          const ltCenW = centroid(lt.pts);
          for (let si = 0; si < ltN; si++) {
            const pA = lt.pts[si];
            const pB = lt.pts[(si + 1) % ltN];
            const dxW = pB.x - pA.x,
              dyW = pB.y - pA.y;
            const lenM = Math.sqrt(dxW * dxW + dyW * dyW) * MPP;
            if (lenM < 0.5) continue;
            const midW = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
            const midUTM = toUTM(midW);
            const segLen = Math.sqrt(dxW * dxW + dyW * dyW) || 1;
            const nxSeg = -dyW / segLen,
              nySeg = dxW / segLen;
            const dotIn =
              (ltCenW.x - midW.x) * nxSeg + (ltCenW.y - midW.y) * nySeg;
            const inX = dotIn >= 0 ? nxSeg : -nxSeg;
            const inY = dotIn >= 0 ? nySeg : -nySeg;
            const OFFSET_M = 0.8;
            const txM = utmOffX + wm(midW.x + inX * mw(OFFSET_M));
            const tyM = utmOffY - wm(midW.y + inY * mw(OFFSET_M));
            const label =
              lenM >= 100 ? lenM.toFixed(1) + "m" : lenM.toFixed(2) + "m";
            const angDeg = (Math.atan2(-dyW, dxW) * 180) / Math.PI;
            dxf.setCurrentLayerName("TEXTO");
            dxf.addText(label, { x: txM, y: tyM }, 0.4, {
              rotation: angDeg,
            });
          }
        });
      }

      for (let i = 0; i < streets.length; i++) {
        const s = streets[i];
        const rect = streetRect(s);
        if (!rect) continue;
        const streetIdx = i + 1;
        dxf.setCurrentLayerName("EJES-CALLE");
        dxf.addLWPolyline([toUTM(s.start), toUTM(s.end)], { flags: 0 });
        const midW = {
          x: (s.start.x + s.end.x) / 2,
          y: (s.start.y + s.end.y) / 2,
        };
        const midUTM = toUTM(midW);
        const sdx = s.end.x - s.start.x,
          sdy = s.end.y - s.start.y;
        let calleAngDeg = (Math.atan2(-sdy, sdx) * 180) / Math.PI;
        if (calleAngDeg > 90) calleAngDeg -= 180;
        if (calleAngDeg < -90) calleAngDeg += 180;
        dxf.setCurrentLayerName("TEXTO");
        dxf.addText(
          `Calle ${String.fromCharCode(64 + streetIdx)} (Ancho ${s.width.toFixed(2)}m)`,
          { x: midUTM.x, y: midUTM.y },
          0.7,
          { rotation: calleAngDeg },
        );
      }

      const content = dxf.stringify();
      const blob = new Blob([content], { type: "application/dxf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "urbanizacion.dxf";
      a.click();
    } catch (err) {
      console.warn("DxfWriter no funcionó, usando fallback R12:", err);
      exportDXF_R12();
    }
  }

  const libReady =
    typeof window.DxfWriter === "function" ||
    (window["@tarikjabiri/dxf"] &&
      (typeof window["@tarikjabiri/dxf"].DxfWriter === "function" ||
        typeof window["@tarikjabiri/dxf"].default === "function"));

  if (libReady) {
    tryExport();
    return;
  }
  const CDN =
    "https://cdn.jsdelivr.net/npm/@tarikjabiri/dxf@1.0.8/dist/dxf.umd.js";
  const old = document.querySelector("script[data-dxflib]");
  if (old) old.remove();
  const s = document.createElement("script");
  s.setAttribute("data-dxflib", "1");
  s.src = CDN;
  s.onload = () => tryExport();
  s.onerror = () => {
    console.warn("CDN no disponible, usando fallback R12");
    exportDXF_R12();
  };
  document.head.appendChild(s);
}

function exportDXF_R12() {
  const utmOffX = _geoOrigin ? _geoOrigin.utmX : 0;
  const utmOffY = _geoOrigin ? _geoOrigin.utmY : 0;
  function toUTM(p) {
    return {
      x: utmOffX + wm(p.x),
      y: utmOffY - wm(p.y),
    };
  }

  const L = [];
  function sec(name) {
    L.push("  0\nSECTION", "  2\n" + name);
  }
  function endsec() {
    L.push("  0\nENDSEC");
  }
  let allPts = [...polyPts];
  for (const mzn of manzanos) allPts = allPts.concat(mzn.pts);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of allPts) {
    const u = toUTM(p);
    if (u.x < minX) minX = u.x;
    if (u.x > maxX) maxX = u.x;
    if (u.y < minY) minY = u.y;
    if (u.y > maxY) maxY = u.y;
  }
  if (!isFinite(minX)) {
    minX = 0;
    maxX = 1000;
    minY = 0;
    maxY = 1000;
  }

  sec("HEADER");
  L.push(
    "  9\n$ACADVER\n  1\nAC1009",
    "  9\n$INSUNITS\n 70\n6",
    `  9\n$EXTMIN\n 10\n${minX.toFixed(4)}\n 20\n${minY.toFixed(4)}`,
    `  9\n$EXTMAX\n 10\n${maxX.toFixed(4)}\n 20\n${maxY.toFixed(4)}`,
    `  9\n$LIMMIN\n 10\n${minX.toFixed(4)}\n 20\n${minY.toFixed(4)}`,
    `  9\n$LIMMAX\n 10\n${maxX.toFixed(4)}\n 20\n${maxY.toFixed(4)}`,
  );
  endsec();

  sec("TABLES");
  L.push("  0\nTABLE\n  2\nVPORT\n 70\n1");
  L.push(
    "  0\nVPORT\n  2\n*ACTIVE\n 70\n0\n 10\n0.0\n 20\n0.0\n 11\n1.0\n 21\n1.0\n 12\n0.0\n 22\n0.0\n 13\n0.0\n 23\n0.0\n 14\n1.0\n 24\n1.0\n 15\n0.0\n 25\n0.0\n 16\n0.0\n 26\n0.0\n 36\n1.0\n 17\n0.0\n 27\n0.0\n 37\n0.0\n 40\n1.0\n 41\n1.0\n 42\n50.0\n 43\n0.0\n 44\n0.0\n 50\n0.0\n 51\n0.0\n 71\n0\n 72\n1000\n 73\n1\n 74\n3\n 75\n0\n 76\n0\n 77\n0\n 78\n0",
  );
  L.push("  0\nENDTAB");
  L.push("  0\nTABLE\n  2\nLTYPE\n 70\n2");
  L.push(
    "  0\nLTYPE\n  2\nCONTINUOUS\n 70\n0\n  3\nSolid line\n 72\n65\n 73\n0\n 40\n0.0",
  );
  L.push(
    "  0\nLTYPE\n  2\nDASHED\n 70\n0\n  3\nDashed\n 72\n65\n 73\n2\n 40\n0.75\n 49\n0.5\n 49\n-0.25",
  );
  L.push("  0\nENDTAB");

  const layers = [
    { name: "0", color: 7, ltype: "CONTINUOUS" },
    { name: "MANZANOS", color: 5, ltype: "CONTINUOUS" },
    { name: "LOTES", color: 3, ltype: "CONTINUOUS" },
    { name: "LOTES-REM", color: 30, ltype: "CONTINUOUS" },
    { name: "CALLES", color: 1, ltype: "CONTINUOUS" },
    { name: "EJES-CALLE", color: 4, ltype: "DASHED" },
    { name: "VEREDAS", color: 6, ltype: "DASHED" },
    { name: "EJES-MZN", color: 2, ltype: "DASHED" },
    { name: "TEXTO", color: 7, ltype: "CONTINUOUS" },
  ];
  L.push("  0\nTABLE\n  2\nLAYER\n 70\n" + layers.length);
  for (const lay of layers) {
    L.push(
      `  0\nLAYER\n  2\n${lay.name}\n 70\n0\n 62\n${lay.color}\n  6\n${lay.ltype}`,
    );
  }
  L.push("  0\nENDTAB");
  L.push("  0\nTABLE\n  2\nSTYLE\n 70\n1");
  L.push(
    "  0\nSTYLE\n  2\nSTANDARD\n 70\n0\n 40\n0.0\n 41\n1.0\n 50\n0.0\n 71\n0\n 42\n0.2\n  3\ntxt\n  4\n",
  );
  L.push("  0\nENDTAB");
  endsec();

  sec("BLOCKS");
  endsec();
  sec("ENTITIES");

  function polyline(pts_utm, layer, closed) {
    const flag = closed ? 1 : 0;
    L.push(
      `  0\nPOLYLINE\n  8\n${layer}\n 66\n1\n 70\n${flag}\n 10\n0.0\n 20\n0.0`,
    );
    for (const p of pts_utm) {
      L.push(
        `  0\nVERTEX\n  8\n${layer}\n 10\n${p.x.toFixed(4)}\n 20\n${p.y.toFixed(4)}`,
      );
    }
    L.push("  0\nSEQEND\n  8\n" + layer);
  }

  function texto(x, y, h, txt, layer) {
    L.push(
      `  0\nTEXT\n  8\n${layer}\n 10\n${x.toFixed(4)}\n 20\n${y.toFixed(4)}\n 30\n0.0\n 40\n${h.toFixed(4)}\n  1\n${txt}\n 72\n1\n 11\n${x.toFixed(4)}\n 21\n${y.toFixed(4)}\n 31\n0.0`,
    );
  }

  function textoRot(x, y, h, txt, layer, angleDeg) {
    const ang = (angleDeg || 0).toFixed(4);
    L.push(
      `  0\nTEXT\n  8\n${layer}\n 10\n${x.toFixed(4)}\n 20\n${y.toFixed(4)}\n 30\n0.0\n 40\n${h.toFixed(4)}\n  1\n${txt}\n 50\n${ang}\n 72\n1\n 11\n${x.toFixed(4)}\n 21\n${y.toFixed(4)}\n 31\n0.0`,
    );
  }

  for (let i = 0; i < manzanos.length; i++) {
    const l = manzanos[i];
    polyline(
      l.pts.map((p) => toUTM(p)),
      "MANZANOS",
      true,
    );

    const cen = centroid(l.pts);
    const cenUTM = toUTM(cen);
    texto(cenUTM.x, cenUTM.y + 1.0, 1.0, `Mzo. ${i + 1}`, "TEXTO");
    texto(
      cenUTM.x,
      cenUTM.y - 0.3,
      0.6,
      `${polyAreaM2(l.pts).toFixed(1)} m2`,
      "TEXTO",
    );

    const swPts = buildSidewalkWorldPts(l.pts);
    if (swPts && swPts.length >= 3) {
      polyline(
        swPts.map((p) => toUTM(p)),
        "VEREDAS",
        true,
      );
    }

    if (mznSegments[i]) {
      const seg = mznSegments[i];
      polyline([toUTM(seg.p1), toUTM(seg.p2)], "EJES-MZN", false);
    }

    const unifiedExport = [];
    const subExp = lotSubdivisions.find((s) => s.mznIdx === i);
    if (subExp) subExp.lots.forEach((lt) => unifiedExport.push(lt));
    sliceLots
      .filter((sd) => sd.mznIdx === i)
      .forEach((sd) => sd.lots.forEach((lt) => unifiedExport.push(lt)));

    unifiedExport.forEach((lt, j) => {
      polyline(
        lt.pts.map((p) => toUTM(p)),
        lt.isRemnant ? "LOTES-REM" : "LOTES",
        true,
      );
      const lcen = centroid(lt.pts);
      const lcenUTM = toUTM(lcen);
      const la = lt.areaM2 !== undefined ? lt.areaM2 : polyAreaM2(lt.pts);

      let ltAngDeg = 0;
      {
        let maxLen = -1;
        const lp = lt.pts,
          ln = lp.length;
        for (let k = 0; k < ln; k++) {
          const a = lp[k],
            b = lp[(k + 1) % ln];
          const dl = Math.hypot(b.x - a.x, b.y - a.y);
          if (dl > maxLen) {
            maxLen = dl;
            ltAngDeg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
          }
        }
        if (ltAngDeg > 90) ltAngDeg -= 180;
        if (ltAngDeg < -90) ltAngDeg += 180;
      }

      const angRad = (ltAngDeg * Math.PI) / 180;
      const perpX = -Math.sin(angRad);
      const perpY = Math.cos(angRad);
      const offsetM = 0.6;
      textoRot(
        lcenUTM.x + perpX * offsetM,
        lcenUTM.y + perpY * offsetM,
        0.8,
        `L${j + 1}`,
        "TEXTO",
        ltAngDeg,
      );
      textoRot(
        lcenUTM.x - perpX * offsetM,
        lcenUTM.y - perpY * offsetM,
        0.5,
        `${la.toFixed(1)}m2`,
        "TEXTO",
        ltAngDeg,
      );
      const ltN = lt.pts.length;
      const ltCenW = centroid(lt.pts);
      for (let si = 0; si < ltN; si++) {
        const pA = lt.pts[si];
        const pB = lt.pts[(si + 1) % ltN];
        const dxW = pB.x - pA.x,
          dyW = pB.y - pA.y;
        const lenM = Math.sqrt(dxW * dxW + dyW * dyW) * MPP;
        if (lenM < 0.5) continue;
        const midW = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
        const segLen = Math.sqrt(dxW * dxW + dyW * dyW) || 1;
        const nxSeg = -dyW / segLen,
          nySeg = dxW / segLen;
        const dotIn = (ltCenW.x - midW.x) * nxSeg + (ltCenW.y - midW.y) * nySeg;
        const inX = dotIn >= 0 ? nxSeg : -nxSeg;
        const inY = dotIn >= 0 ? nySeg : -nySeg;
        const OFFSET_M = 0.8;
        const offsetW = {
          x: midW.x + inX * mw(OFFSET_M),
          y: midW.y + inY * mw(OFFSET_M),
        };
        const offsetUTM = toUTM(offsetW);
        const label =
          lenM >= 100 ? lenM.toFixed(1) + "m" : lenM.toFixed(2) + "m";
        const angDeg = (Math.atan2(-dyW, dxW) * 180) / Math.PI;
        textoRot(offsetUTM.x, offsetUTM.y, 0.4, label, "TEXTO", angDeg);
      }
    });
  }

  for (let i = 0; i < streets.length; i++) {
    const s = streets[i];
    const rect = streetRect(s);
    if (!rect) continue;
    const streetIdx = i + 1;
    polyline([toUTM(s.start), toUTM(s.end)], "EJES-CALLE", false);

    const midW = {
      x: (s.start.x + s.end.x) / 2,
      y: (s.start.y + s.end.y) / 2,
    };
    const midUTM = toUTM(midW);
    const sdx = s.end.x - s.start.x,
      sdy = s.end.y - s.start.y;
    let calleAngDeg = (Math.atan2(-sdy, sdx) * 180) / Math.PI;
    if (calleAngDeg > 90) calleAngDeg -= 180;
    if (calleAngDeg < -90) calleAngDeg += 180;
    textoRot(
      midUTM.x,
      midUTM.y,
      0.7,
      `Calle ${String.fromCharCode(64 + streetIdx)} (Ancho ${s.width.toFixed(2)}m)`,
      "TEXTO",
      calleAngDeg,
    );
    textoRot(midUTM.x, midUTM.y - 0.9, 0.5, "EJE DE VIA", "TEXTO", calleAngDeg);
  }

  endsec();
  L.push("  0\nEOF");
  const content = L.join("\n");
  const blob = new Blob([content], { type: "application/dxf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "urbanizacion.dxf";
  a.click();
}
//===================FIN EXPORTAR DXF=======================================================
