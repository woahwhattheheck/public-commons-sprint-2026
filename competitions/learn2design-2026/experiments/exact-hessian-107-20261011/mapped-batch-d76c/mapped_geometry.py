"""Coordinate-only composition of the retained ROOT110 map and batch portfolio.

The Objective differentiates its installed mapping. This module performs no
simulation, loss evaluation, gradient rescaling or private Objective access.
"""
from __future__ import annotations

import hashlib
import numpy as np

import l2d_coordmap
from elite_archive import FeasibleEliteArchive


class PhysicalEliteArchive(FeasibleEliteArchive):
    """Retain the original archive, with diversity in actual physical unit space."""

    def __init__(self, scale, bias, *, mapped, capacity=16, min_rms=0.04):
        super().__init__(capacity=capacity, min_rms=min_rms)
        self.scale = np.asarray(scale, dtype=np.float64)
        self.bias = np.asarray(bias, dtype=np.float64)
        self.mapped = bool(mapped)

    def unit(self, point):
        if not self.mapped:
            return super().unit(point)
        preactivation = np.asarray(point, dtype=np.float64) * self.scale + self.bias
        return super().unit(preactivation)


def prepare_geometry(obj, canonical_points, *, mode, coord_clip):
    """Install before warmup; preserve the initial physical designs exactly in real arithmetic.

    The input is the original portfolio's default-sigmoid coordinate population,
    after its original random/donor draws and canonical clipping. The public
    ROOT110 mapping is sigmoid(scale * point + bias), so point=(old-bias)/scale.
    Fresh subsequent Objective samples use its installed inverse automatically.
    """
    if mode not in ("identity", l2d_coordmap.MODE):
        raise ValueError("coordinate_map must be identity or l2d_property_v1")
    points = np.asarray(canonical_points)
    if points.ndim != 2 or points.shape[1] != int(obj.n_params):
        raise ValueError("Initial coordinate population differs from Objective dimension")
    if points.dtype.kind != "f" or not np.isfinite(points).all():
        raise ValueError("Initial coordinates must be finite floating point values")
    scale = np.ones(points.shape[1], dtype=np.float64)
    bias = np.zeros(points.shape[1], dtype=np.float64)
    diagnostics = {"requested": mode, "status": "identity", "reason": None}
    if mode != "identity":
        diagnostics = l2d_coordmap.install(obj)
        if diagnostics["status"] == "abort":
            raise ValueError("Native coordinate-map installation and identity restore failed")
        if diagnostics["status"] == "mapped":
            scale = np.asarray(diagnostics.pop("s_vec"), dtype=np.float64)
            bias = np.asarray(diagnostics.pop("b_vec"), dtype=np.float64)
    mapped = diagnostics["status"] == "mapped"
    lower, upper = l2d_coordmap.clip_bounds(scale, bias, coord_clip)
    # Preserve the existing identity arm's exact vector bytes. The mapped arm
    # casts only after the affine conversion, just as native JAX consumes it.
    transformed = ((points.astype(np.float64) - bias) / scale).astype(points.dtype) if mapped else points.copy()
    restored = transformed.astype(np.float64) * scale + bias
    before_unit = FeasibleEliteArchive.unit(points.astype(np.float64))
    after_unit = FeasibleEliteArchive.unit(restored)
    error = float(np.max(np.abs(before_unit - after_unit)))
    if not np.isfinite(transformed).all() or error > 2e-6:
        raise ValueError("Mapped initialization did not preserve original physical unit values")
    diagnostics.update({
        "initial_unit_max_abs_error": error,
        "initial_canonical_sha256": hashlib.sha256(points.tobytes(order="C")).hexdigest(),
        "initial_coordinate_sha256": hashlib.sha256(transformed.tobytes(order="C")).hexdigest(),
        "initial_shape": list(points.shape), "initial_dtype": str(points.dtype),
        "scale": scale.tolist(), "bias": bias.tolist(),
        "clip_lower": lower.tolist(), "clip_upper": upper.tolist(),
        "archive_distance": "physical unit-space RMS",
        "gradient": "original Objective autodiff through installed unit mapping",
    })
    return transformed, lower, upper, scale, bias, diagnostics
