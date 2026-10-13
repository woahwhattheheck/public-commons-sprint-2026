"""Print and online maps from retained native rasters and original vector sources."""
from __future__ import annotations
import math
from pathlib import Path
import textwrap
from .common import finite

MAP_RENDERER_VERSION = "shared-native-scales/v1"

LABELS = {
    "nitrogen_export": "Nitrogen export", "phosphorus_export": "Phosphorus export",
    "sediment_export": "Sediment export", "combined_priority": "Combined export priority",
}
TITLES = {
    "future_sediment_loss": "Potential future sediment export",
    "future_nutrient_runoff": "Potential future nitrogen and phosphorus export",
    "critical_drinking_water": "Source-water catchments and export priorities",
    "high_quality_waters": "Designated high-quality waters and modeled exports",
    "current_nutrient_export": "Current nitrogen and phosphorus export",
    "current_sediment_export": "Current sediment export",
    "combined_pollutant_export": "Combined pollutant export priority",
}

def _geometry(ax, geometry, *, color="#202020", width=.5, style="-", alpha=1):
    if geometry.geom_type == "Polygon":
        ax.plot(*geometry.exterior.xy, color=color, linewidth=width, linestyle=style, alpha=alpha)
        for ring in geometry.interiors:
            ax.plot(*ring.xy, color=color, linewidth=width, linestyle=style, alpha=alpha)
    elif geometry.geom_type in ("LineString", "LinearRing"):
        ax.plot(*geometry.xy, color=color, linewidth=width, linestyle=style, alpha=alpha)
    elif geometry.geom_type == "Point":
        ax.plot([geometry.x], [geometry.y], marker="o", markersize=3, color=color, alpha=alpha)
    elif hasattr(geometry, "geoms"):
        for child in geometry.geoms:
            _geometry(ax, child, color=color, width=width, style=style, alpha=alpha)

def _north_and_scale(ax, bounds, crs):
    from pyproj import Transformer
    left, bottom, right, top = bounds
    width, height = right - left, top - bottom
    x, y = left + width * .93, bottom + height * .86
    to_geo = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    to_native = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    lon, lat = to_geo.transform(x, y)
    nx, ny = to_native.transform(lon, min(lat + .01, 89.99))
    length = math.hypot(nx - x, ny - y)
    if length:
        multiplier = min(width, height) * .07 / length
        tip = (x + (nx - x) * multiplier, y + (ny - y) * multiplier)
        ax.annotate("", xy=tip, xytext=(x, y),
                    arrowprops={"arrowstyle": "-|>", "color": "#111111", "linewidth": 1.0})
        ax.text(tip[0], tip[1] + height * .008, "N", ha="center", va="bottom", fontsize=8)
    aim = width * .18
    magnitude = 10 ** math.floor(math.log10(aim))
    length = max(v * magnitude for v in (1, 2, 5, 10) if v * magnitude <= aim)
    x0, y0 = left + width * .055, bottom + height * .05
    ax.plot([x0, x0 + length], [y0, y0], color="black", linewidth=2)
    ax.plot([x0, x0], [y0 - height * .007, y0 + height * .007], color="black", linewidth=.8)
    ax.plot([x0 + length, x0 + length], [y0 - height * .007, y0 + height * .007], color="black", linewidth=.8)
    ax.text(x0 + length / 2, y0 + height * .013,
            (format(length / 1000, "g") + " km") if length >= 1000 else (format(length, "g") + " m"),
            ha="center", va="bottom", fontsize=7, bbox={"facecolor": "white", "edgecolor": "none", "alpha": .8})


def shared_display_scale(paths, *, signed=False, percentile=98, units=""):
    """Choose one exact native-cell range for a comparable set of map panels."""
    from .raster_stats import raster_percentile
    percentile = finite(percentile, "Map display percentile", minimum=0)
    if percentile > 100:
        raise ValueError("Map display percentile must be at most 100")
    paths = list(dict.fromkeys(str(Path(path).resolve()) for path in paths))
    if not paths:
        raise ValueError("Select at least one original raster for a display scale")
    quantiles = [raster_percentile(path, percentile, positive_only=True,
                                  absolute=signed) for path in paths]
    available = [value for value in quantiles if value is not None and value > 0]
    maximum = max(available, default=1.0)
    label = ("Shared alternative scale; " if signed else "Native-cell display scale; ")
    label += (format(percentile, "g") + "th percentile of nonzero " +
              ("absolute changes." if signed else "values."))
    if len(paths) > 1:
        label += " The largest per-raster cap applies to every alternative."
    if not available:
        label = "Zero-valued modeled cells use a neutral display range."
    return {"minimum": -maximum if signed else 0.0, "maximum": maximum,
            "signed": bool(signed), "units": units, "percentile": percentile,
            "population": "finite nonzero absolute cells" if signed else "finite positive cells",
            "combination": "maximum of per-raster exact percentiles",
            "raster_percentiles": quantiles, "raster_count": len(paths),
            "neutral_zero_range": not available, "label": label}

