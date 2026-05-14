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
const addPolygonRoomBtn = document.getElementById("addPolygonRoomBtn");
const polygonSidesInput = document.getElementById("polygonSidesInput");
const addWallPointBtn = document.getElementById("addWallPointBtn");
const importBackgroundBtn = document.getElementById("importBackgroundBtn");
const backgroundImageInput = document.getElementById("backgroundImageInput");
const pasteBackgroundBtn = document.getElementById("pasteBackgroundBtn");
const editBackgroundChk = document.getElementById("editBackgroundChk");
const backgroundOpacityInput = document.getElementById("backgroundOpacityInput");
const clearBackgroundBtn = document.getElementById("clearBackgroundBtn");
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
const polygonEditor = document.getElementById("polygonEditor");
const roomPolygonSidesInput = document.getElementById("roomPolygonSidesInput");
const insertWallPointBtn = document.getElementById("insertWallPointBtn");
const deletePolygonPointBtn = document.getElementById("deletePolygonPointBtn");
const cornerCutEditor = document.getElementById("cornerCutEditor");
const cornerCutTlInput = document.getElementById("cornerCutTlInput");
const cornerCutTrInput = document.getElementById("cornerCutTrInput");
const cornerCutBrInput = document.getElementById("cornerCutBrInput");
const cornerCutBlInput = document.getElementById("cornerCutBlInput");
const roomRotationInput = document.getElementById("roomRotationInput");
const combineFloorsChk = document.getElementById("combineFloorsChk");
const showDeletedWallsChk = document.getElementById("showDeletedWallsChk");
const restoreDeletedWallsBtn = document.getElementById("restoreDeletedWallsBtn");
const applySizeBtn  = document.getElementById("applySizeBtn");
const cancelSizeBtn = document.getElementById("cancelSizeBtn");
const deleteRoomBtn = document.getElementById("deleteRoomBtn");

// Feature editor
const featureInfo        = document.getElementById("featureInfo");
const featureTypeLabel   = document.getElementById("featureTypeLabel");
const featureWidthInput  = document.getElementById("featureWidthInput");
const featureOffsetInput = document.getElementById("featureOffsetInput");
const featureHeadInput   = document.getElementById("featureHeadInput"); // legacy hidden top/head field
const featureStartHeightInput = document.getElementById("featureStartHeightInput");
const featureEndHeightInput   = document.getElementById("featureEndHeightInput");
const featureDoorHeightInput  = document.getElementById("featureDoorHeightInput");
const windowHeightFields      = document.getElementById("windowHeightFields");
const doorHeightFields        = document.getElementById("doorHeightFields");
const deleteFeatureBtn   = document.getElementById("deleteFeatureBtn");

// Walls view
const wallsSvg               = document.getElementById("wallsSvg");
const wallHeightInput        = document.getElementById("wallHeightInput");
const materialThicknessInput = document.getElementById("materialThicknessInput");
const laserScaleInput        = document.getElementById("laserScaleInput");
const laserBedWidthInput     = document.getElementById("laserBedWidthInput");
const laserBedHeightInput    = document.getElementById("laserBedHeightInput");

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

// A room can now be a regular rectangle or a polygon (angled / triangular room).
const ROOM_ELEMENT_SELECTOR = 'rect[data-room]:not([data-feature]), polygon[data-room]:not([data-feature])';

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

let currentTool   = "select"; // "select" | "addDoor" | "addWindow" | "addWallPoint"
let editingRoomId = null;

let selectedFeature    = null;
let featureHandleStart = null;
let featureHandleEnd   = null;

let pt = null;

let wallVisibility  = new Map(); // wallKey => bool
let floorVisibility = new Map(); // roomId  => bool
let combineFloors = false; // laser floor option: one attached/combined floor outline
let laserScaleDenominator = 50; // laser output scale: real size divided by this number
let laserBedWidthMm = LASER_WIDTH; // editable laser bed width, default 730mm
let laserBedHeightMm = LASER_HEIGHT; // editable laser bed height, default 420mm
let showDeletedWalls = false; // show faded/deleted wall placeholders in the laser view
let backgroundImageState = null; // optional tracing image under the plan: { href, x, y, width, height, opacity }
let backgroundEditMode = false; // when true, background image can be moved/resized

let currentStudentName = ""; // set from UI input

// Prevent autosave from overwriting storage while we clear/rebuild
let _isRestoring = false;

