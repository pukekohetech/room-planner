// ==========================================================
// Walls (laser view) - merged walls + toggles + floor patch
// (rewritten: clears stale laser output, safe init order,
// no double-download, no NaN junk, touch-friendly toggles)
// Requires: common.js for globals & helpers
// ==========================================================

/* global svg, wallsSvg, wallHeightInput, wallHeightM, SCALE_M_PER_PX,
          ENABLE_FINGER_JOINTS, LASER_WIDTH, LASER_HEIGHT, joinedMode,
          wallVisibility, floorVisibility, currentStudentName,
          DOOR_HEIGHT_M, WINDOW_HEAD_DEFAULT_M, WINDOW_HEIGHT_DEFAULT_M,
          getMaterialThicknessMm, getRoomDisplayName */

const IS_COARSE_POINTER =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(pointer: coarse)").matches;

// ==========================================================
// Touch-friendly helpers
// ==========================================================

function addTapHandler(el, onTap, opts = {}) {
  const moveThreshold = opts.moveThreshold ?? (IS_COARSE_POINTER ? 12 : 8);

  let startX = 0;
  let startY = 0;
  let moved = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.isPrimary === false) return;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
    try { el.setPointerCapture?.(e.pointerId); } catch {}
  });

  el.addEventListener("pointermove", (e) => {
    if (Math.abs(e.clientX - startX) > moveThreshold || Math.abs(e.clientY - startY) > moveThreshold) {
      moved = true;
    }
  });

  el.addEventListener("pointerup", (e) => {
    if (moved) return;
    e.preventDefault?.();
    onTap(e);
  });
}

// ==========================================================
// Hitbox + Export helpers
// ==========================================================

const WALL_HIT_STROKE_PX = IS_COARSE_POINTER ? 30 : 18;
const FLOOR_HIT_PAD_PX   = IS_COARSE_POINTER ? 16 : 10;

function setExportFlag(node, enabled) {
  node.setAttribute("data-export", enabled ? "1" : "0");
}

function makeFatHitPath(d, wallKey) {
  const ns = "http://www.w3.org/2000/svg";
  const hit = document.createElementNS(ns, "path");
  hit.setAttribute("d", d);
  hit.setAttribute("fill", "none");
  hit.setAttribute("stroke", "rgba(0,0,0,0)");
  hit.setAttribute("stroke-width", String(WALL_HIT_STROKE_PX));
  hit.setAttribute("pointer-events", "stroke");
  hit.dataset.wallId = wallKey;
  hit.classList.add("wall-hit");
  hit.style.cursor = "pointer";
  return hit;
}

// ==========================================================
// Finger joints (ONLY as part of the wall outline)
// (we DO NOT draw separate joint paths anymore)
// ==========================================================

