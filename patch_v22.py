from pathlib import Path
root = Path('/mnt/data/work_v22')
walls = root/'walls.js'
text = walls.read_text()
insert_before = "function addCombinedFloorPatch(lastBaselineY, usedSheets, markSheetUsed) {\n"
helper = r'''
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

'''
if insert_before not in text:
    raise SystemExit('insert target not found')
text = text.replace(insert_before, helper + insert_before, 1)
old = """  wallsSvg.appendChild(floorPath);\n  wallsSvg.appendChild(hit);\n\n  const widthMm = wPx;\n"""
new = """  wallsSvg.appendChild(floorPath);\n\n  // Blue guide lines show where each wall sits on the one-piece floor.\n  // They are exported as blue strokes so they can be engraved/marked\n  // separately from the red outside cut line.\n  addCombinedFloorWallGuides(polygons, floorX, floorY, bounds, enabled);\n\n  // Keep the transparent hit target above the guide lines for easy toggling.\n  wallsSvg.appendChild(hit);\n\n  const widthMm = wPx;\n"""
if old not in text:
    raise SystemExit('append target not found')
text = text.replace(old, new, 1)
walls.write_text(text)

css = root/'style.css'
ct = css.read_text()
css_insert_after = ".wall-label.disabled,\n.floor-label.disabled { opacity: 0.35; }\n"
css_add = r'''

.combined-floor-wall-guide {
  fill: none !important;
  stroke: rgb(0,0,255) !important;
  stroke-width: 1 !important;
  pointer-events: none;
}

.combined-floor-wall-guide.disabled,
.combined-floor-wall-guides.disabled {
  opacity: 0.35 !important;
}
'''
if css_insert_after not in ct:
    raise SystemExit('css target not found')
ct = ct.replace(css_insert_after, css_insert_after + css_add, 1)
css.write_text(ct)

sw = root/'sw.js'
st = sw.read_text()
st = st.replace('const CACHE_VERSION = "v1.0.21";', 'const CACHE_VERSION = "v1.0.22";')
sw.write_text(st)
print('[OK] patched v22')