// ==========================================================
// UNDO / REDO HISTORY
// ==========================================================

const HISTORY_LIMIT = 80;
let _historyStack = [];
let _historyIndex = -1;
let _historyTimer = null;
let _isHistoryRestoring = false;

function getFloorplanHistorySnapshot() {
  try {
    return JSON.stringify(serializeFloorplan());
  } catch (e) {
    console.warn("getFloorplanHistorySnapshot failed", e);
    return null;
  }
}

function pushFloorplanHistory(reason = "change") {
  if (_isRestoring || _isHistoryRestoring) return false;

  const snapshot = getFloorplanHistorySnapshot();
  if (!snapshot) return false;

  if (_historyIndex >= 0 && _historyStack[_historyIndex] === snapshot) return false;

  if (_historyIndex < _historyStack.length - 1) {
    _historyStack = _historyStack.slice(0, _historyIndex + 1);
  }

  _historyStack.push(snapshot);
  if (_historyStack.length > HISTORY_LIMIT) {
    _historyStack.shift();
  }
  _historyIndex = _historyStack.length - 1;
  return true;
}

function scheduleFloorplanHistory(reason = "change") {
  if (_isRestoring || _isHistoryRestoring) return;
  if (_historyTimer) clearTimeout(_historyTimer);
  _historyTimer = setTimeout(() => {
    _historyTimer = null;
    pushFloorplanHistory(reason);
  }, 250);
}

function initFloorplanHistory() {
  if (_historyTimer) {
    clearTimeout(_historyTimer);
    _historyTimer = null;
  }
  _historyStack = [];
  _historyIndex = -1;
  pushFloorplanHistory("initial");
}

function restoreFloorplanHistorySnapshot(snapshot) {
  if (!snapshot) return false;

  let payload;
  try {
    payload = JSON.parse(snapshot);
  } catch (e) {
    console.warn("restoreFloorplanHistorySnapshot failed", e);
    return false;
  }

  _isHistoryRestoring = true;
  try {
    restoreFloorplanFromPayload(payload);
    saveFloorplanToLocalStorage();

    // Rebind plan-side labels/events after a restore from history.
    if (typeof rebuildPlanLabelsAndBindings === "function") rebuildPlanLabelsAndBindings();
    if (typeof syncBackgroundDom === "function") syncBackgroundDom();
    if (typeof syncCombineFloorsControl === "function") syncCombineFloorsControl();
    if (typeof syncDeletedWallsControls === "function") syncDeletedWallsControls();
    if (typeof rebuildWallsView === "function") rebuildWallsView();
    if (typeof setTool === "function") setTool("select");
    if (typeof closeFeatureSelection === "function") closeFeatureSelection();
    if (typeof closeSizeEditor === "function") closeSizeEditor();
  } finally {
    _isHistoryRestoring = false;
  }

  return true;
}

function ensureCurrentStateIsInHistory() {
  const snapshot = getFloorplanHistorySnapshot();
  if (!snapshot) return false;
  if (_historyIndex >= 0 && _historyStack[_historyIndex] === snapshot) return true;

  if (_historyIndex < _historyStack.length - 1) {
    _historyStack = _historyStack.slice(0, _historyIndex + 1);
  }
  _historyStack.push(snapshot);
  if (_historyStack.length > HISTORY_LIMIT) _historyStack.shift();
  _historyIndex = _historyStack.length - 1;
  return true;
}

function undoFloorplan() {
  if (_historyTimer) {
    clearTimeout(_historyTimer);
    _historyTimer = null;
  }
  ensureCurrentStateIsInHistory();
  if (_historyIndex <= 0) return false;

  _historyIndex -= 1;
  return restoreFloorplanHistorySnapshot(_historyStack[_historyIndex]);
}

