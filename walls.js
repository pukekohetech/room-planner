// ==========================================================
// walls.js — Laser view + toggles + export (clean rebuild)
// ==========================================================

/* global svg, wallsSvg, wallHeightInput, wallHeightM, SCALE_M_PER_PX,
          ENABLE_FINGER_JOINTS, LASER_WIDTH, LASER_HEIGHT, joinedMode,
          wallVisibility, floorVisibility, currentStudentName,
          DOOR_HEIGHT_M, WINDOW_HEAD_DEFAULT_M, WINDOW_HEIGHT_DEFAULT_M,
          getMaterialThicknessMm, getRoomDisplayName, requestAutoSave */

// ---------- Pointer type ----------
const IS_COARSE_POINTER =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(pointer: coarse)").matches;

// ---------- Hit sizes ----------
const WALL_HIT_STROKE_PX = IS_COARSE_POINTER ? 30 : 18;
const FLOOR_HIT_PAD_PX   = IS_COARSE_POINTER ? 16 : 10;

// ==========================================================
// Export helpers
// ==========================================================
function setExportFlag(node, enabled) {
  node.setAttribute("data-export", enabled ? "1" : "0");
}

// ==========================================================
// Touch-friendly tap handler (safe)
// - Prevents accidental “tap” when finger moves.
// - Does NOT interfere with pinch (pinch belongs in plan.js).
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

  el.addEventListener("pointercancel", () => {});
}

// ==========================================================
// Hitbox builders (never exported)
// ==========================================================
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
  setExportFlag(hit, false);
  return hit;
}

function makeFatHitRect(x, y, w, h, floorId) {
  const ns = "http://www.w3.org/2000/svg";
  const hit = document.createElementNS(ns, "rect");
  hit.setAttribute("x", x - FLOOR_HIT_PAD_PX);
  hit.setAttribute("y", y - FLOOR_HIT_PAD_PX);
  hit.setAttribute("width",  w + FLOOR_HIT_PAD_PX * 2);
  hit.setAttribute("height", h + FLOOR_HIT_PAD_PX * 2);
  hit.setAttribute("fill", "rgba(0,0,0,0)");
  hit.setAttribute("pointer-events", "all");
  hit.dataset.floorId = floorId;
  hit.style.cursor = "pointer";
  setExportFlag(hit, false);
  return hit;
}

// ==========================================================
// Finger-joint outline generator (single outline path)
// ==========================================================
function buildWallOutlinePath(wallX, wallY, wallWidthPx, wallHeightPx, useJoints) {
  const t = getMaterialThicknessMm?.();

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
// Core build helpers
// ==========================================================
function clearWallsSvgToEmptySheet() {
  if (!wallsSvg) return;
  while (wallsSvg.firstChild) wallsSvg.removeChild(wallsSvg.firstChild);
  wallsSvg.setAttribute("height", LASER_HEIGHT);
  wallsSvg.setAttribute("viewBox", `0 0 ${LASER_WIDTH} ${LASER_HEIGHT}`);
}

function getRooms() {
  if (!svg) return [];
  const selector =
    typeof ROOM_ELEMENT_SELECTOR !== "undefined"
      ? ROOM_ELEMENT_SELECTOR
      : 'rect[data-room]:not([data-feature]), polygon[data-room]:not([data-feature])';
  return Array.from(svg.querySelectorAll(selector));
}

function parseWallPoints(pointsString) {
  return String(pointsString || "")
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })
    .filter(Boolean);
}

