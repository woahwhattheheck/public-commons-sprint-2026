"""Source-bound projected geometry figures for the shared scientific renderer.

TokenJunkieLabs. Original XY vertices, multipart geometry and holes are drawn
without reprojection, simplification or a geographic basemap. Distances on these
figures are projected grid metres, never an asserted ground-distance correction.
"""
from __future__ import annotations

import math

from .common import digest

KIND = "projected_geometry_map"
ROLE_LABELS_VERSION = 1
_GEOMETRIES = {"Point", "MultiPoint", "LineString", "MultiLineString",
               "Polygon", "MultiPolygon", "GeometryCollection"}


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Map coordinates must be finite original numbers")
    return float(value)


def _position(value):
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        raise ValueError("A map position needs original XY coordinates")
    for item in value:
        _number(item)
    return value


def positions(geometry, depth=0):
    """Validate supported native geometry and yield its original positions."""
    if depth > 32 or not isinstance(geometry, dict) or geometry.get("type") not in _GEOMETRIES:
        raise ValueError("Map figure needs an original supported geometry")
    kind = geometry["type"]
    if kind == "GeometryCollection":
        parts = geometry.get("geometries")
        if not isinstance(parts, list) or not parts:
            raise ValueError("Map geometry collection must be nonempty")
        for part in parts:
            yield from positions(part, depth + 1)
        return
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, (list, tuple)) or not coordinates:
        raise ValueError("Map geometry must have original coordinates")
    if kind == "Point":
        yield _position(coordinates)
    elif kind in ("MultiPoint", "LineString"):
        if kind == "LineString" and len(coordinates) < 2:
            raise ValueError("A map line needs at least two positions")
        for point in coordinates:
            yield _position(point)
    elif kind in ("MultiLineString", "Polygon"):
        for part in coordinates:
            if not isinstance(part, (list, tuple)) or len(part) < (4 if kind == "Polygon" else 2):
                raise ValueError("Map line or ring has insufficient positions")
            for point in part:
                yield _position(point)
            if kind == "Polygon" and part[0][:2] != part[-1][:2]:
                raise ValueError("Map polygon ring must retain its original closure")
    else:
        for polygon in coordinates:
            yield from positions({"type": "Polygon", "coordinates": polygon}, depth + 1)


def _role_labels(panel):
    labels = panel.get("role_labels", {})
    if not isinstance(labels, dict) or set(labels) - {"contribution", "receptor"}:
        raise ValueError("Map role labels may name only the two declared visual roles")
    for label in labels.values():
        if not isinstance(label, str) or not label.strip() or len(label) > 160:
            raise ValueError("Map role labels must be nonempty text of at most 160 characters")
    return {"contribution": "Contribution area", "receptor": "Source / receptor", **labels}


def validate_panel(panel, geometries):
    from pyproj import CRS
    if panel.get("kind") != KIND or not isinstance(geometries, dict):
        raise ValueError("Projected map requires its original geometry bank")
    bounds = panel.get("bounds")
    if not isinstance(bounds, list) or len(bounds) != 4:
        raise ValueError("Projected map requires explicit original XY extent")
    x0, y0, x1, y1 = map(_number, bounds)
    if x1 <= x0 or y1 <= y0:
        raise ValueError("Projected map extent must have positive spans")
    declared = panel.get("crs", {})
    crs = CRS.from_user_input(declared.get("wkt", ""))
    if (not crs.is_projected or declared.get("units") != "metre"
            or declared.get("axes") != "XY" or len(crs.axis_info) < 2
            or any(abs(axis.unit_conversion_factor - 1.0) > 1e-12 for axis in crs.axis_info[:2])):
        raise ValueError("Map figure requires original projected XY metre coordinates")
    _role_labels(panel)
    layers = panel.get("layers")
    if not isinstance(layers, list) or not layers:
        raise ValueError("Projected map requires original bound layers")
    seen = set()
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("role") not in ("receptor", "contribution"):
            raise ValueError("Map layer needs its explicit receptor or contribution role")
        key = layer.get("geometry")
        if key not in geometries:
            raise ValueError("Map lost its declared original geometry")
        if key not in seen:
            geometry = geometries[key]
            if digest(geometry) != key:
                raise ValueError("Map geometry differs from its original retained identity")
            for point in positions(geometry):
                if not x0 <= point[0] <= x1 or not y0 <= point[1] <= y1:
                    raise ValueError("Original map geometry leaves its declared extent")
            seen.add(key)
        source = layer.get("source", {})
        if (not isinstance(source.get("path"), str) or not source["path"]
                or not isinstance(source.get("sha256"), str) or len(source["sha256"]) != 64
                or not isinstance(source.get("bytes"), int) or source["bytes"] < 0
                or not isinstance(layer.get("receptor_id"), str)):
            raise ValueError("Map layer must retain original file and receptor identities")
    legend = panel.get("legend", [])
    if not isinstance(legend, list) or len(legend) > 6:
        raise ValueError("Map legend must be paged into at most six original waters")
    for row in legend:
        if not isinstance(row, dict) or not isinstance(row.get("label"), str) or not row["label"].strip():
            raise ValueError("Map legend needs the original water name")
        _position(row["anchor"])
        if not x0 <= row["anchor"][0] <= x1 or not y0 <= row["anchor"][1] <= y1:
            raise ValueError("Map label must remain inside the original extent")


