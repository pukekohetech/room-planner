// ==========================================================
// PLAN VIEW: Rooms, doors, windows, editors, snapping
// Requires: common.js, walls.js loaded first
// ==========================================================

// ---------- Feature label helpers (doors/windows) ----------

function getFeatureLabel(feature) {
  const fid = feature.dataset.featureId;
  return svg.querySelector(`text[data-feature-label="${fid}"]`);
}

function ensureFeatureLabel(feature) {
  let label = getFeatureLabel(feature);
  if (label) return label;

  label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.dataset.featureLabel = feature.dataset.featureId;
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
  label.textContent = `${lengthM.toFixed(2)}m`;

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
  if (label) svg.removeChild(label);
}

// ==========================================================
// Tool button handling
// ==========================================================

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

toggleJoinBtn.addEventListener("click", () => {
  joinedMode = !joinedMode;
  toggleJoinBtn.textContent = "Join: " + (joinedMode ? "ON" : "OFF");
  rebuildWallsView();
});

addRectBtn.addEventListener("click", () => {
  createRoom(100, 100, 120, 80);
});

// ==========================================================
// Rooms: creation, labels, editor
// ==========================================================

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

  // Label: two lines using tspans (name + size)
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.dataset.room = id;
  text.dataset.roomLabel = id;
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("font-size", "12");
  text.setAttribute("fill", "black");
  text.setAttribute("pointer-events", "auto");
  text.style.cursor = "pointer";

  const nameTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
  nameTspan.dataset.role = "room-name";
  nameTspan.setAttribute("x", 0);
  nameTspan.setAttribute("dy", "-0.3em");

  const sizeTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
  sizeTspan.dataset.role = "room-size";
  sizeTspan.setAttribute("x", 0);
  sizeTspan.setAttribute("dy", "1.2em");

  text.appendChild(nameTspan);
  text.appendChild(sizeTspan);

  text.addEventListener("pointerdown", (e) => e.stopPropagation());
  attachRoomLabelEvents(text, id); // from common.js

  svg.appendChild(rect);
  svg.appendChild(text);
  updateRoomLabel(rect);

  rebuildWallsView();
}

function updateRoomLabel(rect) {
  const id    = rect.dataset.room;
  const label = svg.querySelector(`text[data-room-label="${id}"]`);
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
  const sizeText = formatSizeLabel(w, h); // from common.js

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
  closeSizeEditor();
});

cancelSizeBtn.addEventListener("click", closeSizeEditor);

deleteRoomBtn.addEventListener("click", () => {
  if (!editingRoomId) return;

  const rect  = svg.querySelector(`rect[data-room="${editingRoomId}"]:not([data-feature])`);
  const label = svg.querySelector(`text[data-room-label="${editingRoomId}"]`);
  if (label) svg.removeChild(label);

  const feats = svg.querySelectorAll(
    `rect[data-feature][data-room="${editingRoomId}"]`
  );
  feats.forEach(f => {
    removeFeatureLabel(f);
    svg.removeChild(f);
  });

  if (rect) svg.removeChild(rect);

  if (selectedFeature && selectedFeature.dataset.room === editingRoomId) {
    closeFeatureSelection();
  }

  closeSizeEditor();
  rebuildWallsView();
});

// ==========================================================
// Doors & Windows
// ==========================================================

function updateFeaturePosition(feature) {
  const roomRect = getRoomForFeature(feature); // from common.js
  if (!roomRect) return;

  const side = feature.dataset.side;
  const x    = parseFloat(roomRect.getAttribute("x"));
  const y    = parseFloat(roomRect.getAttribute("y"));
  const w    = parseFloat(roomRect.getAttribute("width"));
  const h    = parseFloat(roomRect.getAttribute("height"));

  let wallOffsetPx = parseFloat(feature.dataset.wallOffsetPx) || 0;
  let lengthPx     = parseFloat(feature.dataset.lengthPx)     || 0;
  const thickness  = getFeatureThickness(feature);            // from common.js
  const minLen     = 10;

  let wallLen = (side === "top" || side === "bottom") ? w : h;
  if (lengthPx < minLen)  lengthPx = minLen;
  if (lengthPx > wallLen) lengthPx = wallLen;

  let maxOffset = wallLen - lengthPx;
  if (maxOffset < 0) maxOffset = 0;
  if (wallOffsetPx < 0)        wallOffsetPx = 0;
  if (wallOffsetPx > maxOffset)wallOffsetPx = maxOffset;

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
    wallLen       = w;
    wallCoordClick= clickPos.x - x;
  } else {
    wallLen       = h;
    wallCoordClick= clickPos.y - y;
  }

  let lengthPx = Math.min(defaultLenPx, wallLen);
  let startPx  = wallCoordClick - lengthPx / 2;
  if (startPx < 0)              startPx = 0;
  if (startPx + lengthPx > wallLen) startPx = wallLen - lengthPx;
  if (startPx < 0)              startPx = 0;

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

  feature.addEventListener("click", (e) => {
    openFeatureInfo(feature);
    e.stopPropagation();
    e.preventDefault();
  });

  svg.appendChild(feature);
  rebuildWallsView();
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
  if (offsetPx < 0)         offsetPx = 0;

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
}

