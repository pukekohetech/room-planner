// ==========================================================
// plan.js (REWRITE)
// Plan view editor + doors/windows + snapping + zoom/pan
// Export guarantees hairline stroke-width = 0.026mm
//
// Requires: common.js loaded first, walls.js available
// ==========================================================

// ------------------------------
// GLOBAL STYLING + EXPORT CONFIG
// ------------------------------

// Readable editor line weight (what you see while editing)
const UI_STROKE_PX = 3;

// Export hairline requirement (physical)
const EXPORT_STROKE_MM = 0.026;

// SVG user units conversion:
// Your drawing coordinates behave like CSS px / viewBox units.
// 1 CSS px = 1/96 inch = 25.4/96 mm
const PX_PER_MM = 96 / 25.4;
const EXPORT_STROKE_U = EXPORT_STROKE_MM * PX_PER_MM; // ≈ 0.0982677 user units

// Labels: keep readable in UI; export will remove label outline stroke.
const UI_LABEL_FONT_SIZE = 8;
const UI_LABEL_OUTLINE_PX = 2;

// Snap config
const SNAP_TOUCH_PX = 12;
const SNAP_ALIGN_PX = 6;

// Hover/resize margin
const HOVER_MARGIN = 5;

// -----------------------------------------
// HELPERS: apply consistent room/feature look
// -----------------------------------------
function setStroke(el, width, color = "black") {
  if (!el) return;
  el.setAttribute("stroke", color);
  el.setAttribute("stroke-width", String(width));
}

function setNoFill(el) {
  if (!el) return;
  el.setAttribute("fill", "none");
}

function ensureRoomRectLooksLikeARoom(rect) {
  if (!rect?.dataset?.room) return;
  rect.setAttribute("fill", "rgba(0,0,0,0)");
  setStroke(rect, UI_STROKE_PX, "black");
  rect.setAttribute(
    "pointer-events",
    rect.tagName?.toLowerCase() === "polygon" ? "all" : "bounding-box"
  );
}

function ensureFeatureRectLooksLikeAFeature(rect) {
  if (!rect?.dataset?.feature) return;
  // Feature fill is used for UI differentiation
  // (door/window). Stroke is optional in UI.
  // Keep stroke off in UI unless you want it:
  // setStroke(rect, 1, "black");
  rect.setAttribute("pointer-events", "visiblePainted");
}


// -----------------------------------------
// Room geometry helpers (rectangles + polygons)
// -----------------------------------------
const ROOM_SELECTOR =
  typeof ROOM_ELEMENT_SELECTOR !== "undefined"
    ? ROOM_ELEMENT_SELECTOR
    : 'rect[data-room]:not([data-feature]), polygon[data-room]:not([data-feature])';

function isRoomElement(el) {
  return !!el?.matches?.(ROOM_SELECTOR);
}

function parsePointsString(pointsString) {
  return String(pointsString || "")
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })
    .filter(Boolean);
}

function formatPoints(points) {
  return points.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(" ");
}

function getRoomPoints(roomEl) {
  if (!roomEl) return [];

  if (roomEl.tagName?.toLowerCase() === "polygon") {
    return parsePointsString(roomEl.getAttribute("points"));
  }

  const x = parseFloat(roomEl.getAttribute("x")) || 0;
  const y = parseFloat(roomEl.getAttribute("y")) || 0;
  const w = parseFloat(roomEl.getAttribute("width")) || 0;
  const h = parseFloat(roomEl.getAttribute("height")) || 0;
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function getRoomGeometry(roomEl) {
  const pts = getRoomPoints(roomEl);
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0, points: [] };

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return { x, y, w: maxX - x, h: maxY - y, points: pts };
}

function setPolygonPoints(poly, points) {
  poly.setAttribute("points", formatPoints(points));
}

function translateRoomFromStart(roomEl, startGeom, dx, dy) {
  if (!roomEl || !startGeom) return;

  if (roomEl.tagName?.toLowerCase() === "polygon") {
    setPolygonPoints(
      roomEl,
      startGeom.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
    );
    return;
  }

  roomEl.setAttribute("x", startGeom.x + dx);
  roomEl.setAttribute("y", startGeom.y + dy);
}

function moveRoomTo(roomEl, startGeom, newX, newY) {
  translateRoomFromStart(roomEl, startGeom, newX - startGeom.x, newY - startGeom.y);
}

function resizeRoomFromStart(roomEl, startGeom, newW, newH) {
  if (!roomEl || !startGeom) return;

  newW = Math.max(15, newW);
  newH = Math.max(15, newH);

  if (roomEl.tagName?.toLowerCase() === "polygon") {
    const sx = startGeom.w ? newW / startGeom.w : 1;
    const sy = startGeom.h ? newH / startGeom.h : 1;
    const scaled = startGeom.points.map((p) => ({
      x: startGeom.x + (p.x - startGeom.x) * sx,
      y: startGeom.y + (p.y - startGeom.y) * sy,
    }));
    setPolygonPoints(roomEl, scaled);
    return;
  }

  roomEl.setAttribute("width", newW);
  roomEl.setAttribute("height", newH);
}

function getRoomCentre(roomEl) {
  const pts = getRoomPoints(roomEl);
  if (!pts.length) return { x: 0, y: 0 };
  const total = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: total.x / pts.length, y: total.y / pts.length };
}

function normaliseAngleDeg(deg) {
  let n = parseFloat(deg);
  if (!isFinite(n)) n = 0;
  n = ((n % 360) + 360) % 360;
  if (n > 180) n -= 360;
  return Math.round(n * 10) / 10;
}

function getRoomRotationDeg(roomEl) {
  return normaliseAngleDeg(roomEl?.dataset?.roomRotationDeg || 0);
}

function setRoomRotationDataset(roomEl, deg) {
  if (!roomEl) return;
  roomEl.dataset.roomRotationDeg = String(normaliseAngleDeg(deg));
}

function rotatePointAround(point, centre, angleDeg) {
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

function getRoomBaseGeometry(roomEl) {
  const points = getRoomPoints(roomEl);
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0, points: [] };

  const angle = getRoomRotationDeg(roomEl);
  const centre = getRoomCentre(roomEl);
  const basePoints = Math.abs(angle) > 0.001
    ? points.map((p) => rotatePointAround(p, centre, -angle))
    : points;

  const xs = basePoints.map((p) => p.x);
  const ys = basePoints.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x, y, w: maxX - x, h: maxY - y, points: basePoints };
}

function ensureRoomIsPolygon(roomEl) {
  if (!roomEl || roomEl.tagName?.toLowerCase() === "polygon") return roomEl;

  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  setPolygonPoints(poly, getRoomPoints(roomEl));
  roomEl = replaceRoomElement(roomEl, poly);
  roomEl.dataset.shape = roomEl.dataset.shape || "rect";
  return roomEl;
}

function rotateRoomBy(roomEl, deltaDeg, centre = null) {
  if (!roomEl || !isFinite(deltaDeg) || Math.abs(deltaDeg) < 0.001) return roomEl;

  roomEl = ensureRoomIsPolygon(roomEl);
  const points = getRoomPoints(roomEl);
  if (points.length < 2) return roomEl;

  const c = centre || getRoomCentre(roomEl);
  setPolygonPoints(roomEl, points.map((p) => rotatePointAround(p, c, deltaDeg)));
  setRoomRotationDataset(roomEl, getRoomRotationDeg(roomEl) + deltaDeg);
  return roomEl;
}

function rotateRoomTo(roomEl, targetDeg) {
  if (!roomEl) return roomEl;
  targetDeg = normaliseAngleDeg(targetDeg);
  const currentDeg = getRoomRotationDeg(roomEl);
  const delta = normaliseAngleDeg(targetDeg - currentDeg);
  if (Math.abs(delta) < 0.001) {
    setRoomRotationDataset(roomEl, targetDeg);
    return roomEl;
  }
  return rotateRoomBy(roomEl, delta);
}