def _wrap(value, width, font_size=8, max_lines=None):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    result, line = [], ""
    for word in str(value).split():
        candidate = (line + " " + word).strip()
        if stringWidth(candidate, "Helvetica", font_size) <= width:
            line = candidate
        else:
            if line:
                result.append(line)
            line = ""
            # Break unusually long original IDs without deleting characters.
            for character in word:
                if stringWidth(line + character, "Helvetica", font_size) > width and line:
                    result.append(line)
                    line = ""
                line += character
    if line:
        result.append(line)
    if max_lines is not None and len(result) > max_lines:
        # Full original labels always remain in the source spec and report table.
        result = result[:max_lines]
        while stringWidth(result[-1] + "...", "Helvetica", font_size) > width:
            result[-1] = result[-1][:-1]
        result[-1] += "..."
    return result or [""]


def _draw_geometry(drawing, geometry, X, Y, role):
    from reportlab.graphics.shapes import Circle, Path, PolyLine
    from reportlab.lib import colors
    kind = geometry["type"]
    ink = colors.Color(.10, .10, .10)
    edge = colors.Color(.48, .48, .48)
    fill = colors.Color(.87, .87, .87) if role == "contribution" else None
    color, weight = (edge, .55) if role == "contribution" else (ink, 1.1)
    if kind == "GeometryCollection":
        for part in geometry["geometries"]:
            _draw_geometry(drawing, part, X, Y, role)
    elif kind == "Point":
        x, y = geometry["coordinates"][:2]
        drawing.add(Circle(X(x), Y(y), 2.7, strokeColor=ink, fillColor=colors.white, strokeWidth=1))
        drawing.add(Circle(X(x), Y(y), .8, strokeColor=None, fillColor=ink))
    elif kind == "MultiPoint":
        for point in geometry["coordinates"]:
            _draw_geometry(drawing, {"type": "Point", "coordinates": point}, X, Y, role)
    elif kind == "LineString":
        drawing.add(PolyLine([value for p in geometry["coordinates"] for value in (X(p[0]), Y(p[1]))],
                            strokeColor=color, strokeWidth=weight, fillColor=None))
    elif kind == "MultiLineString":
        for line in geometry["coordinates"]:
            _draw_geometry(drawing, {"type": "LineString", "coordinates": line}, X, Y, role)
    elif kind == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            _draw_geometry(drawing, {"type": "Polygon", "coordinates": polygon}, X, Y, role)
    else:
        # One compound path per polygon. Even-odd fill leaves original holes
        # transparent without relying on ring orientation or overpainting.
        path = Path(strokeColor=color, fillColor=fill, strokeWidth=weight, fillMode=0)
        for ring in geometry["coordinates"]:
            path.moveTo(X(ring[0][0]), Y(ring[0][1]))
            for point in ring[1:]:
                path.lineTo(X(point[0]), Y(point[1]))
            path.close()
        drawing.add(path)


