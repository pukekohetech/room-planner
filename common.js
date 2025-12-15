// ==========================================================
// COMMON: DOM lookups, constants, shared state & helpers
// (edited: robust restore/save, stable IDs, safer clearing,
// student name input, and autosave on rename)
// ==========================================================

/** Remember last configuration in this browser */
const STORAGE_KEY = "floorplanConfig_v11";

// ==========================================================
// DOM LOOKUPS (use let so we can re-bind if scripts run early)
// ==========================================================

let svg = document.getElementById("floorplan");
let lockSizes = false;


// Toolbar buttons
const toggleJoinBtn     = document.getElementById("toggleJoinBtn");

const addRectBtn        = document.getElementById("addRectBtn");
const addDoorBtn        = document.getElementById("addDoorBtn");
const addWindowBtn      = document.getElementById("addWindowBtn");
const downloadSheetsBtn = document.getElementById("downloadSheetsBtn");

// NEW: student name input (optional)
const studentNameInput  = document.getElementById("studentNameInput");

// Room editor
const sizeEditor    = document.getElementById("sizeEditor");
const roomNameInput = document.getElementById("roomNameInput");
const widthInput    = document.getElementById("widthInput");
const heightInput   = document.getElementById("heightInput");
const applySizeBtn  = document.getElementById("applySizeBtn");
const cancelSizeBtn = document.getElementById("cancelSizeBtn");
const deleteRoomBtn = document.getElementById("deleteRoomBtn");

// Feature editor
const featureInfo        = document.getElementById("featureInfo");
const featureTypeLabel   = document.getElementById("featureTypeLabel");
const featureWidthInput  = document.getElementById("featureWidthInput");
const featureOffsetInput = document.getElementById("featureOffsetInput");
const featureHeadInput   = document.getElementById("featureHeadInput");
const deleteFeatureBtn   = document.getElementById("deleteFeatureBtn");

// Walls view
const wallsSvg               = document.getElementById("wallsSvg");
const wallHeightInput        = document.getElementById("wallHeightInput");
const materialThicknessInput = document.getElementById("materialThicknessInput");

// ==========================================================
// CONSTANTS
// ==========================================================

const SCALE_M_PER_PX = 0.2 / 3;
const SNAP_DISTANCE  = 20;
const LASER_WIDTH    = 730;
const LASER_HEIGHT   = 420;

const DOOR_HEIGHT_M           = 2.0;
const WINDOW_HEAD_DEFAULT_M   = 2.0;
const WINDOW_HEIGHT_DEFAULT_M = 1.0;

const ENABLE_FINGER_JOINTS = true;

// ==========================================================
// STATE
// ==========================================================

let wallHeightM = parseFloat(wallHeightInput?.value) || 2.4;

let joinedMode     = false;
let draggingRoom   = null;
let dragMode       = null;
let startPointer   = null;
let startRect      = null;
let startPositions = [];

let nextRoomId    = 1;
let nextFeatureId = 1;

let currentTool   = "select"; // "select" | "addDoor" | "addWindow"
let editingRoomId = null;

let selectedFeature    = null;
let featureHandleStart = null;
let featureHandleEnd   = null;

let pt = null;

let wallVisibility  = new Map(); // wallKey => bool
let floorVisibility = new Map(); // roomId  => bool

let currentStudentName = ""; // set from UI input

// Prevent autosave from overwriting storage while we clear/rebuild
let _isRestoring = false;

// ==========================================================
// INIT BINDING (safe if scripts load before SVG exists)
// ==========================================================

function ensureSvgBound() {
  if (!svg) svg = document.getElementById("floorplan");
  if (svg && !pt && svg.createSVGPoint) pt = svg.createSVGPoint();
  return !!svg;
}

// ==========================================================
// ID HELPERS (stop runaway IDs / handle non-numeric ids)
// ==========================================================

function extractTrailingInt(value) {
  // supports "12", "room12", "room-12", "feature_12"
  const s = String(value || "");
  const m = s.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : NaN;
}

// ==========================================================
// STORAGE (SAVE / LOAD)
// ==========================================================