featureWidthInput.addEventListener("change", applyFeatureInputs);
featureOffsetInput.addEventListener("change", applyFeatureInputs);
featureHeadInput.addEventListener("change", applyFeatureInputs);

deleteFeatureBtn.addEventListener("click", () => {
  if (!selectedFeature) return;
  removeFeatureHandles();
  removeFeatureLabel(selectedFeature);
  svg.removeChild(selectedFeature);
  selectedFeature = null;
  featureInfo.style.display = "none";
  rebuildWallsView();
});

// ==========================================================
// Feature handles (circles to drag doors/windows)
// ==========================================================

function removeFeatureHandles() {
  if (featureHandleStart) { svg.removeChild(featureHandleStart); featureHandleStart = null; }
  if (featureHandleEnd)   { svg.removeChild(featureHandleEnd);   featureHandleEnd   = null; }
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
  featureHandleStart.setAttribute("r", 9);
  featureHandleStart.setAttribute("fill", "#ffffff");
  featureHandleStart.setAttribute("stroke", "#000000");
  featureHandleStart.style.cursor = "move";

  featureHandleEnd = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  featureHandleEnd.setAttribute("cx", endCx);
  featureHandleEnd.setAttribute("cy", endCy);
  featureHandleEnd.setAttribute("r", 9);
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

// ==========================================================
// Snapping & pointer handling for rooms
// ==========================================================

function applySnapping(rect, proposedX, proposedY) {
  const w = parseFloat(rect.getAttribute("width"));
  const h = parseFloat(rect.getAttribute("height"));

  let snappedX = proposedX;
  let snappedY = proposedY;

  const currLeft   = proposedX;
  const currRight  = proposedX + w;
  const currTop    = proposedY;
  const currBottom = proposedY + h;

  const allRects = Array.from(
    svg.querySelectorAll('rect[data-room]:not([data-feature])')
  );

  allRects.forEach(other => {
    if (other === rect) return;

    const ox = parseFloat(other.getAttribute("x"));
    const oy = parseFloat(other.getAttribute("y"));
    const ow = parseFloat(other.getAttribute("width"));
    const oh = parseFloat(other.getAttribute("height"));

    const oLeft   = ox;
    const oRight  = ox + ow;
    const oTop    = oy;
    const oBottom = oy + oh;

    const verticalOverlap =
      Math.min(currBottom, oBottom) - Math.max(currTop, oTop);
    if (verticalOverlap > 0) {
      if (Math.abs(currLeft - oRight) <= SNAP_DISTANCE)  snappedX = oRight;
      if (Math.abs(currRight - oLeft) <= SNAP_DISTANCE)  snappedX = oLeft - w;
    }

    const horizontalOverlap =
      Math.min(currRight, oRight) - Math.max(currLeft, oLeft);
    if (horizontalOverlap > 0) {
      if (Math.abs(currTop - oBottom) <= SNAP_DISTANCE)  snappedY = oBottom;
      if (Math.abs(currBottom - oTop) <= SNAP_DISTANCE)  snappedY = oTop - h;
    }
  });

  return { x: snappedX, y: snappedY };
}

// Pointer events on SVG (rooms + features)

svg.addEventListener("pointerdown", (evt) => {
  const target = evt.target;

  // clicking room label handled separately
  if (target.tagName === "text" && target.dataset.room) return;

  const isRect       = target && target.tagName === "rect";
  const isHandle     = target && target.tagName === "circle";
  const isFeatureRect= isRect && !!target.dataset.feature;
  const isRoomRect   = isRect && !!target.dataset.room && !isFeatureRect;

  // ------------------------------------------------------------------
  // 1) If we're in addDoor/addWindow mode and click NOT on a room -> exit
  // ------------------------------------------------------------------
  if ((currentTool === "addDoor" || currentTool === "addWindow") && !isRoomRect) {
    setTool("select");
    // don't return; let deselect logic run too
  }

  // ------------------------------------------------------------------
  // 2) Click away from feature -> deselect it (unless clicking feature/handle)
  // ------------------------------------------------------------------
  if (selectedFeature && !isFeatureRect && !isHandle) {
    closeFeatureSelection();
    // don't return; could also be clicking a room to drag
  }

  // If not a rect, nothing else to do
  if (!isRect) return;

  // ------------------------------------------------------------------
  // 3) Click on feature body -> select/open feature info
  // ------------------------------------------------------------------
  if (isFeatureRect) {
    openFeatureInfo(target);
    evt.preventDefault();
    return;
  }

  // ------------------------------------------------------------------
  // 4) Add-door / add-window mode (stay in mode after placing)
  // ------------------------------------------------------------------
  if (isRoomRect && (currentTool === "addDoor" || currentTool === "addWindow")) {
    const pos = getPointerPosition(evt);
    createFeatureOnRoom(
      target,
      currentTool === "addDoor" ? "door" : "window",
      pos
    );
    // stay in tool mode until user clicks off-room or chooses another tool
    evt.preventDefault();
    return;
  }

  // ------------------------------------------------------------------
  // 5) Select mode -> drag/resize room
  // ------------------------------------------------------------------
  if (currentTool !== "select" || !isRoomRect) return;

  const pos = getPointerPosition(evt);
  startPointer = pos;
  draggingRoom = target;

  const x = parseFloat(target.getAttribute("x"));
  const y = parseFloat(target.getAttribute("y"));
  const w = parseFloat(target.getAttribute("width"));
  const h = parseFloat(target.getAttribute("height"));
  startRect = { x, y, w, h };

  const margin     = 30;
  const nearRight  = pos.x > x + w - margin && pos.x < x + w + margin;
  const nearBottom = pos.y > y + h - margin && pos.y < y + h + margin;

  if (joinedMode) {
    dragMode = "move"; // disable resize when joined
  } else {
    dragMode = (nearRight || nearBottom) ? "resize" : "move";
  }

  svg.style.cursor = (dragMode === "resize") ? "nwse-resize" : "move";

  if (joinedMode && dragMode === "move") {
    startPositions = Array.from(
      svg.querySelectorAll('rect[data-room]:not([data-feature])')
    ).map(r => ({
      element: r,
      x: parseFloat(r.getAttribute("x")),
      y: parseFloat(r.getAttribute("y"))
    }));
  } else {
    startPositions = [];
  }

  evt.preventDefault();
});


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
    } else {
      const proposedX = startRect.x + dx;
      const proposedY = startRect.y + dy;
      const snapped   = applySnapping(draggingRoom, proposedX, proposedY);
      draggingRoom.setAttribute("x", snapped.x);
      draggingRoom.setAttribute("y", snapped.y);
      updateRoomLabel(draggingRoom);
      updateFeaturesForRoom(draggingRoom);
      rebuildWallsView();
    }
  } else if (dragMode === "resize") {
    svg.style.cursor = "nwse-resize";
    let newW = startRect.w + dx;
    let newH = startRect.h + dy;
    const minSize = 30;
    if (newW < minSize) newW = minSize;
    if (newH < minSize) newH = minSize;
    draggingRoom.setAttribute("width",  newW);
    draggingRoom.setAttribute("height", newH);
    updateRoomLabel(draggingRoom);
    updateFeaturesForRoom(draggingRoom);
    rebuildWallsView();
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




// ==========================================================
// Initial setup
// ==========================================================

// ==========================================================
// Saving / Loading configuration (localStorage)
// ==========================================================

function saveFloorplanState() {
  if (typeof STORAGE_KEY === "undefined") return;

  const roomsData = [];

  // Collect rooms and their features
  const roomRects = svg.querySelectorAll('rect[data-room]:not([data-feature])');
  roomRects.forEach(rect => {
    const roomId   = rect.dataset.room;
    const roomName = rect.dataset.roomName || "";

    const x = parseFloat(rect.getAttribute("x"));
    const y = parseFloat(rect.getAttribute("y"));
    const w = parseFloat(rect.getAttribute("width"));
    const h = parseFloat(rect.getAttribute("height"));

    const features = [];
    const featureRects = svg.querySelectorAll(
      `rect[data-feature][data-room="${roomId}"]`
    );
    featureRects.forEach(f => {
      features.push({
        kind:      f.dataset.feature,                // "door" | "window"
        side:      f.dataset.side,                  // "top" | "bottom" | "left" | "right"
        offsetPx:  parseFloat(f.dataset.wallOffsetPx) || 0,
        lengthPx:  parseFloat(f.dataset.lengthPx)     || 0,
        windowHeadM: f.dataset.windowHeadM
          ? parseFloat(f.dataset.windowHeadM)
          : null
      });
    });

    roomsData.push({
      x, y, w, h,
      name: roomName,
      features
    });
  });

  const data = {
    rooms: roomsData,
    joinedMode: joinedMode,
    wallHeightM: wallHeightM,
    materialThicknessMm: getMaterialThicknessMm()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Could not save floorplan state:", e);
  }
}

function loadFloorplanState() {
  if (typeof STORAGE_KEY === "undefined") return false;

  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.warn("Could not read floorplan state:", e);
    return false;
  }

  if (!raw) return false;

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn("Bad floorplan JSON:", e);
    return false;
  }

  if (!data.rooms || !Array.isArray(data.rooms) || data.rooms.length === 0) {
    return false;
  }

  // Clear existing rooms, labels and features
  const toRemove = [];
  svg.querySelectorAll("rect, text, circle").forEach(el => {
    if (el.dataset.room || el.dataset.feature || el.dataset.roomLabel || el.dataset.featureLabel) {
      toRemove.push(el);
    }
  });
  toRemove.forEach(el => svg.removeChild(el));

  // Reset counters
  nextRoomId    = 1;
  nextFeatureId = 1;

  // Rebuild rooms and features from saved data
  data.rooms.forEach(room => {
    // createRoom will assign a new id automatically
    createRoom(room.x, room.y, room.w, room.h);
    const roomId = String(nextRoomId - 1); // id of the room just created

    // Set name
    const rect = svg.querySelector(`rect[data-room="${roomId}"]:not([data-feature])`);
    if (rect) {
      rect.dataset.roomName = room.name || `Room ${roomId}`;
      updateRoomLabel(rect);
    }

    // Recreate features for this room
    if (room.features && room.features.length) {
      room.features.forEach(f => {
        const clickPos = { x: room.x, y: room.y }; // dummy, we override values below

        // temp create
        createFeatureOnRoom(rect, f.kind, clickPos);

        const feature = svg.querySelector(
          `rect[data-feature][data-room="${roomId}"][data-feature-id="${nextFeatureId - 1}"]`
        );
        // If not found that way, just grab "last feature" for this room/kind
        const fallbackFeature = feature || Array.from(
          svg.querySelectorAll(`rect[data-feature][data-room="${roomId}"]`)
        ).pop();

        if (fallbackFeature) {
          fallbackFeature.dataset.side         = f.side;
          fallbackFeature.dataset.wallOffsetPx = String(f.offsetPx || 0);
          fallbackFeature.dataset.lengthPx     = String(f.lengthPx || 0);
          if (f.kind === "window" && f.windowHeadM != null) {
            fallbackFeature.dataset.windowHeadM = String(f.windowHeadM);
          }
          updateFeaturePosition(fallbackFeature);
        }
      });
    }
  });

  // Restore simple toggles
  joinedMode = !!data.joinedMode;
  toggleJoinBtn.textContent = "Join: " + (joinedMode ? "ON" : "OFF");

  if (typeof data.wallHeightM === "number" && data.wallHeightM > 0) {
    wallHeightM = data.wallHeightM;
    wallHeightInput.value = wallHeightM.toFixed(2);
  }

  if (typeof data.materialThicknessMm === "number" && materialThicknessInput) {
    materialThicknessInput.value = data.materialThicknessMm.toString();
  }

  // Rebuild elevations for restored rooms
  rebuildWallsView();
  return true;
}

window.addEventListener("DOMContentLoaded", () => {
  // 1) Load the main floorplan (rooms/features geometry)
  const loaded = loadFloorplanState();

  // 2) Load laser toggles + student name (independent of floorplan)
  loadLaserVisibility();

  // 3) Wire student name input (if present)
  const nameInput = document.getElementById("studentNameInput");
  if (nameInput) {
    nameInput.value = currentStudentName || "";
    nameInput.addEventListener("input", () => {
      setStudentName(nameInput.value);
    });
  }

  // 4) Install autosave watcher for changes to rooms/features
  installFeatureAutoSaveObserver();

  // 5) Build laser sheets from whatever state we have
  rebuildWallsView();

  // 6) Wire the download button
  const downloadBtn = document.getElementById("downloadSheetsBtn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      window.downloadAllSheetsAsSvg();
    });
  }

  // OPTIONAL: If no saved floorplan existed, create starter rooms here.
  // if (!loaded) {
  //   createRoom(50, 50, 120, 80);
  //   createRoom(250, 100, 150, 100);
  //   rebuildWallsView();
  // }
});


