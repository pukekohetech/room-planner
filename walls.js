// ==========================================================
// walls.js — Laser view + toggles + export (clean rebuild)
// ==========================================================

/* global svg, wallsSvg, wallHeightInput, wallHeightM, SCALE_M_PER_PX,
          ENABLE_FINGER_JOINTS, joinedMode,
          wallVisibility, floorVisibility, currentStudentName,
          DOOR_HEIGHT_M, WINDOW_HEAD_DEFAULT_M, WINDOW_HEIGHT_DEFAULT_M,
          getMaterialThicknessMm, getRoomDisplayName, requestAutoSave,
          planPxToLaserMm, metresToLaserMm, getLaserScaleDenominator,
          getLaserBedWidthMm, getLaserBedHeightMm */

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
function buildWallOutlinePath(wallX, wallY, wallWidthPx, wallHeightPx, useJoints, flipJoints = false) {
  const t = getMaterialThicknessMm?.();

  if (!useJoints || !ENABLE_FINGER_JOINTS || !isFinite(t) || t <= 0) {
    const x1 = wallX, y1 = wallY;
    const x2 = wallX + wallWidthPx;
    const y2 = wallY + wallHeightPx;
    return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`;
  }

  const pitch       = t;
  const innerLeftX  = wallX;
  const innerRightX = wallX + wallWidthPx;

  // The two vertical ends are finger-jointed. For the wall loop to close,
  // adjacent wall strips must alternate tab/slot at each corner. A room edge
  // can be collected in the opposite direction after rotation/merging, so
  // flipJoints mirrors the tab/slot pattern without moving the wall/openings.
  const leftJointX  = flipJoints ? innerLeftX + t : innerLeftX - t;   // slot : tab
  const rightJointX = flipJoints ? innerRightX + t : innerRightX - t; // tab  : slot

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

  // Right side down. Normal walls have slots on the right; flipped walls have tabs.
  let y = topY;
  for (let i = 0; i < segments.length; i++) {
    const h = segments[i];
    const nextY = y + h;
    const isJointSegment = (i % 2 === 0);

    if (isJointSegment) {
      d += ` L ${rightJointX} ${y} L ${rightJointX} ${nextY} L ${innerRightX} ${nextY}`;
    } else {
      d += ` L ${innerRightX} ${nextY}`;
    }
    y = nextY;
  }

  // Bottom edge
  d += ` L ${innerLeftX} ${bottomY}`;

  // Left side up. Normal walls have tabs on the left; flipped walls have slots.
  y = bottomY;
  for (let i = segments.length - 1; i >= 0; i--) {
    const h = segments[i];
    const prevY = y - h;
    const isJointSegment = (i % 2 === 0);

    if (isJointSegment) {
      d += ` L ${leftJointX} ${y} L ${leftJointX} ${prevY} L ${innerLeftX} ${prevY}`;
    } else {
      d += ` L ${innerLeftX} ${prevY}`;
    }
    y = prevY;
  }

  d += " Z";
  return d;
}

function shouldFlipWallJoints(seg) {
  const wall = seg?.walls?.[0];
  if (!wall) return false;

  if (seg.orientation === "h") return (wall.p2?.x ?? 0) < (wall.p1?.x ?? 0);
  if (seg.orientation === "v") return (wall.p2?.y ?? 0) < (wall.p1?.y ?? 0);
  if (seg.orientation === "d") return (wall.dirSign ?? 1) < 0;

  return false;
}

function getWallJointOverhangs(useJoints, flipJoints) {
  const t = getMaterialThicknessMm?.();
  if (!useJoints || !ENABLE_FINGER_JOINTS || !isFinite(t) || t <= 0) {
    return { left: 0, right: 0, total: 0 };
  }

  // buildWallOutlinePath draws the finger pattern outside ONE end of the
  // wall strip. Normal walls protrude to the left of wallX; flipped walls
  // protrude to the right of wallX + wallWidth. The laser layout must reserve
  // this overhang or two neighbouring pieces can overlap on the SVG sheet.
  const left = flipJoints ? 0 : t;
  const right = flipJoints ? t : 0;
  return { left, right, total: left + right };
}

// ==========================================================
// Core build helpers
// ==========================================================
function clearWallsSvgToEmptySheet() {
  if (!wallsSvg) return;
  while (wallsSvg.firstChild) wallsSvg.removeChild(wallsSvg.firstChild);
  syncWallsSvgBedSize(1);
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

function safeLaserScaleDenominator() {
  const s = typeof getLaserScaleDenominator === "function" ? getLaserScaleDenominator() : 50;
  return (isFinite(s) && s > 0) ? s : 50;
}

function modelMetresToLaserMm(metres) {
  if (typeof metresToLaserMm === "function") return metresToLaserMm(metres);
  const m = parseFloat(metres);
  return isFinite(m) ? (m * 1000 / safeLaserScaleDenominator()) : 0;
}

function modelPlanPxToLaserMm(px) {
  if (typeof planPxToLaserMm === "function") return planPxToLaserMm(px);
  const n = parseFloat(px);
  return isFinite(n) ? modelMetresToLaserMm(n * SCALE_M_PER_PX) : 0;
}

function getLaserScaleLabel() {
  const scale = safeLaserScaleDenominator();
  return `1:${Number.isInteger(scale) ? scale : scale.toFixed(2)}`;
}

function getActiveLaserBedWidthMm() {
  const w = typeof getLaserBedWidthMm === "function" ? getLaserBedWidthMm() : 730;
  return (isFinite(w) && w > 0) ? w : 730;
}

function getActiveLaserBedHeightMm() {
  const h = typeof getLaserBedHeightMm === "function" ? getLaserBedHeightMm() : 420;
  return (isFinite(h) && h > 0) ? h : 420;
}

function syncWallsSvgBedSize(sheetCount = 1) {
  if (!wallsSvg) return;
  const bedW = getActiveLaserBedWidthMm();
  const bedH = getActiveLaserBedHeightMm();
  const totalH = bedH * Math.max(1, sheetCount || 1);
  wallsSvg.setAttribute("width", bedW);
  wallsSvg.setAttribute("height", totalH);
  wallsSvg.setAttribute("viewBox", `0 0 ${bedW} ${totalH}`);
  wallsSvg.style.width = `${bedW}px`;
  wallsSvg.style.minWidth = `${bedW}px`;
  wallsSvg.style.minHeight = `${Math.min(totalH, bedH)}px`;
}

function fitLaserLabelToBox(label, boxX, boxY, boxW, boxH, opts = {}) {
  if (!label || !isFinite(boxW) || !isFinite(boxH) || boxW <= 0 || boxH <= 0) return;

  const pad = opts.padding ?? 1;
  const maxW = Math.max(0.5, boxW - pad * 2);
  const maxH = Math.max(0.5, boxH - pad * 2);
  const minFont = opts.minFontSize ?? 0.75;
  const absoluteMax = opts.maxFontSize ?? 4;

  const tspans = Array.from(label.querySelectorAll("tspan"));
  const visibleLines = tspans.filter((t) => String(t.textContent || "").trim().length > 0);
  const lineCount = Math.max(1, visibleLines.length || tspans.length || 1);
  const maxChars = Math.max(1, ...visibleLines.map((t) => String(t.textContent || "").length));

  const heightBased = maxH / (lineCount * 1.25);
  const widthBased = maxW / (maxChars * 0.56);
  let fontSize = Math.min(absoluteMax, heightBased, widthBased);

  if (!isFinite(fontSize) || fontSize <= 0) fontSize = minFont;
  fontSize = Math.max(minFont, fontSize);

  const cx = boxX + boxW / 2;
  const cy = boxY + boxH / 2;
  label.setAttribute("x", cx);
  label.setAttribute("y", cy);
  tspans.forEach((t) => t.setAttribute("x", cx));
  label.style.fontSize = `${fontSize}px`;
  label.style.display = "";

  function fits() {
    try {
      const bb = label.getBBox();
      return bb.width <= maxW && bb.height <= maxH;
    } catch {
      return true;
    }
  }

  let guard = 0;
  while (!fits() && fontSize > minFont && guard < 16) {
    fontSize = Math.max(minFont, fontSize * 0.85);
    label.style.fontSize = `${fontSize}px`;
    guard++;
  }

  if (!fits()) {
    // On tiny pieces, no label is safer than a label that becomes a cut-path hazard.
    label.style.display = "none";
    setExportFlag(label, false);
  }
}


function scalePointsToLaserMm(points) {
  return (points || []).map((pt) => ({
    x: modelPlanPxToLaserMm(pt.x),
    y: modelPlanPxToLaserMm(pt.y),
  }));
}

function formatLaserCutSize(widthMm, heightMm) {
  return (isFinite(widthMm) && isFinite(heightMm))
    ? `${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm @ ${getLaserScaleLabel()}`
    : "";
}


function getInflatedFloorLayoutPoints(points, inflatePx) {
  if (!points.length || !isFinite(inflatePx) || inflatePx <= 0) return points;

  const bounds = getPointsBounds(points);
  if (!isFinite(bounds.w) || !isFinite(bounds.h) || bounds.w <= 0 || bounds.h <= 0) return points;

  // Floors need to sit under the walls, so add one material thickness on
  // every side. Scaling from the bounding-box centre keeps rectangles,
  // triangles, clipped-corner rooms, and custom polygons simple and stable.
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const scaleX = (bounds.w + inflatePx * 2) / bounds.w;
  const scaleY = (bounds.h + inflatePx * 2) / bounds.h;

  return points.map((pt) => ({
    x: cx + (pt.x - cx) * scaleX,
    y: cy + (pt.y - cy) * scaleY,
  }));
}

function formatWallPoints(points) {
  return points.map((pt) => `${Math.round(pt.x * 10) / 10},${Math.round(pt.y * 10) / 10}`).join(" ");
}


function floorPointKey(pt, places = 1) {
  return `${fixedForKey(pt.x, places)},${fixedForKey(pt.y, places)}`;
}

function uniqueSortedNumbers(values, eps = 0.05) {
  const sorted = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const out = [];
  sorted.forEach((v) => {
    if (!out.length || Math.abs(v - out[out.length - 1]) > eps) out.push(v);
  });
  return out;
}

function linePointFromT(data, t) {
  return {
    x: data.ux * t + data.nx * data.axis,
    y: data.uy * t + data.ny * data.axis,
  };
}

function makePathDFromLoops(loops) {
  return loops
    .filter((loop) => loop.length >= 3)
    .map((loop) => {
      const first = loop[0];
      const rest = loop.slice(1).map((pt) => `L ${fixedForKey(pt.x, 2)} ${fixedForKey(pt.y, 2)}`).join(" ");
      return `M ${fixedForKey(first.x, 2)} ${fixedForKey(first.y, 2)} ${rest} Z`;
    })
    .join(" ");
}

function getLoopsBounds(loops) {
  const all = loops.flat();
  return getPointsBounds(all);
}

function inflateLoopsFromBounds(loops, inflatePx) {
  if (!loops.length || !isFinite(inflatePx) || inflatePx <= 0) return loops;

  const bounds = getLoopsBounds(loops);
  if (!isFinite(bounds.w) || !isFinite(bounds.h) || bounds.w <= 0 || bounds.h <= 0) return loops;

  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const scaleX = (bounds.w + inflatePx * 2) / bounds.w;
  const scaleY = (bounds.h + inflatePx * 2) / bounds.h;

  return loops.map((loop) => loop.map((pt) => ({
    x: cx + (pt.x - cx) * scaleX,
    y: cy + (pt.y - cy) * scaleY,
  })));
}

function signedLoopArea(loop) {
  if (!Array.isArray(loop) || loop.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function lineIntersectionForOffset(a1, a2, b1, b2) {
  const r = { x: a2.x - a1.x, y: a2.y - a1.y };
  const s = { x: b2.x - b1.x, y: b2.y - b1.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 0.000001) return null;

  const qp = { x: b1.x - a1.x, y: b1.y - a1.y };
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  return { x: a1.x + r.x * t, y: a1.y + r.y * t };
}

function offsetLoopOutward(loop, distanceMm) {
  if (!Array.isArray(loop) || loop.length < 3 || !isFinite(distanceMm) || distanceMm <= 0) {
    return loop;
  }

  const area = signedLoopArea(loop);
  if (!isFinite(area) || Math.abs(area) < 0.000001) return loop;

  // SVG coordinates have Y increasing downwards. A visually clockwise loop has
  // positive signed area. For those loops the outward normal is (dy, -dx); for
  // visually counter-clockwise loops it is (-dy, dx). This makes the red floor
  // cut line a true perimeter offset instead of a stretched bounding box.
  const outwardSign = area >= 0 ? 1 : -1;

  const offsetEdges = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 0.01) continue;

    const nx = outwardSign * dy / len;
    const ny = outwardSign * -dx / len;
    offsetEdges.push({
      a: { x: a.x + nx * distanceMm, y: a.y + ny * distanceMm },
      b: { x: b.x + nx * distanceMm, y: b.y + ny * distanceMm },
      sourceA: a,
      sourceB: b,
      nx,
      ny,
    });
  }

  if (offsetEdges.length < 3) return inflateLoopsFromBounds([loop], distanceMm)[0] || loop;

  const out = [];
  for (let i = 0; i < offsetEdges.length; i++) {
    const prev = offsetEdges[(i - 1 + offsetEdges.length) % offsetEdges.length];
    const cur = offsetEdges[i];
    const hit = lineIntersectionForOffset(prev.a, prev.b, cur.a, cur.b);

    if (hit && Number.isFinite(hit.x) && Number.isFinite(hit.y)) {
      // Avoid extreme mitres on very sharp angles; bevels are more reliable on
      // student laser-cut parts and prevent huge spikes in the SVG.
      const corner = cur.sourceA;
      const maxMiter = Math.max(distanceMm * 4, distanceMm + 8);
      if (Math.hypot(hit.x - corner.x, hit.y - corner.y) <= maxMiter) {
        out.push(hit);
        continue;
      }
    }

    // Fallback bevel point when offset lines are parallel or the miter is huge.
    out.push({
      x: cur.sourceA.x + cur.nx * distanceMm,
      y: cur.sourceA.y + cur.ny * distanceMm,
    });
  }

  const cleaned = cleanUnionLoop(out);
  return cleaned.length >= 3 ? cleaned : out;
}

function offsetLoopsOutward(loops, distanceMm) {
  if (!Array.isArray(loops) || !loops.length || !isFinite(distanceMm) || distanceMm <= 0) return loops;
  return loops
    .map((loop) => offsetLoopOutward(loop, distanceMm))
    .filter((loop) => Array.isArray(loop) && loop.length >= 3);
}


function unionPointKey(pt, places = 2) {
  return `${fixedForKey(pt.x, places)},${fixedForKey(pt.y, places)}`;
}

function cloneUnionPoint(pt) {
  return { x: pt.x, y: pt.y };
}

function lerpUnionPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function pointDistanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function crossUnion(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function dotUnion(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

function pointOnSegmentUnion(pt, a, b, eps = 0.35) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.000001) return false;

  const cross = Math.abs(crossUnion(pt.x - a.x, pt.y - a.y, dx, dy));
  if (cross > eps * Math.sqrt(lenSq)) return false;

  const t = dotUnion(pt.x - a.x, pt.y - a.y, dx, dy) / lenSq;
  return t >= -eps && t <= 1 + eps;
}

function segmentTForPointUnion(pt, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.000001) return 0;
  return dotUnion(pt.x - a.x, pt.y - a.y, dx, dy) / lenSq;
}

function addSplitT(edge, t) {
  if (!Number.isFinite(t)) return;
  if (t < -0.0005 || t > 1.0005) return;
  const clamped = Math.max(0, Math.min(1, t));
  if (!edge.ts.some((existing) => Math.abs(existing - clamped) < 0.0005)) {
    edge.ts.push(clamped);
  }
}

function lineSegmentIntersectionT(e1, e2) {
  const p = e1.a;
  const r = { x: e1.b.x - e1.a.x, y: e1.b.y - e1.a.y };
  const q = e2.a;
  const s = { x: e2.b.x - e2.a.x, y: e2.b.y - e2.a.y };
  const rxs = crossUnion(r.x, r.y, s.x, s.y);
  const qmp = { x: q.x - p.x, y: q.y - p.y };
  const qmpxr = crossUnion(qmp.x, qmp.y, r.x, r.y);

  if (Math.abs(rxs) < 0.000001) {
    // Parallel. If collinear, split both edges at all overlap endpoints.
    if (Math.abs(qmpxr) > 0.35) return;

    [e2.a, e2.b].forEach((pt) => {
      if (pointOnSegmentUnion(pt, e1.a, e1.b)) addSplitT(e1, segmentTForPointUnion(pt, e1.a, e1.b));
    });
    [e1.a, e1.b].forEach((pt) => {
      if (pointOnSegmentUnion(pt, e2.a, e2.b)) addSplitT(e2, segmentTForPointUnion(pt, e2.a, e2.b));
    });
    return;
  }

  const t = crossUnion(qmp.x, qmp.y, s.x, s.y) / rxs;
  const u = crossUnion(qmp.x, qmp.y, r.x, r.y) / rxs;
  const eps = 0.0005;
  if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
    addSplitT(e1, t);
    addSplitT(e2, u);
  }
}

function isPointInPolygonUnion(pt, polygon) {
  if (!polygon || polygon.length < 3) return false;

  // Treat boundary as inside. The union samples are offset from boundaries,
  // but this makes the test safer around snapped or nearly-touching rooms.
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (pointOnSegmentUnion(pt, a, b, 0.08)) return true;
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 0.000001) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPointInAnyPolygonUnion(pt, polygons) {
  return polygons.some((poly) => isPointInPolygonUnion(pt, poly));
}

function cleanUnionLoop(loop) {
  if (!loop || loop.length < 3) return [];

  // Remove repeated adjacent points.
  const deduped = [];
  loop.forEach((pt) => {
    if (!deduped.length || pointDistanceSq(pt, deduped[deduped.length - 1]) > 0.01) {
      deduped.push(pt);
    }
  });

  if (deduped.length > 1 && pointDistanceSq(deduped[0], deduped[deduped.length - 1]) <= 0.01) {
    deduped.pop();
  }

  // Remove points that sit exactly between two collinear neighbours.
  const cleaned = [];
  for (let i = 0; i < deduped.length; i++) {
    const prev = deduped[(i - 1 + deduped.length) % deduped.length];
    const cur = deduped[i];
    const next = deduped[(i + 1) % deduped.length];
    const v1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    if (len1 < 0.01 || len2 < 0.01) continue;

    const cross = Math.abs(crossUnion(v1.x, v1.y, v2.x, v2.y));
    const sameDirection = dotUnion(v1.x, v1.y, v2.x, v2.y) > 0;
    if (cross <= 0.05 && sameDirection) continue;

    cleaned.push(cur);
  }

  return cleaned.length >= 3 ? cleaned : deduped;
}

function buildUnionBoundaryLoops(polygons) {
  const cleanPolygons = (polygons || [])
    .map((poly) => (poly || []).map(cloneUnionPoint))
    .filter((poly) => poly.length >= 3);

  if (!cleanPolygons.length) return [];

  const edges = [];
  cleanPolygons.forEach((poly, polyIndex) => {
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      if (pointDistanceSq(a, b) < 0.25) return;
      edges.push({ a: cloneUnionPoint(a), b: cloneUnionPoint(b), polyIndex, edgeIndex: i, ts: [0, 1] });
    });
  });

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      lineSegmentIntersectionT(edges[i], edges[j]);
    }
  }

  const boundaryMap = new Map();
  const sampleOffset = 0.35;

  edges.forEach((edge) => {
    edge.ts.sort((a, b) => a - b);

    for (let i = 0; i < edge.ts.length - 1; i++) {
      const t1 = edge.ts[i];
      const t2 = edge.ts[i + 1];
      if (t2 - t1 < 0.0005) continue;

      const a = lerpUnionPoint(edge.a, edge.b, t1);
      const b = lerpUnionPoint(edge.a, edge.b, t2);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (!Number.isFinite(len) || len < 0.75) continue;

      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nx = -dy / len;
      const ny = dx / len;
      const left = { x: mid.x + nx * sampleOffset, y: mid.y + ny * sampleOffset };
      const right = { x: mid.x - nx * sampleOffset, y: mid.y - ny * sampleOffset };

      const leftInside = isPointInAnyPolygonUnion(left, cleanPolygons);
      const rightInside = isPointInAnyPolygonUnion(right, cleanPolygons);
      if (leftInside === rightInside) continue;

      // Direction is chosen so the union interior sits on the left side of
      // the segment. Internal/overlapped lines therefore disappear.
      const start = leftInside ? a : b;
      const end = leftInside ? b : a;
      const key = `${unionPointKey(start)}>${unionPointKey(end)}`;
      if (!boundaryMap.has(key)) boundaryMap.set(key, { a: start, b: end });
    }
  });

  const boundaryEdges = Array.from(boundaryMap.values());
  if (!boundaryEdges.length) return [];

  const outgoing = new Map();
  boundaryEdges.forEach((edge, index) => {
    edge.index = index;
    edge.used = false;
    const key = unionPointKey(edge.a);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(edge);
  });

  function angleOf(edge) {
    return Math.atan2(edge.b.y - edge.a.y, edge.b.x - edge.a.x);
  }

  function chooseNextEdge(currentEdge) {
    const key = unionPointKey(currentEdge.b);
    const candidates = (outgoing.get(key) || []).filter((edge) => !edge.used);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const currentAngle = angleOf(currentEdge);
    candidates.sort((a, b) => {
      const da = Math.abs(Math.atan2(Math.sin(angleOf(a) - currentAngle), Math.cos(angleOf(a) - currentAngle)));
      const db = Math.abs(Math.atan2(Math.sin(angleOf(b) - currentAngle), Math.cos(angleOf(b) - currentAngle)));
      return da - db;
    });
    return candidates[0];
  }

  const loops = [];
  boundaryEdges.forEach((startEdge) => {
    if (startEdge.used) return;

    const loop = [startEdge.a, startEdge.b];
    startEdge.used = true;
    let current = startEdge;
    const startKey = unionPointKey(startEdge.a);
    let guard = 0;

    while (guard < boundaryEdges.length + 20) {
      guard++;
      if (unionPointKey(current.b) === startKey) break;
      const next = chooseNextEdge(current);
      if (!next) break;
      next.used = true;
      loop.push(next.b);
      current = next;
    }

    if (loop.length > 1 && unionPointKey(loop[0]) === unionPointKey(loop[loop.length - 1])) {
      loop.pop();
    }

    const cleaned = cleanUnionLoop(loop);
    if (cleaned.length >= 3) loops.push(cleaned);
  });

  return loops;
}

function buildCombinedFloorBoundaryLoops(polygons) {
  // Build a true union outline for the one-piece floor. The older version
  // only removed exact shared edges, so overlapping rooms could still leave
  // duplicate/internal laser lines. This traces only the outside boundary of
  // all floor polygons.
  const loops = buildUnionBoundaryLoops(polygons);
  if (loops.length) return loops;

  // Fallback for unusual self-intersecting input: keep the preview visible.
  return (polygons || []).filter((points) => points && points.length >= 3);
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

  const wallHeightPx = modelMetresToLaserMm(wallHeightM);
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
  const maxWidth   = getActiveLaserBedWidthMm() - 20;
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

    if (baselineY + 5 > sheetTop + getActiveLaserBedHeightMm()) {
      sheetIndex++;
      sheetTop = sheetIndex * getActiveLaserBedHeightMm();
      markSheetUsed(sheetIndex);
      baselineY = sheetTop + topPadding + wallHeightPx;
    }
  }

  mergedSegments.forEach(seg => {
    const baseLengthPlanPx = seg.lengthPx ?? (seg.end - seg.start);
    const baseWidthPx = modelPlanPxToLaserMm(baseLengthPlanPx);
    const wallWidthPx = baseWidthPx + thickness; // extend by 1 material thickness in real cut mm
    if (!isFinite(baseLengthPlanPx) || baseLengthPlanPx < 1) return;
    if (!isFinite(baseWidthPx) || baseWidthPx < 0.1) return;
    if (!isFinite(wallWidthPx) || wallWidthPx < 0.1) return;

    const wallKey = seg.key || [
      seg.orientation,
      seg.axis.toFixed(1),
      seg.start.toFixed(1),
      seg.end.toFixed(1)
    ].join(":");

    if (!wallVisibility.has(wallKey)) wallVisibility.set(wallKey, true);
    const enabled = !!wallVisibility.get(wallKey);

    if (!enabled && !(typeof showDeletedWalls !== "undefined" && showDeletedWalls)) return;

    const flipJoints = shouldFlipWallJoints(seg);
    const jointOverhang = getWallJointOverhangs(useJoints, flipJoints);
    const reservedWallWidth = wallWidthPx + jointOverhang.total;

    // The visible rectangular part of the wall starts at wallX, but finger
    // joints can protrude left or right. Lay out by the full bounding width
    // so wall ends never overlap neighbouring pieces on the laser SVG.
    if (cursorX + reservedWallWidth + gapX > maxWidth) startNewRow();

    const wallX = cursorX + jointOverhang.left;
    const wallY = baselineY - wallHeightPx;

    const ns = "http://www.w3.org/2000/svg";
    const outlineD = buildWallOutlinePath(wallX, wallY, wallWidthPx, wallHeightPx, useJoints, flipJoints);

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
    const wallLengthM = baseLengthPlanPx * SCALE_M_PER_PX;

    const label = document.createElementNS(ns, "text");
    const cx = wallX + wallWidthPx / 2;
    const cy = wallY + wallHeightPx / 2;

    label.setAttribute("x", cx);
    label.setAttribute("y", cy);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "4px");
    label.style.fontSize = "4px";
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
    sizeSpan.textContent = isFinite(wallLengthM) ? `${wallLengthM.toFixed(2)}m = ${wallWidthPx.toFixed(1)}mm @ ${getLaserScaleLabel()}` : "";
    label.appendChild(sizeSpan);

    wallsSvg.appendChild(label);
    fitLaserLabelToBox(label, wallX, wallY, wallWidthPx, wallHeightPx, { maxFontSize: 4, minFontSize: 0.75, padding: 1 });

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

        offPx = Math.max(0, Math.min(offPx, baseLengthPlanPx));
        lenPx = Math.max(0, lenPx);
        if (offPx + lenPx > baseLengthPlanPx) lenPx = baseLengthPlanPx - offPx;
        if (lenPx < 1) return;

        const kind = feature.dataset.feature;

        const holeX = wallX + modelPlanPxToLaserMm(offPx);
        const holeWidth = modelPlanPxToLaserMm(lenPx);

        let startM = parseFloat(feature.dataset.openingStartM);
        let endM = parseFloat(feature.dataset.openingEndM);

        if (kind === "door") {
          const doorHeightM = parseFloat(feature.dataset.doorHeightM);
          if (!isFinite(startM)) startM = 0;
          if (!isFinite(endM)) endM = isFinite(doorHeightM) ? startM + doorHeightM : DOOR_HEIGHT_M;
        } else {
          const legacyHeadM = parseFloat(feature.dataset.windowHeadM);
          const legacySillM = parseFloat(feature.dataset.windowSillM);
          if (!isFinite(endM)) endM = isFinite(legacyHeadM) ? legacyHeadM : WINDOW_HEAD_DEFAULT_M;
          if (!isFinite(startM)) startM = isFinite(legacySillM) ? legacySillM : endM - WINDOW_HEIGHT_DEFAULT_M;
        }

        startM = isFinite(startM) ? Math.max(0, startM) : 0;
        endM = isFinite(endM) ? Math.max(0.1, endM) : (kind === "door" ? DOOR_HEIGHT_M : WINDOW_HEAD_DEFAULT_M);
        if (endM > wallHeightM) endM = wallHeightM;
        if (startM >= endM) startM = Math.max(0, endM - 0.1);

        const startPx = modelMetresToLaserMm(startM);
        const endPx = modelMetresToLaserMm(endM);
        const holeHeight = Math.max(1, endPx - startPx);
        const holeY = baselineY - endPx;

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

    cursorX += reservedWallWidth + gapX;
  });

  if (joinedMode) {
    addFloorPatch(baselineY, usedSheets, markSheetUsed);
  }

  const sheetCount = usedSheets.size || 1;
  syncWallsSvgBedSize(sheetCount);
}

// ==========================================================
// Floor patch (laser pieces)
// ==========================================================
function addFloorPatch(lastBaselineY, usedSheets, markSheetUsed) {
  if (typeof combineFloors !== "undefined" && combineFloors) {
    addCombinedFloorPatch(lastBaselineY, usedSheets, markSheetUsed);
    return;
  }

  addSeparateFloorPatches(lastBaselineY, usedSheets, markSheetUsed);
}

function getFloorPatchStart(lastBaselineY, markSheetUsed) {
  const rowGap = 8;
  const topPad = 10;
  let sheetIndex = Math.floor(lastBaselineY / getActiveLaserBedHeightMm());
  let sheetTop = sheetIndex * getActiveLaserBedHeightMm();
  markSheetUsed(sheetIndex);

  return {
    sheetIndex,
    sheetTop,
    currentY: Math.max(lastBaselineY + rowGap, sheetTop + topPad),
    cursorX: 10,
    rowHeight: 0,
    rowGap,
    topPad,
  };
}


function combinedFloorGuideSegmentKey(a, b) {
  const aKey = floorPointKey(a, 2);
  const bKey = floorPointKey(b, 2);
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function addCombinedFloorWallGuides(polygons, floorX, floorY, bounds, enabled) {
  if (!wallsSvg || !Array.isArray(polygons) || !polygons.length) return;

  const ns = "http://www.w3.org/2000/svg";
  const guideGroup = document.createElementNS(ns, "g");
  guideGroup.classList.add("combined-floor-wall-guides", enabled ? "enabled" : "disabled");
  guideGroup.setAttribute("pointer-events", "none");
  setExportFlag(guideGroup, enabled);

  const seen = new Set();

  polygons.forEach((poly) => {
    if (!poly || poly.length < 2) return;

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (!Number.isFinite(len) || len < 0.75) continue;

      // Exact shared walls appear twice, usually in opposite directions.
      // Draw them once so the blue guide does not get over-burnt.
      const key = combinedFloorGuideSegmentKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);

      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", floorX + (a.x - bounds.x));
      line.setAttribute("y1", floorY + (a.y - bounds.y));
      line.setAttribute("x2", floorX + (b.x - bounds.x));
      line.setAttribute("y2", floorY + (b.y - bounds.y));
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "rgb(0,0,255)");
      line.setAttribute("stroke-width", "0.026");
      line.setAttribute("stroke-linecap", "square");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      line.classList.add("combined-floor-wall-guide", enabled ? "enabled" : "disabled");
      setExportFlag(line, enabled);
      guideGroup.appendChild(line);
    }
  });

  if (guideGroup.childNodes.length) wallsSvg.appendChild(guideGroup);
}

function addCombinedFloorPatch(lastBaselineY, usedSheets, markSheetUsed) {
  const rooms = getRooms();
  if (!rooms.length) return;

  const polygons = rooms
    .map((room) => scalePointsToLaserMm(getRoomFloorLayoutPoints(room)))
    .filter((points) => points.length >= 3);

  if (!polygons.length) return;

  const guidePolygons = polygons;
  let wallLoops = buildCombinedFloorBoundaryLoops(polygons);

  // Fallback: if edge stitching fails, draw one path with each room outline as a subpath.
  // This keeps the laser preview usable instead of failing silently.
  if (!wallLoops.length) wallLoops = polygons;

  const materialThicknessPx = Math.max(0, getMaterialThicknessMm?.() || 0);
  let loops = offsetLoopsOutward(wallLoops, materialThicknessPx);
  if (!loops.length) loops = inflateLoopsFromBounds(wallLoops, materialThicknessPx);

  const bounds = getLoopsBounds(loops);
  const wPx = bounds.w;
  const hPx = bounds.h;
  if (!isFinite(wPx) || !isFinite(hPx) || wPx <= 0 || hPx <= 0) return;

  const maxWidth = getActiveLaserBedWidthMm() - 20;
  const gapX = 5;
  const state = getFloorPatchStart(lastBaselineY, markSheetUsed);
  let { sheetIndex, sheetTop, currentY, cursorX, topPad } = state;

  if (cursorX + wPx + gapX > maxWidth) {
    cursorX = 10;
    currentY += hPx + state.rowGap;
  }

  if (currentY + hPx + topPad > sheetTop + getActiveLaserBedHeightMm()) {
    sheetIndex++;
    sheetTop = sheetIndex * getActiveLaserBedHeightMm();
    markSheetUsed(sheetIndex);
    currentY = sheetTop + topPad;
    cursorX = 10;
  }

  const floorX = cursorX;
  const floorY = currentY;
  const ns = "http://www.w3.org/2000/svg";
  const floorId = "__combined_floor__";

  if (!floorVisibility.has(floorId)) floorVisibility.set(floorId, true);
  const enabled = !!floorVisibility.get(floorId);

  const localLoops = loops.map((loop) => loop.map((pt) => ({
    x: floorX + (pt.x - bounds.x),
    y: floorY + (pt.y - bounds.y),
  })));

  const floorPath = document.createElementNS(ns, "path");
  floorPath.setAttribute("d", makePathDFromLoops(localLoops));
  floorPath.dataset.floorId = floorId;
  floorPath.classList.add("floor-strip", "combined-floor-strip", enabled ? "enabled" : "disabled");
  floorPath.setAttribute("fill", "none");
  floorPath.setAttribute("stroke", "rgb(255,0,0)");
  floorPath.setAttribute("stroke-width", "0.026");
  setExportFlag(floorPath, enabled);

  const hit = makeFatHitRect(floorX, floorY, wPx, hPx, floorId);
  addTapHandler(hit, (e) => {
    const id = e.currentTarget.dataset.floorId;
    floorVisibility.set(id, !floorVisibility.get(id));
    if (typeof requestAutoSave === "function") requestAutoSave("toggle combined floor");
    rebuildWallsView();
    e.stopPropagation();
  });

  wallsSvg.appendChild(floorPath);

  // Blue guide lines show where each wall sits on the one-piece floor.
  // They are exported as blue strokes so they can be engraved/marked
  // separately from the red outside cut line.
  addCombinedFloorWallGuides(guidePolygons, floorX, floorY, bounds, enabled);

  // Keep the transparent hit target above the guide lines for easy toggling.
  wallsSvg.appendChild(hit);

  const widthMm = wPx;
  const heightMm = hPx;
  const cx = floorX + wPx / 2;
  const cy = floorY + hPx / 2;

  const label = document.createElementNS(ns, "text");
  label.setAttribute("x", cx);
  label.setAttribute("y", cy);
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("font-size", "4px");
  label.setAttribute("font-family", "Arial, sans-serif");
  label.setAttribute("fill", "rgb(0,0,255)");
  label.classList.add("floor-label", "combined-floor-label", enabled ? "enabled" : "disabled");
  setExportFlag(label, enabled);

  const studentSpan = document.createElementNS(ns, "tspan");
  studentSpan.setAttribute("x", cx);
  studentSpan.setAttribute("dy", "-0.6em");
  studentSpan.textContent = currentStudentName ? `PHS ${currentStudentName}` : "";
  label.appendChild(studentSpan);

  const nameSpan = document.createElementNS(ns, "tspan");
  nameSpan.setAttribute("x", cx);
  nameSpan.setAttribute("dy", "1.1em");
  nameSpan.textContent = "Combined floor";
  label.appendChild(nameSpan);

  const sizeSpan = document.createElementNS(ns, "tspan");
  sizeSpan.setAttribute("x", cx);
  sizeSpan.setAttribute("dy", "1.1em");
  sizeSpan.textContent = formatLaserCutSize(widthMm, heightMm);
  label.appendChild(sizeSpan);

  wallsSvg.appendChild(label);
  fitLaserLabelToBox(label, floorX, floorY, wPx, hPx, { maxFontSize: 4, minFontSize: 0.75, padding: 2 });
}

function addSeparateFloorPatches(lastBaselineY, usedSheets, markSheetUsed) {
  const rooms = getRooms();
  if (!rooms.length) return;

  const maxWidth = getActiveLaserBedWidthMm() - 20;
  const gapX     = 5;
  const rowGap   = 8;
  const topPad   = 10;

  let sheetIndex = Math.floor(lastBaselineY / getActiveLaserBedHeightMm());
  let sheetTop   = sheetIndex * getActiveLaserBedHeightMm();
  markSheetUsed(sheetIndex);

  let currentY  = Math.max(lastBaselineY + rowGap, sheetTop + topPad);
  let cursorX   = 10;
  let rowHeight = 0;

  rooms.forEach(r => {
    const basePlanPoints = getRoomFloorLayoutPoints(r);
    if (basePlanPoints.length < 3) return;

    const basePoints = scalePointsToLaserMm(basePlanPoints);
    const materialThicknessPx = Math.max(0, getMaterialThicknessMm?.() || 0);
    const points = getInflatedFloorLayoutPoints(basePoints, materialThicknessPx);

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

    if (currentY + hPx + topPad > sheetTop + getActiveLaserBedHeightMm()) {
      sheetIndex++;
      sheetTop   = sheetIndex * getActiveLaserBedHeightMm();
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
    const widthMm  = wPx;
    const heightMm = hPx;
    const roomName = getRoomDisplayName(roomId);

    const label = document.createElementNS(ns, "text");
    const cx = floorX + wPx / 2;
    const cy = floorY + hPx / 2;

    label.setAttribute("x", cx);
    label.setAttribute("y", cy);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "4px");
    label.style.fontSize = "4px";
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
    sizeSpan.textContent = formatLaserCutSize(widthMm, heightMm);
    label.appendChild(sizeSpan);

    wallsSvg.appendChild(label);
    fitLaserLabelToBox(label, floorX, floorY, wPx, hPx, { maxFontSize: 4, minFontSize: 0.75, padding: 2 });

    cursorX += wPx + gapX;
    rowHeight = Math.max(rowHeight, hPx);
  });
}

// ==========================================================
// Export helpers
// ==========================================================
function buildSheetSvg(sheetIndex) {
  const ns = "http://www.w3.org/2000/svg";

  const sheetTop    = sheetIndex * getActiveLaserBedHeightMm();
  const sheetBottom = sheetTop + getActiveLaserBedHeightMm();

  const sheetSvg = document.createElementNS(ns, "svg");
  sheetSvg.setAttribute("xmlns", ns);
  sheetSvg.setAttribute("width", `${getActiveLaserBedWidthMm()}mm`);
  sheetSvg.setAttribute("height", `${getActiveLaserBedHeightMm()}mm`);
  sheetSvg.setAttribute("viewBox", `0 0 ${getActiveLaserBedWidthMm()} ${getActiveLaserBedHeightMm()}`);

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

  const totalHeightAttr = parseFloat(wallsSvg.getAttribute("height")) || getActiveLaserBedHeightMm();
  const sheetCount = Math.max(1, Math.ceil(totalHeightAttr / getActiveLaserBedHeightMm()));

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