def panel_drawing(panel, geometries, width, *, validated=False):
    """Return the same vector Drawing used by retained SVG and report PDF."""
    from reportlab.graphics.shapes import Drawing, Line, Rect, String, Polygon
    from reportlab.lib import colors
    if not validated:
        validate_panel(panel, geometries)
    width = _number(width)
    if width < 300:
        raise ValueError("Map report requires a usable page width")
    role_labels = _role_labels(panel)
    custom_labels = role_labels != {"contribution": "Contribution area", "receptor": "Source / receptor"}
    label_lines = {role: _wrap(label, (width - 36) / 2 - 22, 7)
                   for role, label in role_labels.items()}
    label_extra = 9 * (max(len(lines) for lines in label_lines.values()) - 1) if custom_labels else 0
    height = 466.0 + label_extra
    drawing = Drawing(width, height)
    ink, edge = colors.Color(.10, .10, .10), colors.Color(.60, .60, .60)
    drawing.add(Rect(0, 0, width, height, strokeColor=None, fillColor=colors.white))
    for index, line in enumerate(_wrap(panel.get("title", "Original source geography"), width - 74, 10, 2)):
        drawing.add(String(12, height - 17 - index * 12, line, fontName="Helvetica", fontSize=10, fillColor=ink))
    # Constant projected metres per point on both axes; all bounds receive margin
    # in the producer, so no clipping or omitted vertices are needed.
    left, bottom, box_w, box_h = 16.0, 140.0 + label_extra, width - 32.0, 276.0
    x0, y0, x1, y1 = panel["bounds"]
    scale = min(box_w / (x1 - x0), box_h / (y1 - y0))
    map_w, map_h = (x1 - x0) * scale, (y1 - y0) * scale
    ox, oy = left + (box_w - map_w) / 2, bottom + (box_h - map_h) / 2
    X, Y = lambda x: ox + (x - x0) * scale, lambda y: oy + (y - y0) * scale
    drawing.add(Rect(left, bottom, box_w, box_h, strokeColor=edge, fillColor=None, strokeWidth=.5))
    # Contributions first, receptor marks last; overlapping areas are opaque
    # outlines/fills, never an additive concentration or summed-area heatmap.
    for role in ("contribution", "receptor"):
        for layer in panel["layers"]:
            if layer["role"] == role:
                _draw_geometry(drawing, geometries[layer["geometry"]], X, Y, role)
    placed = []
    for index, item in enumerate(panel.get("legend", []), 1):
        x, y = item["anchor"][:2]
        px, py = X(x), Y(y)
        chosen = None
        for dx, dy in ((4, 3), (4, 18), (-19, 3), (-19, 18), (4, -16),
                       (-19, -16), (22, 3), (-37, 3), (4, 34), (-19, -32)):
            lx = max(left + 2, min(left + box_w - 16, px + dx))
            ly = max(bottom + 2, min(bottom + box_h - 13, py + dy))
            box = (lx, ly, lx + 14, ly + 11)
            if not any(box[0] < old[2] + 2 and box[2] > old[0] - 2
                       and box[1] < old[3] + 2 and box[3] > old[1] - 2 for old in placed):
                chosen = box
                break
        if chosen is None:
            chosen = box
        placed.append(chosen)
        lx, ly = chosen[:2]
        drawing.add(Line(px, py, lx + 7, ly + 5, strokeColor=edge, strokeWidth=.4))
        drawing.add(Rect(lx, ly, 14, 11, strokeColor=edge, fillColor=colors.white, strokeWidth=.4))
        drawing.add(String(lx + 7, ly + 2, str(index), textAnchor="middle", fontName="Helvetica",
                           fontSize=7, fillColor=ink))
    # Grid north, not geographic north or a flow-direction assertion.
    nx, ny = width - 30, bottom + box_h + 7
    drawing.add(Rect(nx - 16, ny - 9, 31, 42, fillColor=colors.white, strokeColor=None))
    drawing.add(Line(nx, ny, nx, ny + 20, strokeColor=ink, strokeWidth=.8))
    drawing.add(Polygon([nx, ny + 24, nx - 3, ny + 17, nx + 3, ny + 17],
                        fillColor=ink, strokeColor=ink))
    drawing.add(String(nx, ny - 7, "Grid N", textAnchor="middle", fontName="Helvetica", fontSize=6.5))
    desired = min(map_w / 3, 105) / scale
    exponent = math.floor(math.log10(desired))
    unit = 10.0 ** exponent
    length = max(value * unit for value in (1, 2, 5, 10) if value * unit <= desired)
    sx, sy = 20, bottom - 15
    drawing.add(Line(sx, sy, sx + length * scale, sy, strokeColor=ink, strokeWidth=1))
    for point in (sx, sx + length * scale):
        drawing.add(Line(point, sy - 3, point, sy + 3, strokeColor=ink, strokeWidth=.7))
    label = format(length / 1000, ".4g") + " grid km" if length >= 1000 else format(length, ".4g") + " grid m"
    drawing.add(String(sx + length * scale / 2, sy - 11, label, textAnchor="middle", fontSize=7))
    drawing.add(String(width - 18, sy - 2, str(panel["crs"].get("name", "Projected CRS")),
                       textAnchor="end", fontName="Helvetica", fontSize=7))
    label_y = 100 + label_extra
    drawing.add(Rect(18, label_y, 11, 7, fillColor=colors.Color(.87, .87, .87), strokeColor=edge, strokeWidth=.5))
    if custom_labels:
        right_x = 18 + (width - 36) / 2
        drawing.add(Line(right_x, label_y + 4, right_x + 15, label_y + 4, strokeColor=ink, strokeWidth=1.1))
        for role, x in (("contribution", 34), ("receptor", right_x + 21)):
            for index, line in enumerate(label_lines[role]):
                drawing.add(String(x, label_y - index * 9, line, fontSize=7))
    else:
        # Preserve original Receiving waters swatch labels and positions exactly.
        drawing.add(String(34, 100, "Contribution area", fontSize=7))
        drawing.add(Line(145, 104, 160, 104, strokeColor=ink, strokeWidth=1.1))
        drawing.add(String(166, 100, "Source / receptor", fontSize=7))
    for index, item in enumerate(panel.get("legend", [])):
        column, row = index % 2, index // 2
        x, y = 18 + column * (width / 2), 85 - row * 23
        lines = _wrap(str(index + 1) + ". " + item["label"], width / 2 - 32, 7, 2)
        for offset, line in enumerate(lines):
            drawing.add(String(x, y - offset * 9, line, fontName="Helvetica", fontSize=7))
    drawing.add(String(18, 12, "Original XY geometry; areas may overlap. Symbols are not to scale.",
                       fontName="Helvetica", fontSize=6.8, fillColor=ink))
    return drawing
