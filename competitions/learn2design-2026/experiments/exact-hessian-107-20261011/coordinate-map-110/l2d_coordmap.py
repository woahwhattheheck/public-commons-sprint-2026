"""l2d_coordmap -- optional per-property logit coordinate map for UIFO (ROOT110-R hook).

Not executed, not measured. Pure coordinate transform for
Objective.set_space_mode(unbounded=True, unit_mapping=..., inverse_unit_mapping=...).
Problem, topology, frequencies, bounds, penalty, feasibility and loss are untouched;
the Objective applies its own per-index physical bounds to the returned unit values.

Provenance (embedded; nothing fetched at runtime):
  training JSON  outputs/paper-research-20261011/l2d-property-map-training-data-v1.json
                 sha256 47b6ec701a7f75ddaec04a3914420da4897793d1e31453b5cc3665bdf032d860
  audit result   sha256 9b8a43e89fea956f03d03eea3a06dec2f75dee83efa7179a0f094d7f6658da0f
  dataset blob   6da06060a27e9530f630c3a2fb40c90082dfd152 (L2D 1dc4d6e7d0ff656555f48bcf3c22a4d284779386)
  statistic      all size-3 rows, row-weighted q10/q90 ("all_size3_rows_q10_q50_q90")
API contract: L2D docs blob 45b313271a07d83cc63604bdb7b3d5998eb88f68; dfbench 0.3.3
  objective.py blob a2aba5f7b66f1bacfbcaac6835cb3c8d5ffd6d04 (set_space_mode installs a
  custom pair only when unit_mapping is not None; a bare call does NOT clear it).
"""
from __future__ import annotations

import hashlib
import math

import numpy as np
import jax
import jax.numpy as jnp

SCHEMA = "tjlabs.l2d.semantic-property-map-training.v1"
TRAINING_JSON_SHA256 = "47b6ec701a7f75ddaec04a3914420da4897793d1e31453b5cc3665bdf032d860"
SOURCE_RESULT_SHA256 = "9b8a43e89fea956f03d03eea3a06dec2f75dee83efa7179a0f094d7f6658da0f"
DATASET_GIT_BLOB_SHA1 = "6da06060a27e9530f630c3a2fb40c90082dfd152"
SOURCE_COMMIT = "1dc4d6e7d0ff656555f48bcf3c22a4d284779386"
MODE = "l2d_property_v1"
EPS = 1e-7
REQUIRED_SIZE = 3

# property: (lb, ub, q10, q90, s, b) -- copied verbatim from the training JSON
TABLE = {
    "reflectivity": (0.0, 1.0, 2.2269511693978085e-07, 0.9999949480223581,
                     13.756593846974145, -1.5608681198829286),
    "tuning": (-360.0, 360.0, -359.9986902456726, 359.9983512952118,
               13.102089643453628, -0.11507544514800738),
    "db": (0.0, 10.0, 0.0005055745309272063, 8.991121298516786,
           6.039873837529546, -3.8524757870910378),
    "angle": (-360.0, 360.0, 0.2541188151503316, 359.74325723702174,
              3.968581703712333, 3.969993475142096),
    "power": (0.0, 200.0, 0.0004916117166007306, 195.79013972006885,
              8.377875082924529, -4.5382611725122715),
    "mass": (0.01, 200.0, 0.14577608342049442, 199.99472071775438,
             8.918271255992211, 1.6239348400592823),
    "length": (0.1, 4000.0, 0.1009603923116551, 3999.998262210582,
               14.94567936345057, -0.29651373524110536),
}
PROPERTIES = ("reflectivity", "tuning", "db", "angle", "power", "mass", "length")


def _logit(u):
    return math.log(u) - math.log1p(-u)


def derive_sb(lb, ub, q10, q90, eps=EPS):
    vals = (lb, ub, q10, q90)
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in vals):
        raise ValueError("nonfinite_quantiles")
    if not ub > lb:
        raise ValueError("degenerate_bounds")
    u10 = min(max((q10 - lb) / (ub - lb), eps), 1.0 - eps)
    u90 = min(max((q90 - lb) / (ub - lb), eps), 1.0 - eps)
    l10, l90 = _logit(u10), _logit(u90)
    if not (l90 - l10) > 1e-9:
        raise ValueError("degenerate_quantiles")
    return 0.5 * (l90 - l10), 0.5 * (l90 + l10)


