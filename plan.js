// ==========================================================
// PLAN VIEW: Rooms, doors, windows, editors, snapping
// Requires: common.js loaded first, walls.js available
// ==========================================================

// ----------------------------------------------------------
// Feature label helpers (doors/windows)
// ----------------------------------------------------------

// ---------- Feature label helpers (doors/windows) ----------

// ==========================================================
// Keyboard nudge (arrow keys) for rooms
// - Moves selected room with arrow keys
// - Shift = bigger step
// - Join mode: moves ALL rooms together
// - Updates labels + features + walls view + autosave
// ==========================================================


// ----------------------------------------------------------
// Ensure room rect has visible plan styling
// (fixes rooms that exist but have invisible walls)
// ----------------------------------------------------------
function ensureRoomRectLooksLikeARoom(rect) {
  if (!rect || !rect.dataset || !rect.dataset.room) return;

  rect.setAttribute("fill", "rgba(0,0,0,0)");
  rect.setAttribute("stroke", "black");
  rect.setAttribute("stroke-width", "3");
  rect.setAttribute("pointer-events", "bounding-box");
}


// ==========================================================
// PLAN VIEW UI ZOOM + PAN (viewBox only, laser scale unchanged)
// Wheel = zoom, Drag middle mouse / Space+drag = pan
// ==========================================================
const SNAP_TOUCH_PX = 12;   // touching walls (strong)
const SNAP_ALIGN_PX = 6;    // alignment only (weak)




function installPlanViewZoom(svgEl) {
  if (!svgEl) return;

  svgEl.style.touchAction = "none"; // helps trackpad/touch

  // If SVG has no viewBox yet, create one from its rendered size
  if (!svgEl.getAttribute("viewBox")) {
    const w = svgEl.viewBox?.baseVal?.width || svgEl.clientWidth || 800;
    const h = svgEl.viewBox?.baseVal?.height || svgEl.clientHeight || 600;
    svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }

  const vb = () => {
    const [x, y, w, h] = svgEl.getAttribute("viewBox").split(/\s+/).map(Number);
    return { x, y, w, h };
  };
  const setVb = (v) => svgEl.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Zoom limits (UI only)
  const MIN_W = 50;     // zoom in limit
  const MAX_W = 5000;   // zoom out limit

  function getSvgPointFromClient(clientX, clientY) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svgEl.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: clientX, y: clientY };
  }

  svgEl.addEventListener("wheel", (e) => {
    e.preventDefault();

    const v = vb();
    const mouse = getSvgPointFromClient(e.clientX, e.clientY);

    // Trackpad friendly zoom
    const zoomFactor = Math.pow(1.0015, e.deltaY);
    let newW = v.w * zoomFactor;
    let newH = v.h * zoomFactor;

    // Keep aspect
    const aspect = v.w / v.h;
    newW = clamp(newW, MIN_W, MAX_W);
    newH = newW / aspect;

    // Zoom about mouse point
    const rx = (mouse.x - v.x) / v.w;
    const ry = (mouse.y - v.y) / v.h;

    const newX = mouse.x - rx * newW;
    const newY = mouse.y - ry * newH;

    setVb({ x: newX, y: newY, w: newW, h: newH });
  }, { passive: false });

  // Pan: middle mouse drag OR Space+drag
  let panning = false;
  let panStart = null;
  let vbStart = null;
  let spaceDown = false;

  window.addEventListener("keydown", (e) => { if (e.code === "Space") spaceDown = true; });
  window.addEventListener("keyup",   (e) => { if (e.code === "Space") spaceDown = false; });

  svgEl.addEventListener("pointerdown", (e) => {
    const isMiddle = (e.button === 1);
    if (!isMiddle && !spaceDown) return;

    panning = true;
    panStart = { x: e.clientX, y: e.clientY };
    vbStart = vb();
    svgEl.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  svgEl.addEventListener("pointermove", (e) => {
    if (!panning || !panStart || !vbStart) return;

    // Convert screen delta to viewBox delta
    const rect = svgEl.getBoundingClientRect();
    const dx = (e.clientX - panStart.x) * (vbStart.w / rect.width);
    const dy = (e.clientY - panStart.y) * (vbStart.h / rect.height);

    setVb({ x: vbStart.x - dx, y: vbStart.y - dy, w: vbStart.w, h: vbStart.h });
    e.preventDefault();
  });

  function endPan(e) {
    if (!panning) return;
    panning = false;
    panStart = null;
    vbStart = null;
    e?.preventDefault?.();
  }

  svgEl.addEventListener("pointerup", endPan);
  svgEl.addEventListener("pointercancel", endPan);

  // Optional: quick zoom keys
  window.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;

    if (e.key === "+" || e.key === "=") {
      const v = vb();
      setVb({ x: v.x + v.w*0.05, y: v.y + v.h*0.05, w: v.w*0.9, h: v.h*0.9 });
    }
    if (e.key === "-" || e.key === "_") {
      const v = vb();
      setVb({ x: v.x - v.w*0.055, y: v.y - v.h*0.055, w: v.w/0.9, h: v.h/0.9 });
    }
  });
}




let selectedRoomRect = null; // current room selection for keyboard moves

function setSelectedRoomRect(rect) {
  selectedRoomRect = rect || null;

  // Optional visual: highlight selected room
  svg.querySelectorAll('rect[data-room]:not([data-feature])').forEach(r => {
    r.classList.toggle("room-selected", r === selectedRoomRect);
  });
}

function nudgeRect(rect, dx, dy) {
  if (!rect) return;

  const x = parseFloat(rect.getAttribute("x")) || 0;
  const y = parseFloat(rect.getAttribute("y")) || 0;
  rect.setAttribute("x", x + dx);
  rect.setAttribute("y", y + dy);

  updateRoomLabel(rect);
  updateFeaturesForRoom(rect);
}