def map_pdf(path, title, panels, *, overlays, boundary, crs, subtitle, footer, dpi=220,
            paper=None, project_title="", pdf_pages=None, page_number=None, page_count=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import Normalize, TwoSlopeNorm
    from matplotlib.lines import Line2D
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    dpi = int(finite(dpi, "Map DPI", minimum=120))
    if dpi > 600 or not panels or len(panels) > 3:
        raise ValueError("Select one to three map panels and 120–600 DPI")
    if path is None and pdf_pages is None:
        raise ValueError("Select a standalone map path or an open atlas document")
    count = len(panels)
    dimensions = (11.7 * max(1, count / 2), 8.3)
    if paper is not None:
        from .map_atlas import PAPER
        if paper not in PAPER:
            raise ValueError("Choose Letter, A4 or A3 landscape paper")
        dimensions = PAPER[paper]
    fig, axes = plt.subplots(1, count, figsize=dimensions, squeeze=False)
    try:
        legend = []
        for overlay in overlays:
            legend.append(Line2D([0], [0], color=overlay.get("color", "#202020"),
                                 linewidth=overlay.get("width", .6), linestyle=overlay.get("style", "-"),
                                 label=overlay["label"]))
        for ax, panel in zip(axes[0], panels):
            with rasterio.open(panel["path"]) as src:
                factor = max(src.width / 1800, src.height / 1800, 1)
                height, width = max(1, round(src.height / factor)), max(1, round(src.width / factor))
                values = src.read(1, out_shape=(height, width), masked=True, resampling=Resampling.nearest)
                values = np.ma.masked_invalid(values)
                bounds = (src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top)
                finite_values = values.compressed()
                if not finite_values.size:
                    raise ValueError("Map raster contains no valid pixels: " + str(panel["path"]))
                signed = bool(panel.get("signed"))
                scale = panel.get("scale")
                if scale is not None:
                    low = finite(scale["minimum"], "Map scale minimum")
                    high = finite(scale["maximum"], "Map scale maximum", positive=True)
                    if bool(scale["signed"]) != signed or low >= high:
                        raise ValueError("The selected map range differs from its panel semantics")
                    if scale.get("units") and scale["units"] != panel["units"]:
                        raise ValueError("Comparable map panels must use the same physical units")
                    if signed and not low < 0 < high or not signed and low != 0:
                        raise ValueError("Signed maps center on zero; export maps start at zero")
                    scale_note = scale["label"]
                elif signed:
                    changed = np.abs(finite_values[finite_values != 0])
                    high = float(np.quantile(changed, .98)) if changed.size else 1.0
                    low = -high
                    scale_note = "Display uses the 98th percentile of nonzero preview magnitudes."
                else:
                    positive = finite_values[finite_values > 0]
                    high = float(np.quantile(positive, .98)) if positive.size else 1.0
                    low = 0.0
                    scale_note = "Display uses the 98th percentile of positive preview values."
                if signed:
                    norm = TwoSlopeNorm(vmin=low, vcenter=0, vmax=high)
                    palette = "RdBu_r"
                else:
                    norm = Normalize(vmin=low, vmax=high)
                    palette = "Greys"
                artist = ax.imshow(values, extent=(bounds[0], bounds[2], bounds[1], bounds[3]),
                                   origin="upper", cmap=palette, norm=norm, interpolation="nearest")
                for row in boundary:
                    _geometry(ax, row["geometry"], width=.8)
                for overlay in overlays:
                    for row in overlay["features"]:
                        _geometry(ax, row["geometry"], color=overlay.get("color", "#202020"),
                                  width=overlay.get("width", .6), style=overlay.get("style", "-"), alpha=.9)
                ax.set_xlim(bounds[0], bounds[2])
                ax.set_ylim(bounds[1], bounds[3])
                ax.set_aspect("equal")
                ax.set_title(panel["label"], fontsize=10, loc="left", pad=8)
                ax.set_xlabel("Easting (m)", fontsize=7)
                ax.set_ylabel("Northing (m)", fontsize=7)
                ax.tick_params(labelsize=6)
                _north_and_scale(ax, bounds, crs)
                colorbar = fig.colorbar(artist, ax=ax, fraction=.036, pad=.026,
                                       extend="both" if signed else "max")
                colorbar.set_label(panel["units"], fontsize=7)
                colorbar.ax.tick_params(labelsize=6)
                ax.text(.01, -.13, "\n".join(textwrap.wrap(
                    scale_note + " Numerical GeoTIFF values are preserved.", 105)),
                    transform=ax.transAxes, fontsize=6, va="top")
        if project_title:
            fig.text(.07, .976, textwrap.shorten(str(project_title), 145, placeholder="…"),
                     fontsize=8, va="top", color="#444444")
        fig.suptitle(title, fontsize=14 if project_title else 15, x=.07,
                     y=.945 if project_title else .97, ha="left")
        fig.text(.07, .898 if project_title else .925,
                 "\n".join(textwrap.wrap(subtitle, 140)), fontsize=8, va="top")
        if legend:
            fig.legend(handles=legend, loc="lower center", bbox_to_anchor=(.5, .085),
                       fontsize=7, frameon=False, ncol=min(3, len(legend)))
        fig.text(.07, .04, "\n".join(textwrap.wrap(footer, 155)), fontsize=6, va="bottom")
        if page_number is not None:
            fig.text(.97, .018, str(page_number) + ((" / " + str(page_count)) if page_count else ""),
                     fontsize=7, ha="right", va="bottom")
        fig.subplots_adjust(left=.07, right=.93, bottom=.19,
                            top=.815 if project_title else .86, wspace=.30)
        if path is not None:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            fig.savefig(path, format="pdf", dpi=dpi, metadata={"Title": title, "Subject": subtitle,
                                               "Creator": "Scientific Workbench"})
        if pdf_pages is not None:
            pdf_pages.savefig(fig, dpi=dpi)
    finally:
        plt.close(fig)
    return {"path": str(path) if path is not None else None, "title": title,
            "panels": len(panels), "dpi": dpi, "paper": paper,
            "display_resampling": "nearest; full numerical GeoTIFFs remain unchanged"}

def report_pdf(path, title, sections, *, contact, source_records):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape
    styles = getSampleStyleSheet()
    styles["BodyText"].fontName = "Helvetica"
    styles["BodyText"].fontSize = 9
    styles["BodyText"].leading = 13
    story = [Paragraph(escape(title), styles["Title"]), Spacer(1, .15 * inch)]
    for heading, paragraphs in sections:
        story.append(Paragraph(escape(heading), styles["Heading2"]))
        for paragraph in paragraphs:
            story.append(Paragraph(escape(str(paragraph)).replace("\n", "<br/>"), styles["BodyText"]))
            story.append(Spacer(1, .08 * inch))
    story.append(Paragraph("Source editions", styles["Heading2"]))
    rows = [[Paragraph("<b>Source</b>", styles["BodyText"]),
             Paragraph("<b>Edition and original reference</b>", styles["BodyText"])]]
    for source in source_records:
        rows.append([Paragraph(escape(source["id"]), styles["BodyText"]),
                     Paragraph(escape(str(source["vintage"])) + "<br/>" + escape(source["uri"]),
                               styles["BodyText"])])
    table = Table(rows, colWidths=[1.4 * inch, 5.2 * inch], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("LINEBELOW", (0, 0), (-1, 0), .6, colors.black),
                               ("LINEBELOW", (0, 1), (-1, -1), .25, colors.HexColor("#cccccc")),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story.append(table)
    story.append(Spacer(1, .15 * inch))
    story.append(Paragraph("Prepared by " + escape(contact["name"]) + " · " +
                           escape(contact["organization"]) + " · " + escape(contact["email"]),
                           styles["BodyText"]))
    def page_number(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.drawString(.7 * inch, .42 * inch, "Scientific study · retained model and source editions")
        canvas.drawRightString(7.8 * inch, .42 * inch, str(document.page))
        canvas.restoreState()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    SimpleDocTemplate(str(path), pagesize=letter, rightMargin=.7 * inch, leftMargin=.7 * inch,
                      topMargin=.65 * inch, bottomMargin=.65 * inch,
                      title=title, author=contact["organization"]).build(story,
                          onFirstPage=page_number, onLaterPages=page_number)


# Saved-review printing reuses the native spatial sampler and the existing
# geometry drawing helper. Scientific map_pdf/report_pdf above retain their own
# original source/model semantics.
def spatial_review_layout(review, paper, dpi):
    """Fit the exact saved extent into a real landscape paper rectangle."""
    dimensions = {"letter": (11.0, 8.5), "a4": (297 / 25.4, 210 / 25.4)}
    if paper not in dimensions or isinstance(dpi, bool) or dpi not in (150, 220, 300):
        raise ValueError("Choose Letter or A4 and 150, 220 or 300 DPI")
    width, height = dimensions[paper]
    bounds = review["view"]["bounds"]
    aspect = (bounds[2] - bounds[0]) / (bounds[3] - bounds[1])
    keys = ["primary", "comparison"] if review["mode"] == "compare" else [
        "difference" if review["mode"] == "difference" else
        "swipe" if review["mode"] == "swipe" else "primary"]
    left, right, bottom, top, gap = .63, .32, 1.72, 1.05, .46
    cell_width = (width - left - right - gap * (len(keys) - 1)) / len(keys)
    cell_height = height - top - bottom
    panel_width = min(cell_width, cell_height * aspect)
    panel_height = panel_width / aspect
    if min(panel_width, panel_height) * dpi < 1:
        raise ValueError("The saved extent is too narrow to occupy one print pixel")
    panels = []
    for index, key in enumerate(keys):
        x = left + index * (cell_width + gap) + (cell_width - panel_width) / 2
        y = bottom + (cell_height - panel_height) / 2
        panels.append({"key": key, "axes": [x / width, y / height,
                                             panel_width / width, panel_height / height],
                       "inches": {"x": x, "y": y, "width": panel_width, "height": panel_height},
                       "pixels": {"width": max(1, math.ceil(panel_width * dpi)),
                                  "height": max(1, math.ceil(panel_height * dpi))}})
    return {"page": {"paper": paper, "orientation": "landscape",
                     "width_inches": width, "height_inches": height, "dpi": dpi},
            "panels": panels,
            "render_size": {"page": {"width": int(width * dpi), "height": int(height * dpi)},
                            "panels": [{"key": p["key"], **p["pixels"]} for p in panels]}}


def spatial_review_ground_scale(view):
    """A geodesic scale and true-north direction for any retained view CRS."""
    from pyproj import CRS, Geod, Transformer
    from pyproj.exceptions import ProjError
    bounds = view["bounds"]
    left, bottom, right, top = bounds
    width, height = right - left, top - bottom
    result = {"available": False, "method": "WGS84 ellipsoidal geodesic at the drawn scale bar",
              "view_crs": view["crs"], "north_available": False}
    try:
        source = CRS.from_user_input(view["crs"])
        geographic = CRS.from_epsg(4326)
        to_geo = Transformer.from_crs(source, geographic, always_xy=True)
        to_view = Transformer.from_crs(geographic, source, always_xy=True)
        geod = Geod(ellps="WGS84")
        x0, y0 = left + width * .065, bottom + height * .055
        lon0, lat0 = to_geo.transform(x0, y0, errcheck=True)
        def distance(x):
            lon, lat = to_geo.transform(x, y0, errcheck=True)
            value = geod.inv(lon0, lat0, lon, lat)[2]
            if not math.isfinite(value) or value < 0:
                raise ValueError("This view does not have a finite local ground scale")
            return value
        high = x0 + width * .20
        aim = distance(high)
        if aim <= 0:
            raise ValueError("This view does not have a positive local ground scale")
        magnitude = 10 ** math.floor(math.log10(aim))
        length = max(v * magnitude for v in (1, 2, 5, 10) if v * magnitude <= aim)
        lo, hi = x0, high
        # A short local bar is monotone for the supported finite viewport; record
        # its actual endpoints and measured distance, rather than CRS unit guesses.
        for _ in range(48):
            middle = (lo + hi) / 2
            if distance(middle) < length:
                lo = middle
            else:
                hi = middle
        end = (lo + hi) / 2
        actual = distance(end)
        if abs(actual - length) > max(.001, length * 1e-6):
            raise ValueError("This extent cannot support the selected local scale bar")
        result.update(available=True, anchor={"x": x0, "y": y0},
                      endpoint={"x": end, "y": y0}, length_metres=actual,
                      labelled_metres=length,
                      label=(format(length / 1000, "g") + " km") if length >= 1000
                      else (format(length, "g") + " m"),
                      geographic_anchor={"longitude": lon0, "latitude": lat0},
                      transformation={"description": to_geo.description,
                                      "accuracy_metres": to_geo.accuracy})
        nx, ny = left + width * .91, bottom + height * .80
        lon, lat = to_geo.transform(nx, ny, errcheck=True)
        north_lon, north_lat, _ = geod.fwd(lon, lat, 0, max(1, min(length * .05, 1000)))
        tx, ty = to_view.transform(north_lon, north_lat, errcheck=True)
        vector_length = math.hypot(tx - nx, ty - ny)
        if math.isfinite(vector_length) and vector_length > 0 and abs(lat) < 89.9999:
            multiplier = min(width, height) * .075 / vector_length
            result.update(north_available=True, north_origin={"x": nx, "y": ny},
                          north_tip={"x": nx + (tx - nx) * multiplier,
                                     "y": ny + (ty - ny) * multiplier})
    except (ValueError, OverflowError, ProjError) as error:
        result["reason"] = str(error)
    return result


def _review_scale_drawing(ax, scale, bounds):
    left, bottom, right, top = bounds
    height = top - bottom
    if scale.get("available"):
        start, end = scale["anchor"], scale["endpoint"]
        ax.plot([start["x"], end["x"]], [start["y"], end["y"]],
                color="white", linewidth=4, zorder=25)
        ax.plot([start["x"], end["x"]], [start["y"], end["y"]],
                color="#171717", linewidth=1.5, zorder=26)
        for x in (start["x"], end["x"]):
            ax.plot([x, x], [start["y"] - height * .006, start["y"] + height * .006],
                    color="#171717", linewidth=.75, zorder=26)
        ax.text((start["x"] + end["x"]) / 2, start["y"] + height * .015,
                scale["label"], ha="center", va="bottom", fontsize=7, zorder=27,
                bbox={"facecolor": "white", "edgecolor": "none", "alpha": .92, "pad": 1.5})
    else:
        ax.text(.02, .02, "Ground scale unavailable at this extent", transform=ax.transAxes,
                fontsize=6, color="#333333", zorder=27,
                bbox={"facecolor": "white", "edgecolor": "none", "alpha": .9})
    if scale.get("north_available"):
        start, end = scale["north_origin"], scale["north_tip"]
        ax.annotate("", xy=(end["x"], end["y"]), xytext=(start["x"], start["y"]),
                    arrowprops={"arrowstyle": "-|>", "color": "#171717", "linewidth": 1},
                    zorder=27)
        ax.text(end["x"], end["y"] + height * .012, "N", ha="center", va="bottom",
                fontsize=8, zorder=28,
                bbox={"facecolor": "white", "edgecolor": "none", "alpha": .92, "pad": 1})


def _review_excerpt(value, maximum):
    value = str(value)
    return value if len(value) <= maximum else value[:maximum - 1] + "\u2026"


def _review_plain_lines(value, width=108):
    """Wrap retained text without interpreting Markdown or discarding long IDs."""
    for line in str(value).splitlines() or [""]:
        yield from textwrap.wrap(line, width=width, replace_whitespace=False,
                                 drop_whitespace=False, break_long_words=True,
                                 break_on_hyphens=False) or [""]


def _review_category_key(fig, image, *, x, width, page_width, page_height, title):
    """Draw a source-bound discrete key in the saved map's legend space."""
    from matplotlib.patches import Rectangle
    categories = image.get("categories", [])
    columns = 2 if width >= 3.0 else 1
    shown = categories[:columns * 6]
    key = fig.add_axes([x / page_width, .84 / page_height,
                        max(.01, width - .13) / page_width, .75 / page_height])
    key.set_axis_off()
    font_size = 5.8
    label_chars = max(12, int((width / columns - .20) * 72 / (font_size * .55)))
    for index, item in enumerate(shown):
        column, row = index // 6, index % 6
        left, top = column / columns, 1 - row * .145
        key.add_patch(Rectangle((left, top - .075), .040 / columns, .065,
                                facecolor=item["colour"], edgecolor="#333333", linewidth=.3))
        label = str(item["value"]) + " " + item["label"]
        key.text(left + .056 / columns, top - .038, _review_excerpt(label, label_chars),
                 fontsize=font_size, va="center", ha="left", color="#222222")
    key.set_title(_review_excerpt(title + " / original classes", 90), fontsize=6.5, loc="left", pad=4)
    if not categories:
        key.text(0, .84, "No valid class samples in this view", fontsize=6)
    elif len(shown) < len(categories):
        key.text(0, .005, "Full " + str(len(categories)) + "-class key follows in the PDF.",
                 fontsize=5.5, va="bottom")


def render_spatial_review(directory, *, review, project, frame, layout, overlay_file,
                          overlays, annotation_file, descriptions, created_at, export_id):
    """Write paper-sized PDF/SVG/PNG from one actual native print frame."""
    import base64
    import datetime as dt
    import io
    import json
    import threading
    import matplotlib
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.figure import Figure
    from matplotlib.patches import Rectangle
    from PIL import Image
    import numpy as np
    from shapely.geometry import shape

    # Original queued operator serializes this action; standalone callers share
    # the same small graphics lock because Matplotlib rc_context is process-wide.
    lock = globals().setdefault("_SPATIAL_PRINT_LOCK", threading.RLock())
    directory = Path(directory)
    page, panels = layout["page"], layout["panels"]
    width, height, dpi = page["width_inches"], page["height_inches"], page["dpi"]
    view = frame["view"]
    left, bottom, right, top = view["bounds"]
    extent = [left, right, bottom, top]
    ground = spatial_review_ground_scale(view)
    images = frame["images"]
    short_crs = view["crs"] if len(view["crs"]) <= 100 else "Custom retained CRS; see provenance"
    created = dt.datetime.fromisoformat(created_at)
    if created.tzinfo is None:
        created = created.replace(tzinfo=dt.timezone.utc)
    summary_images = []
    displayed = {key for panel in panels for key in (
        ["primary", "comparison"] if panel["key"] == "swipe" else [panel["key"]])}
    for key in ("primary", "comparison", "difference"):
        image = images.get(key)
        if image is None or key not in displayed:
            continue
        summary_images.append({name: image[name] for name in (
            "title", "units", "scale", "statistics", "source_sha256", "source_sha256s",
            "direction", "sampling", "width", "height", "nodata_transparent",
            "categorical", "categories", "category_source") if name in image} | {"key": key})
    metadata = {"Title": review["title"], "Author": project["title"],
                "Subject": "Saved spatial review " + review["id"],
                "Keywords": "native spatial review, source-bound map, " + review["mode"],
                "Creator": "Upstate scientific Workspace saved-review renderer",
                "CreationDate": created, "ModDate": created}
    style = {"font.family": "DejaVu Sans", "font.size": 8, "text.usetex": False, "text.parse_math": False,
             "axes.edgecolor": "#555555", "axes.linewidth": .6,
             "axes.labelcolor": "#333333", "xtick.color": "#444444", "ytick.color": "#444444",
             "pdf.fonttype": 42, "pdf.use14corefonts": False, "pdf.inheritcolor": False,
             "svg.fonttype": "path", "svg.hashsalt": export_id, "svg.image_inline": True,
             "savefig.bbox": None, "savefig.transparent": False,
             "figure.autolayout": False, "figure.constrained_layout.use": False,
             "axes.grid": False,
             "savefig.facecolor": "white", "figure.facecolor": "white"}
    pdf_pages = 1
    with lock, matplotlib.rc_context(style):
        fig = Figure(figsize=(width, height), dpi=dpi)
        canvas = FigureCanvasAgg(fig)
        try:
            title = "\n".join(textwrap.wrap(review["title"], width=100)[:2])
            fig.text(.057, .968, title, ha="left", va="top", fontsize=12.5, weight="bold")
            fig.text(.057, .909, _review_excerpt(project["title"], 104) + "  /  " +
                     review["mode"].capitalize() + " view", fontsize=8, color="#444444")
            axes = []
            for panel in panels:
                ax = fig.add_axes(panel["axes"])
                axes.append(ax)
                ax.set_facecolor("#f7f7f7")
                ax.set_xlim(left, right)
                ax.set_ylim(bottom, top)
                ax.set_aspect("equal", adjustable="box")
                ax.tick_params(labelsize=6, pad=2)
                ax.ticklabel_format(axis="both", style="plain", useOffset=False)
                ax.set_xlabel(short_crs, fontsize=6.5, labelpad=3)
                key = panel["key"]
                wanted = ["primary", "comparison"] if key == "swipe" else [key]
                if key == "swipe":
                    heading = "Comparison on left: " + format(review.get("swipe", 50), "g") + "%"
                else:
                    image = images.get(key)
                    heading = image["title"] if image else (
                        "Geographic context" if key == "primary" else key.capitalize() + " layer")
                ax.set_title(_review_excerpt(heading, 78 if len(panels) == 1 else 47), fontsize=8, pad=6)
                for name in wanted:
                    image = images.get(name)
                    if image is None:
                        continue
                    with Image.open(io.BytesIO(base64.b64decode(image["png_base64"], validate=True))) as original:
                        original.load()
                        if original.size != (frame["size"]["width"], frame["size"]["height"]):
                            raise ValueError("The native print frame dimensions changed")
                        rgba = np.array(original.convert("RGBA"))
                    artist = ax.imshow(rgba, extent=extent, origin="upper", interpolation="nearest",
                                       aspect="equal", zorder=1 if name == "primary" else 2)
                    if key == "swipe" and name == "comparison":
                        divider = left + (right - left) * review.get("swipe", 50) / 100
                        artist.set_clip_path(Rectangle((left, bottom), divider - left, top - bottom,
                                                       transform=ax.transData))
                if key == "swipe" and 0 < review.get("swipe", 50) < 100:
                    divider = left + (right - left) * review.get("swipe", 50) / 100
                    ax.axvline(divider, color="white", linewidth=2.3, zorder=21)
                    ax.axvline(divider, color="#171717", linewidth=.65, zorder=22)
                if all(images.get(name) is None for name in wanted):
                    ax.text(.5, .97, "Original vector overlays", transform=ax.transAxes,
                            ha="center", va="top", fontsize=7, color="#666666")
            style_codes = {"solid": "-", "dash": "--", "dot": ":"}
            by_index = {item["index"]: item for item in overlays}
            with Path(overlay_file).open(encoding="utf-8") as source:
                for line in source:
                    row = json.loads(line)
                    overlay = by_index[row["overlay_index"]]
                    geometry = shape(row["feature"]["geometry"])
                    for ax in axes:
                        _geometry(ax, geometry, color="#202020",
                                  width=overlay["style"]["width_points"],
                                  style=style_codes[overlay["style"]["style"]],
                                  alpha=overlay["style"]["opacity"])
            visible_markers = 0
            for index, marker in enumerate(review.get("markers", []), 1):
                if not (left <= marker["x"] <= right and bottom <= marker["y"] <= top):
                    continue
                visible_markers += 1
                for ax in axes:
                    ax.scatter([marker["x"]], [marker["y"]], s=24, facecolors="white",
                               edgecolors="#111111", linewidths=.8, zorder=30)
                    ax.annotate(str(index), (marker["x"], marker["y"]), xytext=(4, 4),
                                textcoords="offset points", ha="left", va="bottom", fontsize=7,
                                weight="bold", color="#111111", zorder=31,
                                bbox={"facecolor": "white", "edgecolor": "none", "alpha": .9, "pad": 1})
            for ax in axes:
                _review_scale_drawing(ax, ground, view["bounds"])
            # Each actual image keeps its own physical scale, including two
            # different unit domains in a swipe. NoData remains transparent.
            for panel in panels:
                keys = ["primary", "comparison"] if panel["key"] == "swipe" else [panel["key"]]
                keys = [key for key in keys if images.get(key) is not None]
                if not keys:
                    continue
                cell = panel["inches"]
                legend_width = cell["width"] / len(keys)
                for number, key in enumerate(keys):
                    image = images[key]
                    x = cell["x"] + number * legend_width
                    if image.get("categorical"):
                        # Use the complete column width even for a narrow map extent.
                        group_width = (width - .95 - .46 * (len(panels) - 1)) / len(panels)
                        category_width = group_width / len(keys)
                        category_x = .63 + panels.index(panel) * (group_width + .46) + number * category_width
                        _review_category_key(fig, image, x=category_x, width=category_width,
                                             page_width=width, page_height=height,
                                             title=key.capitalize() if panel["key"] == "swipe" else "Land cover")
                        continue
                    bar = fig.add_axes([x / width, 1.125 / height,
                                        max(.01, legend_width - .13) / width, .07 / height])
                    low, high = image["scale"]["minimum"], image["scale"]["maximum"]
                    if low is not None and high is not None and high > low:
                        gradient = np.arange(28, 233, dtype="uint8")[None, :]
                        bar.imshow(np.repeat(gradient[:, :, None], 3, axis=2),
                                   extent=[0, 1, 0, 1], aspect="auto", interpolation="nearest")
                        bar.set_xticks([0, 1], labels=[format(low, ".8g"), format(high, ".8g")])
                    else:
                        bar.set_facecolor("#7f7f7f" if low is not None else "#f7f7f7")
                        bar.set_xticks([.5], labels=[
                            "constant " + format(low, ".8g") if low is not None else "No valid samples"])
                    bar.set_yticks([])
                    bar.tick_params(labelsize=6, length=2, pad=1)
                    label = (key.capitalize() + " / " if panel["key"] == "swipe" else "") + str(
                        image.get("units") or "units undeclared")
                    bar.set_title(_review_excerpt(label, 82 if len(panels) == 1 and len(keys) == 1 else 43),
                                  fontsize=6.5, pad=3)
            # Compact numbered keys on the figure; complete labels, selections,
            # scales and source identities follow in the PDF and provenance.
            visible_overlays = [item for item in overlays if item["visible"]]
            columns = 4
            for position, overlay in enumerate(visible_overlays):
                column, row = position % columns, position // columns
                x = .06 + column * .237
                y = (.73 - row * .092) / height
                line = fig.add_axes([x, y + .002, .020, .008])
                line.plot([0, 1], [.5, .5], style_codes[overlay["style"]["style"]],
                          color="#202020", linewidth=overlay["style"]["width_points"],
                          alpha=overlay["style"]["opacity"])
                line.set_axis_off()
                fig.text(x + .026, y, str(overlay["index"]) + " " + _review_excerpt(overlay["label"], 29),
                         fontsize=5.9, va="center", color="#333333")
            fig.text(.06, .030, "Review " + review["id"][:16] + "  /  " +
                     page["paper"].upper() + " landscape, " + str(dpi) + " DPI  /  " +
                     "Full overlay key, source identities and annotations follow in the PDF.",
                     fontsize=6, color="#555555")
            fig.text(.06, .014, "Transparent raster cells retain original NoData; valid zero remains a value.  "
                     "Nearest source sampling; exact native pixels are in annotations.json.",
                     fontsize=5.8, color="#555555")
            actual_size = {"width": canvas.get_width_height()[0], "height": canvas.get_width_height()[1]}
            fig.savefig(directory / "map.png", dpi=dpi, format="png", bbox_inches=None,
                        metadata={"Title": review["title"], "Software": metadata["Creator"],
                                  "Description": "Saved review " + review["id"] + "; export " + export_id,
                                  "Creation Time": created_at})
            fig.savefig(directory / "map.svg", dpi=dpi, format="svg", bbox_inches=None,
                        metadata={"Title": review["title"], "Creator": metadata["Creator"],
                                  "Description": "Saved review " + review["id"] + "; export " + export_id,
                                  "Date": created_at})
            with Image.open(directory / "map.png") as written:
                if written.size != (actual_size["width"], actual_size["height"]):
                    raise ValueError("Printed PNG differs from its declared paper dimensions")
                png_dpi = written.info.get("dpi")
            with PdfPages(directory / "map.pdf", metadata=metadata) as document:
                document.savefig(fig, dpi=dpi, bbox_inches=None)
                page_number = 1
                appendix = None
                cursor = 0
                def new_page():
                    nonlocal appendix, cursor, page_number, pdf_pages
                    if appendix is not None:
                        document.savefig(appendix, dpi=dpi, bbox_inches=None)
                        appendix.clear()
                    page_number += 1
                    pdf_pages += 1
                    appendix = Figure(figsize=(width, height), dpi=dpi)
                    FigureCanvasAgg(appendix)
                    appendix.text(.06, .955, _review_excerpt(review["title"], 110),
                                  fontsize=11, weight="bold", va="top")
                    appendix.text(.06, .03, "Saved review " + review["id"] +
                                  "  /  page " + str(page_number), fontsize=6, color="#555555")
                    cursor = height - .8
                def line(value, *, heading=False, indent=0):
                    nonlocal cursor
                    step = .19 if heading else .145
                    if appendix is None or cursor - step < .50:
                        new_page()
                    appendix.text(.06 + indent * .016, cursor / height, value,
                                  fontsize=9 if heading else 7.5,
                                  weight="bold" if heading else "normal", va="top",
                                  family="DejaVu Sans Mono" if indent else "DejaVu Sans")
                    cursor -= step
                def paragraph(value, *, heading=False):
                    for text in _review_plain_lines(value, 112 if not heading else 100):
                        line(text, heading=heading)
                    line("")
                paragraph("Retained view and print selection", heading=True)
                for label, value in (("Project", project["title"]), ("Project ID", project["id"]),
                                     ("Review ID", review["id"]), ("Export ID", export_id),
                                     ("View mode", review["mode"]), ("Created", created_at),
                                     ("Coordinate reference system", view["crs"]),
                                     ("Saved bounds", json.dumps(view["bounds"])),
                                     ("Paper / DPI", json.dumps(page, sort_keys=True))):
                    paragraph(label + ": " + str(value))
                if review["mode"] == "swipe":
                    paragraph("Swipe: comparison covers the left " + format(review.get("swipe", 50), "g") +
                              "%; primary is the full underlay. Comparison NoData is transparent.")
                paragraph("Raster values and legends", heading=True)
                if not summary_images:
                    paragraph("This review contains geographic context and vector overlays.")
                for image in summary_images:
                    paragraph(image["key"].capitalize() + ": " + image["title"], heading=True)
                    paragraph("Units: " + str(image["units"]) + "; scale: " + json.dumps(image["scale"], sort_keys=True))
                    paragraph("Actual print sample statistics: " + json.dumps(image["statistics"], sort_keys=True))
                    if image.get("categorical"):
                        paragraph("Class swatches identify original codes; grey shade has no quantitative meaning.")
                        for category in image.get("categories", []):
                            paragraph(str(category["value"]) + " | " + category["label"] +
                                      " | swatch " + category["colour"])
                        paragraph("Original class tables: " + json.dumps(image.get("category_source", {}),
                                                                         ensure_ascii=False, sort_keys=True))
                    paragraph("Source SHA256: " + str(image["source_sha256"]) +
                              ("; paired sources: " + json.dumps(image["source_sha256s"], sort_keys=True)
                               if image.get("source_sha256s") else ""))
                    if image.get("direction"):
                        paragraph("Direction: " + image["direction"])
                paragraph("Visible print samples describe this extent and resolution. They are not whole-raster "
                          "statistics. Pixel annotations read the original raster, its scale/offset and mask; "
                          "their original values and numeric text are retained in the annotation files.")
                paragraph("Complete overlay key", heading=True)
                for overlay in overlays:
                    paragraph(str(overlay["index"]) + ". " + overlay["label"] +
                              (" [visible]" if overlay["visible"] else " [saved hidden]"), heading=True)
                    paragraph("Selection: " + json.dumps(overlay["selection"], ensure_ascii=False, sort_keys=True))
                    paragraph("Source SHA256: " + overlay["source_sha256"] + "; returned viewport features: " +
                              str(overlay["returned"]) + "; display tolerance: " + str(overlay["display_tolerance"]) +
                              " " + view["crs"] + " units")
                    paragraph("Drawing: " + json.dumps(overlay["style"], sort_keys=True) +
                              ". Full original properties and display geometries: overlay-features.jsonl.")
                paragraph("Ground scale and north", heading=True)
                paragraph(json.dumps(ground, ensure_ascii=False, sort_keys=True))
                paragraph("Source bindings and original native metadata", heading=True)
                for description in descriptions:
                    source = description["layer"]
                    paragraph(source.get("title", "Original source"), heading=True)
                    paragraph("Selection: " + json.dumps(description["selection"], ensure_ascii=False, sort_keys=True))
                    for field in ("sha256", "role", "source_uri", "vintage", "run_id", "grid_id",
                                  "profile_id", "scenario_id", "baseline_run_id", "alternative_run_id", "direction"):
                        if field in source:
                            paragraph(field.replace("_", " ") + ": " + str(source[field]))
                    native = description["native"]
                    for field in ("kind", "crs", "units", "band", "width", "height", "transform",
                                  "nodata_text", "scales", "offsets", "selected_layer",
                                  "reader", "source_object_id_field", "decoded_sha256"):
                        if field in native:
                            paragraph(field.replace("_", " ") + ": " +
                                      json.dumps(native[field], ensure_ascii=False, sort_keys=True))
                paragraph("Review notes", heading=True)
                if review.get("atlas_review"):
                    from .atlas_reviews import context_text
                    paragraph(context_text(review["atlas_review"]))
                paragraph(review.get("notes", "") or "No saved notes.")
                paragraph("Point annotations", heading=True)
                with Path(annotation_file).open(encoding="utf-8") as source:
                    annotations = json.load(source)
                for marker in annotations["markers"]:
                    paragraph(str(marker["index"]) + ". " + (marker["label"] or "Unlabelled point"), heading=True)
                    result = marker["inspection"]
                    paragraph("Coordinate: " + json.dumps(result["point"], ensure_ascii=False, sort_keys=True))
                    for key in ("primary", "comparison"):
                        pixel = result.get(key)
                        if pixel is None:
                            continue
                        paragraph(key.capitalize() + ": " + str(pixel["value_text"]) + " " + str(pixel["units"]) +
                                  "; valid=" + str(pixel["valid"]) + "; row=" + str(pixel["row"]) +
                                  "; column=" + str(pixel["column"]) +
                                  ("; " + str(pixel["reason"]) if pixel.get("reason") else ""))
                        paragraph("Original numeric text: " + str(pixel["raw_value_text"]) +
                                  "; source SHA256 " + pixel["source_sha256"])
                    if result.get("difference"):
                        paragraph("Right source minus left source: " + result["difference"]["value_text"] +
                                  " " + str(result["difference"]["units"]))
                    for group in result["features"]:
                        paragraph("Features: " + group["layer"]["title"] + "; IDs " +
                                  ", ".join(feature["id"] for feature in group["features"]) +
                                  ("; additional matches exist beyond the original 50-feature point limit"
                                   if group["truncated"] else ""))
                    paragraph("Exact attributes, original geometry references and native numeric text remain "
                              "in annotations.json, annotations.csv and annotation-geometries.jsonl.")
                paragraph("Receiving and reuse", heading=True)
                paragraph("Open index.html for this map pack. PACK.json declares the exact artifact bytes. "
                          "Reopen the original saved review in the included scientific Workspace to pan, "
                          "inspect source pixels and create a new review. A complete Workspace backup retains "
                          "the original sources, model selections, map pack and application.")
                if appendix is not None:
                    document.savefig(appendix, dpi=dpi, bbox_inches=None)
                    appendix.clear()
            return {"view": view, "mode": review["mode"], "swipe": review.get("swipe", 50),
                    "page": page, "render_size": {**layout["render_size"], "page": actual_size},
                    "png_dpi": list(png_dpi) if png_dpi else None,
                    "panels": summary_images, "overlays": overlays,
                    "marker_count": len(review.get("markers", [])),
                    "visible_marker_count": visible_markers, "ground_scale": ground,
                    "pdf_pages": pdf_pages,
                    "sampling": "native nearest-neighbour print sampling at the exact saved extent",
                    "swipe_convention": "primary underlay; comparison covers the left retained percentage",
                    "grayscale": {"minimum": 28, "maximum": 232, "constant": 127,
                                  "nodata": "transparent",
                                  "categorical": "Discrete per-panel codes and colours are retained in panels.categories"},
                    "overlay_geometry": "original viewport query, clipped and simplified for the actual print pixel size"}
        finally:
            fig.clear()