function updateRotationEditorValue(roomEl) {
  if (typeof roomRotationInput === "undefined" || !roomRotationInput) return;
  roomRotationInput.value = getRoomRotationDeg(roomEl).toFixed(0);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getWallSideNameForPlan(p1, p2, bounds, index) {
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

function getRoomEdges(roomEl) {
  const points = getRoomPoints(roomEl);
  if (points.length < 2) return [];
  const bounds = getRoomGeometry(roomEl);

  return points.map((p1, index) => {
    const p2 = points[(index + 1) % points.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    const ux = length ? dx / length : 1;
    const uy = length ? dy / length : 0;
    return {
      index,
      p1,
      p2,
      dx,
      dy,
      length,
      ux,
      uy,
      angleDeg: Math.atan2(dy, dx) * 180 / Math.PI,
      side: getWallSideNameForPlan(p1, p2, bounds, index),
    };
  }).filter((edge) => edge.length > 1);
}

function projectPointToEdge(point, edge) {
  const vx = point.x - edge.p1.x;
  const vy = point.y - edge.p1.y;
  const t = clampNumber(vx * edge.ux + vy * edge.uy, 0, edge.length);
  const px = edge.p1.x + edge.ux * t;
  const py = edge.p1.y + edge.uy * t;
  return { t, x: px, y: py, distance: Math.hypot(point.x - px, point.y - py) };
}

function getNearestWallEdge(roomEl, point) {
  const edges = getRoomEdges(roomEl);
  let best = null;
  for (const edge of edges) {
    const projected = projectPointToEdge(point, edge);
    if (!best || projected.distance < best.projected.distance) {
      best = { edge, projected };
    }
  }
  return best;
}

function getFeatureWallInfo(feature) {
  const roomEl = getRoomForFeature?.(feature);
  if (!roomEl) return null;

  const edges = getRoomEdges(roomEl);
  if (!edges.length) return null;

  const storedSide = feature.dataset.side || "";
  const cardinalSides = new Set(["top", "right", "bottom", "left"]);
  let edge = null;

  if (cardinalSides.has(storedSide)) {
    edge = edges
      .filter((e) => e.side === storedSide)
      .sort((a, b) => b.length - a.length)[0] || null;
  }

  if (!edge) {
    const storedIndex = parseInt(feature.dataset.wallIndex, 10);
    if (Number.isFinite(storedIndex)) edge = edges.find((e) => e.index === storedIndex) || null;
  }

  if (!edge && storedSide) {
    edge = edges.find((e) => e.side === storedSide) || null;
  }

  if (!edge) edge = edges[0];

  feature.dataset.wallIndex = String(edge.index);
  feature.dataset.side = edge.side;
  return { roomEl, edge };
}

function getRoomCornerCutsPx(roomEl) {
  return {
    tl: parseFloat(roomEl?.dataset?.cutTlPx) || 0,
    tr: parseFloat(roomEl?.dataset?.cutTrPx) || 0,
    br: parseFloat(roomEl?.dataset?.cutBrPx) || 0,
    bl: parseFloat(roomEl?.dataset?.cutBlPx) || 0,
  };
}

function normaliseCornerCuts(cuts, w, h) {
  const maxCut = Math.max(0, Math.min(w, h) * 0.48);
  let out = {
    tl: clampNumber(cuts.tl || 0, 0, maxCut),
    tr: clampNumber(cuts.tr || 0, 0, maxCut),
    br: clampNumber(cuts.br || 0, 0, maxCut),
    bl: clampNumber(cuts.bl || 0, 0, maxCut),
  };

  function shrinkPair(a, b, limit) {
    const sum = out[a] + out[b];
    if (sum > limit && sum > 0) {
      const scale = limit / sum;
      out[a] *= scale;
      out[b] *= scale;
    }
  }

  shrinkPair("tl", "tr", w * 0.95);
  shrinkPair("bl", "br", w * 0.95);
  shrinkPair("tl", "bl", h * 0.95);
  shrinkPair("tr", "br", h * 0.95);

  return out;
}

function buildBeveledRectPoints(x, y, w, h, cuts) {
  const c = normaliseCornerCuts(cuts, w, h);
  const pts = [];

  pts.push(c.tl > 0 ? { x: x + c.tl, y } : { x, y });

  if (c.tr > 0) pts.push({ x: x + w - c.tr, y }, { x: x + w, y: y + c.tr });
  else pts.push({ x: x + w, y });

  if (c.br > 0) pts.push({ x: x + w, y: y + h - c.br }, { x: x + w - c.br, y: y + h });
  else pts.push({ x: x + w, y: y + h });

  if (c.bl > 0) pts.push({ x: x + c.bl, y: y + h }, { x, y: y + h - c.bl });
  else pts.push({ x, y: y + h });

  if (c.tl > 0) pts.push({ x, y: y + c.tl });

  return pts;
}

function setRoomCornerCutDataset(roomEl, cuts) {
  roomEl.dataset.cutTlPx = String(cuts.tl || 0);
  roomEl.dataset.cutTrPx = String(cuts.tr || 0);
  roomEl.dataset.cutBrPx = String(cuts.br || 0);
  roomEl.dataset.cutBlPx = String(cuts.bl || 0);
}

function hasCornerCuts(cuts) {
  return (cuts.tl || 0) > 0 || (cuts.tr || 0) > 0 || (cuts.br || 0) > 0 || (cuts.bl || 0) > 0;
}

function copyDataset(fromEl, toEl) {
  for (const [key, value] of Object.entries(fromEl.dataset || {})) {
    toEl.dataset[key] = value;
  }
}

function replaceRoomElement(oldEl, newEl) {
  copyDataset(oldEl, newEl);
  oldEl.parentNode?.replaceChild(newEl, oldEl);
  ensureRoomRectLooksLikeARoom(newEl);
  setSelectedRoomRect(newEl);
  return newEl;
}

function applyCornerCutsToRoom(roomEl, cutsPx) {
  if (!roomEl || isFlexiblePolygonRoom(roomEl)) return roomEl;

  const geom = getRoomGeometry(roomEl);
  const cuts = normaliseCornerCuts(cutsPx, geom.w, geom.h);
  const wantsBevel = hasCornerCuts(cuts);

  if (!wantsBevel) {
    setRoomCornerCutDataset(roomEl, cuts);
    if (roomEl.tagName?.toLowerCase() === "polygon" && roomEl.dataset.shape === "bevel") {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", geom.x);
      rect.setAttribute("y", geom.y);
      rect.setAttribute("width", geom.w);
      rect.setAttribute("height", geom.h);
      roomEl = replaceRoomElement(roomEl, rect);
    }
    roomEl.dataset.shape = "rect";
    setRoomCornerCutDataset(roomEl, cuts);
    return roomEl;
  }

  const points = buildBeveledRectPoints(geom.x, geom.y, geom.w, geom.h, cuts);
  if (roomEl.tagName?.toLowerCase() !== "polygon") {
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    roomEl = replaceRoomElement(roomEl, poly);
  }

  roomEl.dataset.shape = "bevel";
  setRoomCornerCutDataset(roomEl, cuts);
  setPolygonPoints(roomEl, points);
  return roomEl;
}

function canUseCornerCutEditor(roomEl) {
  if (!roomEl) return false;
  const shape = roomEl.dataset?.shape || "rect";
  return shape === "rect" || shape === "bevel";
}

function setCornerEditorValues(roomEl) {
  const inputs = [cornerCutTlInput, cornerCutTrInput, cornerCutBrInput, cornerCutBlInput];
  if (inputs.every((input) => !input)) return;

  const canUse = canUseCornerCutEditor(roomEl);
  if (typeof cornerCutEditor !== "undefined" && cornerCutEditor) {
    cornerCutEditor.style.display = canUse ? "block" : "none";
  }

  const cuts = getRoomCornerCutsPx(roomEl);
  const values = [cuts.tl, cuts.tr, cuts.br, cuts.bl].map((px) => (px * SCALE_M_PER_PX).toFixed(2));

  [cornerCutTlInput, cornerCutTrInput, cornerCutBrInput, cornerCutBlInput].forEach((input, i) => {
    if (!input) return;
    input.value = canUse ? values[i] : "0.00";
    input.disabled = !canUse;
  });
}

function isFlexiblePolygonRoom(roomEl) {
  const shape = roomEl?.dataset?.shape;
  return !!roomEl && roomEl.tagName?.toLowerCase() === "polygon" && (shape === "polygon" || shape === "triangle");
}

function clampPolygonSideCount(value, fallback = 3) {
  let n = parseInt(value, 10);
  if (!Number.isFinite(n)) n = fallback;
  return Math.max(3, Math.min(12, Math.round(n)));
}

function getPolygonSideCount(roomEl) {
  const points = getRoomPoints(roomEl);
  return clampPolygonSideCount(roomEl?.dataset?.polySides || points.length || 3, points.length || 3);
}

function buildRegularPolygonPointsFromBox(x, y, w, h, sides) {
  sides = clampPolygonSideCount(sides, 3);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.max(12, w / 2);
  const ry = Math.max(12, h / 2);
  const startAngle = -Math.PI / 2;
  const points = [];
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (Math.PI * 2 * i) / sides;
    points.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return points;
}

function setPolygonEditorValues(roomEl) {
  if (typeof polygonEditor === "undefined" || !polygonEditor || !roomPolygonSidesInput) return;
  const show = isFlexiblePolygonRoom(roomEl);
  polygonEditor.style.display = show ? "block" : "none";
  roomPolygonSidesInput.disabled = !show;
  if (show) roomPolygonSidesInput.value = String(getRoomPoints(roomEl).length || getPolygonSideCount(roomEl));
  updatePolygonPointButtonState?.();
}

function rebuildFlexiblePolygonWithSides(roomEl, sides) {
  if (!isFlexiblePolygonRoom(roomEl)) return roomEl;
  sides = clampPolygonSideCount(sides, getRoomPoints(roomEl).length || 3);
  const originalRotation = getRoomRotationDeg(roomEl);
  roomEl = rotateRoomTo(roomEl, 0);
  const geom = getRoomGeometry(roomEl);
  setPolygonPoints(roomEl, buildRegularPolygonPointsFromBox(geom.x, geom.y, geom.w || 120, geom.h || 100, sides));
  roomEl.dataset.shape = "polygon";
  roomEl.dataset.polySides = String(sides);
  roomEl = rotateRoomTo(roomEl, originalRotation);
  return roomEl;
}

function readCornerEditorCutsPx() {
  const read = (input) => {
    const m = parseFloat(input?.value);
    return isFinite(m) && m > 0 ? m / SCALE_M_PER_PX : 0;
  };
  return {
    tl: read(cornerCutTlInput),
    tr: read(cornerCutTrInput),
    br: read(cornerCutBrInput),
    bl: read(cornerCutBlInput),
  };
}


// -----------------------------------------
// ZOOM + PAN (viewBox only)
// -----------------------------------------
function installPlanViewZoom(svgEl) {
  if (!svgEl) return;

  svgEl.style.touchAction = "none";

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

  const MIN_W = 50;
  const MAX_W = 5000;

  function getSvgPointFromClient(clientX, clientY) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svgEl.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: clientX, y: clientY };
  }

  svgEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();

      const v = vb();
      const mouse = getSvgPointFromClient(e.clientX, e.clientY);

      const zoomFactor = Math.pow(1.0015, e.deltaY);
      let newW = v.w * zoomFactor;

      const aspect = v.w / v.h;
      newW = clamp(newW, MIN_W, MAX_W);
      const newH = newW / aspect;

      const rx = (mouse.x - v.x) / v.w;
      const ry = (mouse.y - v.y) / v.h;

      const newX = mouse.x - rx * newW;
      const newY = mouse.y - ry * newH;

      setVb({ x: newX, y: newY, w: newW, h: newH });
    },
    { passive: false }
  );

  // Pan: middle mouse OR Space+drag
  let panning = false;
  let panStart = null;
  let vbStart = null;
  let spaceDown = false;

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") spaceDown = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") spaceDown = false;
  });

  svgEl.addEventListener("pointerdown", (e) => {
    const isMiddle = e.button === 1;
    if (!isMiddle && !spaceDown) return;

    panning = true;
    panStart = { x: e.clientX, y: e.clientY };
    vbStart = vb();
    svgEl.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  svgEl.addEventListener("pointermove", (e) => {
    if (!panning || !panStart || !vbStart) return;

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

  // Quick zoom keys
  window.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;

    if (e.key === "+" || e.key === "=") {
      const v = vb();
      setVb({ x: v.x + v.w * 0.05, y: v.y + v.h * 0.05, w: v.w * 0.9, h: v.h * 0.9 });
    }
    if (e.key === "-" || e.key === "_") {
      const v = vb();
      setVb({ x: v.x - v.w * 0.055, y: v.y - v.h * 0.055, w: v.w / 0.9, h: v.h / 0.9 });
    }
  });
}

// -----------------------------------------
// Selection + Keyboard Nudge
// -----------------------------------------
let selectedRoomRect = null;
let triangleVertexHandles = [];
let selectedPolygonVertexIndex = null;
let addWallPointHintTimer = null;

function updatePolygonPointButtonState() {
  if (typeof deletePolygonPointBtn !== "undefined" && deletePolygonPointBtn) {
    const canDelete = !!selectedRoomRect && shouldShowTriangleVertexHandles(selectedRoomRect) && selectedPolygonVertexIndex != null && getRoomPoints(selectedRoomRect).length > 3;
    deletePolygonPointBtn.disabled = !canDelete;
    deletePolygonPointBtn.title = canDelete ? "Delete the selected blue point" : "Select a blue point first (polygons need at least 3 points)";
  }
}

function setSelectedPolygonVertexIndex(index) {
  selectedPolygonVertexIndex = Number.isFinite(index) ? index : null;
  triangleVertexHandles.forEach((handle) => {
    handle.classList.toggle("selected", parseInt(handle.dataset.triangleVertex, 10) === selectedPolygonVertexIndex);
  });
  updatePolygonPointButtonState();
}

function removeTriangleVertexHandles() {
  triangleVertexHandles.forEach((handle) => handle.parentNode?.removeChild(handle));
  triangleVertexHandles = [];
  selectedPolygonVertexIndex = null;
  updatePolygonPointButtonState();
}

function shouldShowTriangleVertexHandles(roomEl) {
  return isFlexiblePolygonRoom(roomEl);
}

function updateTriangleVertexHandlesPosition() {
  if (!shouldShowTriangleVertexHandles(selectedRoomRect)) {
    removeTriangleVertexHandles();
    return;
  }

  const points = getRoomPoints(selectedRoomRect);
  if (points.length < 3) {
    removeTriangleVertexHandles();
    return;
  }

  if (triangleVertexHandles.length !== points.length) {
    createTriangleVertexHandles(selectedRoomRect);
    return;
  }

  triangleVertexHandles.forEach((handle, index) => {
    const pt = points[index];
    handle.setAttribute("cx", pt.x);
    handle.setAttribute("cy", pt.y);
    handle.classList.toggle("selected", index === selectedPolygonVertexIndex);
  });
  updatePolygonPointButtonState();
}


function distanceBetweenPoints(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

function getSnapCandidatesForPoint(point, movingRoomEl) {
  const candidates = [];
  if (!point || !svg) return candidates;

  svg.querySelectorAll(ROOM_SELECTOR).forEach((other) => {
    if (other === movingRoomEl) return;

    const otherPoints = getRoomPoints(other);

    // Snap directly onto wall corners / endpoints.
    otherPoints.forEach((p) => {
      const d = distanceBetweenPoints(point, p);
      if (d <= SNAP_TOUCH_PX) {
        candidates.push({ point: { x: p.x, y: p.y }, distance: d, priority: 0 });
      }
    });

    // Snap onto the nearest point along an existing wall segment.
    getSnapEdgesFromPoints(otherPoints).forEach((edge) => {
      const projected = projectPointToEdge(point, edge);
      if (projected.distance <= SNAP_TOUCH_PX) {
        candidates.push({
          point: { x: projected.x, y: projected.y },
          distance: projected.distance,
          priority: 1,
        });
      }
    });
  });

  return candidates;
}

function snapPointToExistingRoomGeometry(point, movingRoomEl) {
  const candidates = getSnapCandidatesForPoint(point, movingRoomEl);
  if (!candidates.length) return point;

  candidates.sort((a, b) =>
    a.priority - b.priority ||
    a.distance - b.distance
  );

  return candidates[0].point;
}

function snapPointAxisAlignment(point, movingRoomEl) {
  if (!point || !svg) return point;

  let bestX = null;
  let bestY = null;

  svg.querySelectorAll(ROOM_SELECTOR).forEach((other) => {
    if (other === movingRoomEl) return;
    getRoomPoints(other).forEach((p) => {
      const dx = Math.abs(point.x - p.x);
      const dy = Math.abs(point.y - p.y);
      if (dx <= SNAP_ALIGN_PX && (!bestX || dx < bestX.distance)) bestX = { x: p.x, distance: dx };
      if (dy <= SNAP_ALIGN_PX && (!bestY || dy < bestY.distance)) bestY = { y: p.y, distance: dy };
    });
  });

  return {
    x: bestX ? bestX.x : point.x,
    y: bestY ? bestY.y : point.y,
  };
}

function snapTriangleVertexEdgeAngle(roomEl, startPoints, idx, rawPoint) {
  if (!roomEl || !Array.isArray(startPoints) || startPoints.length < 3) return rawPoint;

  const otherEdges = [];
  svg.querySelectorAll(ROOM_SELECTOR).forEach((other) => {
    if (other === roomEl) return;
    getSnapEdgesFromPoints(getRoomPoints(other)).forEach((edge) => otherEdges.push(edge));
  });
  if (!otherEdges.length) return rawPoint;

  const adjacentFixedPoints = [
    startPoints[(idx - 1 + startPoints.length) % startPoints.length],
    startPoints[(idx + 1) % startPoints.length],
  ];

  let best = null;
  const minLength = 12;

  adjacentFixedPoints.forEach((fixed) => {
    const currentDx = rawPoint.x - fixed.x;
    const currentDy = rawPoint.y - fixed.y;
    const currentLen = Math.hypot(currentDx, currentDy);
    if (!Number.isFinite(currentLen) || currentLen < minLength) return;

    otherEdges.forEach((edge) => {
      // Try both directions along the other wall, because a polygon edge can be
      // drawn either way around the room.
      [1, -1].forEach((direction) => {
        const ux = edge.ux * direction;
        const uy = edge.uy * direction;
        const signed = currentDx * ux + currentDy * uy;
        if (Math.abs(signed) < minLength) return;

        const candidate = {
          x: fixed.x + ux * signed,
          y: fixed.y + uy * signed,
        };
        const change = distanceBetweenPoints(rawPoint, candidate);
        if (change > SNAP_ALIGN_PX * 1.5) return;

        // Prefer angle snaps where the adjacent polygon edge overlaps the wall
        // it is matching, so it feels like the existing wall snap behaviour.
        const candT1 = fixed.x * edge.ux + fixed.y * edge.uy;
        const candT2 = candidate.x * edge.ux + candidate.y * edge.uy;
        const edgeT1 = edge.p1.x * edge.ux + edge.p1.y * edge.uy;
        const edgeT2 = edge.p2.x * edge.ux + edge.p2.y * edge.uy;
        const candidateStart = Math.min(candT1, candT2);
        const candidateEnd = Math.max(candT1, candT2);
        const edgeStart = Math.min(edgeT1, edgeT2);
        const edgeEnd = Math.max(edgeT1, edgeT2);
        const overlap = Math.min(candidateEnd, edgeEnd) - Math.max(candidateStart, edgeStart);
        if (overlap < 10) return;

        if (!best || change < best.change) best = { point: candidate, change };
      });
    });
  });

  return best ? best.point : rawPoint;
}

function snapTriangleVertexPoint(roomEl, startPoints, idx, rawPoint) {
  if (!roomEl || !Array.isArray(startPoints) || !startPoints[idx]) return rawPoint;

  // First: snap the node itself to nearby wall endpoints / wall segments.
  let snapped = snapPointToExistingRoomGeometry(rawPoint, roomEl);

  // Second: if the point itself did not strongly snap, let the adjacent polygon
  // edges snap to a similar angle as nearby walls.
  if (distanceBetweenPoints(rawPoint, snapped) < 0.001) {
    snapped = snapTriangleVertexEdgeAngle(roomEl, startPoints, idx, rawPoint);
  }

  // Third: small x/y alignment to other vertices, useful for neat right-angle or
  // mirrored polygon shapes without forcing a full wall snap.
  snapped = snapPointAxisAlignment(snapped, roomEl);

  return {
    x: Math.round(snapped.x * 10) / 10,
    y: Math.round(snapped.y * 10) / 10,
  };
}

function getPolygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function normaliseFlexiblePolygonAfterPointChange(roomEl) {
  if (!roomEl) return roomEl;
  roomEl = ensureRoomIsPolygon(roomEl);
  roomEl.dataset.shape = "polygon";
  roomEl.dataset.polySides = String(getRoomPoints(roomEl).length);
  setSelectedRoomRect(roomEl);
  setPolygonEditorValues(roomEl);
  setCornerEditorValues(roomEl);
  updateRoomLabel(roomEl);
  updateFeaturesForRoom(roomEl);
  updateTriangleVertexHandlesPosition();
  rebuildWallsView();
  return roomEl;
}

function insertPolygonPointOnNearestEdge(roomEl, clickPoint) {
  if (!roomEl || !clickPoint) return null;
  const nearest = getNearestWallEdge(roomEl, clickPoint);
  if (!nearest) return null;

  roomEl = ensureRoomIsPolygon(roomEl);
  const points = getRoomPoints(roomEl);
  const insertAt = nearest.edge.index + 1;
  const newPoint = snapTriangleVertexPoint(roomEl, points, nearest.edge.index, {
    x: nearest.projected.x,
    y: nearest.projected.y,
  });

  const nextPoints = points.slice();
  nextPoints.splice(insertAt, 0, newPoint);
  if (Math.abs(getPolygonArea(nextPoints)) < 25) return roomEl;

  setPolygonPoints(roomEl, nextPoints);
  normaliseFlexiblePolygonAfterPointChange(roomEl);
  setSelectedPolygonVertexIndex(insertAt);
  requestAutoSave?.("insert polygon wall point");
  return roomEl;
}

function deleteSelectedPolygonPoint() {
  if (!selectedRoomRect || !shouldShowTriangleVertexHandles(selectedRoomRect)) return false;
  const points = getRoomPoints(selectedRoomRect);
  if (points.length <= 3) return false;
  if (selectedPolygonVertexIndex == null || selectedPolygonVertexIndex < 0 || selectedPolygonVertexIndex >= points.length) return false;

  const nextPoints = points.filter((_, i) => i !== selectedPolygonVertexIndex);
  if (nextPoints.length < 3 || Math.abs(getPolygonArea(nextPoints)) < 25) return false;

  setPolygonPoints(selectedRoomRect, nextPoints);
  normaliseFlexiblePolygonAfterPointChange(selectedRoomRect);
  setSelectedPolygonVertexIndex(Math.min(selectedPolygonVertexIndex, nextPoints.length - 1));
  requestAutoSave?.("delete polygon wall point");
  return true;
}

function deleteRoomById(roomId) {
  if (!roomId) return false;
  const roomEl = svg.querySelector(`[data-room="${roomId}"]:not([data-feature])`);
  if (!roomEl) return false;

  const label = svg.querySelector(`text[data-room-label="${roomId}"]`);
  const feats = svg.querySelectorAll(`rect[data-feature][data-room="${roomId}"]`);
  feats.forEach((f) => {
    removeFeatureLabel(f);
    f.parentNode?.removeChild(f);
  });

  label?.parentNode?.removeChild(label);
  roomEl.parentNode?.removeChild(roomEl);

  if (selectedRoomRect === roomEl) setSelectedRoomRect(null);
  if (selectedFeature && selectedFeature.dataset.room === roomId) closeFeatureSelection();
  if (editingRoomId === roomId) closeSizeEditor();

  rebuildWallsView();
  requestAutoSave?.("delete room");
  return true;
}

function deleteSelectedThing() {
  if (selectedFeature) {
    const feature = selectedFeature;
    removeFeatureHandles();
    removeFeatureLabel(feature);
    feature.parentNode?.removeChild(feature);
    selectedFeature = null;
    featureInfo.style.display = "none";
    rebuildWallsView();
    requestAutoSave?.("delete feature");
    return true;
  }

  if (deleteSelectedPolygonPoint()) return true;

  const roomId = editingRoomId || selectedRoomRect?.dataset?.room;
  if (roomId) return deleteRoomById(roomId);

  return false;
}

function createTriangleVertexHandles(roomEl) {
  removeTriangleVertexHandles();
  if (!shouldShowTriangleVertexHandles(roomEl)) return;

  const points = getRoomPoints(roomEl);
  points.forEach((point, index) => {
    const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    handle.classList.add("polygon-vertex-handle", "triangle-vertex-handle");
    handle.dataset.triangleVertex = String(index);
    handle.setAttribute("cx", point.x);
    handle.setAttribute("cy", point.y);
    handle.setAttribute("r", "7");
    handle.style.cursor = "move";

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startPoint = getPointerPosition(e);
      const startPoints = getRoomPoints(roomEl);
      const idx = parseInt(handle.dataset.triangleVertex, 10);
      setSelectedPolygonVertexIndex(idx);
      try { handle.setPointerCapture?.(e.pointerId); } catch {}

      function onMove(ev) {
        ev.preventDefault();
        const pos = getPointerPosition(ev);
        const dx = pos.x - startPoint.x;
        const dy = pos.y - startPoint.y;
        const rawVertex = { x: startPoints[idx].x + dx, y: startPoints[idx].y + dy };
        const snappedVertex = snapTriangleVertexPoint(roomEl, startPoints, idx, rawVertex);
        const nextPoints = startPoints.map((pt, i) =>
          i === idx ? snappedVertex : pt
        );

        // Avoid a completely collapsed polygon while still allowing flexible,
        // irregular room shapes.
        const area = Math.abs(getPolygonArea(nextPoints));
        if (area < 25) return;

        roomEl.dataset.shape = "polygon";
        roomEl.dataset.polySides = String(nextPoints.length);
        setPolygonPoints(roomEl, nextPoints);
        updateRoomLabel(roomEl);
        updateFeaturesForRoom(roomEl);
        updateTriangleVertexHandlesPosition();
        rebuildWallsView();
        requestAutoSave?.("drag polygon vertex");
      }

      function onUp(ev) {
        ev?.preventDefault?.();
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    svg.appendChild(handle);
    triangleVertexHandles.push(handle);
  });
  setSelectedPolygonVertexIndex(selectedPolygonVertexIndex != null && selectedPolygonVertexIndex < points.length ? selectedPolygonVertexIndex : null);
}

function setSelectedRoomRect(rect) {
  const sameRoom = rect && selectedRoomRect === rect;
  selectedRoomRect = rect || null;
  if (!sameRoom) selectedPolygonVertexIndex = null;

  svg.querySelectorAll(ROOM_SELECTOR).forEach((r) => {
    r.classList.toggle("room-selected", r === selectedRoomRect);
  });

  if (shouldShowTriangleVertexHandles(selectedRoomRect)) {
    createTriangleVertexHandles(selectedRoomRect);
  } else {
    removeTriangleVertexHandles();
  }
}

function nudgeRect(rect, dx, dy) {
  if (!rect) return;

  translateRoomFromStart(rect, getRoomGeometry(rect), dx, dy);

  updateRoomLabel(rect);
  updateFeaturesForRoom(rect);
  if (rect === selectedRoomRect) updateTriangleVertexHandlesPosition();
}

function nudgeSelectedRoom(dx, dy) {
  if (!selectedRoomRect) return;

  // Move only the selected room.
  // The Add Floors toggle uses joinedMode for laser floor export only;
  // it should not make every room move together.
  nudgeRect(selectedRoomRect, dx, dy);

  rebuildWallsView();
  requestAutoSave?.("keyboard nudge");
}

document.addEventListener("keydown", (e) => {
  const tag = (e.target?.tagName || "").toLowerCase();
  const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
  if (isTyping) return;

  if (e.key === "Delete" || e.key === "Backspace") {
    if (deleteSelectedThing()) e.preventDefault();
    return;
  }

  if (!selectedRoomRect) return;

  const step = e.shiftKey ? 10 : 2;
  let dx = 0,
    dy = 0;
  if (e.key === "ArrowLeft") dx = -step;
  if (e.key === "ArrowRight") dx = step;
  if (e.key === "ArrowUp") dy = -step;
  if (e.key === "ArrowDown") dy = step;

  if (dx || dy) {
    e.preventDefault();
    nudgeSelectedRoom(dx, dy);
    return;
  }

  if (e.key.toLowerCase() === "r") {
    e.preventDefault();
    rotateEditingRoomBy(e.shiftKey ? -15 : 15);
  }
});

// -----------------------------------------
// Feature label helpers (doors/windows)
// -----------------------------------------
function getFeatureLabel(feature) {
  const fid = feature.dataset.featureId;
  return svg.querySelector(`text[data-feature-label="${fid}"]`);
}

function ensureFeatureLabel(feature) {
  let label = getFeatureLabel(feature);
  if (label) return label;

  label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.dataset.featureLabel = feature.dataset.featureId;

  label.setAttribute("font-size", String(UI_LABEL_FONT_SIZE));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.setAttribute("fill", "black");

  // UI readability outline (EXPORT will remove)
  label.setAttribute("stroke", "white");
  label.setAttribute("stroke-width", String(UI_LABEL_OUTLINE_PX));
  label.setAttribute("paint-order", "stroke");

  label.style.pointerEvents = "none";

  svg.appendChild(label);
  return label;
}

function updateFeatureLabelCore(feature, opts = {}) {
  const label = ensureFeatureLabel(feature);
  const info = getFeatureWallInfo(feature);
  if (!info) return;

  const { edge } = info;
  const lengthPx = parseFloat(feature.dataset.lengthPx) || 0;
  const offsetPx = parseFloat(feature.dataset.wallOffsetPx) || 0;
  const lengthM = lengthPx * SCALE_M_PER_PX;
  label.textContent = isFinite(lengthM) ? `${lengthM.toFixed(2)}m` : "";

  const thickness = opts.thickness ?? (typeof getFeatureThickness === "function" ? getFeatureThickness(feature) || 6 : 6);
  const clearance = isFinite(opts.clearance) ? opts.clearance : 10;
  const cx = edge.p1.x + edge.ux * (offsetPx + lengthPx / 2);
  const cy = edge.p1.y + edge.uy * (offsetPx + lengthPx / 2);
  const nx = -edge.uy;
  const ny = edge.ux;

  label.setAttribute("transform", "");
  label.setAttribute("x", cx + nx * (thickness / 2 + clearance));
  label.setAttribute("y", cy + ny * (thickness / 2 + clearance));
}

function updateFeatureLabel(feature) {
  updateFeatureLabelCore(feature, { clearance: 10 });
}

function removeFeatureLabel(feature) {
  const label = getFeatureLabel(feature);
  label?.parentNode?.removeChild(label);
}

// -----------------------------------------
// Tool buttons
// -----------------------------------------
function setTool(tool) {
  currentTool = tool;
  [addDoorBtn, addWindowBtn, addWallPointBtn, insertWallPointBtn].forEach((btn) => btn?.classList.remove("tool-active"));
  if (tool === "addDoor") addDoorBtn?.classList.add("tool-active");
  if (tool === "addWindow") addWindowBtn?.classList.add("tool-active");
  if (tool === "addWallPoint") {
    addWallPointBtn?.classList.add("tool-active");
    insertWallPointBtn?.classList.add("tool-active");
  }

  svg.style.cursor = tool === "addDoor" || tool === "addWindow" || tool === "addWallPoint" ? "crosshair" : "default";
}

addDoorBtn?.addEventListener("click", () => setTool(currentTool === "addDoor" ? "select" : "addDoor"));
addWindowBtn?.addEventListener("click", () => setTool(currentTool === "addWindow" ? "select" : "addWindow"));
addWallPointBtn?.addEventListener("click", () => setTool(currentTool === "addWallPoint" ? "select" : "addWallPoint"));
insertWallPointBtn?.addEventListener("click", () => setTool(currentTool === "addWallPoint" ? "select" : "addWallPoint"));
deletePolygonPointBtn?.addEventListener("click", () => deleteSelectedPolygonPoint());
addRectBtn?.addEventListener("click", () => createRoom(100, 100, 120, 80));
addPolygonRoomBtn?.addEventListener("click", () => {
  const sides = clampPolygonSideCount(polygonSidesInput?.value, 3);
  createRegularPolygonRoom(140, 140, 150, 120, sides);
});

// -----------------------------------------
// Rooms: labels + editor
// -----------------------------------------
function ensureRoomLabelForRect(rect) {
  const id = rect.dataset.room;
  let label = svg.querySelector(`text[data-room-label="${id}"]`);
  if (label) return label;

  label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.dataset.room = id;
  label.dataset.roomLabel = id;

  label.classList.add("room-label");
  label.setAttribute("data-room-label", id);

  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.setAttribute("font-size", String(UI_LABEL_FONT_SIZE));
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
  attachRoomLabelEvents?.(label, id);

  svg.appendChild(label);
  return label;
}

function createRoom(x, y, w, h) {
  const id = String(nextRoomId++);
  const defaultName = `Room ${id}`;

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", x);
  rect.setAttribute("y", y);
  rect.setAttribute("width", w);
  rect.setAttribute("height", h);
  rect.dataset.room = id;
  rect.dataset.roomName = defaultName;
  rect.dataset.shape = "rect";
  setRoomRotationDataset(rect, 0);
  setRoomCornerCutDataset(rect, { tl: 0, tr: 0, br: 0, bl: 0 });

  svg.appendChild(rect);

  ensureRoomRectLooksLikeARoom(rect);
  ensureRoomLabelForRect(rect);
  updateRoomLabel(rect);

  rebuildWallsView();
  requestAutoSave?.("create room");
}

function createPolygonRoom(points, shapeName = "polygon") {
  const id = String(nextRoomId++);
  const defaultName = `Room ${id}`;

  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  poly.setAttribute("points", formatPoints(points));
  poly.dataset.room = id;
  poly.dataset.roomName = defaultName;
  poly.dataset.shape = shapeName === "triangle" ? "polygon" : shapeName;
  if (poly.dataset.shape === "polygon") poly.dataset.polySides = String(points.length);
  setRoomRotationDataset(poly, 0);
  setRoomCornerCutDataset(poly, { tl: 0, tr: 0, br: 0, bl: 0 });

  svg.appendChild(poly);

  ensureRoomRectLooksLikeARoom(poly);
  ensureRoomLabelForRect(poly);
  updateRoomLabel(poly);

  rebuildWallsView();
  requestAutoSave?.("create polygon room");
}

function createRegularPolygonRoom(x, y, w, h, sides = 3) {
  sides = clampPolygonSideCount(sides, 3);
  createPolygonRoom(buildRegularPolygonPointsFromBox(x, y, w, h, sides), "polygon");
}

function createBevelRoom(x, y, w, h, cut, corner = "tr") {
  const cuts = { tl: 0, tr: 0, br: 0, bl: 0 };
  cuts[corner] = cut;
  const points = buildBeveledRectPoints(x, y, w, h, cuts);
  const beforeId = nextRoomId;
  createPolygonRoom(points, "bevel");
  const room = svg.querySelector(`[data-room="${beforeId}"]:not([data-feature])`);
  if (room) setRoomCornerCutDataset(room, normaliseCornerCuts(cuts, w, h));
}

function createTriangleRoom(x, y, w, h) {
  createRegularPolygonRoom(x, y, w, h, 3);
}

function updateRoomLabel(rect) {
  const id = rect.dataset.room;
  const label = ensureRoomLabelForRect(rect);
  if (!label) return;

  const geom = getRoomBaseGeometry(rect);
  const w = geom.w;
  const h = geom.h;
  const centre = getRoomCentre(rect);

  const cx = centre.x;
  const cy = centre.y;

  label.setAttribute("x", cx);
  label.setAttribute("y", cy);

  const nameTspan = label.querySelector('tspan[data-role="room-name"]');
  const sizeTspan = label.querySelector('tspan[data-role="room-size"]');

  const roomName = rect.dataset.roomName || `Room ${id}`;
  const sizeText = formatSizeLabel?.(w, h) ?? "";

  if (nameTspan) {
    nameTspan.textContent = roomName;
    nameTspan.setAttribute("x", cx);
  }
  if (sizeTspan) {
    sizeTspan.textContent = sizeText;
    sizeTspan.setAttribute("x", cx);
  }
}

// Room editor panel (uses your existing DOM elements)
function openSizeEditorForRoom(roomId) {
  const rect = svg.querySelector(`[data-room="${roomId}"]:not([data-feature])`);
  if (!rect) return;

  const geom = getRoomBaseGeometry(rect);
  const wPx = geom.w;
  const hPx = geom.h;
  widthInput.value = (wPx * SCALE_M_PER_PX).toFixed(2);
  heightInput.value = (hPx * SCALE_M_PER_PX).toFixed(2);
  roomNameInput.value = rect.dataset.roomName || `Room ${roomId}`;
  setCornerEditorValues(rect);
  setPolygonEditorValues(rect);
  updateRotationEditorValue(rect);
  setSelectedRoomRect(rect);
  updatePolygonPointButtonState();

  editingRoomId = roomId;
  sizeEditor.style.display = "flex";
  roomNameInput.focus();
  roomNameInput.select();
}

function closeSizeEditor() {
  sizeEditor.style.display = "none";
  editingRoomId = null;
}

applySizeBtn?.addEventListener("click", () => {
  if (!editingRoomId) return;

  let roomEl = svg.querySelector(`[data-room="${editingRoomId}"]:not([data-feature])`);
  if (!roomEl) {
    closeSizeEditor();
    return;
  }

  const newName = roomNameInput.value.trim();
  roomEl.dataset.roomName = newName || `Room ${editingRoomId}`;

  const currentBaseGeom = getRoomBaseGeometry(roomEl);
  const currentWpx = currentBaseGeom.w;
  const currentHpx = currentBaseGeom.h;

  let newWm = parseFloat(widthInput.value);
  let newHm = parseFloat(heightInput.value);

  if (!isFinite(newWm) || newWm <= 0) newWm = currentWpx * SCALE_M_PER_PX;
  if (!isFinite(newHm) || newHm <= 0) newHm = currentHpx * SCALE_M_PER_PX;

  const requestedRotation = (typeof roomRotationInput !== "undefined" && roomRotationInput)
    ? parseFloat(roomRotationInput.value)
    : getRoomRotationDeg(roomEl);

  // Apply size/corner changes in the room's unrotated coordinate space, then rotate back.
  roomEl = rotateRoomTo(roomEl, 0);
  const currentGeom = getRoomGeometry(roomEl);
  resizeRoomFromStart(roomEl, currentGeom, newWm / SCALE_M_PER_PX, newHm / SCALE_M_PER_PX);

  if (isFlexiblePolygonRoom(roomEl)) {
    const requestedSides = clampPolygonSideCount(roomPolygonSidesInput?.value, getRoomPoints(roomEl).length || 3);
    if (requestedSides !== getRoomPoints(roomEl).length) {
      roomEl = rebuildFlexiblePolygonWithSides(roomEl, requestedSides);
      roomEl = rotateRoomTo(roomEl, 0);
    } else {
      roomEl.dataset.shape = "polygon";
      roomEl.dataset.polySides = String(getRoomPoints(roomEl).length);
    }
  } else {
    roomEl = applyCornerCutsToRoom(roomEl, readCornerEditorCutsPx());
  }

  roomEl = rotateRoomTo(roomEl, requestedRotation);
  updateRotationEditorValue(roomEl);

  updateRoomLabel(roomEl);
  updateFeaturesForRoom(roomEl);
  setSelectedRoomRect(roomEl);
  updateTriangleVertexHandlesPosition();
  rebuildWallsView();
  requestAutoSave?.("apply room edit");
  closeSizeEditor();
});

cancelSizeBtn?.addEventListener("click", closeSizeEditor);

function rotateEditingRoomBy(deltaDeg) {
  const roomId = editingRoomId || selectedRoomRect?.dataset?.room;
  if (!roomId) return;

  let roomEl = svg.querySelector(`[data-room="${roomId}"]:not([data-feature])`);
  if (!roomEl) return;

  roomEl = rotateRoomBy(roomEl, deltaDeg);
  updateRotationEditorValue(roomEl);
  updateRoomLabel(roomEl);
  updateFeaturesForRoom(roomEl);
  setSelectedRoomRect(roomEl);
  updateTriangleVertexHandlesPosition();
  rebuildWallsView();
  requestAutoSave?.("rotate room");
}

const rotateLeftBtn = document.getElementById("rotateLeftBtn");
const rotateRightBtn = document.getElementById("rotateRightBtn");

rotateLeftBtn?.addEventListener("click", () => rotateEditingRoomBy(-15));
rotateRightBtn?.addEventListener("click", () => rotateEditingRoomBy(15));
roomRotationInput?.addEventListener("change", () => {
  const roomId = editingRoomId || selectedRoomRect?.dataset?.room;
  if (!roomId) return;
  let roomEl = svg.querySelector(`[data-room="${roomId}"]:not([data-feature])`);
  if (!roomEl) return;
  roomEl = rotateRoomTo(roomEl, parseFloat(roomRotationInput.value));
  updateRotationEditorValue(roomEl);
  updateRoomLabel(roomEl);
  updateFeaturesForRoom(roomEl);
  setSelectedRoomRect(roomEl);
  updateTriangleVertexHandlesPosition();
  rebuildWallsView();
  requestAutoSave?.("rotate room input");
});

roomPolygonSidesInput?.addEventListener("change", () => {
  const roomId = editingRoomId || selectedRoomRect?.dataset?.room;
  if (!roomId) return;
  let roomEl = svg.querySelector(`[data-room="${roomId}"]:not([data-feature])`);
  if (!isFlexiblePolygonRoom(roomEl)) return;
  roomEl = rebuildFlexiblePolygonWithSides(roomEl, roomPolygonSidesInput.value);
  setPolygonEditorValues(roomEl);
  updateRotationEditorValue(roomEl);
  updateRoomLabel(roomEl);
  updateFeaturesForRoom(roomEl);
  setSelectedRoomRect(roomEl);
  updateTriangleVertexHandlesPosition();
  rebuildWallsView();
  requestAutoSave?.("change polygon wall count");
});

deleteRoomBtn?.addEventListener("click", () => {
  const roomId = editingRoomId || selectedRoomRect?.dataset?.room;
  deleteRoomById(roomId);
});


// -----------------------------------------
// Doors & Windows
// -----------------------------------------
function updateFeaturePosition(feature) {
  const info = getFeatureWallInfo(feature);
  if (!info) return;

  const { edge } = info;
  let wallOffsetPx = parseFloat(feature.dataset.wallOffsetPx) || 0;
  let lengthPx = parseFloat(feature.dataset.lengthPx) || 0;

  const thickness = getFeatureThickness?.(feature) ?? 6;
  const minLen = 10;
  const wallLen = edge.length;

  if (lengthPx < minLen) lengthPx = minLen;
  if (lengthPx > wallLen) lengthPx = wallLen;

  let maxOffset = wallLen - lengthPx;
  if (maxOffset < 0) maxOffset = 0;
  wallOffsetPx = clampNumber(wallOffsetPx, 0, maxOffset);

  feature.dataset.wallOffsetPx = String(wallOffsetPx);
  feature.dataset.lengthPx = String(lengthPx);
  feature.dataset.wallIndex = String(edge.index);
  feature.dataset.side = edge.side;

  feature.setAttribute("x", edge.p1.x + wallOffsetPx);
  feature.setAttribute("y", edge.p1.y - thickness / 2);
  feature.setAttribute("width", lengthPx);
  feature.setAttribute("height", thickness);
  feature.setAttribute("transform", `rotate(${edge.angleDeg} ${edge.p1.x} ${edge.p1.y})`);

  updateFeatureLabel(feature);
}

function updateFeaturesForRoom(roomRect) {
  const roomId = roomRect.dataset.room;
  const feats = svg.querySelectorAll(`rect[data-feature][data-room="${roomId}"]`);
  feats.forEach((f) => updateFeaturePosition(f));

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
  const nearest = getNearestWallEdge(roomRect, clickPos);
  if (!nearest) return;

  const defaultLenM = kind === "door" ? 0.9 : 1.2;
  const defaultLenPx = defaultLenM / SCALE_M_PER_PX;
  const wallLen = nearest.edge.length;

  let lengthPx = Math.min(defaultLenPx, wallLen);
  let startPx = nearest.projected.t - lengthPx / 2;
  startPx = clampNumber(startPx, 0, Math.max(0, wallLen - lengthPx));

  const feature = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  feature.dataset.feature = kind;
  feature.dataset.featureId = String(nextFeatureId++);
  feature.dataset.room = roomRect.dataset.room;
  feature.dataset.wallIndex = String(nearest.edge.index);
  feature.dataset.side = nearest.edge.side;
  feature.dataset.wallOffsetPx = String(startPx);
  feature.dataset.lengthPx = String(lengthPx);

  if (kind === "window") {
    feature.dataset.windowHeadM = String(WINDOW_HEAD_DEFAULT_M);
  }

  feature.style.cursor = "pointer";
  feature.setAttribute("fill", kind === "door" ? "#c08040" : "#80c0ff");
  ensureFeatureRectLooksLikeAFeature(feature);

  updateFeaturePosition(feature);
  bindFeatureEvents(feature);

  svg.appendChild(feature);

  rebuildWallsView();
  requestAutoSave?.("create feature");
}

// Feature editor panel (your existing UI)
function openFeatureInfo(feature) {
  selectedFeature = feature;
  updateFeatureInfoFields(feature);
  featureInfo.style.display = "flex";
  createFeatureHandles(feature);
}

function updateFeatureInfoFields(feature) {
  const kind = feature.dataset.feature === "door" ? "Door" : "Window";
  const info = getFeatureWallInfo(feature);
  if (!info) return;

  const wallOffsetPx = parseFloat(feature.dataset.wallOffsetPx) || 0;
  const lengthPx = parseFloat(feature.dataset.lengthPx) || 0;

  featureTypeLabel.textContent = `${kind} on ${info.edge.side}`;
  featureWidthInput.value = (lengthPx * SCALE_M_PER_PX).toFixed(2);
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

  const info = getFeatureWallInfo(selectedFeature);
  if (!info) return;

  const wallLen = info.edge.length;

  let widthM = parseFloat(featureWidthInput.value);
  let offsetM = parseFloat(featureOffsetInput.value);

  if (!isFinite(widthM) || widthM <= 0) return;
  if (!isFinite(offsetM) || offsetM < 0) offsetM = 0;

  let lengthPx = widthM / SCALE_M_PER_PX;
  let offsetPx = offsetM / SCALE_M_PER_PX;

  const minLen = 10;
  if (lengthPx < minLen) lengthPx = minLen;
  if (lengthPx > wallLen) lengthPx = wallLen;

  const maxOffset = Math.max(0, wallLen - lengthPx);
  offsetPx = clampNumber(offsetPx, 0, maxOffset);

  selectedFeature.dataset.wallOffsetPx = String(offsetPx);
  selectedFeature.dataset.lengthPx = String(lengthPx);

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
  requestAutoSave?.("edit feature");
}

featureWidthInput?.addEventListener("change", applyFeatureInputs);
featureOffsetInput?.addEventListener("change", applyFeatureInputs);
featureHeadInput?.addEventListener("change", applyFeatureInputs);

deleteFeatureBtn?.addEventListener("click", () => {
  if (!selectedFeature) return;
  deleteSelectedThing();
});

// -----------------------------------------
// Feature handles (circles)
// -----------------------------------------
function removeFeatureHandles() {
  featureHandleStart?.parentNode?.removeChild(featureHandleStart);
  featureHandleEnd?.parentNode?.removeChild(featureHandleEnd);
  featureHandleStart = null;
  featureHandleEnd = null;
}

function getFeatureEndpoints(feature) {
  const info = getFeatureWallInfo(feature);
  if (!info) return null;
  const { edge } = info;
  const offset = parseFloat(feature.dataset.wallOffsetPx) || 0;
  const length = parseFloat(feature.dataset.lengthPx) || 0;
  return {
    info,
    start: { x: edge.p1.x + edge.ux * offset, y: edge.p1.y + edge.uy * offset },
    end: { x: edge.p1.x + edge.ux * (offset + length), y: edge.p1.y + edge.uy * (offset + length) },
  };
}

function attachHandleDrag(handle, feature, handleType) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const info = getFeatureWallInfo(feature);
    if (!info) return;

    const { edge } = info;
    const wallLen = edge.length;
    const startOffset = parseFloat(feature.dataset.wallOffsetPx) || 0;
    const startLength = parseFloat(feature.dataset.lengthPx) || 0;
    const startPoint = getPointerPosition(e);
    const minLen = 10;

    function onMove(ev) {
      ev.preventDefault();
      const pos = getPointerPosition(ev);
      const deltaAlongWall = (pos.x - startPoint.x) * edge.ux + (pos.y - startPoint.y) * edge.uy;

      let offset = startOffset;
      let length = startLength;

      if (handleType === "start") {
        offset = startOffset + deltaAlongWall;
        offset = clampNumber(offset, 0, Math.max(0, wallLen - length));
      } else {
        length = startLength + deltaAlongWall;
        length = clampNumber(length, minLen, Math.max(minLen, wallLen - offset));
      }

      feature.dataset.wallOffsetPx = String(offset);
      feature.dataset.lengthPx = String(length);

      updateFeaturePosition(feature);
      updateFeatureHandlesPosition();
      updateFeatureLabel(feature);

      if (selectedFeature === feature) updateFeatureInfoFields(feature);
      rebuildWallsView();
      requestAutoSave?.("drag feature handle");
    }

    function onUp(ev) {
      ev.preventDefault();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
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

  const endpoints = getFeatureEndpoints(feature);
  if (!endpoints) return;

  featureHandleStart = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  featureHandleStart.setAttribute("cx", endpoints.start.x);
  featureHandleStart.setAttribute("cy", endpoints.start.y);
  featureHandleStart.setAttribute("r", 4);
  featureHandleStart.setAttribute("fill", "#ffffff");
  featureHandleStart.setAttribute("stroke", "#000000");
  featureHandleStart.style.cursor = "move";

  featureHandleEnd = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  featureHandleEnd.setAttribute("cx", endpoints.end.x);
  featureHandleEnd.setAttribute("cy", endpoints.end.y);
  featureHandleEnd.setAttribute("r", 4);
  featureHandleEnd.setAttribute("fill", "#ffffff");
  featureHandleEnd.setAttribute("stroke", "#000000");
  featureHandleEnd.style.cursor = "nwse-resize";

  svg.appendChild(featureHandleStart);
  svg.appendChild(featureHandleEnd);

  attachHandleDrag(featureHandleStart, feature, "start");
  attachHandleDrag(featureHandleEnd, feature, "end");
}

function updateFeatureHandlesPosition() {
  if (!selectedFeature || !featureHandleStart || !featureHandleEnd) return;
  const endpoints = getFeatureEndpoints(selectedFeature);
  if (!endpoints) return;

  featureHandleStart.setAttribute("cx", endpoints.start.x);
  featureHandleStart.setAttribute("cy", endpoints.start.y);
  featureHandleEnd.setAttribute("cx", endpoints.end.x);
  featureHandleEnd.setAttribute("cy", endpoints.end.y);
}

// -----------------------------------------
// Snapping
// -----------------------------------------
function getSnapEdgesFromPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return [];

  const edges = [];
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 1) continue;
    edges.push({
      p1,
      p2,
      dx,
      dy,
      length,
      ux: dx / length,
      uy: dy / length,
    });
  }
  return edges;
}

