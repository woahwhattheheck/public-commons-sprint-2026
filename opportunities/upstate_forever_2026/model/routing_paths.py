"""Explain a retained native D8/MFD routing graph from one selected raster cell.

No terrain conditioning, stream extraction, native simulation or solute transport
is performed here. Each positive native MFD nibble is retained. A unit routed
share is propagated through the complete reachable acyclic graph to first
stream cells (by default), missing support, missing direction or raster edges.

Encoding source: natcap/pygeoprocessing 2.4.11,
src/pygeoprocessing/routing/routing.pyx,
Git blob 4f12528f2a8864cf021fe2f4237fc49a0f3d5753.
"""
from __future__ import annotations

from collections import deque
from collections.abc import Mapping
import heapq
import math
import operator

SCHEMA = "upstate.native-routing-paths/v1"
ENCODING_SOURCE = {
    "repository": "https://github.com/natcap/pygeoprocessing",
    "ref": "2.4.11",
    "path": "src/pygeoprocessing/routing/routing.pyx",
    "git_blob": "4f12528f2a8864cf021fe2f4237fc49a0f3d5753",
}
# Native direction order: E, NE, N, NW, W, SW, S, SE.
OFFSETS = ((0, 1), (-1, 1), (-1, 0), (-1, -1),
           (0, -1), (1, -1), (1, 0), (1, 1))
DIRECTIONS = ("E", "NE", "N", "NW", "W", "SW", "S", "SE")
TERMINAL_KINDS = ("stream", "outside_extent", "terrain_nodata",
                  "stream_unknown", "direction_missing")


class RoutingPathError(ValueError):
    """An input or reachable native graph cannot be interpreted as declared."""


class RoutingCycleError(RoutingPathError):
    """A reachable directed cycle prevents acyclic native path accounting."""

    def __init__(self, cells):
        self.cells = [[row, col] for row, col in cells]
        super().__init__(
            "The retained native routing graph contains a directed cycle: " +
            " -> ".join(f"({row}, {col})" for row, col in cells) +
            ". Preserve the original raster and investigate this selected run.")


def _integer(value, label):
    if isinstance(value, bool):
        raise RoutingPathError(label + " must be an integer, not a boolean")
    try:
        return operator.index(value)
    except TypeError as exc:
        raise RoutingPathError(label + " must be an exact integer") from exc


def _number(value, label):
    if isinstance(value, bool):
        raise RoutingPathError(label + " must be numeric, not a boolean")
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise RoutingPathError(label + " must be finite numeric data") from exc
    if not math.isfinite(result):
        raise RoutingPathError(label + " must be finite numeric data")
    return result


def decode_direction(value, algorithm):
    """Return (direction index, original integer weight, normalized share).

    D8 nodata128/None and MFD nodata0/None return an empty tuple. D8 direction0
    is valid east. Signed Int32 MFD values retain all high bits. Normalization
    uses all eight original weights, including routes out of the raster.
    """
    if algorithm not in ("d8", "mfd"):
        raise RoutingPathError("Select the original native algorithm: d8 or mfd")
    if value is None:
        return ()
    raw = _integer(value, "Native flow direction")
    if algorithm == "d8":
        if raw == 128:
            return ()
        if not 0 <= raw <= 7:
            raise RoutingPathError("Native D8 direction must be 0–7 or nodata128")
        return ((raw, 1, 1.0),)
    if not -(1 << 31) <= raw <= (1 << 32) - 1:
        raise RoutingPathError("Native MFD direction must retain one 32-bit word")
    bits = raw & 0xffffffff
    weights = tuple((bits >> (4 * index)) & 15 for index in range(8))
    total = sum(weights)
    return tuple((index, weight, weight / total)
                 for index, weight in enumerate(weights) if weight) if total else ()


def _cycle(nodes):
    """Find one real cycle without recursion or reporting downstream dependants."""
    colour, parents = {}, {}
    for origin in sorted(nodes):
        if colour.get(origin):
            continue
        colour[origin] = 1
        stack = [(origin, iter(edge["target"] for edge in nodes[origin]["edges"]))]
        while stack:
            cell, targets = stack[-1]
            try:
                target = next(targets)
            except StopIteration:
                colour[cell] = 2
                stack.pop()
                continue
            if colour.get(target, 0) == 0:
                parents[target] = cell
                colour[target] = 1
                stack.append((target, iter(edge["target"] for edge in nodes[target]["edges"])))
            elif colour[target] == 1:
                chain = [cell]
                while chain[-1] != target:
                    chain.append(parents[chain[-1]])
                return list(reversed(chain)) + [target]
    raise RoutingPathError("Reachable routing dependencies could not be ordered")