function nudgeSelectedRoom(dx, dy) {
  if (!selectedRoomRect) return;

  if (joinedMode) {
    // Move all rooms together
    const rooms = svg.querySelectorAll('rect[data-room]:not([data-feature])');
    rooms.forEach(r => nudgeRect(r, dx, dy));
  } else {
    nudgeRect(selectedRoomRect, dx, dy);
  }

  rebuildWallsView();
  requestAutoSave?.("keyboard nudge");
}

// Install once
document.addEventListener("keydown", (e) => {
  // Don’t steal keys when typing in an input
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  const isTyping =
    tag === "input" || tag === "textarea" || e.target?.isContentEditable;
  if (isTyping) return;

  // Only act if we have a selected room
  if (!selectedRoomRect) return;

  // Steps in PX (your scale converts px->m; keep this as "nudge pixels")
  const step = e.shiftKey ? 10 : 2;

  let dx = 0, dy = 0;
  if (e.key === "ArrowLeft")  dx = -step;
  if (e.key === "ArrowRight") dx =  step;
  if (e.key === "ArrowUp")    dy = -step;
  if (e.key === "ArrowDown")  dy =  step;

  if (dx !== 0 || dy !== 0) {
    e.preventDefault();
    nudgeSelectedRoom(dx, dy);
  }
});


function getFeatureLabel(feature) {
  const fid = feature.dataset.featureId;
  return svg.querySelector(`text[data-feature-label="${fid}"]`);
}

function ensureFeatureLabel(feature) {
  let label = getFeatureLabel(feature);
  if (label) return label;

  label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.dataset.featureLabel = feature.dataset.featureId;

  // Styling (readable over anything)
  label.setAttribute("font-size", "10");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.setAttribute("fill", "black");

  // white outline so it reads anywhere
  label.setAttribute("stroke", "white");
  label.setAttribute("stroke-width", "3");
  label.setAttribute("paint-order", "stroke");

  // labels should never block clicking/dragging
  label.style.pointerEvents = "none";

  svg.appendChild(label);
  return label;
}

function updateFeatureLabel(feature) {
  const label = ensureFeatureLabel(feature);

  const x = parseFloat(feature.getAttribute("x"));
  const y = parseFloat(feature.getAttribute("y"));
  const w = parseFloat(feature.getAttribute("width"));
  const h = parseFloat(feature.getAttribute("height"));
  const side = feature.dataset.side;

  if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return;

  // Centre along the feature
  const cx = x + w / 2;
  const cy = y + h / 2;

  // Label text: use the true opening length (dataset) when present
  const lengthPx = parseFloat(feature.dataset.lengthPx) ||
    (side === "top" || side === "bottom" ? w : h);

  const lengthM = lengthPx * SCALE_M_PER_PX;
  label.textContent = isFinite(lengthM) ? `${lengthM.toFixed(2)}m` : "";

  // Push label OFF the feature so it doesn't overlap the rectangle
  // (door thickness is usually 6px, window 4px in your helpers)
  const thickness = getFeatureThickness(feature) || 6;

  // Extra clearance so the text never sits on the feature outline
  const clearance = 10;
  const offset = (thickness / 2) + clearance;

  // Reset any rotation first
  label.setAttribute("transform", "");

  if (side === "top") {
    // feature sits around the top wall line: move label upward
    label.setAttribute("x", cx);
    label.setAttribute("y", cy - offset);
  } else if (side === "bottom") {
    // move label downward
    label.setAttribute("x", cx);
    label.setAttribute("y", cy + offset);
  } else if (side === "left") {
    // keep text horizontal; move left
    label.setAttribute("x", cx - offset);
    label.setAttribute("y", cy);
  } else if (side === "right") {
    // move right
    label.setAttribute("x", cx + offset);
    label.setAttribute("y", cy);
  } else {
    // fallback
    label.setAttribute("x", cx);
    label.setAttribute("y", cy - offset);
  }
}

function removeFeatureLabel(feature) {
  const label = getFeatureLabel(feature);
  if (label) svg.removeChild(label);
}


function refreshAllPlanLabels() {
  // Rooms: ensure label exists + position it
  svg.querySelectorAll('rect[data-room]:not([data-feature])').forEach(rect => {
    const id = rect.dataset.room;
    if (!id) return;

    // If label missing (common.js restore often doesn’t recreate it), rebuild it
    let label = svg.querySelector(`text[data-room-label="${id}"]`);
    if (!label) {
      label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.dataset.room = id;
      label.dataset.roomLabel = id;
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "middle");
      label.setAttribute("font-size", "8");
      label.setAttribute("fill", "black");
      label.setAttribute("pointer-events", "auto");
      label.style.cursor = "pointer";

      const nameTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      nameTspan.dataset.role = "room-name";
      nameTspan.setAttribute("x", 0);
      nameTspan.setAttribute("dy", "-0.3em");

      const sizeTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      sizeTspan.dataset.role = "room-size";
      sizeTspan.setAttribute("x", 0);
      sizeTspan.setAttribute("dy", "1.2em");

      label.appendChild(nameTspan);
      label.appendChild(sizeTspan);

      label.addEventListener("pointerdown", (e) => e.stopPropagation());
      attachRoomLabelEvents(label, id); // from common.js

      svg.appendChild(label);
    }

    updateRoomLabel(rect); // positions + updates text
  });

  // Features: ensure/update labels
  svg.querySelectorAll('rect[data-feature]').forEach(f => {
    updateFeatureLabel(f);
  });
}


function ensureFeatureLabel(feature) {
  let label = getFeatureLabel(feature);
  if (label) return label;

  label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.dataset.featureLabel = feature.dataset.featureId;

  // mark so common.js clearing can remove it safely
  label.classList.add("feature-label");
  label.setAttribute("data-feature-label", feature.dataset.featureId);

  label.setAttribute("font-size", "10");
  label.setAttribute("fill", "black");
  label.setAttribute("text-anchor", "middle");
  label.style.pointerEvents = "none";
  svg.appendChild(label);
  return label;
}

