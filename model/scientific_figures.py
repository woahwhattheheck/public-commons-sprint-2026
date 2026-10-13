"""Vector scientific figures from the retained numeric source specifications."""
from __future__ import annotations
import math

def _number(value):
    if isinstance(value, bool):
        raise ValueError("Scientific figure coordinates must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("Scientific figure coordinates must be finite")
    return result

def _validate_figure(figure):
    if not isinstance(figure, dict) or not isinstance(figure.get("panels"), list):
        raise ValueError("Scientific figures require their original panel specifications")
    for panel in figure["panels"]:
        if panel.get("kind") == "projected_geometry_map":
            from .scientific_map_figures import validate_panel
            validate_panel(panel, figure.get("geometries"))
            continue
        for axis in ("x", "y"):
            spec = panel[axis]
            lo, hi = map(_number, spec["domain"])
            if hi <= lo:
                raise ValueError("Scientific figure axis has no positive span")
            for tick in spec.get("ticks", []):
                _number(tick["value"])
        for series in panel.get("series", []):
            if "markers" in series and (not isinstance(series["markers"], bool)
                    or (series["markers"] is False and series.get("geometry") != "line")):
                raise ValueError("Scientific series markers must be boolean; marker-free geometry must be a line")
            if series.get("geometry") not in ("line", "scatter", "boxplot"):
                raise ValueError("Unknown scientific figure geometry")
            for point in series.get("points", []):
                _number(point["x"])
                if series["geometry"] == "boxplot":
                    values = [_number(point[k]) for k in ("minimum", "q1", "median", "q3", "maximum")]
                    if values != sorted(values):
                        raise ValueError("Boxplot quantiles must retain their original order")
                elif point.get("y") is not None:
                    _number(point["y"])
        for line in panel.get("reference_lines", []):
            if line.get("axis", "y") not in ("x", "y"):
                raise ValueError("Reference line needs an x or y axis")
            _number(line["value"])
        for annotation in panel.get("annotations", []):
            _number(annotation["x"])
            _number(annotation["y"])
            if not isinstance(annotation.get("text"), str) or not annotation["text"].strip():
                raise ValueError("Scientific annotations need their original text")

def _marker(drawing, x, y, kind, radius, color, open_marker=False):
    from reportlab.graphics.shapes import Circle, Polygon, Rect, Line
    from reportlab.lib import colors
    if kind == "diamond-mean":
        kind, open_marker = "diamond", True
    fill = colors.white if open_marker else color
    if kind in ("triangle", "triangle-up"):
        drawing.add(Polygon([x, y+radius*1.2, x-radius, y-radius, x+radius, y-radius],
                            strokeColor=color, fillColor=fill, strokeWidth=.7))
    elif kind in ("square", "rect"):
        drawing.add(Rect(x-radius, y-radius, 2*radius, 2*radius,
                         strokeColor=color, fillColor=fill, strokeWidth=.7))
    elif kind == "diamond":
        drawing.add(Polygon([x,y+radius*1.3,x-radius,y,x,y-radius*1.3,x+radius,y],
                            strokeColor=color, fillColor=fill, strokeWidth=.7))
    elif kind in ("cross", "x"):
        drawing.add(Line(x-radius,y-radius,x+radius,y+radius,strokeColor=color,strokeWidth=.8))
        drawing.add(Line(x-radius,y+radius,x+radius,y-radius,strokeColor=color,strokeWidth=.8))
    else:
        drawing.add(Circle(x,y,radius,strokeColor=color,fillColor=fill,strokeWidth=.7))

def panel_drawing(panel, width):
    """Draw the figure's supplied numeric coordinates with ReportLab vectors."""
    from reportlab.graphics.shapes import Drawing, Line, PolyLine, Rect, String
    from reportlab.lib import colors
    width = float(width)
    height = 252.0
    left, right, bottom, top = 56.0, 15.0, 68.0, 28.0
    plot_w, plot_h = width-left-right, height-bottom-top
    x0, x1 = map(_number, panel["x"]["domain"])
    y0, y1 = map(_number, panel["y"]["domain"])
    X = lambda value: left + (_number(value)-x0)/(x1-x0)*plot_w
    Y = lambda value: bottom + (_number(value)-y0)/(y1-y0)*plot_h
    drawing = Drawing(width, height)
    ink, grid = colors.HexColor("#202020"), colors.HexColor("#dedede")
    for axis in ("x", "y"):
        for tick in panel[axis].get("ticks", []):
            value = _number(tick["value"])
            lo, hi = (x0,x1) if axis=="x" else (y0,y1)
            if not lo <= value <= hi:
                continue
            label = str(tick.get("label", format(value, ".4g")))
            if axis=="x":
                p=X(value)
                drawing.add(Line(p,bottom,p,bottom-4,strokeColor=ink,strokeWidth=.5))
                drawing.add(String(p,bottom-16,label,fontName="Helvetica",fontSize=7,textAnchor="middle",fillColor=ink))
            else:
                p=Y(value)
                drawing.add(Line(left,p,left+plot_w,p,strokeColor=grid,strokeWidth=.35))
                drawing.add(String(left-7,p-2.4,label,fontName="Helvetica",fontSize=7,textAnchor="end",fillColor=ink))
    drawing.add(Line(left,bottom,left+plot_w,bottom,strokeColor=ink,strokeWidth=.7))
    drawing.add(Line(left,bottom,left,bottom+plot_h,strokeColor=ink,strokeWidth=.7))
    title = str(panel.get("title") or panel.get("label") or "")
    drawing.add(String(left,height-13,title,fontName="Helvetica-Bold",fontSize=9,fillColor=ink))
    xlabel = panel["x"].get("label","")
    ylabel = panel["y"].get("label","")
    xu, yu = panel["x"].get("unit",""), panel["y"].get("unit","")
    if xu and xu not in ("days since 1970-01-01 UTC", "station index"):
        xlabel += " (" + str(xu) + ")"
    if yu:
        ylabel += " (" + str(yu) + ")"
    drawing.add(String(left+plot_w/2,30,str(xlabel),fontName="Helvetica",fontSize=8,textAnchor="middle",fillColor=ink))
    # Horizontal units stay legible beside the panel title on a portrait page.
    if ylabel:
        drawing.add(String(left+plot_w,height-13,str(ylabel),fontName="Helvetica",fontSize=7,textAnchor="end",fillColor=ink))
    for line in panel.get("reference_lines", []):
        axis = line.get("axis","y")
        v = _number(line["value"])
        if axis=="y" and y0<=v<=y1:
            p=Y(v);drawing.add(Line(left,p,left+plot_w,p,strokeColor=ink,strokeWidth=.7,strokeDashArray=[3,2]))
        elif axis=="x" and x0<=v<=x1:
            p=X(v);drawing.add(Line(p,bottom,p,bottom+plot_h,strokeColor=ink,strokeWidth=.7,strokeDashArray=[3,2]))
    marks = ("circle","square","triangle","diamond","cross")
    for si, series in enumerate(panel.get("series", [])):
        kind=series["geometry"];points=series.get("points",[])
        marker=series.get("marker") or marks[si%len(marks)]
        if isinstance(marker,dict):
            marker=marker.get("shape","circle")
        marker_open = str(marker).endswith("-open")
        marker = str(marker).removesuffix("-open")
        if kind=="boxplot":
            for p in points:
                x=X(p["x"]);w=min(20,max(6,plot_w/max(12,len(points)*3)))
                lo,q1,med,q3,hi=[Y(p[k]) for k in ("minimum","q1","median","q3","maximum")]
                drawing.add(Line(x,lo,x,hi,strokeColor=ink,strokeWidth=.8))
                for y in (lo,hi):
                    drawing.add(Line(x-w/3,y,x+w/3,y,strokeColor=ink,strokeWidth=.8))
                drawing.add(Rect(x-w/2,q1,w,q3-q1,strokeColor=ink,strokeWidth=.8,fillColor=colors.white))
                drawing.add(Line(x-w/2,med,x+w/2,med,strokeColor=ink,strokeWidth=1.1))
                if p.get("mean") is not None:
                    _marker(drawing,x,Y(p["mean"]),"diamond",2.5,ink,True)
            continue
        segment=[]
        marker_points=[]
        for point in points:
            if point.get("y") is None:
                if kind=="line" and len(segment)>2:
                    drawing.add(PolyLine(segment,strokeColor=ink,strokeWidth=.8,strokeDashArray=[] if si==0 else [4,2]))
                segment=[]
                continue
            x,y=X(point["x"]),Y(point["y"])
            if x<left-1e-6 or x>left+plot_w+1e-6 or y<bottom-1e-6 or y>bottom+plot_h+1e-6:
                raise ValueError("Figure source point falls outside its supplied axis domain")
            segment.extend((x,y))
            marker_points.append((x,y,bool(point.get("censored") or series.get("open_marker") or marker_open or ("filled" in point and not point["filled"]))))
        if kind=="line" and len(segment)>2:
            drawing.add(PolyLine(segment,strokeColor=ink,strokeWidth=.8,strokeDashArray=[] if si==0 else [4,2]))
        for x,y,is_open in marker_points:
            if series.get("markers", True):
                _marker(drawing,x,y,str(marker),2.1,ink,is_open)
    # Place the original annotation text and threshold labels in the figure.
    # Candidate boxes are scored against earlier labels and every source marker.
    from reportlab.pdfbase.pdfmetrics import stringWidth
    point_locations = [(X(p["x"]), Y(p["y"])) for series in panel.get("series", [])
                       for p in series.get("points", []) if p.get("y") is not None]
    placed = []
    notes = [{"x": X(a["x"]), "y": Y(a["y"]), "text": a["text"]}
             for a in panel.get("annotations", [])]
    for reference in panel.get("reference_lines", []):
        if not reference.get("label"):
            continue
        axis = reference.get("axis", "y")
        value = _number(reference["value"])
        if axis == "x" and x0 <= value <= x1:
            notes.append({"x": X(value), "y": bottom + plot_h - 8,
                          "text": str(reference["label"])})
        elif axis == "y" and y0 <= value <= y1:
            notes.append({"x": left + plot_w - 8, "y": Y(value),
                          "text": str(reference["label"])})
    for note in notes:
        label = str(note["text"])
        font_size = 6.5
        label_w = stringWidth(label, "Helvetica", font_size)
        if label_w > plot_w - 6:
            raise ValueError("Scientific annotation is wider than the original panel")
        box_w, box_h = label_w + 4, 11
        px, py = note["x"], note["y"]
        candidates = []
        for dy in (8, -19, 22, -33, 36, -47):
            for dx in (6, -box_w - 6, -box_w / 2):
                bx = min(left + plot_w - box_w - 2, max(left + 2, px + dx))
                by = min(bottom + plot_h - box_h - 2, max(bottom + 2, py + dy))
                candidates.append((bx, by))
        # Sparse plot-space alternatives let a crowded event keep its full label.
        for by in (bottom + plot_h - box_h - 3, bottom + plot_h / 2, bottom + 3):
            for bx in (left + 3, left + (plot_w - box_w) / 2, left + plot_w - box_w - 3):
                candidates.append((bx, by))
        def score(position):
            bx, by = position
            overlap = sum(max(0, min(bx + box_w, ox + ow) - max(bx, ox)) *
                          max(0, min(by + box_h, oy + oh) - max(by, oy))
                          for ox, oy, ow, oh in placed)
            hidden = sum(bx - 3 <= x <= bx + box_w + 3 and by - 3 <= y <= by + box_h + 3
                         for x, y in point_locations)
            distance = (bx + box_w / 2 - px) ** 2 + (by + box_h / 2 - py) ** 2
            return overlap * 10000 + hidden * 100000 + distance
        bx, by = min(candidates, key=score)
        placed.append((bx, by, box_w, box_h))
        ex = min(bx + box_w, max(bx, px))
        ey = min(by + box_h, max(by, py))
        drawing.add(Line(px, py, ex, ey, strokeColor=ink, strokeWidth=.35))
        drawing.add(Rect(bx, by, box_w, box_h, strokeColor=None, fillColor=colors.white))
        drawing.add(String(bx + 2, by + 3, label, fontName="Helvetica",
                           fontSize=font_size, fillColor=ink))
    # Compact monochrome legend reproduces each source-series marker and line style.
    cursor, legend_y = left, 12.0
    for si, series in enumerate(panel.get("series", [])):
        label = str(series.get("label", ""))
        if not label:
            continue
        needed = min(plot_w, 23 + len(label) * 3.8)
        if cursor + needed > left + plot_w and cursor > left:
            continue
        if series["geometry"] == "line":
            drawing.add(Line(cursor,legend_y,cursor+14,legend_y,strokeColor=ink,
                             strokeWidth=.8,strokeDashArray=[] if si==0 else [4,2]))
        mark = series.get("marker", "circle")
        if isinstance(mark, dict):
            mark = mark.get("shape", "circle")
        if series.get("markers", True):
            _marker(drawing,cursor+7,legend_y,str(mark).removesuffix("-open"),2.0,ink,
                    str(mark).endswith("-open"))
        drawing.add(String(cursor+20,legend_y-2.5,label,fontName="Helvetica",
                           fontSize=7,fillColor=ink))
        cursor += needed + 8
    return drawing

def panel_drawings(figure, width):
    """Return one print-safe native vector drawing per original scientific panel."""
    _validate_figure(figure)
    if not math.isfinite(float(width)) or float(width) < 300:
        raise ValueError("Scientific report figures need a usable page width")
    result = []
    for panel in figure["panels"]:
        if panel.get("kind") == "projected_geometry_map":
            from .scientific_map_figures import panel_drawing as map_drawing
            result.append(map_drawing(panel, figure["geometries"], float(width), validated=True))
        else:
            result.append(panel_drawing(panel, float(width)))
    return result