function getRoomPlanPoints(roomEl) {
  if (!roomEl) return [];

  if (roomEl.tagName?.toLowerCase() === "polygon") {
    return parseWallPoints(roomEl.getAttribute("points"));
  }

  const x = parseFloat(roomEl.getAttribute("x"));
  const y = parseFloat(roomEl.getAttribute("y"));
  const w = parseFloat(roomEl.getAttribute("width"));
  const h = parseFloat(roomEl.getAttribute("height"));
  if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return [];

  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function getPointsBounds(points) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map((pt) => pt.x);
  const ys = points.map((pt) => pt.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function getPointsCentre(points) {
  if (!points.length) return { x: 0, y: 0 };
  const total = points.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

function rotateWallPointAround(point, centre, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

function getRoomFloorLayoutPoints(roomEl) {
  const points = getRoomPlanPoints(roomEl);
  if (points.length < 3) return points;

  // Wall pieces should reflect the rotated room, but floor pieces do not need
  // to be rotated on the laser bed. Rotate the floor outline back to the
  // room's unrotated/base orientation before laying it out.
  const angle = parseFloat(roomEl?.dataset?.roomRotationDeg || "0") || 0;
  if (Math.abs(angle) < 0.001) return points;

  const centre = getPointsCentre(points);
  return points.map((pt) => rotateWallPointAround(pt, centre, -angle));
}

function formatWallPoints(points) {
  return points.map((pt) => `${Math.round(pt.x * 10) / 10},${Math.round(pt.y * 10) / 10}`).join(" ");
}

function getWallSideName(p1, p2, bounds, index) {
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const eps = 0.5;

  if (Math.abs(dy) <= eps) {
    return Math.abs(midY - bounds.y) <= Math.abs(midY - (bounds.y + bounds.h)) ? "top" : "bottom";
  }
  if (Math.abs(dx) <= eps) {
    return Math.abs(midX - bounds.x) <= Math.abs(midX - (bounds.x + bounds.w)) ? "left" : "right";
  }
  return `angled ${index + 1}`;
}


function fixedForKey(value, places = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return (0).toFixed(places);
  const p = Math.pow(10, places);
  return (Math.round(n * p) / p).toFixed(places);
}

function getCanonicalSegmentData(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthPx = Math.hypot(dx, dy);
  if (!Number.isFinite(lengthPx) || lengthPx < 1) return null;

  let ux = dx / lengthPx;
  let uy = dy / lengthPx;

  // Use one stable direction for both ways along the same line.
  if (ux < -0.000001 || (Math.abs(ux) <= 0.000001 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }

  const nx = -uy;
  const ny = ux;
  const axis = p1.x * nx + p1.y * ny;
  const t1 = p1.x * ux + p1.y * uy;
  const t2 = p2.x * ux + p2.y * uy;
  const start = Math.min(t1, t2);
  const end = Math.max(t1, t2);
  const dirSign = t2 >= t1 ? 1 : -1;

  return {
    ux,
    uy,
    nx,
    ny,
    axis,
    start,
    end,
    dirSign,
    lengthPx,
    groupKey: `d:${fixedForKey(ux, 3)}:${fixedForKey(uy, 3)}:${fixedForKey(axis, 1)}`,
  };
}

function pushMergedWallSegment(list, current) {
  if (!current) return;
  current.lengthPx = current.end - current.start;
  if (!Number.isFinite(current.lengthPx) || current.lengthPx < 1) return;

  if (!current.key) {
    if (current.orientation === "d") {
      current.key = [
        "d",
        fixedForKey(current.ux, 3),
        fixedForKey(current.uy, 3),
        fixedForKey(current.axis, 1),
        fixedForKey(current.start, 1),
        fixedForKey(current.end, 1),
      ].join(":");
    } else {
      current.key = [
        current.orientation,
        fixedForKey(current.axis, 1),
        fixedForKey(current.start, 1),
        fixedForKey(current.end, 1),
      ].join(":");
    }
  }

  list.push(current);
}

// ==========================================================
// Main rebuild
// ==========================================================
function rebuildWallsView() {
  if (!wallsSvg || !svg) return;

  clearWallsSvgToEmptySheet();

  const rooms = getRooms();
  if (!rooms.length) return;

  const t = getMaterialThicknessMm?.();
  const thickness = (isFinite(t) && t > 0) ? t : 0;
  const useJoints = ENABLE_FINGER_JOINTS && thickness > 0;

  const wallHeightPx = wallHeightM / SCALE_M_PER_PX;
  if (!isFinite(wallHeightPx) || wallHeightPx <= 0) return;

  // 1) collect wall segments from rectangles and polygon rooms.
  // Horizontal, vertical, and diagonal walls are all grouped by their real line,
  // then overlapping/touching sections are merged into one laser strip.
  const axisGroups = new Map();
  const diagonalGroups = new Map();

  rooms.forEach(roomEl => {
    const roomId = roomEl.dataset.room;
    const points = getRoomPlanPoints(roomEl);
    if (points.length < 3) return;

    const bounds = getPointsBounds(points);

    points.forEach((p1, i) => {
      const p2 = points[(i + 1) % points.length];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthPx = Math.hypot(dx, dy);
      if (!isFinite(lengthPx) || lengthPx < 1) return;

      const side = getWallSideName(p1, p2, bounds, i);
      const eps = 0.5;
      const isHorizontal = Math.abs(dy) <= eps;
      const isVertical = Math.abs(dx) <= eps;

      if (isHorizontal || isVertical) {
        const orientation = isHorizontal ? "h" : "v";
        const axis = isHorizontal ? p1.y : p1.x;
        const start = isHorizontal ? Math.min(p1.x, p2.x) : Math.min(p1.y, p2.y);
        const end = isHorizontal ? Math.max(p1.x, p2.x) : Math.max(p1.y, p2.y);
        const axisKey = `${orientation}:${fixedForKey(axis, 1)}`;

        if (!axisGroups.has(axisKey)) axisGroups.set(axisKey, []);
        axisGroups.get(axisKey).push({
          roomId,
          side,
          orientation,
          axis,
          start,
          end,
          lengthPx: end - start,
          index: i,
          p1,
          p2,
        });
        return;
      }

      const canonical = getCanonicalSegmentData(p1, p2);
      if (!canonical) return;

      if (!diagonalGroups.has(canonical.groupKey)) diagonalGroups.set(canonical.groupKey, []);
      diagonalGroups.get(canonical.groupKey).push({
        roomId,
        side,
        orientation: "d",
        axis: canonical.axis,
        start: canonical.start,
        end: canonical.end,
        lengthPx,
        index: i,
        p1,
        p2,
        ux: canonical.ux,
        uy: canonical.uy,
        dirSign: canonical.dirSign,
      });
    });
  });

  // 2) merge overlaps/touching runs on each line.
  const mergedSegments = [];
  const eps = 0.5;

  axisGroups.forEach((segments) => {
    segments.sort((a, b) => a.start - b.start);

    let current = null;
    for (const seg of segments) {
      if (!current) {
        current = { orientation: seg.orientation, axis: seg.axis, start: seg.start, end: seg.end, walls: [seg] };
        continue;
      }

      if (seg.start <= current.end + eps) {
        if (seg.end > current.end) current.end = seg.end;
        current.walls.push(seg);
      } else {
        pushMergedWallSegment(mergedSegments, current);
        current = { orientation: seg.orientation, axis: seg.axis, start: seg.start, end: seg.end, walls: [seg] };
      }
    }

    pushMergedWallSegment(mergedSegments, current);
  });

  diagonalGroups.forEach((segments) => {
    segments.sort((a, b) => a.start - b.start);

    let current = null;
    for (const seg of segments) {
      if (!current) {
        current = {
          orientation: "d",
          axis: seg.axis,
          start: seg.start,
          end: seg.end,
          ux: seg.ux,
          uy: seg.uy,
          walls: [seg],
        };
        continue;
      }

      if (seg.start <= current.end + eps) {
        if (seg.end > current.end) current.end = seg.end;
        current.walls.push(seg);
      } else {
        pushMergedWallSegment(mergedSegments, current);
        current = {
          orientation: "d",
          axis: seg.axis,
          start: seg.start,
          end: seg.end,
          ux: seg.ux,
          uy: seg.uy,
          walls: [seg],
        };
      }
    }

    pushMergedWallSegment(mergedSegments, current);
  });

  if (!mergedSegments.length) return;

  // 3) layout on sheets
  const maxWidth   = LASER_WIDTH - 20;
  const gapX       = Math.max(1, thickness + 1);
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
    const baseWidthPx = seg.lengthPx ?? (seg.end - seg.start);
    const wallWidthPx = baseWidthPx + thickness; // extend by 1 material thickness
    if (!isFinite(baseWidthPx) || baseWidthPx < 1) return;
    if (!isFinite(wallWidthPx) || wallWidthPx < 1) return;

    const wallKey = seg.key || [
      seg.orientation,
      seg.axis.toFixed(1),
      seg.start.toFixed(1),
      seg.end.toFixed(1)
    ].join(":");

    if (!wallVisibility.has(wallKey)) wallVisibility.set(wallKey, true);
    const enabled = !!wallVisibility.get(wallKey);

    if (!enabled && !(typeof showDeletedWalls !== "undefined" && showDeletedWalls)) return;

    if (cursorX + wallWidthPx + gapX > maxWidth) startNewRow();

    const wallX = cursorX;
    const wallY = baselineY - wallHeightPx;

    const ns = "http://www.w3.org/2000/svg";
    const outlineD = buildWallOutlinePath(wallX, wallY, wallWidthPx, wallHeightPx, useJoints);

    // Visible outline (export depends on enabled)
    const wallPath = document.createElementNS(ns, "path");
    wallPath.setAttribute("d", outlineD);
    wallPath.setAttribute("fill", "none");
    wallPath.setAttribute("stroke", "rgb(255,0,0)");
    wallPath.setAttribute("stroke-width", "0.026");
    wallPath.dataset.wallId = wallKey;
    wallPath.classList.add("wall-strip", enabled ? "enabled" : "disabled");
    setExportFlag(wallPath, enabled);

    // Hit path (always on top of wall for easy tapping)
    const hitPath = makeFatHitPath(outlineD, wallKey);

    addTapHandler(hitPath, (e) => {
      const id = e.currentTarget.dataset.wallId;
      wallVisibility.set(id, !wallVisibility.get(id));
      if (typeof requestAutoSave === "function") requestAutoSave("delete/restore wall");
      rebuildWallsView();
      e.stopPropagation();
    });

    // Append order: hit first or last?
    // Put hit ABOVE wall so it captures taps reliably.
    wallsSvg.appendChild(wallPath);
    wallsSvg.appendChild(hitPath);

    // Label (export only when enabled)
    const primary = seg.walls[0];
    const roomName = getRoomDisplayName(primary.roomId);
    const wallLengthM = wallWidthPx * SCALE_M_PER_PX;

    const label = document.createElementNS(ns, "text");
    const cx = wallX + wallWidthPx / 4;
    const cy = wallY + wallHeightPx / 4;

    label.setAttribute("x", cx);
    label.setAttribute("y", cy);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "4px");
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

    // Openings (doors/windows) as rectangular holes
    // Clamp openings to BASE wall span only
    if (enabled) {
      const openings = [];

      seg.walls.forEach(wall => {
        const feats = svg.querySelectorAll(`rect[data-feature][data-room="${wall.roomId}"]`);
        feats.forEach(f => {
          const featureIndex = parseInt(f.dataset.wallIndex, 10);
          const indexMatches = Number.isFinite(featureIndex) && featureIndex === wall.index;
          const sideMatches = !Number.isFinite(featureIndex) && f.dataset.side === wall.side;
          if (indexMatches || sideMatches) openings.push({ feature: f, wall });
        });
      });

      const doorHeightPxConst = DOOR_HEIGHT_M / SCALE_M_PER_PX;

      openings.forEach(({ feature, wall }) => {
        let offPxLocal = parseFloat(feature.dataset.wallOffsetPx);
        if (!isFinite(offPxLocal)) offPxLocal = 0;

        let lenPx = parseFloat(feature.dataset.lengthPx);
        if (!isFinite(lenPx)) lenPx = 0;

        let offPx;
        if (seg.orientation === "h") {
          const dir = wall.p2.x >= wall.p1.x ? 1 : -1;
          const globalCoord = wall.p1.x + dir * offPxLocal;
          offPx = globalCoord - seg.start;
          if (dir < 0) offPx -= lenPx;
        } else if (seg.orientation === "v") {
          const dir = wall.p2.y >= wall.p1.y ? 1 : -1;
          const globalCoord = wall.p1.y + dir * offPxLocal;
          offPx = globalCoord - seg.start;
          if (dir < 0) offPx -= lenPx;
        } else {
          // Diagonal merged strips use a canonical left-to-right direction.
          // A room edge may run the opposite way, so convert its local feature
          // offset into the merged strip coordinate before drawing the hole.
          if (wall.dirSign < 0) {
            offPx = (wall.end - offPxLocal - lenPx) - seg.start;
          } else {
            offPx = (wall.start + offPxLocal) - seg.start;
          }
        }

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
        holeRect.classList.add("hole-rect");
        holeRect.setAttribute("x", holeX);
        holeRect.setAttribute("y", holeY);
        holeRect.setAttribute("width", holeWidth);
        holeRect.setAttribute("height", holeHeight);
        holeRect.setAttribute("fill", "none");
        holeRect.setAttribute("stroke", "rgb(255,0,0)");
        holeRect.setAttribute("stroke-width", "0.026");
        holeRect.classList.add("wall-strip", enabled ? "enabled" : "disabled");
        // setExportFlag(wallPath, enabled);
        setExportFlag(holeRect, enabled);
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
  const rooms = getRooms();
  if (!rooms.length) return;

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
    const points = getRoomFloorLayoutPoints(r);
    if (points.length < 3) return;

    const bounds = getPointsBounds(points);
    const wPx = bounds.w;
    const hPx = bounds.h;
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

    const ns = "http://www.w3.org/2000/svg";

    let floorShape;
    if (r.tagName?.toLowerCase() === "polygon") {
      floorShape = document.createElementNS(ns, "polygon");
      const localPoints = points.map((pt) => ({
        x: floorX + (pt.x - bounds.x),
        y: floorY + (pt.y - bounds.y),
      }));
      floorShape.setAttribute("points", formatWallPoints(localPoints));
    } else {
      floorShape = document.createElementNS(ns, "rect");
      floorShape.setAttribute("x", floorX);
      floorShape.setAttribute("y", floorY);
      floorShape.setAttribute("width",  wPx);
      floorShape.setAttribute("height", hPx);
    }

    floorShape.dataset.floorId = roomId;
    floorShape.classList.add("floor-strip", enabled ? "enabled" : "disabled");
    floorShape.setAttribute("fill", "none");
    floorShape.setAttribute("stroke", "rgb(255,0,0)");
    floorShape.setAttribute("stroke-width", "0.026");
    setExportFlag(floorShape, enabled);

    const hit = makeFatHitRect(floorX, floorY, wPx, hPx, roomId);

    addTapHandler(hit, (e) => {
      const id = e.currentTarget.dataset.floorId;
      floorVisibility.set(id, !floorVisibility.get(id));
      if (typeof requestAutoSave === "function") requestAutoSave("toggle floor");
      rebuildWallsView();
      e.stopPropagation();
    });

    // Put hit above so taps work reliably
    wallsSvg.appendChild(floorShape);
    wallsSvg.appendChild(hit);

    // Label (export only when enabled)
    const widthM  = wPx * SCALE_M_PER_PX;
    const heightM = hPx * SCALE_M_PER_PX;
    const roomName = getRoomDisplayName(roomId);

    const label = document.createElementNS(ns, "text");
    const cx = floorX + wPx / 2;
    const cy = floorY + hPx / 2;

    label.setAttribute("x", cx);
    label.setAttribute("y", cy);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "4px");
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
// Export helpers
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
  // Grab elements by id if globals weren’t set yet
  if (!window.svg) window.svg = document.getElementById("floorplan");
  if (!window.wallsSvg) window.wallsSvg = document.getElementById("wallsSvg");

  if (!window.svg || !window.wallsSvg) return;

  rebuildWallsView();

  const downloadBtn = document.getElementById("downloadSheetsBtn");
  if (downloadBtn) downloadBtn.onclick = () => window.downloadAllSheetsAsSvg();

  const showDeletedChk = document.getElementById("showDeletedWallsChk");
  if (showDeletedChk && typeof showDeletedWalls !== "undefined") {
    showDeletedChk.checked = !!showDeletedWalls;
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
window.rebuildWallsView = rebuildWallsView; // handy for debugging