function updateFeatureLabel(feature) {
  const label = ensureFeatureLabel(feature);

  const x = parseFloat(feature.getAttribute("x"));
  const y = parseFloat(feature.getAttribute("y"));
  const w = parseFloat(feature.getAttribute("width"));
  const h = parseFloat(feature.getAttribute("height"));
  const side = feature.dataset.side;

  const cx = x + w / 2;
  const cy = y + h / 2;

  const lengthPx = parseFloat(feature.dataset.lengthPx) ||
    (side === "top" || side === "bottom" ? w : h);
  const lengthM = lengthPx * SCALE_M_PER_PX;

  label.textContent = isFinite(lengthM) ? `${lengthM.toFixed(2)}m` : "";

  const offset = 14;
  label.setAttribute("transform", "");

  if (side === "top" || side === "bottom") {
    const ty = side === "top" ? (y - offset) : (y + h + offset);
    label.setAttribute("x", cx);
    label.setAttribute("y", ty);
  } else {
    const baseX = cx;
    const baseY = cy;
    const translate = side === "left" ? -offset : offset;

    label.setAttribute("x", baseX);
    label.setAttribute("y", baseY);
    label.setAttribute(
      "transform",
      `rotate(-90 ${baseX} ${baseY}) translate(${translate} 0)`
    );
  }
}

function removeFeatureLabel(feature) {
  const label = getFeatureLabel(feature);
  if (label && label.parentNode) label.parentNode.removeChild(label);
}

// ----------------------------------------------------------
// Tool button handling
// ----------------------------------------------------------

function setTool(tool) {
  currentTool = tool;
  [addDoorBtn, addWindowBtn].forEach(btn => btn.classList.remove("tool-active"));
  if (tool === "addDoor")   addDoorBtn.classList.add("tool-active");
  if (tool === "addWindow") addWindowBtn.classList.add("tool-active");

  svg.style.cursor =
    (tool === "addDoor" || tool === "addWindow") ? "crosshair" : "default";
}

addDoorBtn.addEventListener("click", () => {
  setTool(currentTool === "addDoor" ? "select" : "addDoor");
});

addWindowBtn.addEventListener("click", () => {
  setTool(currentTool === "addWindow" ? "select" : "addWindow");
});

//

addRectBtn.addEventListener("click", () => {
  createRoom(100, 100, 120, 80);
});

// ----------------------------------------------------------
// Rooms: creation, labels, editor
// ----------------------------------------------------------

function ensureRoomLabelForRect(rect) {
  const id = rect.dataset.room;
  let label = svg.querySelector(`text[data-room-label="${id}"]`);
  if (label) return label;

  // Label: two lines using tspans (name + size)
  label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.dataset.room = id;
  label.dataset.roomLabel = id;

  // mark so common.js clearing can remove it safely
  label.classList.add("room-label");
  label.setAttribute("data-room-label", id);

  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.setAttribute("font-size", "8");
  label.setAttribute("fill", "black");
  label.setAttribute("pointer-events", "auto");
  label.style.cursor = "pointer";

  const nameTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
  nameTspan.dataset.role = "room-name";
  nameTspan.setAttribute("x", 0);
  nameTspan.setAttribute("dy", "-0.3em");

  const sizeTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
  sizeTspan.dataset.role = "room-size";
  sizeTspan.setAttribute("x", 0);
  sizeTspan.setAttribute("dy", "1.2em");

  label.appendChild(nameTspan);
  label.appendChild(sizeTspan);

  label.addEventListener("pointerdown", (e) => e.stopPropagation());
  attachRoomLabelEvents(label, id); // from common.js

  svg.appendChild(label);
  return label;
}

function createRoom(x, y, w, h) {
  const id = String(nextRoomId++);
  const defaultName = `Room ${id}`;

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", x);
  rect.setAttribute("y", y);
  rect.setAttribute("width",  w);
  rect.setAttribute("height", h);
  rect.setAttribute("fill", "rgba(0,0,0,0)");
  rect.setAttribute("stroke", "black");
  rect.setAttribute("stroke-width", "3");
  rect.setAttribute("pointer-events", "bounding-box");
  rect.dataset.room = id;
  rect.dataset.roomName = defaultName;

  svg.appendChild(rect);

  ensureRoomLabelForRect(rect);
  updateRoomLabel(rect);

  rebuildWallsView();
  requestAutoSave("create room");
}

function updateRoomLabel(rect) {
  const id = rect.dataset.room;
  const label = ensureRoomLabelForRect(rect);
  if (!label) return;

  const x = parseFloat(rect.getAttribute("x"));
  const y = parseFloat(rect.getAttribute("y"));
  const w = parseFloat(rect.getAttribute("width"));
  const h = parseFloat(rect.getAttribute("height"));

  const cx = x + w / 2;
  const cy = y + h / 2;

  label.setAttribute("x", cx);
  label.setAttribute("y", cy);

  const nameTspan = label.querySelector('tspan[data-role="room-name"]');
  const sizeTspan = label.querySelector('tspan[data-role="room-size"]');

  const roomName = rect.dataset.roomName || `Room ${id}`;
  const sizeText = formatSizeLabel(w, h);

  if (nameTspan) {
    nameTspan.textContent = roomName;
    nameTspan.setAttribute("x", cx);
  }
  if (sizeTspan) {
    sizeTspan.textContent = sizeText;
    sizeTspan.setAttribute("x", cx);
  }
}

// ---------- Room editor panel ----------

function openSizeEditorForRoom(roomId) {
  const rect = svg.querySelector(`rect[data-room="${roomId}"]:not([data-feature])`);
  if (!rect) return;

  const wPx = parseFloat(rect.getAttribute("width"));
  const hPx = parseFloat(rect.getAttribute("height"));
  widthInput.value  = (wPx * SCALE_M_PER_PX).toFixed(2);
  heightInput.value = (hPx * SCALE_M_PER_PX).toFixed(2);
  roomNameInput.value = rect.dataset.roomName || `Room ${roomId}`;

  editingRoomId = roomId;
  sizeEditor.style.display = "flex";
  roomNameInput.focus();
  roomNameInput.select();
}