function getParallelEdgeSnapOffset(movingPoints, movingRoom) {
  const movingEdges = getSnapEdgesFromPoints(movingPoints);
  if (!movingEdges.length) return null;

  let best = null;
  const overlapMin = 20;
  const parallelTolerance = 0.02;

  svg.querySelectorAll(ROOM_SELECTOR).forEach((other) => {
    if (other === movingRoom) return;

    const otherEdges = getSnapEdgesFromPoints(getRoomPoints(other));
    otherEdges.forEach((otherEdge) => {
      movingEdges.forEach((movingEdge) => {
        const cross = movingEdge.ux * otherEdge.uy - movingEdge.uy * otherEdge.ux;
        if (Math.abs(cross) > parallelTolerance) return;

        // Use the moving edge direction as the tangent axis, and its normal as
        // the snap direction. This lets 45-degree/rotated walls snap to another
        // parallel wall instead of only using the room bounding box.
        const ux = movingEdge.ux;
        const uy = movingEdge.uy;
        const nx = -uy;
        const ny = ux;

        const movingAxis = movingEdge.p1.x * nx + movingEdge.p1.y * ny;
        const otherAxis = otherEdge.p1.x * nx + otherEdge.p1.y * ny;
        const distance = otherAxis - movingAxis;
        if (Math.abs(distance) > SNAP_TOUCH_PX) return;

        const movingT1 = movingEdge.p1.x * ux + movingEdge.p1.y * uy;
        const movingT2 = movingEdge.p2.x * ux + movingEdge.p2.y * uy;
        const otherT1 = otherEdge.p1.x * ux + otherEdge.p1.y * uy;
        const otherT2 = otherEdge.p2.x * ux + otherEdge.p2.y * uy;

        const movingStart = Math.min(movingT1, movingT2);
        const movingEnd = Math.max(movingT1, movingT2);
        const otherStart = Math.min(otherT1, otherT2);
        const otherEnd = Math.max(otherT1, otherT2);
        const overlap = Math.min(movingEnd, otherEnd) - Math.max(movingStart, otherStart);
        if (overlap < overlapMin) return;

        if (!best || Math.abs(distance) < Math.abs(best.distance)) {
          best = {
            distance,
            dx: nx * distance,
            dy: ny * distance,
          };
        }
      });
    });
  });

  return best;
}

