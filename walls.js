// ==========================================================
// Walls (laser view) - merged walls + toggles + floor patch
// Requires: common.js for globals & helpers
// ==========================================================

// Draw complementary finger-joint *outlines* on the left and right
// sides of the wall, as zig-zag paths (no separate boxes).
// Left side: tabs stick OUT of the wall (towards negative X).
// Right side: slots cut INTO the wall (towards negative X from the right edge).
function drawFingerJointsForWall(wallX, wallY, wallWidthPx, wallHeightPx) {
  const t = getMaterialThicknessMm();                  // mm → px (1px ≈ 1mm here)
  const useJoints = ENABLE_FINGER_JOINTS && t > 0;
  if (!useJoints) return;

  const pitch       = t;                               // vertical segment height
  const innerLeftX  = wallX;
  const outerLeftX  = wallX - t;                       // left tabs OUTSIDE
  const innerRightX = wallX + wallWidthPx;
  const outerRightX = innerRightX - t;                 // right slots INSIDE

  // LEFT SIDE PATH (start top-left corner)
  let dLeft = `M ${innerLeftX} ${wallY}`;
  // RIGHT SIDE PATH (start top-right corner)
  let dRight = `M ${innerRightX} ${wallY}`;

  let y = wallY;
  let index = 0;

  while (y < wallY + wallHeightPx) {
    const remaining = wallY + wallHeightPx - y;
    const h = Math.min(pitch, remaining);              // last chunk may be smaller
    const nextY = y + h;

    const isTabSegment = (index % 2 === 0);            // even segments have “finger”

    if (isTabSegment) {
      // LEFT: tab OUT: in → out → down → in
      dLeft  += ` L ${outerLeftX} ${y}`;
      dLeft  += ` L ${outerLeftX} ${nextY}`;
      dLeft  += ` L ${innerLeftX} ${nextY}`;

      // RIGHT: slot IN: in → inwards → down → back
      dRight += ` L ${outerRightX} ${y}`;
      dRight += ` L ${outerRightX} ${nextY}`;
      dRight += ` L ${innerRightX} ${nextY}`;
    } else {
      // gap segment, go straight down
      dLeft  += ` L ${innerLeftX} ${nextY}`;
      dRight += ` L ${innerRightX} ${nextY}`;
    }

    y = nextY;
    index++;
  }

  const leftPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  leftPath.setAttribute("d", dLeft);
  leftPath.setAttribute("fill", "none");
  leftPath.setAttribute("stroke", "rgb(255,0,0)");
  leftPath.setAttribute("stroke-width", "1");
  wallsSvg.appendChild(leftPath);

  const rightPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  rightPath.setAttribute("d", dRight);
  rightPath.setAttribute("fill", "none");
  rightPath.setAttribute("stroke", "rgb(255,0,0)");
  rightPath.setAttribute("stroke-width", "1");
  wallsSvg.appendChild(rightPath);
}