function closeSizeEditor() {
  sizeEditor.style.display = "none";
  editingRoomId = null;
}

applySizeBtn.addEventListener("click", () => {
  if (!editingRoomId) return;

  const rect = svg.querySelector(`rect[data-room="${editingRoomId}"]:not([data-feature])`);
  if (!rect) { closeSizeEditor(); return; }

  const newName = roomNameInput.value.trim();
  rect.dataset.roomName = newName || `Room ${editingRoomId}`;

  const currentWpx = parseFloat(rect.getAttribute("width"));
  const currentHpx = parseFloat(rect.getAttribute("height"));

  let newWm = parseFloat(widthInput.value);
  let newHm = parseFloat(heightInput.value);

  if (!isFinite(newWm) || newWm <= 0) newWm = currentWpx * SCALE_M_PER_PX;
  if (!isFinite(newHm) || newHm <= 0) newHm = currentHpx * SCALE_M_PER_PX;

  const newWpx = newWm / SCALE_M_PER_PX;
  const newHpx = newHm / SCALE_M_PER_PX;

  rect.setAttribute("width",  newWpx);
  rect.setAttribute("height", newHpx);

  updateRoomLabel(rect);
  updateFeaturesForRoom(rect);
  rebuildWallsView();
  requestAutoSave("apply room edit");
  closeSizeEditor();
});

cancelSizeBtn.addEventListener("click", closeSizeEditor);

deleteRoomBtn.addEventListener("click", () => {
  if (!editingRoomId) return;

  const rect  = svg.querySelector(`rect[data-room="${editingRoomId}"]:not([data-feature])`);
  const label = svg.querySelector(`text[data-room-label="${editingRoomId}"]`);

  // remove features for this room
  const feats = svg.querySelectorAll(`rect[data-feature][data-room="${editingRoomId}"]`);
  feats.forEach(f => {
    removeFeatureLabel(f);
    if (f.parentNode) f.parentNode.removeChild(f);
  });

  if (label && label.parentNode) label.parentNode.removeChild(label);
  if (rect && rect.parentNode) rect.parentNode.removeChild(rect);

  if (selectedFeature && selectedFeature.dataset.room === editingRoomId) {
    closeFeatureSelection();
  }

  closeSizeEditor();
  rebuildWallsView();
  requestAutoSave("delete room");
});

// ----------------------------------------------------------
// Doors & Windows
// ----------------------------------------------------------

function updateFeaturePosition(feature) {
  const roomRect = getRoomForFeature(feature);
  if (!roomRect) return;

  const side = feature.dataset.side;
  const x    = parseFloat(roomRect.getAttribute("x"));
  const y    = parseFloat(roomRect.getAttribute("y"));
  const w    = parseFloat(roomRect.getAttribute("width"));
  const h    = parseFloat(roomRect.getAttribute("height"));

  let wallOffsetPx = parseFloat(feature.dataset.wallOffsetPx) || 0;
  let lengthPx     = parseFloat(feature.dataset.lengthPx)     || 0;
  const thickness  = getFeatureThickness(feature);
  const minLen     = 10;

  let wallLen = (side === "top" || side === "bottom") ? w : h;
  if (lengthPx < minLen)  lengthPx = minLen;
  if (lengthPx > wallLen) lengthPx = wallLen;

  let maxOffset = wallLen - lengthPx;
  if (maxOffset < 0) maxOffset = 0;
  if (wallOffsetPx < 0) wallOffsetPx = 0;
  if (wallOffsetPx > maxOffset) wallOffsetPx = maxOffset;

  feature.dataset.wallOffsetPx = String(wallOffsetPx);
  feature.dataset.lengthPx     = String(lengthPx);

  let fx, fy, fw, fh;
  if (side === "top" || side === "bottom") {
    fw = lengthPx;
    fh = thickness;
    fx = x + wallOffsetPx;
    fy = (side === "top") ? (y - thickness / 2) : (y + h - thickness / 2);
  } else {
    fw = thickness;
    fh = lengthPx;
    fy = y + wallOffsetPx;
    fx = (side === "left") ? (x - thickness / 2) : (x + w - thickness / 2);
  }

  feature.setAttribute("x", fx);
  feature.setAttribute("y", fy);
  feature.setAttribute("width",  fw);
  feature.setAttribute("height", fh);

  updateFeatureLabel(feature);
}

function updateFeaturesForRoom(roomRect) {
  const roomId = roomRect.dataset.room;
  const feats  = svg.querySelectorAll(`rect[data-feature][data-room="${roomId}"]`);
  feats.forEach(f => updateFeaturePosition(f));

  if (selectedFeature && selectedFeature.dataset.room === roomId) {
    updateFeatureInfoFields(selectedFeature);
    updateFeatureHandlesPosition();
  }
}

function bindFeatureEvents(feature) {
  feature.addEventListener("click", (e) => {
    openFeatureInfo(feature);
    e.stopPropagation();
    e.preventDefault();
  });
}