function applySnapping(rect, proposedX, proposedY) {
  const geom = getRoomGeometry(rect);
  const w = geom.w;
  const h = geom.h;

  let snappedX = proposedX;
  let snappedY = proposedY;

  const allRects = Array.from(svg.querySelectorAll(ROOM_SELECTOR));
  const overlapMin = 20;

  const snap = (value, target, dist) => (Math.abs(value - target) <= dist ? target : value);
  const overlap = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1);

  allRects.forEach((other) => {
    if (other === rect) return;

    const otherGeom = getRoomGeometry(other);
    const ox = otherGeom.x;
    const oy = otherGeom.y;
    const ow = otherGeom.w;
    const oh = otherGeom.h;

    const oL = ox,
      oR = ox + ow,
      oT = oy,
      oB = oy + oh;

    const sL = snappedX,
      sR = snappedX + w,
      sT = snappedY,
      sB = snappedY + h;

    const vOverlap = overlap(sT, sB, oT, oB);
    const hOverlap = overlap(sL, sR, oL, oR);

    if (vOverlap >= overlapMin) {
      snappedX = snap(snappedX, oR, SNAP_TOUCH_PX);
      snappedX = snap(snappedX, oL - w, SNAP_TOUCH_PX);
    }

    if (hOverlap >= overlapMin) {
      snappedY = snap(snappedY, oB, SNAP_TOUCH_PX);
      snappedY = snap(snappedY, oT - h, SNAP_TOUCH_PX);
    }

    snappedX = snap(snappedX, oL, SNAP_ALIGN_PX);
    snappedX = snap(snappedX, oR - w, SNAP_ALIGN_PX);

    snappedY = snap(snappedY, oT, SNAP_ALIGN_PX);
    snappedY = snap(snappedY, oB - h, SNAP_ALIGN_PX);
  });

  const shiftedPoints = geom.points.map((p) => ({
    x: p.x + (snappedX - geom.x),
    y: p.y + (snappedY - geom.y),
  }));
  const edgeSnap = getParallelEdgeSnapOffset(shiftedPoints, rect);
  if (edgeSnap) {
    snappedX += edgeSnap.dx;
    snappedY += edgeSnap.dy;
  }

  snappedX = Math.round(snappedX * 10) / 10;
  snappedY = Math.round(snappedY * 10) / 10;

  return { x: snappedX, y: snappedY };
}