// Build a continuous outline path for a wall, with optional finger joints
function buildWallOutlinePath(wallX, wallY, wallWidthPx, wallHeightPx, useJoints) {
  const t = getMaterialThicknessMm();  // mm → px (1px ≈ 1mm here)

  // If joints are off or thickness invalid, just a simple rectangle
  if (!useJoints || !ENABLE_FINGER_JOINTS || !isFinite(t) || t <= 0) {
    const x1 = wallX;
    const y1 = wallY;
    const x2 = wallX + wallWidthPx;
    const y2 = wallY + wallHeightPx;

    return [
      `M ${x1} ${y1}`,
      `L ${x2} ${y1}`,
      `L ${x2} ${y2}`,
      `L ${x1} ${y2}`,
      `Z`
    ].join(" ");
  }

  const pitch       = t;                          // vertical segment height
  const innerLeftX  = wallX;
  const outerLeftX  = wallX - t;                  // left tabs OUTSIDE
  const innerRightX = wallX + wallWidthPx;
  const outerRightX = innerRightX - t;            // right slots INSIDE
  const totalHeight = wallHeightPx;

  // Split wall height into segments (last one may be smaller)
  const segments = [];
  let remaining = totalHeight;
  while (remaining > 0) {
    const h = Math.min(pitch, remaining);
    segments.push(h);
    remaining -= h;
  }
  const n = segments.length;

  const topY    = wallY;
  const bottomY = wallY + totalHeight;

  let d = "";

  // Start at top-left inner corner
  d += `M ${innerLeftX} ${topY}`;
  // Top edge to top-right inner corner
  d += ` L ${innerRightX} ${topY}`;

  // ---- Right side, going DOWN with slots ----
  let y = topY;
  for (let i = 0; i < n; i++) {
    const h = segments[i];
    const nextY = y + h;
    const isTabSegment = (i % 2 === 0); // even segments have “finger”

    if (isTabSegment) {
      // slot IN on the right: in → inwards → down → back
      d += ` L ${outerRightX} ${y}`;
      d += ` L ${outerRightX} ${nextY}`;
      d += ` L ${innerRightX} ${nextY}`;
    } else {
      // gap: straight down on inner edge
      d += ` L ${innerRightX} ${nextY}`;
    }
    y = nextY;
  }

  // Bottom edge from bottom-right to bottom-left
  d += ` L ${innerLeftX} ${bottomY}`;

  // ---- Left side, going UP with tabs ----
  y = bottomY;
  for (let i = n - 1; i >= 0; i--) {
    const h = segments[i];
    const prevY = y - h;
    const isTabSegment = (i % 2 === 0);

    if (isTabSegment) {
      // tab OUT on the left: in → out → up → in
      d += ` L ${outerLeftX} ${y}`;
      d += ` L ${outerLeftX} ${prevY}`;
      d += ` L ${innerLeftX} ${prevY}`;
    } else {
      // gap: straight up on inner edge
      d += ` L ${innerLeftX} ${prevY}`;
    }
    y = prevY;
  }

  // Close back at the starting point
  d += " Z";
  return d;
}