function createFeatureOnRoom(roomRect, kind, clickPos) {
  const x = parseFloat(roomRect.getAttribute("x"));
  const y = parseFloat(roomRect.getAttribute("y"));
  const w = parseFloat(roomRect.getAttribute("width"));
  const h = parseFloat(roomRect.getAttribute("height"));

  const defaultLenM  = kind === "door" ? 0.9 : 1.2;
  const defaultLenPx = defaultLenM / SCALE_M_PER_PX;

  const dTop    = Math.abs(clickPos.y - y);
  const dBottom = Math.abs(clickPos.y - (y + h));
  const dLeft   = Math.abs(clickPos.x - x);
  const dRight  = Math.abs(clickPos.x - (x + w));

  let side = "top";
  let minD = dTop;
  if (dBottom < minD) { minD = dBottom; side = "bottom"; }
  if (dLeft   < minD) { minD = dLeft;   side = "left";   }
  if (dRight  < minD) {               side = "right";    }

  let wallLen, wallCoordClick;
  if (side === "top" || side === "bottom") {
    wallLen        = w;
    wallCoordClick = clickPos.x - x;
  } else {
    wallLen        = h;
    wallCoordClick = clickPos.y - y;
  }

  let lengthPx = Math.min(defaultLenPx, wallLen);
  let startPx  = wallCoordClick - lengthPx / 2;
  if (startPx < 0) startPx = 0;
  if (startPx + lengthPx > wallLen) startPx = wallLen - lengthPx;
  if (startPx < 0) startPx = 0;

  const feature = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  feature.dataset.feature   = kind;
  feature.dataset.featureId = String(nextFeatureId++);
  feature.dataset.room      = roomRect.dataset.room;
  feature.dataset.side      = side;
  feature.dataset.wallOffsetPx = String(startPx);
  feature.dataset.lengthPx     = String(lengthPx);

  if (kind === "window") {
    feature.dataset.windowHeadM = String(WINDOW_HEAD_DEFAULT_M);
  }

  feature.setAttribute("pointer-events", "visiblePainted");
  feature.style.cursor = "pointer";
  feature.setAttribute("fill", kind === "door" ? "#c08040" : "#80c0ff");

  updateFeaturePosition(feature);
  bindFeatureEvents(feature);

  svg.appendChild(feature);

  rebuildWallsView();
  requestAutoSave("create feature");
}

// ---------- Feature editor panel ----------

function openFeatureInfo(feature) {
  selectedFeature = feature;
  updateFeatureInfoFields(feature);
  featureInfo.style.display = "flex";
  createFeatureHandles(feature);
}

function updateFeatureInfoFields(feature) {
  const kind     = feature.dataset.feature === "door" ? "Door" : "Window";
  const roomRect = getRoomForFeature(feature);
  if (!roomRect) return;

  const wallOffsetPx = parseFloat(feature.dataset.wallOffsetPx) || 0;
  const lengthPx     = parseFloat(feature.dataset.lengthPx)     || 0;

  featureTypeLabel.textContent = kind;
  featureWidthInput.value  = (lengthPx     * SCALE_M_PER_PX).toFixed(2);
  featureOffsetInput.value = (wallOffsetPx * SCALE_M_PER_PX).toFixed(2);

  if (feature.dataset.feature === "window") {
    const headM = parseFloat(feature.dataset.windowHeadM) || WINDOW_HEAD_DEFAULT_M;
    featureHeadInput.disabled = false;
    featureHeadInput.value = headM.toFixed(2);
  } else {
    featureHeadInput.disabled = true;
    featureHeadInput.value = "";
  }
}

function closeFeatureSelection() {
  selectedFeature = null;
  featureInfo.style.display = "none";
  removeFeatureHandles();
}

function applyFeatureInputs() {
  if (!selectedFeature) return;

  const roomRect = getRoomForFeature(selectedFeature);
  if (!roomRect) return;

  const side = selectedFeature.dataset.side;
  const w    = parseFloat(roomRect.getAttribute("width"));
  const h    = parseFloat(roomRect.getAttribute("height"));
  const wallLen = (side === "top" || side === "bottom") ? w : h;

  let widthM  = parseFloat(featureWidthInput.value);
  let offsetM = parseFloat(featureOffsetInput.value);

  if (!isFinite(widthM) || widthM <= 0) return;
  if (!isFinite(offsetM) || offsetM < 0) offsetM = 0;

  let lengthPx = widthM  / SCALE_M_PER_PX;
  let offsetPx = offsetM / SCALE_M_PER_PX;

  const minLen = 10;
  if (lengthPx < minLen) lengthPx = minLen;
  if (lengthPx > wallLen) lengthPx = wallLen;

  let maxOffset = wallLen - lengthPx;
  if (maxOffset < 0) maxOffset = 0;
  if (offsetPx > maxOffset) offsetPx = maxOffset;
  if (offsetPx < 0) offsetPx = 0;

  selectedFeature.dataset.wallOffsetPx = String(offsetPx);
  selectedFeature.dataset.lengthPx     = String(lengthPx);

  if (selectedFeature.dataset.feature === "window") {
    let headM = parseFloat(featureHeadInput.value);
    if (!isFinite(headM) || headM <= 0) headM = WINDOW_HEAD_DEFAULT_M;
    if (headM > wallHeightM) headM = wallHeightM;
    selectedFeature.dataset.windowHeadM = String(headM);
  }

  updateFeaturePosition(selectedFeature);
  updateFeatureHandlesPosition();
  updateFeatureInfoFields(selectedFeature);
  rebuildWallsView();
  requestAutoSave("edit feature");
}

featureWidthInput.addEventListener("change", applyFeatureInputs);
featureOffsetInput.addEventListener("change", applyFeatureInputs);
featureHeadInput.addEventListener("change", applyFeatureInputs);

deleteFeatureBtn.addEventListener("click", () => {
  if (!selectedFeature) return;
  removeFeatureHandles();
  removeFeatureLabel(selectedFeature);

  if (selectedFeature.parentNode) selectedFeature.parentNode.removeChild(selectedFeature);

  selectedFeature = null;
  featureInfo.style.display = "none";
  rebuildWallsView();
  requestAutoSave("delete feature");
});

// ----------------------------------------------------------
// Feature handles (circles to drag doors/windows)
// ----------------------------------------------------------

function removeFeatureHandles() {
  if (featureHandleStart) { if (featureHandleStart.parentNode) featureHandleStart.parentNode.removeChild(featureHandleStart); featureHandleStart = null; }
  if (featureHandleEnd)   { if (featureHandleEnd.parentNode) featureHandleEnd.parentNode.removeChild(featureHandleEnd);     featureHandleEnd   = null; }
}