// -----------------------------------------
// Pointer events (rooms + features)
// -----------------------------------------
svg.addEventListener("pointerdown", (evt) => {
  const target = evt.target;

  // room label clicks handled elsewhere
  if (target?.tagName === "text" && target.dataset.room) return;

  const isRect = target?.tagName === "rect";
  const isHandle = target?.tagName === "circle";
  const isFeatureRect = isRect && !!target.dataset.feature;
  const isRoomRect = isRoomElement(target) && !isFeatureRect;
  const isPolygonRoom = isRoomRect && target.tagName?.toLowerCase() === "polygon";

  if (!isRoomRect) setSelectedRoomRect(null);

  if ((currentTool === "addDoor" || currentTool === "addWindow" || currentTool === "addWallPoint") && !isRoomRect) {
    setTool("select");
  }

  if (selectedFeature && !isFeatureRect && !isHandle) {
    closeFeatureSelection();
  }

  if (!isRect && !isPolygonRoom) return;

  if (isFeatureRect) {
    openFeatureInfo(target);
    evt.preventDefault();
    return;
  }

  if (isRoomRect && currentTool === "addWallPoint") {
    const pos = getPointerPosition(evt);
    const updatedRoom = insertPolygonPointOnNearestEdge(target, pos);
    if (updatedRoom) {
      setSelectedRoomRect(updatedRoom);
      openSizeEditorForRoom(updatedRoom.dataset.room);
    }
    setTool("select");
    evt.preventDefault();
    return;
  }

  if (isRoomRect && (currentTool === "addDoor" || currentTool === "addWindow")) {
    const pos = getPointerPosition(evt);
    createFeatureOnRoom(target, currentTool === "addDoor" ? "door" : "window", pos);
    evt.preventDefault();
    return;
  }

  if (currentTool !== "select" || !isRoomRect) return;

  const pos = getPointerPosition(evt);
  startPointer = pos;
  draggingRoom = target;
  setSelectedRoomRect(target);

  startRect = getRoomGeometry(target);

  const margin = 5;
  const nearRight = pos.x > startRect.x + startRect.w - margin && pos.x < startRect.x + startRect.w + margin;
  const nearBottom = pos.y > startRect.y + startRect.h - margin && pos.y < startRect.y + startRect.h + margin;

  if (lockSizes) {
    dragMode = "move";
  } else {
    dragMode = nearRight || nearBottom ? "resize" : "move";
  }

  svg.style.cursor = dragMode === "resize" ? "nwse-resize" : "move";

  // Always drag one room at a time.
  // joinedMode is reserved for the Add Floors laser-export toggle.
  startPositions = [];

  evt.preventDefault();
});

