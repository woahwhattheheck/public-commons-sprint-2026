"""Public-context, coherent-donor starts for the original UIFO optimizer.

This module has no simulator dependency and never evaluates an Objective. The
offline compiler supplies a compact bank of observed public donor designs. A
transferred point is a proposal: native Objective feasibility decides its value.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np


BANK_SCHEMA = "tjlabs.l2d.public-donor-bank/v1"
DEFAULT_BANK = Path(__file__).with_name("warmstart_bank.npz")


def topology_context(topology: str, size: int) -> tuple[dict, dict]:
    """Decode the organizer's public character order without a simulator import."""
    if type(size) is not int or not 1 <= size <= 8:
        raise ValueError("UIFO donor mapping supports single-digit grid coordinates")
    if not isinstance(topology, str) or topology.count("-") != 1:
        raise ValueError("invalid public UIFO topology")
    interior, boundary = topology.split("-")
    if (len(interior) != size * size or len(boundary) != 4 * size
            or set(interior) - set("ABCDEFGH") or set(boundary) - set("LSDH")):
        raise ValueError("UIFO topology does not match its declared size")
    inside = {f"{r}{c}": ch for (r, c), ch in zip(
        ((r, c) for r in range(1, size + 1) for c in range(1, size + 1)), interior)}
    edges = ([f"0{c}" for c in range(1, size + 1)]
             + [f"{r}{c}" for r in range(1, size + 1) for c in (0, size + 1)]
             + [f"{size + 1}{c}" for c in range(1, size + 1)])
    return inside, dict(zip(edges, boundary))


def pair_members(pair) -> tuple[tuple[str, str], ...]:
    """Preserve one shared variable as one canonical, order-independent key."""
    if (isinstance(pair, (list, tuple)) and len(pair) == 2
            and all(isinstance(part, str) and part for part in pair)):
        members = (tuple(pair),)
    elif isinstance(pair, (list, tuple)) and pair:
        members = tuple(tuple(member) for member in pair
                        if isinstance(member, (list, tuple)) and len(member) == 2
                        and all(isinstance(part, str) and part for part in member))
        if len(members) != len(pair):
            raise ValueError("malformed public optimization pair")
    else:
        raise ValueError("malformed public optimization pair")
    if len(set(members)) != len(members) or len({p for _, p in members}) != 1:
        raise ValueError("coupled variables must contain unique targets of one property")
    return tuple(sorted(members))


def component_role(component: str, context: tuple[dict, dict]) -> str:
    """Separate source/readout roles without assuming equal vector positions."""
    centers, boundaries = context
    if "_" in component:
        return "space"
    mass = component.endswith("sus")
    name = component[:-3] if mass else component
    center = re.fullmatch(r"center([0-9]{2})", name)
    boundary = re.fullmatch(r"boundary([0-9]{2})(.*)", name)
    mirror = re.fullmatch(r"m([lrtb]?)([0-9]{2})", name)
    if center and center[1] in centers:
        kind = "splitter" if centers[center[1]] in "ABCD" else "directional"
    elif boundary and boundary[1] in boundaries:
        kind = "boundary:" + boundaries[boundary[1]] + ":" + boundary[2]
    elif mirror and mirror[2] in boundaries and not mirror[1]:
        kind = "boundary-mirror:" + boundaries[mirror[2]]
    elif mirror and mirror[2] in centers and mirror[1]:
        kind = "cell-mirror:" + mirror[1]
    else:
        # An unfamiliar native component can use only an exact-key donor;
        # it does not borrow a different component's empirical distribution.
        kind = "component:" + component
    return "mass:" + kind if mass else kind


def parameter_labels(pairs, topology: str, size: int) -> tuple[list[str], list[str]]:
    context = topology_context(topology, size)
    keys, roles = [], []
    for pair in pairs:
        members = pair_members(pair)
        member_roles = tuple(component_role(name, context) for name, _ in members)
        key = json.dumps([(name, prop, role) for (name, prop), role
                          in zip(members, member_roles)], separators=(",", ":"))
        role = json.dumps([sorted(set(member_roles)), members[0][1]],
                          separators=(",", ":"))
        keys.append(key)
        roles.append(role)
    if len(set(keys)) != len(keys):
        raise ValueError("public optimization variables must have distinct targets")
    return keys, roles


def _read_bank(path: Path) -> dict:
    with np.load(path, allow_pickle=False) as packed:
        bank = {name: packed[name] for name in packed.files}
    meta = json.loads(str(bank.pop("metadata").item()))
    if meta.get("schema") != BANK_SCHEMA:
        raise ValueError("unsupported donor bank schema")
    required = {"keys", "roles", "values", "topologies", "sizes", "losses",
                "entry_hashes", "max_power_ratios", "prior_roles", "prior_values"}
    if set(bank) != required:
        raise ValueError("incomplete donor bank")
    n, width = bank["values"].shape
    if (n < 1 or bank["keys"].shape != (width,)
            or bank["roles"].shape != (width,)
            or bank["max_power_ratios"].shape != (n, 3)
            or any(bank[name].shape != (n,) for name in
                   ("topologies", "sizes", "losses", "entry_hashes"))
            or bank["prior_roles"].shape != bank["prior_values"].shape
            or not np.isfinite(bank["losses"]).all()
            or np.isinf(bank["values"]).any()
            or not np.isfinite(bank["max_power_ratios"]).all()
            or (bank["max_power_ratios"] < 0).any()
            or (bank["max_power_ratios"] > 1).any()
            or not np.isfinite(bank["prior_values"]).all()
            or len(set(bank["keys"].tolist())) != width):
        raise ValueError("malformed donor bank arrays")
    bank["metadata"] = meta
    return bank