function rebuildWallsView() {
  if (!wallsSvg) return;

  const t = getMaterialThicknessMm();
  const useJoints = ENABLE_FINGER_JOINTS && t > 0;

  // Clear old contents
  while (wallsSvg.firstChild) {
    wallsSvg.removeChild(wallsSvg.firstChild);
  }

  const rooms = svg.querySelectorAll('rect[data-room]:not([data-feature])');
  if (rooms.length === 0) return;

  const wallHeightPx = wallHeightM / SCALE_M_PER_PX;

  // --------------------------------------------------------
  // 1. Collect base wall segments per axis (room rectangles)
  // --------------------------------------------------------
  const axisGroups = new Map();

  rooms.forEach(roomRect => {
    const roomId = roomRect.dataset.room;
    const x = parseFloat(roomRect.getAttribute("x"));
    const y = parseFloat(roomRect.getAttribute("y"));
    const w = parseFloat(roomRect.getAttribute("width"));
    const h = parseFloat(roomRect.getAttribute("height"));

    const baseWalls = [
      { side: "top",    orientation: "h", axis: y,     start: x,     end: x + w },
      { side: "bottom", orientation: "h", axis: y + h, start: x,     end: x + w },
      { side: "left",   orientation: "v", axis: x,     start: y,     end: y + h },
      { side: "right",  orientation: "v", axis: x + w, start: y,     end: y + h }
    ];

    baseWalls.forEach(wall => {
      const lengthPx = wall.end - wall.start;
      if (lengthPx < 1) return;

      const axisKey = `${wall.orientation}:${wall.axis.toFixed(1)}`;
      if (!axisGroups.has(axisKey)) axisGroups.set(axisKey, []);
      axisGroups.get(axisKey).push({
        roomId,
        side: wall.side,
        orientation: wall.orientation,
        axis: wall.axis,
        start: wall.start,
        end: wall.end
      });
    });
  });

  // --------------------------------------------------------
  // 2. Merge overlapping segments on each axis
  // --------------------------------------------------------
  const mergedSegments = [];

  axisGroups.forEach((segments) => {
    segments.sort((a, b) => a.start - b.start);

    let current = null;
    segments.forEach(seg => {
      if (!current) {
        current = {
          orientation: seg.orientation,
          axis: seg.axis,
          start: seg.start,
          end: seg.end,
          walls: [seg]
        };
        return;
      }

      const eps = 0.5;
      if (seg.start <= current.end + eps) {
        if (seg.end > current.end) current.end = seg.end;
        current.walls.push(seg);
      } else {
        mergedSegments.push(current);
        current = {
          orientation: seg.orientation,
          axis: seg.axis,
          start: seg.start,
          end: seg.end,
          walls: [seg]
        };
      }
    });

    if (current) mergedSegments.push(current);
  });

  if (mergedSegments.length === 0) return;

  // --------------------------------------------------------
  // 3. Layout merged walls into 730x420 sheets
  // --------------------------------------------------------
  const maxWidth    = LASER_WIDTH - 20;   // side margins
  const gapX        = Math.max(5, t);     // spacing grows with thickness
  const gapY        = 8;                  // vertical gap between rows
  const topPadding  = 10;

  const usedSheets = new Set();

  function markSheetUsed(sheetIndex) {
    usedSheets.add(sheetIndex);
  }

  let sheetIndex = 0;
  markSheetUsed(sheetIndex);
  let sheetTop   = 0;

  let cursorX   = 10;
  let baselineY = sheetTop + topPadding + wallHeightPx;

  function startNewRow() {
    cursorX = 10;
    baselineY += wallHeightPx + gapY;
    if (baselineY + 5 > sheetTop + LASER_HEIGHT) {
      sheetIndex++;
      sheetTop = sheetIndex * LASER_HEIGHT;
      markSheetUsed(sheetIndex);
      baselineY = sheetTop + topPadding + wallHeightPx;
    }
  }

  mergedSegments.forEach(seg => {
    const t = getMaterialThicknessMm();
    const wallWidthPx = (seg.end - seg.start) + (isFinite(t) && t > 0 ? t : 0);




    if (wallWidthPx < 1) return;

    const wallKey = [
      seg.orientation,
      seg.axis.toFixed(1),
      seg.start.toFixed(1),
      seg.end.toFixed(1)
    ].join(":");

    if (!wallVisibility.has(wallKey)) wallVisibility.set(wallKey, true);
    const enabled = !!wallVisibility.get(wallKey);

    if (cursorX + wallWidthPx + gapX > maxWidth) {
      startNewRow();
    }

    const wallX = cursorX;
    const wallY = baselineY - wallHeightPx;

    const ns = "http://www.w3.org/2000/svg";
    const outlineD = buildWallOutlinePath(wallX, wallY, wallWidthPx, wallHeightPx, useJoints);

    // --- Visible wall outline (thin) ---
    const wallPath = document.createElementNS(ns, "path");
    wallPath.setAttribute("d", outlineD);
    wallPath.setAttribute("fill", "none");
    wallPath.setAttribute("stroke", "rgb(255,0,0)");
    wallPath.setAttribute("stroke-width", "1");
    wallPath.dataset.wallId = wallKey;
    wallPath.classList.add("wall-strip", enabled ? "enabled" : "disabled");
    setExportFlag(wallPath, enabled); // <-- disabled won't export

    // --- Big invisible hit path (easy clicks) ---
    const hitPath = makeFatHitPath(outlineD, wallKey);
    // hit path should NOT export
    setExportFlag(hitPath, false);

    hitPath.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.wallId;
      const current = !!wallVisibility.get(id);
      wallVisibility.set(id, !current);
      saveLaserVisibility();
      rebuildWallsView();
      e.stopPropagation();
    });

    // Append: hit path first (behind), then actual wall
    wallsSvg.appendChild(hitPath);
    wallsSvg.appendChild(wallPath);

    // --- Label (ONLY export when enabled) ---
    const primary  = seg.walls[0];
    const roomName = getRoomDisplayName(primary.roomId);
    const wallLengthM = wallWidthPx * SCALE_M_PER_PX;

    const label = document.createElementNS(ns, "text");
    const cx = wallX + wallWidthPx / 5;
    const cy = wallY + wallHeightPx / 6;
    label.setAttribute("x", cx);
    label.setAttribute("y", cy);
    label.setAttribute("text-anchor", "middle");

    label.setAttribute("font-size", "2px");
    label.setAttribute("font-family", "Arial, sans-serif");
    label.setAttribute("fill", "rgb(0,0,255)");

    label.classList.add("wall-label", enabled ? "enabled" : "disabled");
    label.dataset.wallId = wallKey;
    setExportFlag(label, enabled); // <-- disabled label won't export

    const studentSpan = document.createElementNS(ns, "tspan");
    studentSpan.setAttribute("x", cx);
    studentSpan.setAttribute("dy", "-0.3em");
    studentSpan.textContent = currentStudentName ? `PHS ${currentStudentName}` : "";
    label.appendChild(studentSpan);


    const nameSpan = document.createElementNS(ns, "tspan");
    nameSpan.setAttribute("x", cx);
    nameSpan.setAttribute("dy", "1.1em");
    nameSpan.textContent = `${roomName} ${primary.side}`;

    const sizeSpan = document.createElementNS(ns, "tspan");
    sizeSpan.setAttribute("x", cx);
    sizeSpan.setAttribute("dy", "1.1em");
    sizeSpan.textContent = `${wallLengthM.toFixed(2)}m`;

    label.appendChild(nameSpan);
    label.appendChild(sizeSpan);
    wallsSvg.appendChild(label);

    // Finger joints + openings ONLY when enabled
    if (enabled && useJoints) {
      drawFingerJointsForWall(wallX, wallY, wallWidthPx, wallHeightPx);
      // those paths should export because enabled:
      // drawFingerJointsForWall currently doesn't set data-export.
      // We’ll rely on buildSheetSvg to export by default unless you change it.
      // If you want joints excluded when disabled (already true), you're good.
    }

    // ------------------------------------------------------
    // Openings (doors / windows) as rectangular holes
    // ------------------------------------------------------
    const openings = [];
    seg.walls.forEach(wall => {
      const feats = svg.querySelectorAll(
        `rect[data-feature][data-room="${wall.roomId}"][data-side="${wall.side}"]`
      );
      feats.forEach(f => openings.push({ feature: f, wall }));
    });

    const doorHeightPxConst = DOOR_HEIGHT_M / SCALE_M_PER_PX;

    if (enabled) {
      openings.forEach(obj => {
        const feature = obj.feature;
        const wall    = obj.wall;

        let offPxLocal = parseFloat(feature.dataset.wallOffsetPx) || 0;
        let lenPx      = parseFloat(feature.dataset.lengthPx)     || 0;

        const globalStart = wall.start + offPxLocal;
        let offPx = globalStart - seg.start;

        if (offPx < 0) offPx = 0;
        if (lenPx < 0) lenPx = 0;
        if (offPx > wallWidthPx) offPx = wallWidthPx;
        if (offPx + lenPx > wallWidthPx) {
          lenPx = wallWidthPx - offPx;
        }
        if (lenPx < 1) return;

        const kind = feature.dataset.feature;

        const holeX = wallX + offPx;
        const holeWidth = lenPx;

        let holeHeight, holeY;

        if (kind === "door") {
          holeHeight = doorHeightPxConst;
          if (holeHeight > wallHeightPx * 0.95) holeHeight = wallHeightPx * 0.95;
          holeY = baselineY - holeHeight;
        } else {
          let headM = parseFloat(feature.dataset.windowHeadM) || WINDOW_HEAD_DEFAULT_M;
          if (headM > wallHeightM) headM = wallHeightM;

          const headPx    = headM / SCALE_M_PER_PX;
          let winHeightPx = WINDOW_HEIGHT_DEFAULT_M / SCALE_M_PER_PX;
          if (winHeightPx > headPx) winHeightPx = headPx;

          holeHeight = winHeightPx;
          holeY      = baselineY - headPx;
        }

        const holeRect = document.createElementNS(ns, "rect");
        holeRect.setAttribute("x", holeX);
        holeRect.setAttribute("y", holeY);
        holeRect.setAttribute("width",  holeWidth);
        holeRect.setAttribute("height", holeHeight);
        holeRect.setAttribute("fill", "#ffffff");
        holeRect.setAttribute("stroke", "rgb(255,0,0)");
        holeRect.setAttribute("stroke-width", "1");
        setExportFlag(holeRect, true); // only exists when enabled anyway
        wallsSvg.appendChild(holeRect);
      });
    }

    cursorX += wallWidthPx + gapX;
  });

  if (joinedMode) {
    addFloorPatch(baselineY, wallHeightPx, gapY, usedSheets, markSheetUsed);
  }

  const sheetCount = usedSheets.size || 1;
  const totalHeight = LASER_HEIGHT * sheetCount;

  wallsSvg.setAttribute("height", totalHeight);
  wallsSvg.setAttribute("viewBox", `0 0 ${LASER_WIDTH} ${totalHeight}`);
}