svg.addEventListener("pointermove", (evt) => {
  if (currentTool !== "select") return;
  if (draggingRoom) return;

  const target = evt.target;
  const isRoomRect = isRoomElement(target);
  if (!isRoomRect) {
    svg.style.cursor = "";
    return;
  }

  const pos = getPointerPosition(evt);

  const geom = getRoomGeometry(target);

  const nearRight = Math.abs(pos.x - (geom.x + geom.w)) < HOVER_MARGIN;
  const nearBottom = Math.abs(pos.y - (geom.y + geom.h)) < HOVER_MARGIN;

  const hoverMode = lockSizes ? "move" : nearRight || nearBottom ? "resize" : "move";
  svg.style.cursor = hoverMode === "resize" ? "nwse-resize" : "move";

  target.classList.toggle("room-hover-resize", hoverMode === "resize");
  target.classList.toggle("room-hover-move", hoverMode === "move");
});

svg.addEventListener("pointermove", (evt) => {
  if (!draggingRoom || !dragMode) return;

  const pos = getPointerPosition(evt);
  const dx = pos.x - startPointer.x;
  const dy = pos.y - startPointer.y;

  if (dragMode === "move") {
    svg.style.cursor = "move";

    const proposedX = startRect.x + dx;
    const proposedY = startRect.y + dy;
    const snapped = applySnapping(draggingRoom, proposedX, proposedY);

    moveRoomTo(draggingRoom, startRect, snapped.x, snapped.y);

    updateRoomLabel(draggingRoom);
    updateFeaturesForRoom(draggingRoom);
    updateTriangleVertexHandlesPosition();

    rebuildWallsView();
    requestAutoSave?.("move room");
  } else if (dragMode === "resize") {
    svg.style.cursor = "nwse-resize";
    let newW = startRect.w + dx;
    let newH = startRect.h + dy;

    const minSize = 15;
    if (newW < minSize) newW = minSize;
    if (newH < minSize) newH = minSize;

    resizeRoomFromStart(draggingRoom, startRect, newW, newH);

    updateRoomLabel(draggingRoom);
    updateFeaturesForRoom(draggingRoom);
    updateTriangleVertexHandlesPosition();

    rebuildWallsView();
    requestAutoSave?.("resize room");
  }

  evt.preventDefault();
});