function buildWallOutlinePath(wallX, wallY, wallWidthPx, wallHeightPx, useJoints) {
  const t = getMaterialThicknessMm();

  if (!useJoints || !ENABLE_FINGER_JOINTS || !isFinite(t) || t <= 0) {
    const x1 = wallX, y1 = wallY;
    const x2 = wallX + wallWidthPx;
    const y2 = wallY + wallHeightPx;
    return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`;
  }

  const pitch       = t;
  const innerLeftX  = wallX;
  const outerLeftX  = wallX - t;
  const innerRightX = wallX + wallWidthPx;
  const outerRightX = innerRightX - t;

  const segments = [];
  let remaining = wallHeightPx;
  while (remaining > 0) {
    const h = Math.min(pitch, remaining);
    segments.push(h);
    remaining -= h;
  }

  const topY    = wallY;
  const bottomY = wallY + wallHeightPx;

  let d = `M ${innerLeftX} ${topY} L ${innerRightX} ${topY}`;

  // Right side down (slots)
  let y = topY;
  for (let i = 0; i < segments.length; i++) {
    const h = segments[i];
    const nextY = y + h;
    const isTabSegment = (i % 2 === 0);

    if (isTabSegment) {
      d += ` L ${outerRightX} ${y} L ${outerRightX} ${nextY} L ${innerRightX} ${nextY}`;
    } else {
      d += ` L ${innerRightX} ${nextY}`;
    }
    y = nextY;
  }

  // Bottom edge
  d += ` L ${innerLeftX} ${bottomY}`;

  // Left side up (tabs)
  y = bottomY;
  for (let i = segments.length - 1; i >= 0; i--) {
    const h = segments[i];
    const prevY = y - h;
    const isTabSegment = (i % 2 === 0);

    if (isTabSegment) {
      d += ` L ${outerLeftX} ${y} L ${outerLeftX} ${prevY} L ${innerLeftX} ${prevY}`;
    } else {
      d += ` L ${innerLeftX} ${prevY}`;
    }
    y = prevY;
  }

  d += " Z";
  return d;
}

// ==========================================================
// Main rebuild
// ==========================================================

function clearWallsSvgToEmptySheet() {
  if (!wallsSvg) return;

  while (wallsSvg.firstChild) wallsSvg.removeChild(wallsSvg.firstChild);

  wallsSvg.setAttribute("height", LASER_HEIGHT);
  wallsSvg.setAttribute("viewBox", `0 0 ${LASER_WIDTH} ${LASER_HEIGHT}`);
}

function rebuildWallsView() {
  if (!wallsSvg || !svg) return;

  clearWallsSvgToEmptySheet();

  const rooms = svg.querySelectorAll('rect[data-room]:not([data-feature])');
  if (!rooms || rooms.length === 0) return;

  const t = getMaterialThicknessMm();
  const thickness = (isFinite(t) && t > 0) ? t : 0;
  const useJoints = ENABLE_FINGER_JOINTS && thickness > 0;

  const wallHeightPx = wallHeightM / SCALE_M_PER_PX;

  // --------------------------------------------------------
  // 1) Collect base wall segments per axis (room rectangles)
  // --------------------------------------------------------
  const axisGroups = new Map();

  rooms.forEach(roomRect => {
    const roomId = roomRect.dataset.room;

    const x = parseFloat(roomRect.getAttribute("x"));
    const y = parseFloat(roomRect.getAttribute("y"));
    const w = parseFloat(roomRect.getAttribute("width"));
    const h = parseFloat(roomRect.getAttribute("height"));

    if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return;

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
  // 2) Merge overlapping segments on each axis
  // --------------------------------------------------------
  const mergedSegments = [];
  const eps = 0.5;

  axisGroups.forEach((segments) => {
    segments.sort((a, b) => a.start - b.start);

    let current = null;
    segments.forEach(seg => {
      if (!current) {
        current = { orientation: seg.orientation, axis: seg.axis, start: seg.start, end: seg.end, walls: [seg] };
        return;
      }

      if (seg.start <= current.end + eps) {
        if (seg.end > current.end) current.end = seg.end;
        current.walls.push(seg);
      } else {
        mergedSegments.push(current);
        current = { orientation: seg.orientation, axis: seg.axis, start: seg.start, end: seg.end, walls: [seg] };
      }
    });

    if (current) mergedSegments.push(current);
  });

  if (mergedSegments.length === 0) return;

  // --------------------------------------------------------
  // 3) Layout merged walls into 730x420 sheets
  // --------------------------------------------------------
  const maxWidth   = LASER_WIDTH - 20;
  const gapX       = Math.max(5, thickness);
  const gapY       = 8;
  const topPadding = 10;

  const usedSheets = new Set();
  const markSheetUsed = (idx) => usedSheets.add(idx);

  let sheetIndex = 0;
  let sheetTop   = 0;
  markSheetUsed(sheetIndex);

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
    const baseWidthPx = seg.end - seg.start;        // the true wall span
    const wallWidthPx = baseWidthPx + thickness;    // 🔥 extend by exactly 1 material thickness

    if (!isFinite(baseWidthPx) || baseWidthPx < 1) return;
    if (!isFinite(wallWidthPx) || wallWidthPx < 1) return;

    const wallKey = [
      seg.orientation,
      seg.axis.toFixed(1),
      seg.start.toFixed(1),
      seg.end.toFixed(1)
    ].join(":");

    if (!wallVisibility.has(wallKey)) wallVisibility.set(wallKey, true);
    const enabled = !!wallVisibility.get(wallKey);

    if (cursorX + wallWidthPx + gapX > maxWidth) startNewRow();

    const wallX = cursorX;
    const wallY = baselineY - wallHeightPx;

    const ns = "http://www.w3.org/2000/svg";
    const outlineD = buildWallOutlinePath(wallX, wallY, wallWidthPx, wallHeightPx, useJoints);

    // Visible outline
    const wallPath = document.createElementNS(ns, "path");
    wallPath.setAttribute("d", outlineD);
    wallPath.setAttribute("fill", "none");
    wallPath.setAttribute("stroke", "rgb(255,0,0)");
    wallPath.setAttribute("stroke-width", "1");
    wallPath.dataset.wallId = wallKey;
    wallPath.classList.add("wall-strip", enabled ? "enabled" : "disabled");
    setExportFlag(wallPath, enabled);

    // Fat hit path (never exported)
    const hitPath = makeFatHitPath(outlineD, wallKey);
    setExportFlag(hitPath, false);

    addTapHandler(hitPath, (e) => {
      const id = e.currentTarget.dataset.wallId;
      wallVisibility.set(id, !wallVisibility.get(id));
      if (typeof requestAutoSave === "function") requestAutoSave("toggle wall");
      rebuildWallsView();
      e.stopPropagation();
    });

    wallsSvg.appendChild(hitPath);
    wallsSvg.appendChild(wallPath);

    // Label (export only when enabled)
    const primary  = seg.walls[0];
    const roomName = getRoomDisplayName(primary.roomId);
    const wallLengthM = wallWidthPx * SCALE_M_PER_PX;

    const label = document.createElementNS(ns, "text");
    const cx = wallX + wallWidthPx / 4;
    const cy = wallY + wallHeightPx / 4;

    label.setAttribute("x", cx);
    label.setAttribute("y", cy);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "2px");
    label.setAttribute("font-family", "Arial, sans-serif");
    label.setAttribute("fill", "rgb(0,0,255)");
    label.classList.add("wall-label", enabled ? "enabled" : "disabled");
    label.dataset.wallId = wallKey;
    setExportFlag(label, enabled);

    const studentSpan = document.createElementNS(ns, "tspan");
    studentSpan.setAttribute("x", cx);
    studentSpan.setAttribute("dy", "-0.3em");
    studentSpan.textContent = currentStudentName ? `PHS ${currentStudentName}` : "";
    label.appendChild(studentSpan);

    const nameSpan = document.createElementNS(ns, "tspan");
    nameSpan.setAttribute("x", cx);
    nameSpan.setAttribute("dy", "1.1em");
    nameSpan.textContent = `${roomName} ${primary.side}`;
    label.appendChild(nameSpan);

    const sizeSpan = document.createElementNS(ns, "tspan");
    sizeSpan.setAttribute("x", cx);
    sizeSpan.setAttribute("dy", "1.1em");
    sizeSpan.textContent = isFinite(wallLengthM) ? `${wallLengthM.toFixed(2)}m` : "";
    label.appendChild(sizeSpan);

    wallsSvg.appendChild(label);

    // ------------------------------------------------------
    // Openings (doors/windows) as rectangular holes
    // IMPORTANT: clamp openings to BASE wall span only
    // (so the +thickness tail does not get random holes)
    // ------------------------------------------------------
    if (enabled) {
      const openings = [];
      seg.walls.forEach(wall => {
        const feats = svg.querySelectorAll(
          `rect[data-feature][data-room="${wall.roomId}"][data-side="${wall.side}"]`
        );
        feats.forEach(f => openings.push({ feature: f, wall }));
      });

      const doorHeightPxConst = DOOR_HEIGHT_M / SCALE_M_PER_PX;

      openings.forEach(({ feature, wall }) => {
        let offPxLocal = parseFloat(feature.dataset.wallOffsetPx);
        if (!isFinite(offPxLocal)) offPxLocal = 0;

        let lenPx = parseFloat(feature.dataset.lengthPx);
        if (!isFinite(lenPx)) lenPx = 0;

        const globalStart = wall.start + offPxLocal;
        let offPx = globalStart - seg.start;

        // clamp to BASE span
        offPx = Math.max(0, Math.min(offPx, baseWidthPx));
        lenPx = Math.max(0, lenPx);
        if (offPx + lenPx > baseWidthPx) lenPx = baseWidthPx - offPx;
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
          let headM = parseFloat(feature.dataset.windowHeadM);
          if (!isFinite(headM)) headM = WINDOW_HEAD_DEFAULT_M;
          if (headM > wallHeightM) headM = wallHeightM;

          const headPx = headM / SCALE_M_PER_PX;
          let winHeightPx = WINDOW_HEIGHT_DEFAULT_M / SCALE_M_PER_PX;
          if (winHeightPx > headPx) winHeightPx = headPx;

          holeHeight = winHeightPx;
          holeY = baselineY - headPx;
        }

        const holeRect = document.createElementNS(ns, "rect");
        holeRect.setAttribute("x", holeX);
        holeRect.setAttribute("y", holeY);
        holeRect.setAttribute("width",  holeWidth);
        holeRect.setAttribute("height", holeHeight);
        holeRect.setAttribute("fill", "none");
        holeRect.setAttribute("stroke", "rgb(255,0,0)");
        holeRect.setAttribute("stroke-width", "1");
        setExportFlag(holeRect, true);
        wallsSvg.appendChild(holeRect);
      });
    }

    cursorX += wallWidthPx + gapX;
  });

  if (joinedMode) {
    addFloorPatch(baselineY, usedSheets, markSheetUsed);
  }

  const sheetCount = usedSheets.size || 1;
  const totalHeight = LASER_HEIGHT * sheetCount;

  wallsSvg.setAttribute("height", totalHeight);
  wallsSvg.setAttribute("viewBox", `0 0 ${LASER_WIDTH} ${totalHeight}`);
}

// ==========================================================
// Floor patch (laser pieces)
// ==========================================================

function addFloorPatch(lastBaselineY, usedSheets, markSheetUsed) {
  const rooms = svg.querySelectorAll('rect[data-room]:not([data-feature])');
  if (!rooms || rooms.length === 0) return;

  const maxWidth = LASER_WIDTH - 20;
  const gapX     = 5;
  const rowGap   = 8;
  const topPad   = 10;

  let sheetIndex = Math.floor(lastBaselineY / LASER_HEIGHT);
  let sheetTop   = sheetIndex * LASER_HEIGHT;
  markSheetUsed(sheetIndex);

  let currentY  = Math.max(lastBaselineY + rowGap, sheetTop + topPad);
  let cursorX   = 10;
  let rowHeight = 0;

  rooms.forEach(r => {
    const wPx = parseFloat(r.getAttribute("width"));
    const hPx = parseFloat(r.getAttribute("height"));

    if (!isFinite(wPx) || !isFinite(hPx) || wPx <= 0 || hPx <= 0) return;

    const roomId = r.dataset.room;
    if (!floorVisibility.has(roomId)) floorVisibility.set(roomId, true);
    const enabled = !!floorVisibility.get(roomId);

    if (cursorX + wPx + gapX > maxWidth) {
      cursorX = 10;
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
    const floorW = wPx;
    const floorH = hPx;

    const ns = "http://www.w3.org/2000/svg";

    const floorRect = document.createElementNS(ns, "rect");
    floorRect.setAttribute("x", floorX);
    floorRect.setAttribute("y", floorY);
    floorRect.setAttribute("width",  floorW);
    floorRect.setAttribute("height", floorH);
    floorRect.dataset.floorId = roomId;
    floorRect.classList.add("floor-strip", enabled ? "enabled" : "disabled");
    floorRect.setAttribute("fill", "none");
    floorRect.setAttribute("stroke", "rgb(255,0,0)");
    floorRect.setAttribute("stroke-width", "1");
    setExportFlag(floorRect, enabled);

    const hit = document.createElementNS(ns, "rect");
    hit.setAttribute("x", floorX - FLOOR_HIT_PAD_PX);
    hit.setAttribute("y", floorY - FLOOR_HIT_PAD_PX);
    hit.setAttribute("width",  floorW + FLOOR_HIT_PAD_PX * 2);
    hit.setAttribute("height", floorH + FLOOR_HIT_PAD_PX * 2);
    hit.setAttribute("fill", "rgba(0,0,0,0)");
    hit.setAttribute("pointer-events", "all");
    hit.dataset.floorId = roomId;
    hit.style.cursor = "pointer";
    setExportFlag(hit, false);

    addTapHandler(hit, (e) => {
      const id = e.currentTarget.dataset.floorId;
      floorVisibility.set(id, !floorVisibility.get(id));
      if (typeof requestAutoSave === "function") requestAutoSave("toggle floor");
      rebuildWallsView();
      e.stopPropagation();
    });

    wallsSvg.appendChild(hit);
    wallsSvg.appendChild(floorRect);

    const widthM  = floorW * SCALE_M_PER_PX;
    const heightM = floorH * SCALE_M_PER_PX;
    const roomName = getRoomDisplayName(roomId);

    const label = document.createElementNS(ns, "text");
    const cx = floorX + floorW / 2;
    const cy = floorY + floorH / 2;

    label.setAttribute("x", cx);
    label.setAttribute("y", cy);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "2px");
    label.setAttribute("font-family", "Arial, sans-serif");
    label.setAttribute("fill", "rgb(0,0,255)");
    label.classList.add("floor-label", enabled ? "enabled" : "disabled");
    setExportFlag(label, enabled);

    const studentSpan = document.createElementNS(ns, "tspan");
    studentSpan.setAttribute("x", cx);
    studentSpan.setAttribute("dy", "-0.6em");
    studentSpan.textContent = currentStudentName ? `PHS ${currentStudentName}` : "";
    label.appendChild(studentSpan);

    const nameSpan = document.createElementNS(ns, "tspan");
    nameSpan.setAttribute("x", cx);
    nameSpan.setAttribute("dy", "1.1em");
    nameSpan.textContent = `${roomName} floor`;
    label.appendChild(nameSpan);

    const sizeSpan = document.createElementNS(ns, "tspan");
    sizeSpan.setAttribute("x", cx);
    sizeSpan.setAttribute("dy", "1.1em");
    sizeSpan.textContent =
      (isFinite(widthM) && isFinite(heightM))
        ? `${widthM.toFixed(2)}m × ${heightM.toFixed(2)}m`
        : "";
    label.appendChild(sizeSpan);

    wallsSvg.appendChild(label);

    cursorX += wPx + gapX;
    rowHeight = Math.max(rowHeight, hPx);
  });
}

// ==========================================================
// SVG EXPORT HELPERS
// ==========================================================

function buildSheetSvg(sheetIndex) {
  const ns = "http://www.w3.org/2000/svg";

  const sheetTop    = sheetIndex * LASER_HEIGHT;
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
    if (!node || node.nodeType !== 1) return;
    if (typeof node.getBBox !== "function") return;

    if (node.getAttribute("data-export") === "0") return;

    let bb;
    try { bb = node.getBBox(); } catch { return; }

    const bbTop = bb.y;
    const bbBottom = bb.y + bb.height;

    if (bbBottom > sheetTop && bbTop < sheetBottom) {
      const clone = node.cloneNode(true);
      clone.removeAttribute("pointer-events");
      clone.classList.remove("wall-hit");
      g.appendChild(clone);
    }
  });

  sheetSvg.appendChild(g);
  return sheetSvg;
}

window.downloadAllSheetsAsSvg = function () {
  if (!wallsSvg) {
    alert("No walls SVG found.");
    return;
  }

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

// ==========================================================
// Init
// ==========================================================

function initWallsView() {
  rebuildWallsView();

  const downloadBtn = document.getElementById("downloadSheetsBtn");
  if (downloadBtn) {
    downloadBtn.onclick = () => window.downloadAllSheetsAsSvg();
  }

  if (wallHeightInput) {
    wallHeightInput.addEventListener("change", () => {
      const val = parseFloat(wallHeightInput.value);
      if (isFinite(val) && val > 0) {
        wallHeightM = val;
        rebuildWallsView();
        requestAutoSave?.("wall height");
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", initWallsView);