function addFloorPatch(lastBaselineY, wallHeightPx, gapY, usedSheets, markSheetUsed) {
  const rooms = svg.querySelectorAll('rect[data-room]:not([data-feature])');
  if (rooms.length === 0) return;

  const maxWidth = LASER_WIDTH - 20;
  const gapX     = 5;
  const rowGap   = 8;
  const topPad   = 10;

  let sheetIndex = Math.floor(lastBaselineY / LASER_HEIGHT);
  let sheetTop   = sheetIndex * LASER_HEIGHT;
  markSheetUsed(sheetIndex);

  let currentY = Math.max(lastBaselineY + rowGap, sheetTop + topPad);
  let cursorX   = 10;
  let rowHeight = 0;

  rooms.forEach(r => {
    const wPx = parseFloat(r.getAttribute("width"));
    const hPx = parseFloat(r.getAttribute("height"));
    if (wPx <= 0 || hPx <= 0) return;

    const roomId = r.dataset.room;
    if (!floorVisibility.has(roomId)) floorVisibility.set(roomId, true);
    const enabled = !!floorVisibility.get(roomId);

    if (cursorX + wPx + gapX > maxWidth) {
      cursorX   = 10;
      currentY += rowHeight + rowGap;
      rowHeight = 0;
    }

    if (currentY + hPx + topPad > sheetTop + LASER_HEIGHT) {
      sheetIndex++;
      sheetTop   = sheetIndex * LASER_HEIGHT;
      markSheetUsed(sheetIndex);
      currentY   = sheetTop + topPad;
      cursorX    = 10;
      rowHeight  = 0;
    }

    const floorX = cursorX;
    const floorY = currentY;

    const ns = "http://www.w3.org/2000/svg";

    // Visible floor outline
    const floorRect = document.createElementNS(ns, "rect");
    floorRect.setAttribute("x", floorX);
    floorRect.setAttribute("y", floorY);
    floorRect.setAttribute("width",  wPx);
    floorRect.setAttribute("height", hPx);
    floorRect.dataset.floorId = roomId;
    floorRect.classList.add("floor-strip", enabled ? "enabled" : "disabled");
    floorRect.setAttribute("fill", "none");
    floorRect.setAttribute("stroke", "rgb(255,0,0)");
    floorRect.setAttribute("stroke-width", "1");
    setExportFlag(floorRect, enabled); // disabled floor won't export

    // Bigger invisible hit rect
    const hit = document.createElementNS(ns, "rect");
    hit.setAttribute("x", floorX - FLOOR_HIT_PAD_PX);
    hit.setAttribute("y", floorY - FLOOR_HIT_PAD_PX);
    hit.setAttribute("width",  wPx + FLOOR_HIT_PAD_PX * 2);
    hit.setAttribute("height", hPx + FLOOR_HIT_PAD_PX * 2);
    hit.setAttribute("fill", "rgba(0,0,0,0)");
    hit.setAttribute("pointer-events", "all");
    hit.dataset.floorId = roomId;
    setExportFlag(hit, false); // never export the hitbox

    hit.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.floorId;
      const current = !!floorVisibility.get(id);
      floorVisibility.set(id, !current);
      saveLaserVisibility();
      rebuildWallsView();
      e.stopPropagation();
    });

    wallsSvg.appendChild(hit);
    wallsSvg.appendChild(floorRect);

    const widthM  = wPx * SCALE_M_PER_PX;
    const heightM = hPx * SCALE_M_PER_PX;
    const roomName = getRoomDisplayName(roomId);

    const label = document.createElementNS(ns, "text");
const cx = floorX + wPx / 2;       // match wall label placement style
const cy = floorY + hPx / 2;
label.setAttribute("x", cx);
label.setAttribute("y", cy);
label.setAttribute("text-anchor", "middle");

label.setAttribute("font-size", "2px");
label.setAttribute("font-family", "Arial, sans-serif");
label.setAttribute("fill", "rgb(0,0,255)");

label.classList.add("floor-label", enabled ? "enabled" : "disabled");
setExportFlag(label, enabled);

    const nameSpan = document.createElementNS(ns, "tspan");
    nameSpan.setAttribute("x", cx);
    nameSpan.setAttribute("dy", "-0.2em");
    nameSpan.textContent = `${roomName} floor`;


    const sizeSpan = document.createElementNS(ns, "tspan");
    sizeSpan.setAttribute("x", cx);
    sizeSpan.setAttribute("dy", "1.0em");
    sizeSpan.textContent = `${widthM.toFixed(2)}m × ${heightM.toFixed(2)}m`;

    label.appendChild(nameSpan);
    label.appendChild(sizeSpan);
    wallsSvg.appendChild(label);

    cursorX   += wPx + gapX;
    if (hPx > rowHeight) rowHeight = hPx;
  });
}