function endRoomDrag() {
  draggingRoom = null;
  dragMode = null;
  startPointer = null;
  startRect = null;
  startPositions = [];

  svg.style.cursor = currentTool === "addDoor" || currentTool === "addWindow" || currentTool === "addWallPoint" ? "crosshair" : "default";
}

svg.addEventListener("pointerup", endRoomDrag);
svg.addEventListener("pointercancel", endRoomDrag);

// -----------------------------------------
// Rebind after restore
// -----------------------------------------
function rebuildPlanLabelsAndBindings() {
  const rooms = svg.querySelectorAll(ROOM_SELECTOR);
  rooms.forEach((r) => {
    ensureRoomRectLooksLikeARoom(r);
    if (!r.dataset.roomRotationDeg) setRoomRotationDataset(r, 0);
    ensureRoomLabelForRect(r);
    updateRoomLabel(r);
  });
  updateTriangleVertexHandlesPosition();

  const feats = Array.from(svg.querySelectorAll("rect[data-feature]"));
  feats.forEach((f) => {
    if (!f.dataset.featureId) f.dataset.featureId = String(nextFeatureId++);
    ensureFeatureRectLooksLikeAFeature(f);
    bindFeatureEvents(f);
    updateFeaturePosition(f);
  });
}

// ==========================================================
// EXPORT: FORCE HAIRLINE 0.026mm
// ==========================================================
function buildExportSvgString(svgEl) {
  if (!svgEl) throw new Error("SVG element missing");

  const clone = svgEl.cloneNode(true);

  // remove editor-only handles
  clone.querySelectorAll("circle").forEach((n) => n.remove());

  // remove hover/selection classes
  clone.querySelectorAll(".room-selected, .room-hover-resize, .room-hover-move").forEach((n) => {
    n.classList.remove("room-selected", "room-hover-resize", "room-hover-move");
  });

  // remove label outline strokes (laser export friendly)
  clone.querySelectorAll("text").forEach((t) => {
    t.removeAttribute("stroke");
    t.removeAttribute("stroke-width");
    t.removeAttribute("paint-order");
  });

  // FORCE hairline on anything with a stroke OR rooms/features explicitly
  const geo = clone.querySelectorAll("rect, path, line, polyline, polygon, circle, ellipse");
  geo.forEach((el) => {
    const strokeAttr = el.getAttribute("stroke");
    const style = el.getAttribute("style") || "";
    const hasStroke = (strokeAttr && strokeAttr !== "none") || style.includes("stroke:");

    // Force rooms/features to have a stroke in export
    const isRoom = el.hasAttribute("data-room") && !el.hasAttribute("data-feature");
    const isFeature = el.tagName === "rect" && el.hasAttribute("data-feature");

    if (hasStroke || isRoom || isFeature) {
      if (!strokeAttr || strokeAttr === "none") el.setAttribute("stroke", "black");
      el.setAttribute("stroke-width", String(EXPORT_STROKE_U));
      el.setAttribute("vector-effect", "non-scaling-stroke");
      el.setAttribute("stroke-linecap", "square");
      el.setAttribute("stroke-linejoin", "miter");
    }

    // Ensure rooms are not filled in export unless you want engrave
    if (isRoom) el.setAttribute("fill", "none");
  });

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  const serializer = new XMLSerializer();
  return serializer.serializeToString(clone);
}