function attachHandleDrag(handle, feature, handleType) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const roomRect = getRoomForFeature(feature);
    if (!roomRect) return;

    const side   = feature.dataset.side;
    const w      = parseFloat(roomRect.getAttribute("width"));
    const h      = parseFloat(roomRect.getAttribute("height"));
    const wallLen= (side === "top" || side === "bottom") ? w : h;

    const startOffset = parseFloat(feature.dataset.wallOffsetPx) || 0;
    const startLength = parseFloat(feature.dataset.lengthPx)     || 0;
    const startPoint  = getPointerPosition(e);
    const minLen      = 10;

    function onMove(ev) {
      ev.preventDefault();
      const pos = getPointerPosition(ev);
      const dx  = pos.x - startPoint.x;
      const dy  = pos.y - startPoint.y;

      let offset = startOffset;
      let length = startLength;

      if (side === "top" || side === "bottom") {
        if (handleType === "start") {
          offset = startOffset + dx;
          if (offset < 0) offset = 0;
          if (offset + length > wallLen) offset = wallLen - length;
        } else {
          length = startLength + dx;
          if (length < minLen) length = minLen;
          if (offset + length > wallLen) length = wallLen - offset;
        }
      } else {
        if (handleType === "start") {
          offset = startOffset + dy;
          if (offset < 0) offset = 0;
          if (offset + length > wallLen) offset = wallLen - length;
        } else {
          length = startLength + dy;
          if (length < minLen) length = minLen;
          if (offset + length > wallLen) length = wallLen - offset;
        }
      }

      feature.dataset.wallOffsetPx = String(offset);
      feature.dataset.lengthPx     = String(length);

      updateFeaturePosition(feature);
      updateFeatureHandlesPosition();
      updateFeatureLabel(feature);

      if (selectedFeature === feature) updateFeatureInfoFields(feature);
      rebuildWallsView();
      requestAutoSave("drag feature handle");
    }

    function onUp(ev) {
      ev.preventDefault();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup",   onUp);
      window.removeEventListener("pointercancel", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}

function createFeatureHandles(feature) {
  removeFeatureHandles();
  if (!feature) return;

  const x = parseFloat(feature.getAttribute("x"));
  const y = parseFloat(feature.getAttribute("y"));
  const w = parseFloat(feature.getAttribute("width"));
  const h = parseFloat(feature.getAttribute("height"));
  const side = feature.dataset.side;

  let startCx, startCy, endCx, endCy;
  if (side === "top" || side === "bottom") {
    startCx = x;
    startCy = y + h / 2;
    endCx   = x + w;
    endCy   = y + h / 2;
  } else {
    startCx = x + w / 2;
    startCy = y;
    endCx   = x + w / 2;
    endCy   = y + h;
  }

  featureHandleStart = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  featureHandleStart.setAttribute("cx", startCx);
  featureHandleStart.setAttribute("cy", startCy);
  featureHandleStart.setAttribute("r", 4);
  featureHandleStart.setAttribute("fill", "#ffffff");
  featureHandleStart.setAttribute("stroke", "#000000");
  featureHandleStart.style.cursor = "move";

  featureHandleEnd = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  featureHandleEnd.setAttribute("cx", endCx);
  featureHandleEnd.setAttribute("cy", endCy);
  featureHandleEnd.setAttribute("r", 4);
  featureHandleEnd.setAttribute("fill", "#ffffff");
  featureHandleEnd.setAttribute("stroke", "#000000");
  featureHandleEnd.style.cursor = "nwse-resize";

  svg.appendChild(featureHandleStart);
  svg.appendChild(featureHandleEnd);

  attachHandleDrag(featureHandleStart, feature, "start");
  attachHandleDrag(featureHandleEnd,   feature, "end");
}

function updateFeatureHandlesPosition() {
  if (!selectedFeature || !featureHandleStart || !featureHandleEnd) return;

  const x = parseFloat(selectedFeature.getAttribute("x"));
  const y = parseFloat(selectedFeature.getAttribute("y"));
  const w = parseFloat(selectedFeature.getAttribute("width"));
  const h = parseFloat(selectedFeature.getAttribute("height"));
  const side = selectedFeature.dataset.side;

  let startCx, startCy, endCx, endCy;
  if (side === "top" || side === "bottom") {
    startCx = x;
    startCy = y + h / 2;
    endCx   = x + w;
    endCy   = y + h / 2;
  } else {
    startCx = x + w / 2;
    startCy = y;
    endCx   = x + w / 2;
    endCy   = y + h;
  }

  featureHandleStart.setAttribute("cx", startCx);
  featureHandleStart.setAttribute("cy", startCy);
  featureHandleEnd.setAttribute("cx",   endCx);
  featureHandleEnd.setAttribute("cy",   endCy);
}

// ----------------------------------------------------------
// Snapping & pointer handling for rooms
// ----------------------------------------------------------
function applySnapping(rect, proposedX, proposedY) {
  const w = parseFloat(rect.getAttribute("width"));
  const h = parseFloat(rect.getAttribute("height"));

  let snappedX = proposedX;
  let snappedY = proposedY;

  const allRects = Array.from(
    svg.querySelectorAll('rect[data-room]:not([data-feature])')
  );

  const overlapMin = 20; // px overlap required to consider a shared wall

  const snap = (value, target, dist) =>
    Math.abs(value - target) <= dist ? target : value;

  const overlap = (a1, a2, b1, b2) =>
    Math.min(a2, b2) - Math.max(a1, b1);

  allRects.forEach(other => {
    if (other === rect) return;

    const ox = parseFloat(other.getAttribute("x"));
    const oy = parseFloat(other.getAttribute("y"));
    const ow = parseFloat(other.getAttribute("width"));
    const oh = parseFloat(other.getAttribute("height"));

    const oL = ox;
    const oR = ox + ow;
    const oT = oy;
    const oB = oy + oh;

    const sL = snappedX;
    const sR = snappedX + w;
    const sT = snappedY;
    const sB = snappedY + h;

    const vOverlap = overlap(sT, sB, oT, oB);
    const hOverlap = overlap(sL, sR, oL, oR);

    // --------------------------------------------------
    // 1) TOUCHING WALLS (strong snap, requires overlap)
    // --------------------------------------------------
    if (vOverlap >= overlapMin) {
      snappedX = snap(snappedX, oR, SNAP_TOUCH_PX);      // left to right
      snappedX = snap(snappedX, oL - w, SNAP_TOUCH_PX);  // right to left
    }

    if (hOverlap >= overlapMin) {
      snappedY = snap(snappedY, oB, SNAP_TOUCH_PX);      // top to bottom
      snappedY = snap(snappedY, oT - h, SNAP_TOUCH_PX);  // bottom to top
    }

    // --------------------------------------------------
    // 2) ALIGNMENT (weak snap, no forced touching)
    // --------------------------------------------------
    snappedX = snap(snappedX, oL, SNAP_ALIGN_PX);
    snappedX = snap(snappedX, oR - w, SNAP_ALIGN_PX);

    snappedY = snap(snappedY, oT, SNAP_ALIGN_PX);
    snappedY = snap(snappedY, oB - h, SNAP_ALIGN_PX);
  });

  // tiny quantize to kill floating-point dust
  snappedX = Math.round(snappedX * 10) / 10;
  snappedY = Math.round(snappedY * 10) / 10;

  return { x: snappedX, y: snappedY };
}



// Pointer events on SVG (rooms + features)

svg.addEventListener("pointerdown", (evt) => {
  
//if (evt.pointerType === "touch" && evt.isPrimary === false) return; // ignore 2nd finger

 // if (evt.isPrimary === false) return; // ignore non-primary pointers (2nd finger)


  const target = evt.target;
  

  // clicking room label handled separately
  if (target.tagName === "text" && target.dataset.room) return;

  const isRect        = target && target.tagName === "rect";
  const isHandle      = target && target.tagName === "circle";
  const isFeatureRect = isRect && !!target.dataset.feature;
  const isRoomRect    = isRect && !!target.dataset.room && !isFeatureRect;

  if (!isRoomRect) setSelectedRoomRect(null);


  // 1) If we're in addDoor/addWindow mode and click NOT on a room -> exit
  if ((currentTool === "addDoor" || currentTool === "addWindow") && !isRoomRect) {
    setTool("select");
  }

  // 2) Click away from feature -> deselect it (unless clicking feature/handle)
  if (selectedFeature && !isFeatureRect && !isHandle) {
    closeFeatureSelection();
  }

  // If not a rect, nothing else to do
  if (!isRect) return;

  // 3) Click on feature body -> select/open feature info
  if (isFeatureRect) {
    openFeatureInfo(target);
    evt.preventDefault();
    return;
  }

  // 4) Add-door / add-window mode (stay in mode after placing)
  if (isRoomRect && (currentTool === "addDoor" || currentTool === "addWindow")) {
    const pos = getPointerPosition(evt);
    createFeatureOnRoom(target, currentTool === "addDoor" ? "door" : "window", pos);
    evt.preventDefault();
    return;
  }

  // 5) Select mode -> drag/resize room
  if (currentTool !== "select" || !isRoomRect) return;

  const pos = getPointerPosition(evt);
  startPointer = pos;
  draggingRoom = target;
  setSelectedRoomRect(target);

  const x = parseFloat(target.getAttribute("x"));
  const y = parseFloat(target.getAttribute("y"));
  const w = parseFloat(target.getAttribute("width"));
  const h = parseFloat(target.getAttribute("height"));
  startRect = { x, y, w, h };

  const margin     = 5;
  const nearRight  = pos.x > x + w - margin && pos.x < x + w + margin;
  const nearBottom = pos.y > y + h - margin && pos.y < y + h + margin;

  if (joinedMode || lockSizes) {
  dragMode = "move";
} else {
  dragMode = (nearRight || nearBottom) ? "resize" : "move";
}

  svg.style.cursor = (dragMode === "resize") ? "nwse-resize" : "move";

  if (joinedMode && dragMode === "move") {
    startPositions = Array.from(svg.querySelectorAll('rect[data-room]:not([data-feature])'))
      .map(r => ({
        element: r,
        x: parseFloat(r.getAttribute("x")),
        y: parseFloat(r.getAttribute("y"))
      }));
  } else {
    startPositions = [];
  }

  evt.preventDefault();
});

//==========================================================================
//=============new ========================================================
const HOVER_MARGIN = 5;

svg.addEventListener("pointermove", (evt) => {
  if (currentTool !== "select") return;
  if (draggingRoom) return;

  const target = evt.target;
  const isRoomRect = target?.matches?.('rect[data-room]:not([data-feature])');

  if (!isRoomRect) {
    svg.style.cursor = "";
    return;
  }

  const pos = getPointerPosition(evt);

  const x = parseFloat(target.getAttribute("x"));
  const y = parseFloat(target.getAttribute("y"));
  const w = parseFloat(target.getAttribute("width"));
  const h = parseFloat(target.getAttribute("height"));

  const nearRight  = Math.abs(pos.x - (x + w)) < HOVER_MARGIN;
  const nearBottom = Math.abs(pos.y - (y + h)) < HOVER_MARGIN;

  const hoverMode =
    (joinedMode || lockSizes)
      ? "move"
      : (nearRight || nearBottom) ? "resize" : "move";

  svg.style.cursor = (hoverMode === "resize") ? "nwse-resize" : "move";

  target.classList.toggle("room-hover-resize", hoverMode === "resize");
  target.classList.toggle("room-hover-move", hoverMode === "move");
});

//=========================================================================






svg.addEventListener("pointermove", (evt) => {
  if (!draggingRoom || !dragMode) return;

  const pos = getPointerPosition(evt);
  const dx  = pos.x - startPointer.x;
  const dy  = pos.y - startPointer.y;

  if (dragMode === "move") {
    svg.style.cursor = "move";

    if (joinedMode) {
      startPositions.forEach(item => {
        item.element.setAttribute("x", item.x + dx);
        item.element.setAttribute("y", item.y + dy);
        updateRoomLabel(item.element);
        updateFeaturesForRoom(item.element);
      });
      rebuildWallsView();
      requestAutoSave("move rooms joined");
    } else {
      const proposedX = startRect.x + dx;
      const proposedY = startRect.y + dy;
      const snapped   = applySnapping(draggingRoom, proposedX, proposedY);
      draggingRoom.setAttribute("x", snapped.x);
      draggingRoom.setAttribute("y", snapped.y);
      updateRoomLabel(draggingRoom);
      updateFeaturesForRoom(draggingRoom);
      rebuildWallsView();
      requestAutoSave("move room");
    }
  } else if (dragMode === "resize") {
    svg.style.cursor = "nwse-resize";
    let newW = startRect.w + dx;
    let newH = startRect.h + dy;
    const minSize = 15;
    if (newW < minSize) newW = minSize;
    if (newH < minSize) newH = minSize;
    draggingRoom.setAttribute("width",  newW);
    draggingRoom.setAttribute("height", newH);
    updateRoomLabel(draggingRoom);
    updateFeaturesForRoom(draggingRoom);
    rebuildWallsView();
    requestAutoSave("resize room");
  }

  evt.preventDefault();
});

function endRoomDrag() {
  draggingRoom = null;
  dragMode     = null;
  startPointer = null;
  startRect    = null;
  startPositions = [];

  svg.style.cursor =
    (currentTool === "addDoor" || currentTool === "addWindow") ? "crosshair" : "default";
}

svg.addEventListener("pointerup",     endRoomDrag);
svg.addEventListener("pointercancel", endRoomDrag);

// ----------------------------------------------------------
// Re-bind labels + click handlers after restore
// (common.js recreates rects, but labels/events are plan.js job)
// ----------------------------------------------------------

function rebuildPlanLabelsAndBindings() {
  // Rooms
  const rooms = svg.querySelectorAll('rect[data-room]:not([data-feature])');

rooms.forEach(r => {
  ensureRoomRectLooksLikeARoom(r);
  ensureRoomLabelForRect(r);
  updateRoomLabel(r);
});

  // Features
  const feats = Array.from(svg.querySelectorAll('rect[data-feature]'));
  feats.forEach(f => {
    // ensure featureId exists
    if (!f.dataset.featureId) f.dataset.featureId = String(nextFeatureId++);
    bindFeatureEvents(f);
    updateFeaturePosition(f);
  });
}

// ----------------------------------------------------------
// Startup (ONE place only)
// ----------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // --- Lock Sizes ---
  const lockChk = document.getElementById("lockSizesChk");
  const lockStatus = document.getElementById("lockSizesStatus");

  if (lockChk) {
    lockChk.checked = !!lockSizes;
    if (lockStatus) lockStatus.textContent = lockSizes ? "ON" : "OFF";

    lockChk.addEventListener("change", () => {
      lockSizes = lockChk.checked;
      if (lockStatus) lockStatus.textContent = lockSizes ? "ON" : "OFF";
      requestAutoSave?.("lock sizes");
    });
  }

  // --- Join Mode (Add Floors) ---
  const joinChk = document.getElementById("toggleJoinBtn"); // your checkbox id
  const joinStatus = document.getElementById("joinStatus"); // your <span id="joinStatus">

  if (joinChk) {
    // sync UI from real state
    joinChk.checked = !!joinedMode;
    if (joinStatus) joinStatus.textContent = joinedMode ? "ON" : "OFF";

    joinChk.addEventListener("change", () => {
      joinedMode = joinChk.checked;
      if (joinStatus) joinStatus.textContent = joinedMode ? "ON" : "OFF";

      rebuildWallsView?.();              // floors show/hide
      requestAutoSave?.("join mode");    // persist
    });
  }




  // 1) clear all button;
  const resetBtn = document.getElementById("resetAppBtn");
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    const ok = confirm(
      "This will permanently delete the saved plan on this device.\n\nContinue?"
    );
    if (!ok) return;

    resetRoomPlannerStorage();   // from common.js
    location.reload();           // hard reset UI state
  });
}


  // 2) Load saved rooms/features/etc (ONLY ONE system)
  loadFloorplanFromLocalStorage?.();   // OR loadFloorplanState() (but not both)

  svg.querySelectorAll('rect[data-room]:not([data-feature])')
  .forEach(ensureRoomRectLooksLikeARoom);

  // 3) Recreate any missing labels (rooms + features)
  refreshAllPlanLabels?.();

  // 4) Install zoom AFTER svg exists
  installPlanViewZoom?.(svg);

 // installTouchPinchAndHover(svg, { resizeMargin: 5 });

  // 5) Sync Join UI from actual state
   //If toggleJoinBtn is now a checkbox switch:
   toggleJoinBtn.checked = !!joinedMode;
   document.getElementById("joinStatus").textContent = joinedMode ? "ON" : "OFF";
  // If you're still using the old button text:
  if (toggleJoinBtn && toggleJoinBtn.tagName !== "INPUT") {
    toggleJoinBtn.textContent = "Join: " + (joinedMode ? "ON" : "OFF");
  }

  // 6) Hook student name input
  const nameInput = document.getElementById("studentNameInput");
  if (nameInput) {
    nameInput.value = currentStudentName || "";
    nameInput.addEventListener("input", () => setStudentName(nameInput.value));
  }

  // 7) Autosave watcher LAST (so loading doesn't trigger saves)
  installFeatureAutoSaveObserver?.();

  // 8) Build laser view AFTER state + labels exist
  rebuildWallsView?.();

  // rebuild fingerjoints
  if (materialThicknessInput) {
  materialThicknessInput.addEventListener("input", () => {
    rebuildWallsView();
    requestAutoSave?.("material thickness");
  });

  // optional: also rebuild on blur/change for number inputs
  materialThicknessInput.addEventListener("change", () => {
    rebuildWallsView();
    requestAutoSave?.("material thickness");
  });
}

});