function serializeFloorplan() {
  if (!ensureSvgBound()) {
    return {
      version: 1,
      meta: { savedAt: new Date().toISOString(), studentName: currentStudentName || "" },
      counters: { nextRoomId, nextFeatureId },
      ui: { joinedMode, currentTool, lockSizes },
      visibility: {
        wallVis: Object.fromEntries(wallVisibility.entries()),
        floorVis: Object.fromEntries(floorVisibility.entries())
      },
      rooms: [],
      features: []
    };
  }

  const rooms = [];
  const features = [];

  // Rooms = rect[data-room] that are NOT features
  svg.querySelectorAll(`rect[data-room]:not([data-feature])`).forEach(rect => {
    const x = parseFloat(rect.getAttribute("x"));
    const y = parseFloat(rect.getAttribute("y"));
    const w = parseFloat(rect.getAttribute("width"));
    const h = parseFloat(rect.getAttribute("height"));

    rooms.push({
      roomId: rect.dataset.room,
      roomName: rect.dataset.roomName || "",
      x: isFinite(x) ? x : 0,
      y: isFinite(y) ? y : 0,
      width:  isFinite(w) ? w : 0,
      height: isFinite(h) ? h : 0
    });
  });

  // Features = rect[data-feature] (door/window)
  svg.querySelectorAll(`rect[data-feature]`).forEach(rect => {
    const x = parseFloat(rect.getAttribute("x"));
    const y = parseFloat(rect.getAttribute("y"));
    const w = parseFloat(rect.getAttribute("width"));
    const h = parseFloat(rect.getAttribute("height"));

    const f = {
      featureId: rect.dataset.featureId || rect.dataset.id || null,
      room: rect.dataset.room || null,
      feature: rect.dataset.feature || "", // "door" | "window"
      x: isFinite(x) ? x : 0,
      y: isFinite(y) ? y : 0,
      width:  isFinite(w) ? w : 0,
      height: isFinite(h) ? h : 0,
      data: {}
    };

    // Dataset keys used by walls generator
    const keysToCopy = ["side", "wallOffsetPx", "lengthPx", "windowHeadM"];
    for (const k of keysToCopy) {
      if (rect.dataset[k] != null) f.data[k] = rect.dataset[k];
    }

    features.push(f);
  });

  return {
    version: 1,
    meta: {
      savedAt: new Date().toISOString(),
      studentName: currentStudentName || ""
    },
    counters: {
      // stored but recomputed on restore (authoritative)
      nextRoomId,
      nextFeatureId
    },
    ui: {
      joinedMode,
      currentTool
    },
    visibility: {
      wallVis: Object.fromEntries(wallVisibility.entries()),
      floorVis: Object.fromEntries(floorVisibility.entries())
    },
    rooms,
    features
  };
}

function saveFloorplanToLocalStorage() {
  if (_isRestoring) return;
  try {
    const payload = serializeFloorplan();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("saveFloorplanToLocalStorage failed", e);
  }
}

function clearFloorplanSvg() {
  if (!ensureSvgBound()) return;

  // Remove rooms + features
  svg.querySelectorAll(`rect[data-feature], rect[data-room]`).forEach(n => n.remove());

  // SAFER: only remove plan-side labels if you mark them.
  // (Avoid deleting any random <text> you might add later.)
  svg.querySelectorAll(`
    text.room-label,
    text.feature-label,
    [data-room-label],
    [data-feature-label]
  `).forEach(n => n.remove());
}

/** Ensure nextRoomId/nextFeatureId are consistent with what exists */
function recomputeNextIdsFromSvg() {
  if (!ensureSvgBound()) return;

  let maxRoom = 0;
  svg.querySelectorAll('rect[data-room]:not([data-feature])').forEach(r => {
    const n = extractTrailingInt(r.dataset.room);
    if (Number.isFinite(n)) maxRoom = Math.max(maxRoom, n);
  });
  nextRoomId = maxRoom + 1;

  let maxFeat = 0;
  svg.querySelectorAll('rect[data-feature]').forEach(f => {
    const n = extractTrailingInt(f.dataset.featureId || f.dataset.id);
    if (Number.isFinite(n)) maxFeat = Math.max(maxFeat, n);
  });
  nextFeatureId = maxFeat + 1;
}

