"""Readable, lossless column panels for scientific PDF tables.

Wide source tables keep their original row and column order. A displayed row
number reconnects the same original record across adjacent column panels. The
source cells are rendered through the caller's existing formatter, including
its exact values and links. Layout never truncates or aggregates observations.
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
import math
import re
from typing import Any

LAYOUT_EDITION = "scientific-table-panels-20261013-v1"
_NUMBER = re.compile(r"^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?%?$")
MAX_PANEL_COLUMNS = 5
ROWS_PER_PANEL_GROUP = 8


def _widths(paragraphs: list[list[Any]], style: Any) -> tuple[list[float], list[float]]:
    """Measure existing displayed strings, not reformatted source values."""
    from reportlab.pdfbase.pdfmetrics import stringWidth

    minimum, preferred = [], []
    for column in zip(*paragraphs):
        text = [cell.getPlainText() for cell in column]
        values = [value for value in text[1:] if value.strip()]
        numeric = bool(values) and all(_NUMBER.fullmatch(value.strip()) for value in values)
        words = [word for value in text for word in value.split()]
        widest_word = max((stringWidth(word, style.fontName, style.fontSize)
                           for word in words), default=0.0)
        # Long IDs remain complete and can wrap. Ordinary words and measurement
        # labels get enough room rather than shrinking the source font.
        floor = 46.0 if numeric else (52.0 if not values else 64.0)
        low = max(floor, min(120.0, widest_word + 12.0))
        samples = sorted(stringWidth(value, style.fontName, style.fontSize)
                         for value in text if value)
        typical = samples[min(len(samples) - 1, int(len(samples) * .75))] if samples else 0.0
        high = max(low, min(170.0, typical + 12.0))
        minimum.append(low)
        preferred.append(high)
    return minimum, preferred


def _allocate(minimum: Sequence[float], preferred: Sequence[float], width: float) -> list[float]:
    base = sum(minimum)
    if base > width + .01:
        raise ValueError("Scientific table panel is narrower than its readable columns")
    room = max(0.0, width - base)
    demand = [max(0.0, want - low) for low, want in zip(minimum, preferred)]
    total = sum(demand)
    if total > 0:
        result = [low + room * extra / total for low, extra in zip(minimum, demand)]
    else:
        result = [low + room / len(minimum) for low in minimum]
    # Keep the complete row exactly within the renderer's available frame.
    result[-1] += width - sum(result)
    return result


def pdf_table_flowables(
    block: dict[str, Any],
    *,
    width: float,
    paragraph: Callable[..., Any],
    cell_style: Any,
) -> list[Any]:
    """Render ordinary tables unchanged, and wide tables as indexed panels.

    ``paragraph`` is the scientific renderer's own cell formatter. Each source
    nonshared cell enters one panel exactly once. Identical displayed fields
    are labelled once for all original rows. Repeated headers and generated
    positional row numbers provide navigation, not additional source records.
    """
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

    columns = block.get("columns")
    rows = block.get("rows")
    if not isinstance(columns, (list, tuple)) or not columns:
        raise ValueError("Scientific tables require their original column labels")
    if not isinstance(rows, (list, tuple)) or any(
        not isinstance(row, (list, tuple)) or len(row) != len(columns) for row in rows
    ):
        raise ValueError("Scientific table rows must match their original column labels")
    if not isinstance(width, (int, float)) or not math.isfinite(width) or width < 120:
        raise ValueError("Scientific tables require a finite readable frame width")
    weights = block.get("widths")
    if weights is not None and (
        not isinstance(weights, (list, tuple)) or len(weights) != len(columns)
        or any(type(value) not in (int, float) or not math.isfinite(value) or value <= 0
               for value in weights)
    ):
        raise ValueError("Scientific table width weights must be positive and match its columns")

    cells = [[paragraph(value, cell_style) for value in columns]]
    cells.extend([paragraph(value, cell_style) for value in row] for row in rows)
    minimum, preferred = _widths(cells, cell_style)

    def table(data: list[list[Any]], widths: list[float], *, indexed: bool = False) -> Any:
        view = Table(data, colWidths=widths, repeatRows=1,
                     splitByRow=1, splitInRow=1, hAlign="LEFT")
        commands = [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
            ("LINEBELOW", (0, 0), (-1, 0), .6, colors.black),
            ("LINEBELOW", (0, 1), (-1, -1), .25, colors.HexColor("#cccccc")),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
        if indexed:
            commands.extend([
                ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#f5f5f5")),
                ("LINEAFTER", (0, 0), (0, -1), .25, colors.HexColor("#cccccc")),
            ])
        view.setStyle(TableStyle(commands))
        return view

    selected = list(weights) if weights is not None else [1.0] * len(columns)
    original_widths = [width * value / sum(selected) for value in selected]
    ordinary = (len(columns) <= 6 and sum(minimum) <= width
                and min(original_widths) >= 32.0)
    if ordinary:
        # Respect declared producer proportions when already readable. Otherwise
        # redistribute within the same table without changing its source rows.
        final = original_widths if all(a >= b for a, b in zip(original_widths, minimum)) else _allocate(
            minimum, preferred, width)
        return [table(cells, final)]

    note_style = ParagraphStyle("ScientificTablePanelNote", parent=cell_style,
                                fontSize=8, leading=11, spaceAfter=5)
    heading_style = ParagraphStyle("ScientificTablePanelHeading", parent=cell_style,
                                   fontSize=8, leading=11, spaceBefore=7,
                                   spaceAfter=4, keepWithNext=True)
    result = []
    shared = [index for index in range(len(columns)) if len(rows) > 1
              and all(row[index].text == cells[1][index].text for row in cells[2:])]
    if shared:
        result.append(Paragraph(f"Shared fields for all {len(rows)} original rows", heading_style))
        common = [[paragraph("Original field", cell_style), paragraph("Shared displayed value", cell_style)]]
        common.extend([cells[0][index], cells[1][index] if cells[1][index].getPlainText().strip()
                       else paragraph("All source cells blank", cell_style)] for index in shared)
        result.extend([table(common, [width * .30, width * .70]), Spacer(1, 7)])
    selected_columns = [index for index in range(len(columns)) if index not in shared]
    if not selected_columns:
        result.append(Paragraph(
            f"All {len(rows)} original rows have the displayed fields above. "
            "The complete original rows remain in the report data and source records.", note_style))
        return result
    result.append(Paragraph(
        "The Row number is the position in this original table. Where columns "
        "continue in another panel, the same number reconnects one record. "
        "Shared fields above apply to every row; other fields retain their original order.", note_style))
    index_width = max(34.0, 14.0 + len(str(max(1, len(rows)))) * float(cell_style.fontSize) * .6)
    content_width = width - index_width
    panels, start = [], 0
    while start < len(selected_columns):
        end, used = start, 0.0
        while end < len(selected_columns) and end - start < MAX_PANEL_COLUMNS:
            candidate = minimum[selected_columns[end]]
            if end > start and used + candidate > content_width:
                break
            if candidate > content_width:
                raise ValueError("Scientific table frame cannot fit one source column")
            used += candidate
            end += 1
        indices = selected_columns[start:end]
        panels.append((indices, _allocate([minimum[i] for i in indices],
                                          [preferred[i] for i in indices], content_width)))
        start = end
    ranges = ([(0, len(rows))] if len(panels) == 1 else
              [(start, min(start + ROWS_PER_PANEL_GROUP, len(rows)))
               for start in range(0, len(rows), ROWS_PER_PANEL_GROUP)]) or [(0, 0)]
    for first_row, last_row in ranges:
        for indices, allocated in panels:
            row_label = (f"Rows {first_row + 1}-{last_row} of {len(rows)}"
                         if rows else "No source rows")
            field_numbers = ", ".join(str(index + 1) for index in indices)
            label = f"{row_label} | Original columns {field_numbers} of {len(columns)}"
            result.append(Paragraph(label, heading_style))
            data = [[paragraph("Row", cell_style)] + [cells[0][i] for i in indices]]
            data.extend([[paragraph(str(index + 1), cell_style)] + [cells[index + 1][i] for i in indices]
                         for index in range(first_row, last_row)])
            result.append(table(data, [index_width] + allocated, indexed=True))
            result.append(Spacer(1, 5))
    return result