// Wall height change => rebuild walls
wallHeightInput.addEventListener("change", () => {
  const val = parseFloat(wallHeightInput.value);
  if (isFinite(val) && val > 0) {
    wallHeightM = val;
    rebuildWallsView();
  }
});


// ===== Hitbox + Export + Storage helpers =====
const WALL_HIT_STROKE_PX = 18;   // <-- bigger = easier to click
const FLOOR_HIT_PAD_PX   = 10;
const VIS_STORAGE_KEY    = "laser_visibility_v1";

function makeFatHitPath(d, wallKey) {
  const ns = "http://www.w3.org/2000/svg";
  const hit = document.createElementNS(ns, "path");
  hit.setAttribute("d", d);
  hit.setAttribute("fill", "none");
  hit.setAttribute("stroke", "rgba(0,0,0,0)");     // invisible
  hit.setAttribute("stroke-width", String(WALL_HIT_STROKE_PX));
  hit.setAttribute("pointer-events", "stroke");    // only stroke is clickable
  hit.dataset.wallId = wallKey;
  hit.classList.add("wall-hit");
  return hit;
}

function makeFloorKeyFromRoomRect(roomRect) {
  const roomId = roomRect.dataset.room || "unknown";
  return `${roomId} floor`;
}



// Mark nodes as exportable or not. buildSheetSvg will filter by this.
function setExportFlag(node, enabled) {
  // "1" = export; "0" = do not export
  node.setAttribute("data-export", enabled ? "1" : "0");
}