function redoFloorplan() {
  if (_historyTimer) {
    clearTimeout(_historyTimer);
    _historyTimer = null;
  }
  if (_historyIndex < 0 || _historyIndex >= _historyStack.length - 1) return false;

  _historyIndex += 1;
  return restoreFloorplanHistorySnapshot(_historyStack[_historyIndex]);
}

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
      version: 4,
      meta: { savedAt: new Date().toISOString(), studentName: currentStudentName || "" },
      counters: { nextRoomId, nextFeatureId },
      ui: { joinedMode, currentTool, lockSizes, combineFloors, showDeletedWalls, backgroundEditMode, laserScaleDenominator, laserBedWidthMm, laserBedHeightMm },
      backgroundImage: backgroundImageState ? { ...backgroundImageState } : null,
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

  // Rooms can be rectangles or polygons (angled / triangular rooms).
  svg.querySelectorAll(ROOM_ELEMENT_SELECTOR).forEach(el => {
    if (el.tagName.toLowerCase() === "polygon") {
      rooms.push({
        shape: el.dataset.shape || "polygon",
        roomId: el.dataset.room,
        roomName: el.dataset.roomName || "",
        points: el.getAttribute("points") || "",
        data: {
          cutTlPx: el.dataset.cutTlPx || "0",
          cutTrPx: el.dataset.cutTrPx || "0",
          cutBrPx: el.dataset.cutBrPx || "0",
          cutBlPx: el.dataset.cutBlPx || "0",
          roomRotationDeg: el.dataset.roomRotationDeg || "0",
          polySides: el.dataset.polySides || ""
        }
      });
      return;
    }

    const x = parseFloat(el.getAttribute("x"));
    const y = parseFloat(el.getAttribute("y"));
    const w = parseFloat(el.getAttribute("width"));
    const h = parseFloat(el.getAttribute("height"));

    rooms.push({
      shape: "rect",
      roomId: el.dataset.room,
      roomName: el.dataset.roomName || "",
      x: isFinite(x) ? x : 0,
      y: isFinite(y) ? y : 0,
      width:  isFinite(w) ? w : 0,
      height: isFinite(h) ? h : 0,
      data: {
        cutTlPx: el.dataset.cutTlPx || "0",
        cutTrPx: el.dataset.cutTrPx || "0",
        cutBrPx: el.dataset.cutBrPx || "0",
        cutBlPx: el.dataset.cutBlPx || "0",
        roomRotationDeg: el.dataset.roomRotationDeg || "0",
        polySides: el.dataset.polySides || ""
      }
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
    const keysToCopy = ["side", "wallIndex", "wallOffsetPx", "lengthPx", "windowHeadM", "windowSillM", "doorHeightM", "openingStartM", "openingEndM"];
    for (const k of keysToCopy) {
      if (rect.dataset[k] != null) f.data[k] = rect.dataset[k];
    }

    features.push(f);
  });

  return {
    version: 4,
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
      currentTool,
      lockSizes,
      combineFloors,
      showDeletedWalls,
      backgroundEditMode,
      laserScaleDenominator,
      laserBedWidthMm,
      laserBedHeightMm
    },
    backgroundImage: backgroundImageState ? { ...backgroundImageState } : null,
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
  svg.querySelectorAll(`rect[data-feature], rect[data-room], polygon[data-room]`).forEach(n => n.remove());

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
  svg.querySelectorAll(ROOM_ELEMENT_SELECTOR).forEach(r => {
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
  if (!payload || ![1, 2, 3, 4].includes(payload.version)) return;

  _isRestoring = true;
  try {
    clearFloorplanSvg();

    // Restore UI
if (payload.ui) {
  joinedMode  = !!payload.ui.joinedMode;
  currentTool = payload.ui.currentTool || currentTool;
  lockSizes   = !!payload.ui.lockSizes;
  combineFloors = !!payload.ui.combineFloors;
  showDeletedWalls = !!payload.ui.showDeletedWalls;
  backgroundEditMode = !!payload.ui.backgroundEditMode;
  const savedScale = parseFloat(payload.ui.laserScaleDenominator);
  if (isFinite(savedScale) && savedScale > 0) laserScaleDenominator = savedScale;
  const savedBedW = parseFloat(payload.ui.laserBedWidthMm);
  const savedBedH = parseFloat(payload.ui.laserBedHeightMm);
  if (isFinite(savedBedW) && savedBedW > 0) laserBedWidthMm = savedBedW;
  if (isFinite(savedBedH) && savedBedH > 0) laserBedHeightMm = savedBedH;
}

    backgroundImageState = payload.backgroundImage ? { ...payload.backgroundImage } : null;

    // Student name
    if (typeof payload.meta?.studentName === "string") {
      currentStudentName = payload.meta.studentName.trim();
    }

    // Visibility maps (optional, used by walls view)
    if (payload.visibility) {
      wallVisibility  = new Map(Object.entries(payload.visibility.wallVis || {}));
      floorVisibility = new Map(Object.entries(payload.visibility.floorVis || {}));
    }

    // Recreate rooms (skip invalid sizes/points to avoid NaN junk)
for (const r of payload.rooms || []) {
  const shape = String(r.shape || (r.points ? "polygon" : "rect"));

  if (shape !== "rect") {
    const points = String(r.points || "").trim();
    if (!points) continue;

    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", points);
    poly.setAttribute("fill", "rgba(0,0,0,0)");
    poly.setAttribute("stroke", "black");
    poly.setAttribute("stroke-width", "3");
    poly.setAttribute("pointer-events", "visiblePainted");
    poly.dataset.room = String(r.roomId);
    poly.dataset.roomName = String(r.roomName || "");
    poly.dataset.shape = shape;
    if (r.data) {
      for (const [k, v] of Object.entries(r.data)) poly.dataset[k] = String(v);
    }
    svg.appendChild(poly);
    continue;
  }

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
  rect.dataset.shape = "rect";
  if (r.data) {
    for (const [k, v] of Object.entries(r.data)) rect.dataset[k] = String(v);
  }

  svg.appendChild(rect);
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
    "lockSizes",
    "combineFloors",
    "showDeletedWalls",
    "laserScaleDenominator",
    "laserBedWidthMm",
    "laserBedHeightMm"
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

function syncDeletedWallsControls() {
  if (showDeletedWallsChk) showDeletedWallsChk.checked = !!showDeletedWalls;
  if (restoreDeletedWallsBtn) restoreDeletedWallsBtn.disabled = false;
}

function setShowDeletedWalls(value) {
  showDeletedWalls = !!value;
  syncDeletedWallsControls();
  requestAutoSave("show deleted walls");
  if (typeof rebuildWallsView === "function") rebuildWallsView();
}

function bindDeletedWallsControlsOnce() {
  if (showDeletedWallsChk) {
    syncDeletedWallsControls();
    showDeletedWallsChk.addEventListener("change", () => {
      setShowDeletedWalls(showDeletedWallsChk.checked);
    });
  }

  if (restoreDeletedWallsBtn) {
    restoreDeletedWallsBtn.addEventListener("click", () => {
      wallVisibility = new Map();
      requestAutoSave("restore all walls");
      if (typeof rebuildWallsView === "function") rebuildWallsView();
    });
  }
}

function syncCombineFloorsControl() {
  if (combineFloorsChk) combineFloorsChk.checked = !!combineFloors;
}

function setCombineFloors(value) {
  combineFloors = !!value;
  syncCombineFloorsControl();
  requestAutoSave("combine floors");
  if (typeof rebuildWallsView === "function") rebuildWallsView();
}

function bindCombineFloorsControlOnce() {
  if (!combineFloorsChk) return;
  syncCombineFloorsControl();
  combineFloorsChk.addEventListener("change", () => {
    setCombineFloors(combineFloorsChk.checked);
  });
}

function getMaterialThicknessMm() {
  let t = parseFloat(materialThicknessInput?.value);
  if (!isFinite(t) || t < 0) t = 0;
  return t;
}

function getLaserScaleDenominator() {
  let s = parseFloat(laserScaleInput?.value);
  if (!isFinite(s) || s <= 0) s = laserScaleDenominator || 50;
  if (!isFinite(s) || s <= 0) s = 50;
  return s;
}

function getLaserBedWidthMm() {
  let w = parseFloat(laserBedWidthInput?.value);
  if (!isFinite(w) || w <= 0) w = laserBedWidthMm || LASER_WIDTH;
  if (!isFinite(w) || w <= 0) w = LASER_WIDTH;
  return w;
}

function getLaserBedHeightMm() {
  let h = parseFloat(laserBedHeightInput?.value);
  if (!isFinite(h) || h <= 0) h = laserBedHeightMm || LASER_HEIGHT;
  if (!isFinite(h) || h <= 0) h = LASER_HEIGHT;
  return h;
}

function syncLaserScaleControl() {
  if (laserScaleInput) laserScaleInput.value = String(getLaserScaleDenominator());
  if (laserBedWidthInput) laserBedWidthInput.value = String(getLaserBedWidthMm());
  if (laserBedHeightInput) laserBedHeightInput.value = String(getLaserBedHeightMm());
}

function setLaserScaleDenominator(value) {
  const s = parseFloat(value);
  if (!isFinite(s) || s <= 0) return;
  laserScaleDenominator = s;
  syncLaserScaleControl();
  requestAutoSave("laser scale");
  if (typeof rebuildWallsView === "function") rebuildWallsView();
}

function setLaserBedSize(widthValue, heightValue) {
  const w = parseFloat(widthValue);
  const h = parseFloat(heightValue);
  if (isFinite(w) && w > 0) laserBedWidthMm = w;
  if (isFinite(h) && h > 0) laserBedHeightMm = h;
  syncLaserScaleControl();
  requestAutoSave("laser bed size");
  if (typeof rebuildWallsView === "function") rebuildWallsView();
}

let _laserOutputControlsBound = false;
function bindLaserScaleControlOnce() {
  if (_laserOutputControlsBound) return;
  _laserOutputControlsBound = true;

  syncLaserScaleControl();

  if (laserScaleInput) {
    laserScaleInput.addEventListener("input", () => {
      const s = parseFloat(laserScaleInput.value);
      if (isFinite(s) && s > 0) {
        laserScaleDenominator = s;
        requestAutoSave("laser scale");
        if (typeof rebuildWallsView === "function") rebuildWallsView();
      }
    });
    laserScaleInput.addEventListener("change", () => setLaserScaleDenominator(laserScaleInput.value));
  }

  const onBedInput = () => {
    const w = parseFloat(laserBedWidthInput?.value);
    const h = parseFloat(laserBedHeightInput?.value);
    if (isFinite(w) && w > 0) laserBedWidthMm = w;
    if (isFinite(h) && h > 0) laserBedHeightMm = h;
    requestAutoSave("laser bed size");
    if (typeof rebuildWallsView === "function") rebuildWallsView();
  };

  laserBedWidthInput?.addEventListener("input", onBedInput);
  laserBedHeightInput?.addEventListener("input", onBedInput);
  laserBedWidthInput?.addEventListener("change", () => setLaserBedSize(laserBedWidthInput.value, laserBedHeightInput?.value));
  laserBedHeightInput?.addEventListener("change", () => setLaserBedSize(laserBedWidthInput?.value, laserBedHeightInput.value));
}

function metresToLaserMm(metres) {
  const m = parseFloat(metres);
  if (!isFinite(m)) return 0;
  return (m * 1000) / getLaserScaleDenominator();
}

function planPxToLaserMm(px) {
  const n = parseFloat(px);
  if (!isFinite(n)) return 0;
  return metresToLaserMm(n * SCALE_M_PER_PX);
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
  return svg.querySelector(`[data-room="${roomId}"]:not([data-feature])`);
}

function getFeatureThickness(feature) {
  return feature?.dataset?.feature === "door" ? 6 : 4;
}

function getRoomDisplayName(roomId) {
  if (!ensureSvgBound()) return `Room ${roomId}`;
  const room = svg.querySelector(`[data-room="${roomId}"]:not([data-feature])`);
  if (!room) return `Room ${roomId}`;
  return room.dataset.roomName || `Room ${roomId}`;
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
  if (_isRestoring || _isHistoryRestoring) return;
  scheduleFloorplanHistory(reason);
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
            n.matches?.(ROOM_ELEMENT_SELECTOR) ||
            n.querySelector?.("rect[data-feature]") ||
            n.querySelector?.(ROOM_ELEMENT_SELECTOR)
          )
        );
        if (touched) {
          requestAutoSave("svg add/remove");
          return;
        }
      }

      if (m.type === "attributes") {
        const el = m.target;
        if (el && el.nodeType === 1 && el.matches?.(`rect[data-feature], ${ROOM_ELEMENT_SELECTOR}`)) {
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
      "x", "y", "width", "height", "points", "transform",
      "data-wallOffsetPx", "data-lengthPx", "data-wallIndex",
      "data-windowHeadM", "data-windowSillM", "data-doorHeightM", "data-openingStartM", "data-openingEndM", "data-side",
      "data-cutTlPx", "data-cutTrPx", "data-cutBrPx", "data-cutBlPx", "data-roomRotationDeg", "data-polySides",
      "data-room", "data-feature",
      // IMPORTANT: this is what makes renames autosave:
      "data-roomName", "data-shape",
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
  bindCombineFloorsControlOnce();
  bindDeletedWallsControlsOnce();
  bindLaserScaleControlOnce();
  installFeatureAutoSaveObserver();
  if (typeof rebuildWallsView === "function") rebuildWallsView();
  return loaded;
}