def propose_starts(*, problem_spec: dict, optimization_pairs, bounds,
                   count: int, bank_path: Path = DEFAULT_BANK) -> tuple[list, dict]:
    """Return bounded proposals, with complete shared-parameter assignments.

    Donors are ranked by readout placement, boundary roles, center component
    types, then orientation and saved loss. An absent variable uses a learned
    role median; if the bank has neither, that donor is skipped as incomplete.
    Bounds are always the supplied Objective bounds, including narrowed bounds.
    """
    if type(count) is not int or not 0 <= count <= 16:
        raise ValueError("donor count must be an integer in [0,16]")
    diag = {"requested": count, "selected": [], "status": "unsupported-objective"}
    if count == 0:
        diag["status"] = "disabled"
        return [], diag
    if not isinstance(problem_spec, dict) or problem_spec.get("type") != "UIFOProblem":
        return [], diag
    params = problem_spec.get("params", {})
    size, topology = params.get("size"), params.get("topology")
    if type(size) is not int or not 1 <= size <= 8 or not isinstance(topology, str):
        return [], diag
    keys, roles = parameter_labels(optimization_pairs, topology, size)
    limits = np.asarray(bounds, dtype=np.float64)
    if (limits.shape != (2, len(keys)) or not np.isfinite(limits).all()
            or not (limits[1] > limits[0]).all()):
        raise ValueError("invalid public Objective bounds")
    bank = _read_bank(Path(bank_path))
    available = np.flatnonzero(bank["sizes"] == size)
    if not len(available):
        diag["status"] = "unsupported-grid-size"
        return [], diag
    diag["source_dataset_sha256"] = bank["metadata"]["source"]["sha256"]
    lookup = {key: i for i, key in enumerate(bank["keys"].tolist())}
    priors = dict(zip(bank["prior_roles"].tolist(), bank["prior_values"].tolist()))
    target_center, target_boundary = topology.split("-")

    def rank(index):
        center, boundary = str(bank["topologies"][index]).split("-")
        readout = sum((a if a in "DH" else "-") != (b if b in "DH" else "-")
                      for a, b in zip(boundary, target_boundary))
        boundary_distance = sum(a != b for a, b in zip(boundary, target_boundary))
        types = sum((a in "ABCD") != (b in "ABCD")
                    for a, b in zip(center, target_center))
        orientations = sum((ord(a) - ord("A")) % 4 != (ord(b) - ord("A")) % 4
                           for a, b in zip(center, target_center))
        return readout, boundary_distance, types, orientations, float(bank["losses"][index]), str(bank["entry_hashes"][index])

    proposals = []
    used_topologies = set()
    for index in sorted(available.tolist(), key=rank):
        donor_topology = str(bank["topologies"][index])
        if donor_topology in used_topologies:
            continue
        row, transferred, inferred = [], 0, 0
        for key, role in zip(keys, roles):
            column = lookup.get(key)
            value = bank["values"][index, column] if column is not None else np.nan
            if np.isfinite(value):
                transferred += 1
            elif role in priors:
                value = priors[role]
                inferred += 1
            else:
                break
            row.append(float(value))
        if len(row) != len(keys):
            continue
        raw = np.asarray(row, dtype=np.float64)
        bounded = np.clip(raw, limits[0], limits[1])
        if any(np.array_equal(bounded, previous) for previous in proposals):
            continue
        proposals.append(bounded)
        used_topologies.add(donor_topology)
        diag["selected"].append({
            "entry_hash": str(bank["entry_hashes"][index]),
            "topology": donor_topology, "saved_loss": float(bank["losses"][index]),
            "distance": list(rank(index)[:4]), "exact_key_values": transferred,
            "role_prior_values": inferred, "clipped_to_supplied_bounds": int(np.count_nonzero(raw != bounded)),
            "observed_donor_max_power_ratios": bank["max_power_ratios"][index].tolist(),
        })
        if len(proposals) == count:
            break
    diag["status"] = "ready" if proposals else "no-complete-mapping"
    return proposals, diag


def as_sigmoid_coordinates(bounded, bounds) -> np.ndarray:
    """Public default sigmoid inverse; no Objective implementation attributes."""
    limits = np.asarray(bounds, dtype=np.float64)
    unit = (np.asarray(bounded, dtype=np.float64) - limits[0]) / (limits[1] - limits[0])
    unit = np.clip(unit, 1e-7, 1.0 - 1e-7)
    return np.log(unit) - np.log1p(-unit)


def replace_start_slots(objective, starts: list, *, preserve_first: bool = False,
                        bank_path: Path = DEFAULT_BANK) -> tuple[list, dict]:
    """Consume public context after original random draws, before native warmup."""
    slots = [i for i in range(0, len(starts), 2) if not (preserve_first and i == 0)]
    if preserve_first and len(starts) > 1:
        slots = list(range(1, len(starts), 2))
    proposals, diag = propose_starts(
        problem_spec=objective.problem_spec,
        optimization_pairs=objective.optimization_pairs,
        bounds=objective.bounds, count=len(slots), bank_path=bank_path)
    out = list(starts)
    for slot, proposal, info in zip(slots, proposals, diag["selected"]):
        out[slot] = as_sigmoid_coordinates(proposal, objective.bounds)
        info["restart_slot"] = slot
    diag["original_random_draws_retained"] = len(starts) - int(preserve_first)
    diag["unchanged_start_slots"] = [i for i in range(len(starts))
                                     if i not in slots[:len(proposals)]]
    return out, diag