// Save/load visibility maps (walls + floors)
function saveLaserVisibility() {
  try {
    const payload = {
  v: 1,
  studentName: currentStudentName,
  wallVisibility: Array.from(wallVisibility.entries()),
  floorVisibility: Array.from(floorVisibility.entries())
};

    localStorage.setItem(VIS_STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("saveLaserVisibility failed", e);
  }
}

function loadLaserVisibility() {
  try {
    const raw = localStorage.getItem(VIS_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1) return;

    if (typeof parsed.studentName === "string") {
      currentStudentName = parsed.studentName;
    }

    if (Array.isArray(parsed.wallVisibility)) {
      wallVisibility = new Map(parsed.wallVisibility);
    }
    if (Array.isArray(parsed.floorVisibility)) {
      floorVisibility = new Map(parsed.floorVisibility);
    }
  } catch (e) {
    console.warn("loadLaserVisibility failed", e);
  }
}





// ==========================================================
// SVG EXPORT HELPERS
// ==========================================================

// Build a standalone SVG element for one sheet index
function buildSheetSvg(sheetIndex) {
  const ns = "http://www.w3.org/2000/svg";

  const sheetTop = sheetIndex * LASER_HEIGHT;
  const sheetBottom = sheetTop + LASER_HEIGHT;

  const sheetSvg = document.createElementNS(ns, "svg");
  sheetSvg.setAttribute("xmlns", ns);
  sheetSvg.setAttribute("width", LASER_WIDTH);
  sheetSvg.setAttribute("height", LASER_HEIGHT);
  sheetSvg.setAttribute("viewBox", `0 0 ${LASER_WIDTH} ${LASER_HEIGHT}`);

  const g = document.createElementNS(ns, "g");
  g.setAttribute("transform", `translate(0, -${sheetTop})`);

  const children = Array.from(wallsSvg.childNodes);
  children.forEach(node => {
    if (!node || node.nodeType !== 1) return; // element nodes only
    if (typeof node.getBBox !== "function") return;

    // *** Filter out anything marked non-export ***
    const exportFlag = node.getAttribute("data-export");
    if (exportFlag === "0") return;

    let bb;
    try { bb = node.getBBox(); } catch (e) { return; }

    const bbTop = bb.y;
    const bbBottom = bb.y + bb.height;

    if (bbBottom > sheetTop && bbTop < sheetBottom) {
      const clone = node.cloneNode(true);

      // Make exported SVG clean (no hitboxes / pointer behavior)
      clone.removeAttribute("pointer-events");
      clone.classList.remove("wall-hit");

      g.appendChild(clone);
    }
  });

  sheetSvg.appendChild(g);
  return sheetSvg;
}


// Download all sheets as separate SVG files
window.downloadAllSheetsAsSvg = function () {
  if (!wallsSvg) {
    alert("No walls SVG found.");
    return;
  }

  // Make sure layout is up to date
  rebuildWallsView();

  const totalHeightAttr = parseFloat(wallsSvg.getAttribute("height")) || LASER_HEIGHT;
  const sheetCount = Math.max(1, Math.ceil(totalHeightAttr / LASER_HEIGHT));

  for (let i = 0; i < sheetCount; i++) {
    const sheetSvg = buildSheetSvg(i);

    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(sheetSvg);

    if (!source.match(/^<\?xml/)) {
      source = '<?xml version="1.0" standalone="no"?>\n' + source;
    }

    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `laser_sheet_${i + 1}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  loadLaserVisibility();   // <-- restores wall/floor toggles
  rebuildWallsView();

  const downloadBtn = document.getElementById("downloadSheetsBtn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      window.downloadAllSheetsAsSvg();
    });
  }
});

