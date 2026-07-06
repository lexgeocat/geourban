//===================INICIO CALCULADORA========================================================
function toggleCalc() {
  const p = document.getElementById("calcPanel");
  p.style.display = p.style.display === "none" ? "block" : "none";
}

let _calcVal = "0"; // valor en pantalla
let _calcPrev = null; // operando previo
let _calcOp = null; // operador pendiente
let _calcNewNum = true; // ¿el próximo dígito inicia número nuevo?
let _calcExpr = ""; // texto de expresión (fila superior)

function _calcRefresh() {
  const disp = document.getElementById("calcDisplay");
  const raw = parseFloat(_calcVal);
  let txt = isFinite(raw) ? String(parseFloat(raw.toPrecision(10))) : _calcVal;
  disp.textContent = txt;
  document.getElementById("calcExpr").textContent = _calcExpr;
}

function calcNum(n) {
  if (_calcNewNum) {
    _calcVal = n === "0" ? "0" : n;
    _calcNewNum = false;
  } else {
    if (_calcVal === "0" && n === "0") return;
    if (_calcVal === "0" && n !== ".") {
      _calcVal = n;
    } else {
      if (_calcVal.length < 15) _calcVal += n;
    }
  }
  _calcRefresh();
}

function calcDot() {
  if (_calcNewNum) {
    _calcVal = "0.";
    _calcNewNum = false;
  } else if (!_calcVal.includes(".")) {
    _calcVal += ".";
  }
  _calcRefresh();
}

function calcOp(op) {
  const cur = parseFloat(_calcVal);
  if (_calcOp && !_calcNewNum) {
    const res = _calcApply(_calcPrev, cur, _calcOp);
    _calcVal = String(parseFloat(res.toPrecision(12)));
    _calcPrev = parseFloat(_calcVal);
  } else {
    _calcPrev = cur;
  }
  _calcOp = op;
  _calcNewNum = true;
  const opSymbol = { "+": "+", "-": "−", "*": "×", "/": "÷" }[op] || op;
  _calcExpr = `${parseFloat(_calcVal.replace(/\.0+$/, ""))} ${opSymbol}`;
  _calcRefresh();
}

function calcEq() {
  if (_calcOp === null) return;
  const cur = parseFloat(_calcVal);
  const opSymbol =
    { "+": "+", "-": "−", "*": "×", "/": "÷" }[_calcOp] || _calcOp;
  _calcExpr = `${_calcPrev} ${opSymbol} ${cur} =`;
  const res = _calcApply(_calcPrev, cur, _calcOp);
  _calcVal = isFinite(res) ? String(parseFloat(res.toPrecision(12))) : "Error";
  _calcOp = null;
  _calcPrev = null;
  _calcNewNum = true;
  _calcRefresh();
}

function _calcApply(a, b, op) {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b !== 0 ? a / b : NaN;
  }
  return b;
}

function calcFn(fn) {
  const cur = parseFloat(_calcVal);
  if (fn === "clear") {
    _calcVal = "0";
    _calcPrev = null;
    _calcOp = null;
    _calcNewNum = true;
    _calcExpr = "";
  } else if (fn === "sign") {
    _calcVal = String(-cur);
    _calcNewNum = false;
  } else if (fn === "pct") {
    _calcVal = String(cur / 100);
    _calcNewNum = false;
  }
  _calcRefresh();
}