function restoreFloorplanFromPayload(payload) {
  if (!ensureSvgBound()) return;
  if (!payload || payload.version !== 1) return;

  _isRestoring = true;
  try {
    clearFloorplanSvg();

    // Restore UI
if (payload.ui) {
  joinedMode  = !!payload.ui.joinedMode;
  currentTool = payload.ui.currentTool || currentTool;
  lockSizes   = !!payload.ui.lockSizes;
}

    // Student name
    if (typeof payload.meta?.studentName === "string") {
      currentStudentName = payload.meta.studentName.trim();
    }

    // Visibility maps (optional, used by walls view)
    if (payload.visibility) {
      wallVisibility  = new Map(Object.entries(payload.visibility.wallVis || {}));
      floorVisibility = new Map(Object.entries(payload.visibility.floorVis || {}));
    }

    // Recreate rooms (skip invalid sizes to avoid NaN junk)
for (const r of payload.rooms || []) {
  const x = +r.x, y = +r.y, w = +r.width, h = +r.height;
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) continue;

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", isFinite(x) ? x : 0);
  rect.setAttribute("y", isFinite(y) ? y : 0);
  rect.setAttribute("width",  w);
  rect.setAttribute("height", h);

  // ✅ IMPORTANT: match createRoom() styling so it doesn't turn black
  rect.setAttribute("fill", "rgba(0,0,0,0)");
  rect.setAttribute("stroke", "black");
  rect.setAttribute("stroke-width", "3");
  rect.setAttribute("pointer-events", "bounding-box");

  rect.dataset.room = String(r.roomId);
  rect.dataset.roomName = String(r.roomName || "");

  svg.appendChild(rect);

  // If you have these, call them here:
  // ensureRoomLabel(rect);
  // attachRoomRectEvents(rect);
}

    // Recreate features (doors/windows)
// Recreate features (doors/windows)
for (const f of payload.features || []) {
  const x = +f.x, y = +f.y, w = +f.width, h = +f.height;
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) continue;

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", isFinite(x) ? x : 0);
  rect.setAttribute("y", isFinite(y) ? y : 0);
  rect.setAttribute("width",  w);
  rect.setAttribute("height", h);

  rect.dataset.feature = String(f.feature || "");
  if (f.room != null) rect.dataset.room = String(f.room);
  if (f.featureId != null) rect.dataset.featureId = String(f.featureId);

  if (f.data) {
    for (const [k, v] of Object.entries(f.data)) rect.dataset[k] = String(v);
  }

  // ✅ IMPORTANT: match createFeatureOnRoom() styling so it doesn't go black
  rect.setAttribute("pointer-events", "visiblePainted");
  rect.style.cursor = "pointer";
  rect.setAttribute(
    "fill",
    rect.dataset.feature === "door" ? "#c08040" : "#80c0ff"
  );

  svg.appendChild(rect);

  // If you attach handlers normally:
  // attachFeatureEvents(rect);
}

  } finally {
    _isRestoring = false;
  }

  // Authoritative counters based on actual SVG contents
  recomputeNextIdsFromSvg();

  // Update student name UI if present
  if (studentNameInput) studentNameInput.value = currentStudentName || "";

  // Rebuild derived view after restore
  if (typeof rebuildWallsView === "function") rebuildWallsView();
}

function loadFloorplanFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    restoreFloorplanFromPayload(payload);
    return true;
  } catch (e) {
    console.warn("loadFloorplanFromLocalStorage failed", e);
    return false;
  }
}

// ==========================================================
// HELPERS USED ACROSS FILES
// ==========================================================

function resetRoomPlannerStorage() {
  // 1) Clear known keys (edit these to match your real keys if different)
  const knownKeys = [
    "floorplanState",
    "floorplan",
    "rooms",
    "roomPlannerState",
    "wallVisibility",
    "floorVisibility",
    "studentName",
    "joinedMode",
    "lockSizes"
  ];

  knownKeys.forEach(k => localStorage.removeItem(k));

  // 2) Also clear any keys that look like they belong to this app
  // (helps if you renamed keys during development)
  const prefixHints = ["room", "floor", "plan", "wall", "laser", "pukekohe"];
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key) continue;
    const low = key.toLowerCase();
    if (prefixHints.some(h => low.includes(h))) {
      localStorage.removeItem(key);
    }
  }
}


function setStudentName(name) {
  currentStudentName = String(name || "").trim();
  requestAutoSave("student name");
  if (typeof rebuildWallsView === "function") rebuildWallsView();
}