function downloadSvgString(svgString, filename = "floorplan.svg") {
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportFloorplanSvg() {
  const svgString = buildExportSvgString(svg);
  downloadSvgString(svgString, "floorplan_hairline_0.026mm.svg");
}

// If you have an export button:
document.getElementById("exportBtn")?.addEventListener("click", exportFloorplanSvg);

// -----------------------------------------
// Startup
// -----------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // lock sizes UI
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

  // join mode UI
  const joinChk = document.getElementById("toggleJoinBtn");
  const joinStatus = document.getElementById("joinStatus");

  if (joinChk) {
    joinChk.checked = !!joinedMode;
    if (joinStatus) joinStatus.textContent = joinedMode ? "ON" : "OFF";

    joinChk.addEventListener("change", () => {
      joinedMode = joinChk.checked;
      if (joinStatus) joinStatus.textContent = joinedMode ? "ON" : "OFF";
      rebuildWallsView?.();
      requestAutoSave?.("join mode");
    });
  }

  // clear all
  const resetBtn = document.getElementById("resetAppBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const ok = confirm("This will permanently delete the saved plan on this device.\n\nContinue?");
      if (!ok) return;
      resetRoomPlannerStorage?.();
      location.reload();
    });
  }

  // load saved state
  loadFloorplanFromLocalStorage?.();

  // ensure styles for all rooms/features
  svg.querySelectorAll(ROOM_SELECTOR).forEach(ensureRoomRectLooksLikeARoom);
  svg.querySelectorAll("rect[data-feature]").forEach(ensureFeatureRectLooksLikeAFeature);

  // rebuild labels & events
  rebuildPlanLabelsAndBindings?.();

  // install zoom after svg exists
  installPlanViewZoom?.(svg);

  // deleted wall display / restore controls
  bindDeletedWallsControlsOnce?.();
  updatePolygonPointButtonState?.();

  // student name input
  const nameInput = document.getElementById("studentNameInput");
  if (nameInput) {
    nameInput.value = currentStudentName || "";
    nameInput.addEventListener("input", () => setStudentName?.(nameInput.value));
  }

  // autosave watcher last
  installFeatureAutoSaveObserver?.();

  // build laser view
  rebuildWallsView?.();

  // material thickness listeners if present
  if (materialThicknessInput) {
    materialThicknessInput.addEventListener("input", () => {
      rebuildWallsView();
      requestAutoSave?.("material thickness");
    });
    materialThicknessInput.addEventListener("change", () => {
      rebuildWallsView();
      requestAutoSave?.("material thickness");
    });
  }
});
