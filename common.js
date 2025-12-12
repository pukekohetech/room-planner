// ==========================================================
// COMMON: DOM lookups, constants, shared state & helpers
// ==========================================================
// Remember last configuration in this browser
const STORAGE_KEY = "floorplanConfig_v1";


const svg = document.getElementById("floorplan");

// Toolbar buttons
// Toolbar buttons
const toggleJoinBtn       = document.getElementById("toggleJoinBtn");
const addRectBtn          = document.getElementById("addRectBtn");
const addDoorBtn          = document.getElementById("addDoorBtn");
const addWindowBtn        = document.getElementById("addWindowBtn");
const downloadSheetsBtn   = document.getElementById("downloadSheetsBtn");


// Room editor
const sizeEditor      = document.getElementById("sizeEditor");
const roomNameInput   = document.getElementById("roomNameInput");
const widthInput      = document.getElementById("widthInput");
const heightInput     = document.getElementById("heightInput");
const applySizeBtn    = document.getElementById("applySizeBtn");
const cancelSizeBtn   = document.getElementById("cancelSizeBtn");
const deleteRoomBtn   = document.getElementById("deleteRoomBtn");


// Feature editor
const featureInfo        = document.getElementById("featureInfo");
const featureTypeLabel   = document.getElementById("featureTypeLabel");
const featureWidthInput  = document.getElementById("featureWidthInput");
const featureOffsetInput = document.getElementById("featureOffsetInput");
const featureHeadInput   = document.getElementById("featureHeadInput");
const deleteFeatureBtn   = document.getElementById("deleteFeatureBtn");

// Walls view
const wallsSvg             = document.getElementById("wallsSvg");
const wallHeightInput      = document.getElementById("wallHeightInput");
const materialThicknessInput = document.getElementById("materialThicknessInput");

// ---------- CONSTANTS ----------
const SCALE_M_PER_PX = 0.2 / 3;
const SNAP_DISTANCE  = 20;
const LASER_WIDTH    = 730;
const LASER_HEIGHT   = 420;

const DOOR_HEIGHT_M          = 2.0;
const WINDOW_HEAD_DEFAULT_M   = 2.0;
const WINDOW_HEIGHT_DEFAULT_M = 1.0;

// Turn joints on/off in one place if needed
const ENABLE_FINGER_JOINTS = true;

let wallHeightM = parseFloat(wallHeightInput.value) || 2.4;

// ---------- STATE ----------
let joinedMode    = false;
let draggingRoom  = null;
let dragMode      = null;
let startPointer  = null;
let startRect     = null;
let startPositions= [];

let nextRoomId    = 1;
let nextFeatureId = 1;

let currentTool   = "select"; // "select" | "addDoor" | "addWindow"
let editingRoomId = null;

let selectedFeature   = null;
let featureHandleStart= null;
let featureHandleEnd  = null;

const pt = svg.createSVGPoint();

let wallVisibility  = new Map(); // wallKey => bool
let floorVisibility = new Map(); // roomId  => bool;

let currentStudentName = ""; // set from UI input



// ---------- SHARED HELPERS ----------

function setStudentName(name) {
  currentStudentName = String(name || "").trim();
  saveLaserVisibility(); // reuse saving (we'll extend payload below)
  rebuildWallsView();
}


function getMaterialThicknessMm() {
  let t = parseFloat(materialThicknessInput?.value);
  if (!isFinite(t) || t < 0) t = 0;   // 0mm => no joints
  return t;
}

function getPointerPosition(evt) {
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function formatSizeLabel(wPx, hPx) {
  const wM = wPx * SCALE_M_PER_PX;
  const hM = hPx * SCALE_M_PER_PX;
  return `${wM.toFixed(2)}m × ${hM.toFixed(2)}m`;
}

function getRoomForFeature(feature) {
  const roomId = feature.dataset.room;
  return svg.querySelector(`rect[data-room="${roomId}"]:not([data-feature])`);
}

function getFeatureThickness(feature) {
  return feature.dataset.feature === "door" ? 6 : 4;
}

function getRoomDisplayName(roomId) {
  const rect = svg.querySelector(`rect[data-room="${roomId}"]:not([data-feature])`);
  if (!rect) return `Room ${roomId}`;
  return rect.dataset.roomName || `Room ${roomId}`;
}

function attachRoomLabelEvents(textElement, roomId) {
  const openEditor = (e) => {
    openSizeEditorForRoom(roomId);
    e.stopPropagation();
    e.preventDefault();
  };

  textElement.addEventListener("click", openEditor);
  textElement.addEventListener("pointerup", openEditor);
  textElement.addEventListener("touchend", openEditor);
}


let _saveTimer = null;

function requestAutoSave(reason) {
  // Debounce so dragging/resizing doesn’t spam localStorage
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      saveLaserVisibility(); // visibility + student name
      // If you ALSO have a room layout saver (rooms/features positions), call it here too:
      // saveRoomLayoutToLocalStorage();
    } catch (e) {
      console.warn("AutoSave failed", e);
    }
  }, 150);
}

// Watches for changes to rooms/features in the main svg
function installFeatureAutoSaveObserver() {
  if (!svg) return;

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      // added/removed feature nodes
      if (m.type === "childList") {
        const added = Array.from(m.addedNodes || []);
        const removed = Array.from(m.removedNodes || []);
        const touched = [...added, ...removed].some(n =>
          n && n.nodeType === 1 && (
            n.matches?.("rect[data-feature]") ||
            n.querySelector?.("rect[data-feature]") ||
            n.matches?.("rect[data-room]") ||
            n.querySelector?.("rect[data-room]")
          )
        );
        if (touched) {
          requestAutoSave("feature add/remove");
          return;
        }
      }

      // attribute changes on feature nodes (offset/length/etc)
      if (m.type === "attributes") {
        const el = m.target;
        if (el && el.nodeType === 1 && el.matches?.("rect[data-feature], rect[data-room]")) {
          requestAutoSave("feature attr change");
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
      "data-room", "data-feature"
    ]
  });
}