def validate_table(table=None, rtol=1e-9):
    """Re-derive (s,b) from embedded q10/q90 and compare with the embedded table."""
    table = TABLE if table is None else table
    if set(table) != set(PROPERTIES):
        return False, "table_property_set"
    for p in PROPERTIES:
        row = table[p]
        if len(row) != 6:
            return False, p + ":table_row"
        lb, ub, q10, q90, s, b = row
        try:
            s2, b2 = derive_sb(lb, ub, q10, q90)
        except ValueError as exc:
            return False, p + ":" + str(exc)
        if not (math.isfinite(s) and math.isfinite(b) and s > 0):
            return False, p + ":nonfinite_or_nonpositive_scale"
        if abs(s2 - s) > rtol * max(1.0, abs(s)) or abs(b2 - b) > rtol * max(1.0, abs(b)):
            return False, p + ":table_mismatch"
    return True, None


def _pair_prop(e):
    pn = getattr(e, "property_name", None)
    if isinstance(pn, str):
        return pn
    if isinstance(e, (tuple, list)) and len(e) == 2 and isinstance(e[1], str):
        return e[1]
    return None


def property_labels(pairs):
    """Per-index property labels from objective.optimization_pairs (runtime order authority).

    Ordinary entry: (component, property) or an object with .property_name.
    Tied entry: list/tuple of such pairs; all members must share one property.
    Returns (labels, None) or (None, reason).
    """
    labels = []
    for i, e in enumerate(pairs):
        p = _pair_prop(e)
        if p is None:
            if not isinstance(e, (tuple, list)):
                return None, "unparsable_entry@%d" % i
            if len(e) == 0:
                return None, "empty_tied_group@%d" % i
            props = {_pair_prop(m) for m in e}
            if None in props:
                return None, "unparsable_tied_member@%d" % i
            if len(props) != 1:
                return None, "mixed_tied_group@%d:%s" % (i, ",".join(sorted(props)))
            p = props.pop()
        labels.append(p)
    return labels, None


def _dt(a):
    return a.dtype if jnp.issubdtype(a.dtype, jnp.floating) else jnp.float32


def make_maps(s_vec, b_vec, eps=EPS):
    s0 = np.asarray(s_vec, np.float64)
    b0 = np.asarray(b_vec, np.float64)

    def unit_mapping(z):
        z = jnp.asarray(z)
        dt = _dt(z)
        z = z.astype(dt)
        return jax.nn.sigmoid(z * jnp.asarray(s0, dt) + jnp.asarray(b0, dt))

    def inverse_unit_mapping(u):
        u = jnp.asarray(u)
        dt = _dt(u)
        u = jnp.clip(u.astype(dt), eps, 1.0 - eps)
        return (jnp.log(u) - jnp.log1p(-u) - jnp.asarray(b0, dt)) / jnp.asarray(s0, dt)

    return unit_mapping, inverse_unit_mapping


def identity_maps(eps=EPS):
    """Explicit default-equivalent pair: sigmoid forward, eps-clipped logit inverse."""

    def unit_mapping(z):
        z = jnp.asarray(z)
        return jax.nn.sigmoid(z.astype(_dt(z)))

    def inverse_unit_mapping(u):
        u = jnp.asarray(u)
        u = jnp.clip(u.astype(_dt(u)), eps, 1.0 - eps)
        return jnp.log(u) - jnp.log1p(-u)

    return unit_mapping, inverse_unit_mapping


def clip_bounds(s_vec, b_vec, coord_clip):
    """Per-index z box whose preactivation s*z+b spans exactly [-coord_clip, coord_clip]."""
    s = np.asarray(s_vec, np.float64)
    b = np.asarray(b_vec, np.float64)
    c = float(coord_clip)
    if not (math.isfinite(c) and c > 0 and np.all(np.isfinite(s)) and np.all(s > 0)
            and np.all(np.isfinite(b))):
        raise ValueError("invalid_clip_inputs")
    return (-c - b) / s, (c - b) / s


def _identity(reason, **extra):
    d = {"requested": MODE, "status": "identity", "reason": reason,
         "training_json_sha256": TRAINING_JSON_SHA256}
    d.update(extra)
    return d