def trace_paths(read_cell, width, height, algorithm, origin, affine,
                *, stop_at_stream=True):
    """Trace the complete reachable original routing graph.

    read_cell(row, col) is called exactly once per reachable in-extent cell and
    must return {direction: int|None, terrain_valid: bool, stream: bool|None,
    elevation: finite number|None}. The caller handles actual raster masks,
    nodata and exact co-registration before calling. A missing stream value
    stops that branch when stop_at_stream=True; it never means non-stream.

    origin is (row, col), zero-based. affine is exactly (a,b,c,d,e,f), mapping
    column/row to x=a*col+b*row+c, y=d*col+e*row+f. Distances use these native
    coordinate units, not assumed metres; the caller retains actual CRS units.
    Elevations likewise retain their original units. Pixel-centre edge lengths
    are graph lengths, not hydraulic travel distances or times.

    Terminal nodes outside_extent/terrain_nodata retain the actual next-cell
    coordinate and the edge leading there. They do not assert a river outlet.
    First-stream routing stops upon arrival at each selected native stream.
    Setting stop_at_stream=False follows the retained direction through stream
    cells; even then a missing direction is not automatically a physical sink.

    Reachable cycles raise RoutingCycleError carrying one complete cycle.
    No branch probability threshold, maximum path length or cell cap is used.
    """
    if not callable(read_cell):
        raise RoutingPathError("Provide the original raster cell reader")
    width, height = _integer(width, "Raster width"), _integer(height, "Raster height")
    if width <= 0 or height <= 0:
        raise RoutingPathError("Raster dimensions must be positive")
    if algorithm not in ("d8", "mfd"):
        raise RoutingPathError("Select the original native algorithm: d8 or mfd")
    if type(stop_at_stream) is not bool:
        raise RoutingPathError("stop_at_stream must be an explicit boolean")
    if not isinstance(origin, (tuple, list)) or len(origin) != 2:
        raise RoutingPathError("Select one zero-based original row and column")
    origin = (_integer(origin[0], "Origin row"), _integer(origin[1], "Origin column"))
    if not (0 <= origin[0] < height and 0 <= origin[1] < width):
        raise RoutingPathError("The selected source point lies outside the native raster")
    if not isinstance(affine, (tuple, list)) or len(affine) != 6:
        raise RoutingPathError("Retain all six original affine coefficients")
    a, b, c, d, e, f = tuple(_number(v, "Affine coefficient") for v in affine)
    determinant = a * e - b * d
    if not math.isfinite(determinant) or determinant == 0:
        raise RoutingPathError("Native raster affine must be finite and invertible")
    lengths = tuple(math.hypot(a * dc + b * dr, d * dc + e * dr)
                    for dr, dc in OFFSETS)
    if any(not math.isfinite(v) or v <= 0 for v in lengths):
        raise RoutingPathError("Native raster neighbour lengths must be finite and positive")

    def centre(cell):
        row, col = cell
        xy = (a * (col + .5) + b * (row + .5) + c,
              d * (col + .5) + e * (row + .5) + f)
        if not all(math.isfinite(v) for v in xy):
            raise RoutingPathError("Selected route has nonfinite original coordinates")
        return xy

    nodes, queue = {}, deque([origin])
    queued = {origin}
    while queue:
        cell = queue.popleft()
        row, col = cell
        x, y = centre(cell)
        node = {"row": row, "column": col, "x": x, "y": y,
                "terrain_valid": False, "stream": None, "elevation": None,
                "direction": None, "terminal": None, "edges": []}
        nodes[cell] = node
        if not (0 <= row < height and 0 <= col < width):
            node["terminal"] = "outside_extent"
            continue
        original = read_cell(row, col)
        if not isinstance(original, Mapping):
            raise RoutingPathError(f"Original cell {cell} must supply mapped raster values")
        terrain = original.get("terrain_valid")
        stream = original.get("stream")
        if type(terrain) is not bool or (stream is not None and type(stream) is not bool):
            raise RoutingPathError(f"Original cell {cell} needs explicit terrain/stream masks")
        elevation = original.get("elevation")
        if elevation is not None:
            elevation = _number(elevation, f"Original elevation at {cell}")
        node.update(terrain_valid=terrain, stream=stream, elevation=elevation)
        if not terrain:
            node["terminal"] = "terrain_nodata"
            continue
        raw = original.get("direction")
        if raw is not None:
            raw = _integer(raw, f"Native direction at {cell}")
        node["direction"] = raw
        if stop_at_stream and stream is True:
            node["terminal"] = "stream"
            continue
        if stop_at_stream and stream is None:
            node["terminal"] = "stream_unknown"
            continue
        outgoing = decode_direction(raw, algorithm)
        if not outgoing:
            node["terminal"] = "direction_missing"
            continue
        for index, weight, share in outgoing:
            dr, dc = OFFSETS[index]
            target = (row + dr, col + dc)
            node["edges"].append({"target": target, "direction_index": index,
                                  "direction_name": DIRECTIONS[index],
                                  "native_weight": weight, "local_share": share,
                                  "length_native_units": lengths[index]})
            if target not in queued:
                queued.add(target)
                queue.append(target)

    if not nodes[origin]["terrain_valid"]:
        raise RoutingPathError("Select a source point on retained valid native terrain")
    indegree = dict.fromkeys(nodes, 0)
    for node in nodes.values():
        for edge in node["edges"]:
            indegree[edge["target"]] += 1
    ready = [cell for cell, count in indegree.items() if not count]
    heapq.heapify(ready)
    ordered = []
    while ready:
        cell = heapq.heappop(ready)
        ordered.append(cell)
        for edge in nodes[cell]["edges"]:
            target = edge["target"]
            indegree[target] -= 1
            if not indegree[target]:
                heapq.heappush(ready, target)
    if len(ordered) != len(nodes):
        raise RoutingCycleError(_cycle(nodes))

    incoming = {origin: [(1.0, 0.0)]}
    bounds = {origin: (0.0, 0.0)}
    cells, edges, terminals = [], [], []
    underflow_edges = 0
    for cell in ordered:
        node = nodes[cell]
        terms = incoming.pop(cell, [])
        share = math.fsum(pair[0] for pair in terms)
        weighted_length = math.fsum(pair[1] for pair in terms)
        shortest, longest = bounds[cell]
        if not all(math.isfinite(v) for v in (share, weighted_length, shortest, longest)):
            raise RoutingPathError("Route accounting exceeded finite numeric range")
        row = {k: v for k, v in node.items() if k != "edges"}
        row.update(routed_share=share,
                   mean_distance_native_units=weighted_length / share if share else None,
                   min_distance_native_units=shortest,
                   max_distance_native_units=longest)
        cells.append(row)
        if node["terminal"]:
            terminals.append(dict(row))
        for edge in node["edges"]:
            target = edge["target"]
            length, local = edge["length_native_units"], edge["local_share"]
            routed = share * local
            if share > 0 and routed == 0:
                underflow_edges += 1
            next_weighted = (weighted_length + share * length) * local
            incoming.setdefault(target, []).append((routed, next_weighted))
            low, high = shortest + length, longest + length
            if target in bounds:
                low, high = min(low, bounds[target][0]), max(high, bounds[target][1])
            bounds[target] = (low, high)
            downstream = nodes[target]
            drop = (node["elevation"] - downstream["elevation"]
                    if node["elevation"] is not None and downstream["elevation"] is not None
                    else None)
            edges.append({
                "from_row": node["row"], "from_column": node["column"],
                "to_row": downstream["row"], "to_column": downstream["column"],
                "from_x": node["x"], "from_y": node["y"],
                "to_x": downstream["x"], "to_y": downstream["y"],
                **{k: v for k, v in edge.items() if k != "target"},
                "routed_share": routed, "target_terminal": downstream["terminal"],
                "elevation_drop_native_units": drop})
    terminal_shares = {
        kind: math.fsum(row["routed_share"] for row in terminals if row["terminal"] == kind)
        for kind in TERMINAL_KINDS}
    terminal_total = math.fsum(terminal_shares.values())
    residual = 1.0 - terminal_total
    if abs(residual) > 1e-10:
        raise RoutingPathError(
            "Native route terminal accounting differs from the unit source share: " +
            format(residual, ".17g"))
    total_length = math.fsum(
        row["routed_share"] * row["mean_distance_native_units"]
        for row in terminals if row["mean_distance_native_units"] is not None)
    return {
        "schema": SCHEMA, "algorithm": algorithm, "encoding_source": dict(ENCODING_SOURCE),
        "origin": {"row": origin[0], "column": origin[1]},
        "width": width, "height": height, "affine": [a, b, c, d, e, f],
        "stop_at_stream": stop_at_stream,
        "interpretation": "A dimensionless unit routed share on the retained native direction graph",
        "distance_units": "original CRS coordinate units",
        "elevation_units": "original elevation raster units",
        "terminal_shares": terminal_shares, "terminal_total": terminal_total,
        "accounting_residual": residual,
        "mean_terminal_distance_native_units": total_length,
        "reachable_cells": len(cells), "edge_count": len(edges),
        "numerical_underflow_edges": underflow_edges,
        "cells": cells, "edges": edges, "terminals": terminals,
        "notes": [
            "Shares use original native integer weights; no branch pruning or renormalization at the raster edge.",
            "Rejoining branches are combined before propagating the following cell.",
            "First-stream arrival is the default boundary; it does not identify a utility intake or river mouth.",
            "Edge and nodata exits retain the next pixel-centre edge and do not assert a physical outlet.",
            "These are routing support fractions, not discharge, pollutant delivery ratios, concentrations or travel times.",
            "Distance follows pixel-centre graph edges in the original coordinate units.",
            "Binary64 arithmetic retains every graph edge; numerical underflow is reported when it occurs.",
        ],
    }