function bindStudentNameInputOnce() {
  if (!studentNameInput) return;
  studentNameInput.value = currentStudentName || "";
  studentNameInput.addEventListener("input", () => {
    setStudentName(studentNameInput.value);
  });
}

function getMaterialThicknessMm() {
  let t = parseFloat(materialThicknessInput?.value);
  if (!isFinite(t) || t < 0) t = 0;
  return t;
}

function getPointerPosition(evt) {
  if (!ensureSvgBound() || !pt) return { x: 0, y: 0 };
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function formatSizeLabel(wPx, hPx) {
  if (!isFinite(wPx) || !isFinite(hPx)) return "";
  const wM = wPx * SCALE_M_PER_PX;
  const hM = hPx * SCALE_M_PER_PX;
  if (!isFinite(wM) || !isFinite(hM)) return "";
  return `${wM.toFixed(2)}m × ${hM.toFixed(2)}m`;
}

function getRoomForFeature(feature) {
  if (!ensureSvgBound()) return null;
  const roomId = feature?.dataset?.room;
  if (!roomId) return null;
  return svg.querySelector(`rect[data-room="${roomId}"]:not([data-feature])`);
}

function getFeatureThickness(feature) {
  return feature?.dataset?.feature === "door" ? 6 : 4;
}

function getRoomDisplayName(roomId) {
  if (!ensureSvgBound()) return `Room ${roomId}`;
  const rect = svg.querySelector(`rect[data-room="${roomId}"]:not([data-feature])`);
  if (!rect) return `Room ${roomId}`;
  return rect.dataset.roomName || `Room ${roomId}`;
}

/**
 * Avoid double-trigger: use pointerup only (covers touch + mouse).
 * (Do not stack click + pointerup + touchend.)
 */
function attachRoomLabelEvents(textElement, roomId) {
  const openEditor = (e) => {
    if (typeof openSizeEditorForRoom === "function") {
      openSizeEditorForRoom(roomId);
    }
    e.stopPropagation();
    e.preventDefault?.();
  };

  textElement.addEventListener("pointerup", openEditor);
}

// ==========================================================
// AUTOSAVE (DEBOUNCED)
// ==========================================================

let _saveTimer = null;

function requestAutoSave(reason = "change") {
  if (_isRestoring) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveFloorplanToLocalStorage();
  }, 150);
}

// ==========================================================
// AUTOSAVE OBSERVER (WATCH SVG MUTATIONS)
// Install ONLY after initial load/restore.
// ==========================================================

let _autosaveObserver = null;

function installFeatureAutoSaveObserver() {
  if (!ensureSvgBound()) return;

  // Prevent double observers
  if (_autosaveObserver) {
    try { _autosaveObserver.disconnect(); } catch {}
    _autosaveObserver = null;
  }

  const obs = new MutationObserver((mutations) => {
    if (_isRestoring) return;

    for (const m of mutations) {
      if (m.type === "childList") {
        const added = Array.from(m.addedNodes || []);
        const removed = Array.from(m.removedNodes || []);
        const touched = [...added, ...removed].some(n =>
          n && n.nodeType === 1 && (
            n.matches?.("rect[data-feature]") ||
            n.matches?.("rect[data-room]") ||
            n.querySelector?.("rect[data-feature]") ||
            n.querySelector?.("rect[data-room]")
          )
        );
        if (touched) {
          requestAutoSave("svg add/remove");
          return;
        }
      }

      if (m.type === "attributes") {
        const el = m.target;
        if (el && el.nodeType === 1 && el.matches?.("rect[data-feature], rect[data-room]")) {
          requestAutoSave(`attr:${m.attributeName}`);
          return;
        }
      }
    }
  });

  obs.observe(svg, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "x", "y", "width", "height",
      "data-wallOffsetPx", "data-lengthPx",
      "data-windowHeadM", "data-side",
      "data-room", "data-feature",
      // IMPORTANT: this is what makes renames autosave:
      "data-roomName",
      "data-featureId"
    ]
  });

  _autosaveObserver = obs;
}

// ==========================================================
// OPTIONAL INIT (call this from ONE place only)
// ==========================================================

function initCommon() {
  ensureSvgBound();
  const loaded = loadFloorplanFromLocalStorage();
  bindStudentNameInputOnce();
  installFeatureAutoSaveObserver();
  if (typeof rebuildWallsView === "function") rebuildWallsView();
  return loaded;
}