def build_map(pairs, n_params, problem_size, table=None):
    """Pure construction + pure arithmetic self-check. No Objective calls."""
    table = TABLE if table is None else table
    if problem_size is None:
        return _identity("problem_size_unknown")
    try:
        if isinstance(problem_size, bool) or int(problem_size) != REQUIRED_SIZE:
            return _identity("problem_size_not_3:%s" % (problem_size,))
    except Exception:
        return _identity("problem_size_unparsable")
    ok, why = validate_table(table)
    if not ok:
        return _identity("table_invalid:" + why)
    labels, why = property_labels(pairs)
    if labels is None:
        return _identity(why)
    if len(labels) != int(n_params):
        return _identity("shape_mismatch:labels=%d,n_params=%d" % (len(labels), int(n_params)))
    unknown = sorted({p for p in labels if p not in table})
    if unknown:
        return _identity("unknown_property:" + ",".join(unknown)[:120])
    s_vec = np.array([table[p][4] for p in labels], np.float64)
    b_vec = np.array([table[p][5] for p in labels], np.float64)
    if not (np.all(np.isfinite(s_vec)) and np.all(np.isfinite(b_vec)) and np.all(s_vec > 0)):
        return _identity("nonfinite_vectors")
    unit, inv = make_maps(s_vec, b_vec)
    try:  # pure arithmetic on concrete arrays: shape, range, round trip
        z = np.stack([np.linspace(-1.0, 1.0, len(labels)), np.zeros(len(labels))]).astype(np.float32)
        u = np.asarray(unit(z))
        z1 = np.asarray(unit(z[0]))
        back = np.asarray(inv(u))
        if u.shape != z.shape or z1.shape != z[0].shape or back.shape != z.shape:
            return _identity("map_shape_mismatch")
        if not (np.all(np.isfinite(u)) and np.all((u >= 0) & (u <= 1)) and np.all(np.isfinite(back))):
            return _identity("map_nonfinite_or_range")
        if float(np.max(np.abs(back - z))) > 1e-2:
            return _identity("map_roundtrip_error")
    except Exception as exc:  # noqa: BLE001
        return _identity("map_selfcheck_error:" + repr(exc)[:120])
    counts = {p: labels.count(p) for p in PROPERTIES if p in labels}
    return {
        "requested": MODE, "status": "mapped", "reason": None,
        "training_json_sha256": TRAINING_JSON_SHA256,
        "labels_sha256": hashlib.sha256("|".join(labels).encode()).hexdigest(),
        "property_counts": counts,
        "per_property_s_b": {p: [TABLE[p][4], TABLE[p][5]] for p in PROPERTIES},
        "s_vec": s_vec, "b_vec": b_vec,
        "unit_mapping": unit, "inverse_unit_mapping": inv,
    }


def _get(container, key):
    """Public mapping-or-attribute read; None if absent."""
    if container is None:
        return None
    try:
        return container[key]
    except Exception:  # noqa: BLE001
        return getattr(container, key, None)


def resolve_problem_size(obj, explicit):
    """Explicit size, else public problem_spec['params']['size']. Never private fields."""
    if explicit is not None:
        return explicit, "explicit"
    try:
        spec = obj.problem_spec
    except Exception as exc:  # noqa: BLE001
        return None, "problem_spec_unavailable:" + repr(exc)[:80]
    size = _get(_get(spec, "params"), "size")
    if size is None:
        return None, "problem_spec_params_size_missing"
    return size, "problem_spec.params.size"


def install(obj, problem_size=None):
    """Build and, if valid, install the map. Must run before random starts, warmups, start_logging().

    Returns diagnostics with status 'mapped', 'identity', or 'abort'
    (abort = custom install failed AND explicit identity restore failed; caller must stop).
    """
    try:
        pairs = list(obj.optimization_pairs)
        n = int(obj.n_params)
    except Exception as exc:  # noqa: BLE001
        return _identity("pairs_unavailable:" + repr(exc)[:120])
    size, size_source = resolve_problem_size(obj, problem_size)
    m = build_map(pairs, n, size)
    m["size_source"] = size_source
    if m["status"] != "mapped":
        return m
    unit, inv = m.pop("unit_mapping"), m.pop("inverse_unit_mapping")
    try:
        obj.set_space_mode(unbounded=True, unit_mapping=unit, inverse_unit_mapping=inv)
    except Exception as exc:  # noqa: BLE001
        reason = "set_space_mode_failed:" + repr(exc)[:120]
        iu, ii = identity_maps()
        try:
            obj.set_space_mode(unbounded=True, unit_mapping=iu, inverse_unit_mapping=ii)
        except Exception as exc2:  # noqa: BLE001
            d = _identity(reason, restore="failed:" + repr(exc2)[:80], size_source=size_source)
            d["status"] = "abort"
            return d
        return _identity(reason, restore="ok_identity_pair", size_source=size_source)
    return m