document.addEventListener("keydown", function (e) {
  // Devolver foco al canvas si el activeElement es el body o el canvas mismo
  // (garantiza que tras clicks en el mapa los atajos siempre respondan)
  const _actTag = document.activeElement ? document.activeElement.tagName : "";
  const _inField =
    _actTag === "INPUT" || _actTag === "SELECT" || _actTag === "TEXTAREA";
  // ── Ctrl+Z: Deshacer ──
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
    if (!_inField) {
      e.preventDefault();
      undoAction();
      return;
    }
  }

  if (e.key === "Enter") {
    const tag = _actTag;
    if (!_inField) {
      if (mode === "polygon" && !polyClosed && polyPts.length >= 3) {
        e.preventDefault();
        closePolygon();
        return;
      }
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "c") {
    const tag = _actTag;
    if (!_inField) {
      if (selStreetId) {
        const s = streets.find((s) => s.id === selStreetId);
        if (s) {
          window._copiedStreet = JSON.parse(JSON.stringify(s));
          document.getElementById("hintLabel").textContent =
            "✓ Calle copiada";
          setTimeout(() => {
            document.getElementById("hintLabel").textContent = "";
          }, 1500);
          e.preventDefault();
        }
      }
      return;
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "v") {
    const tag = _actTag;
    if (!_inField) {
      if (window._copiedStreet && polyClosed) {
        _snapshot();
        const src = window._copiedStreet;
        const OFFSET = mw(5); // 5 metros de desplazamiento
        const newStreet = {
          id: ++streetIdCtr,
          start: { x: src.start.x + OFFSET, y: src.start.y + OFFSET },
          end: { x: src.end.x + OFFSET, y: src.end.y + OFFSET },
          width: src.width,
        };
        streets.push(newStreet);
        selStreetId = newStreet.id;
        recomputeManzanos();
        updateSidebar();
        fillPanel(newStreet);
        setMode("edit");
        document.getElementById("hintLabel").textContent =
          "✓ Calle pegada (+5m desplazada)";
        setTimeout(() => {
          document.getElementById("hintLabel").textContent = "";
        }, 2000);
        render();
        e.preventDefault();
      } else if (!polyClosed) {
        document.getElementById("hintLabel").textContent =
          "Cerrá la parcela antes de pegar calles.";
        setTimeout(() => {
          document.getElementById("hintLabel").textContent = "";
        }, 2000);
      }
      return;
    }
  }

  if (e.key === "Delete" || e.key === "Supr") {
    const tag = _actTag;
    if (!_inField) {
      if (selStreetId) {
        if (confirm("¿Eliminar esta calle?")) {
          _snapshot();
          streets = streets.filter((s) => s.id !== selStreetId);
          selStreetId = null;
          closePanel();
          recomputeManzanos();
          updateSidebar();
          render();
        }
        e.preventDefault();
      }
    }
  }

  if (e.key === "Escape") {
    const tag = _actTag;
    if (!_inField) {
      if (mode === "street" && streetStart) {
        streetStart = null;
        document.getElementById("hintLabel").textContent = "";
        render();
        e.preventDefault();
      } else if (mode === "polygon" && !polyClosed && polyPts.length > 0) {
        polyPts = [];
        document.getElementById("btnClose").style.display = "none";
        document.getElementById("hintLabel").textContent = "";
        render();
        e.preventDefault();
      } else if (pickingSegForMzn >= 0) {
        cancelPickSegment();
        e.preventDefault();
      } else if (mode === "edit" && selStreetId) {
        selStreetId = null;
        closePanel();
        updateSidebar();
        render();
        e.preventDefault();
      } else if (mode === "slice" && sliceSubPhase !== "none") {
        sliceCancelFrente();
        e.preventDefault();
      } else {
        mode = "none";
        streetStart = null;
        selStreetId = null;
        dragHandle = null;
        canvas.style.cursor = "default";
        ["btnPolygon", "btnStreet", "btnEdit", "btnSlice"].forEach((id) =>
          document.getElementById(id).classList.remove("active"),
        );
        document.getElementById("modeLabel").textContent = "MODO: MOUSE";
        document.getElementById("hintLabel").textContent = "";
        render();
        e.preventDefault();
      }
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "p") {
    const tag = _actTag;
    if (!_inField) {
      e.preventDefault();
      printPlan();
    }
  }

  const panel = document.getElementById("calcPanel");
  if (!panel || panel.style.display === "none") return;
  const tag = document.activeElement ? document.activeElement.tagName : "";
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  let handled = true;
  switch (e.key) {
    case "0":
    case "Insert":
      calcNum("0");
      break;
    case "1":
    case "End":
      calcNum("1");
      break;
    case "2":
    case "ArrowDown":
      calcNum("2");
      break;
    case "3":
    case "PageDown":
      calcNum("3");
      break;
    case "4":
    case "ArrowLeft":
      calcNum("4");
      break;
    case "5":
    case "Clear":
      calcNum("5");
      break;
    case "6":
    case "ArrowRight":
      calcNum("6");
      break;
    case "7":
    case "Home":
      calcNum("7");
      break;
    case "8":
    case "ArrowUp":
      calcNum("8");
      break;
    case "9":
    case "PageUp":
      calcNum("9");
      break;
    case ".":
    case ",":
    case "Decimal":
      calcDot();
      break;
    case "+":
    case "Add":
      calcOp("+");
      break;
    case "-":
    case "Subtract":
      calcOp("-");
      break;
    case "*":
    case "Multiply":
      calcOp("*");
      break;
    case "/":
    case "Divide":
      calcOp("/");
      break;
    case "Enter":
    case "=":
      calcEq();
      break;
    case "Backspace":
      if (_calcVal.length > 1) {
        _calcVal = _calcVal.slice(0, -1);
        if (_calcVal === "-") _calcVal = "0";
      } else {
        _calcVal = "0";
      }
      _calcNewNum = false;
      _calcRefresh();
      break;
    case "Escape":
    case "Delete":
      calcFn("clear");
      break;
    default:
      handled = false;
  }

  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
});

(function () {
  let dragging = false,
    ox = 0,
    oy = 0;
  document.addEventListener("DOMContentLoaded", () => {
    const sel = document.getElementById("langSel");
    if (sel) sel.value = _lang;
    applyLang();
  });
  document.addEventListener("mousedown", function (e) {
    const hdr = document.getElementById("calcHeader");
    if (!hdr || !hdr.contains(e.target)) return;
    dragging = true;
    const panel = document.getElementById("calcPanel");
    const rect = panel.getBoundingClientRect();
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    e.preventDefault();
  });
  document.addEventListener("mousemove", function (e) {
    if (!dragging) return;
    const panel = document.getElementById("calcPanel");
    panel.style.left = e.clientX - ox + "px";
    panel.style.top = e.clientY - oy + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });
  document.addEventListener("mouseup", function () {
    dragging = false;
  });
})();
//===================FIN CALCULADORA===========================================================
