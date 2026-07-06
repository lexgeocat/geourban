//===================INICIO IMAGEN SATELITAL===================================================
function toggleSatellite(on) {
  _satVisible = on;
  const mapDiv = document.getElementById("satelliteMap");

  if (on) {
    mapDiv.style.display = "block";
    mapDiv.style.pointerEvents = "none";
    canvas.style.background = "transparent";
    canvas.style.pointerEvents = "auto";
    if (!_satMap) _initSatMap();
    if (_geoOrigin) {
      setTimeout(() => {
        _satMap.invalidateSize();
        _alignLeafletToCanvas();
      }, 80);
    }

    const gridChk = document.getElementById("gridChk");
    if (gridChk) {
      gridChk.checked = false;
      showGrid = false;
    }
  } else {
    mapDiv.style.display = "none";
    mapDiv.style.pointerEvents = "none";
    canvas.style.background = "";
    canvas.style.pointerEvents = "auto";
    const gridChk = document.getElementById("gridChk");
    if (gridChk) {
      gridChk.checked = true;
      showGrid = true;
    }
  }

  render();
}

function _initSatMap() {
  const mapDiv = document.getElementById("satelliteMap");
  mapDiv.style.pointerEvents = "none";
  _satMap = L.map("satelliteMap", {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
    boxZoom: false,
    keyboard: false,
    fadeAnimation: false,
    zoomAnimation: false,
    markerZoomAnimation: false,
  });

  const googleLayer = L.tileLayer(
    "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    {
      subdomains: ["0", "1", "2", "3"],
      attribution: "",
      maxZoom: 21,
      maxNativeZoom: 21,
      updateWhenIdle: false,
      updateWhenZooming: false,
      keepBuffer: 6,
    },
  ).addTo(_satMap);
  googleLayer.on("tileerror", function (e) {
    const tile = e.tile;
    if (tile && !tile._fallbackApplied) {
      tile._fallbackApplied = true;
      const c = e.coords;
      if (c) {
        tile.src =
          "https://server.arcgisonline.com/ArcGIS/rest/services/" +
          "World_Imagery/MapServer/tile/" +
          c.z +
          "/" +
          c.y +
          "/" +
          c.x;
      }
    }
  });
}

let _alignPending = false;
function _alignLeafletToCanvas() {
  if (!_satMap || !_geoOrigin) return;
  if (_alignPending) return;
  _alignPending = true;

  const W = canvas.width,
    H = canvas.height;
  const worldCX = (W / 2 - pan.x) / zoom;
  const worldCY = (H / 2 - pan.y) / zoom;
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

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      _readLeafletAndUpdateCanvas();
      _alignPending = false;
    });
  });
}

function _readLeafletAndUpdateCanvas() {
  if (!_satMap || !_geoOrigin) return;
  const pxA = _satMap.latLngToContainerPoint([_geoOrigin.lat, _geoOrigin.lng]);
  const refLL = _worldToLatLng(1000, 0);
  const pxB = _satMap.latLngToContainerPoint([refLL.lat, refLL.lng]);
  const leafletPPU = Math.hypot(pxB.x - pxA.x, pxB.y - pxA.y) / 1000;
  if (leafletPPU < 1e-10) return;
  zoom = leafletPPU;
  pan.x = pxA.x;
  pan.y = pxA.y;
  document.getElementById("satelliteMap").style.transform = "";
  render();
}

function _worldToLatLng(wx, wy) {
  const mX = wx * MPP;
  const mY = -wy * MPP;
  return _utmToLatLng(
    _geoOrigin.utmX + mX,
    _geoOrigin.utmY + mY,
    _geoOrigin.zone,
    _geoOrigin.hemi,
  );
}

function _utmToLatLng(x, y, zone, hemi) {
  const proj =
    hemi === "south"
      ? `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`
      : `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
  const wgs84 = "+proj=longlat +datum=WGS84 +no_defs";
  const res = proj4(proj, wgs84, [x, y]);
  return { lat: res[1], lng: res[0] };
}

render();
function _latLngToUtm(lat, lng) {
  const zone = Math.floor((lng + 180) / 6) + 1;
  const hemi = lat >= 0 ? "north" : "south";
  const proj =
    hemi === "south"
      ? `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`
      : `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
  const wgs84 = "+proj=longlat +datum=WGS84 +no_defs";
  const res = proj4(wgs84, proj, [lng, lat]);
  return { x: res[0], y: res[1], zone, hemi };
}

function _mppToLeafletZoom(lat, mpp) {
  return Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / mpp);
}

(function _autoLocate() {
  if (polyPts.length > 0 || polyClosed) return;
  const LOCATION_KEY = "lsai_last_location_v1";
  function applyLocation(lat, lng) {
    const utmPt = _latLngToUtm(lat, lng);
    _geoOrigin = {
      utmX: utmPt.x,
      utmY: utmPt.y,
      zone: utmPt.zone,
      hemi: utmPt.hemi,
      lat: lat,
      lng: lng,
    };
    pan.x = canvas.width / 2;
    pan.y = canvas.height / 2;
    zoom = 2;
    render();
  }

  try {
    const stored = localStorage.getItem(LOCATION_KEY);
    if (stored) {
      const loc = JSON.parse(stored);
      if (loc && loc.lat && loc.lng) {
        applyLocation(loc.lat, loc.lng);
        // Mostrar mensaje discreto
        document.getElementById("hintLabel").textContent =
          `✓ Ubicación previa cargada · Zona UTM ${_geoOrigin.zone}${_geoOrigin.hemi === "south" ? "S" : "N"}`;
        setTimeout(() => {
          document.getElementById("hintLabel").textContent = "";
        }, 3000);
      }
    }
  } catch (e) {}
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      if (polyPts.length > 0 || polyClosed) return;
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      try {
        localStorage.setItem(LOCATION_KEY, JSON.stringify({ lat, lng }));
      } catch (e) {}
      applyLocation(lat, lng);
      document.getElementById("hintLabel").textContent =
        `✓ Ubicación actualizada · Zona UTM ${_geoOrigin.zone}${_geoOrigin.hemi === "south" ? "S" : "N"}`;
      setTimeout(() => {
        document.getElementById("hintLabel").textContent = "";
      }, 3000);
    },
    function () {
      /* silencioso si niega el permiso */
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
  );
})();

//===================  FIN  IMAGEN SATELITAL===================================================
