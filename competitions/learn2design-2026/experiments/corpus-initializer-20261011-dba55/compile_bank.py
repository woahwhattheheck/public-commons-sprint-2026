"""Compile the released Differometor-30k HDF5 into a small UIFO donor bank.

Offline preparation only. This file and official/dataset_utils.py are excluded
from the competition ZIP: only warmstart.py and the compiled data are needed
by the optimizer. No optical simulation or Objective evaluation occurs here.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict, deque
from functools import lru_cache
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

import h5py
import numpy as np

from warmstart import BANK_SCHEMA, parameter_labels, topology_context


SOURCE_COMMIT = "1dc4d6e7d0ff656555f48bcf3c22a4d284779386"
SOURCE_BLOB = "6da06060a27e9530f630c3a2fb40c90082dfd152"
SOURCE_BYTES = 74_920_439
SOURCE_URL = ("https://raw.githubusercontent.com/artificial-scientist-lab/"
              f"Learn2Design-2026/{SOURCE_COMMIT}/dataset/dataset.h5")
PORTS = ("left", "top", "right", "bottom")


def text(value) -> str:
    return bytes(value).decode("utf-8").rstrip("\0") if isinstance(value, (bytes, np.bytes_)) else str(value)


def identify(path: Path) -> dict:
    size = path.stat().st_size
    git = hashlib.sha1(b"blob " + str(size).encode() + b"\0")
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            sha.update(chunk)
            git.update(chunk)
    if size != SOURCE_BYTES or git.hexdigest() != SOURCE_BLOB:
        raise ValueError("input is not the pinned official Differometor-30k corpus")
    return {"url": SOURCE_URL, "commit": SOURCE_COMMIT, "git_blob_sha1": SOURCE_BLOB,
            "bytes": size, "sha256": sha.hexdigest()}


@lru_cache(maxsize=64)
def layout(topology: str, size: int):
    """Use the organizer's reconstruction helper for exact parameter/port roles."""
    from official.dataset_utils import reconstruct_uifo_setup
    topology_context(topology, size)
    if not any(ch in topology.split("-")[1] for ch in "DH"):
        raise ValueError("corpus topology lacks an explicit readout")
    setup, pairs = reconstruct_uifo_setup(topology, size)
    keys, roles = parameter_labels(pairs, topology, size)
    mirrors, splitters, directional, detectors = [], [], [], []
    for name, data in setup.nodes(data=True):
        kind = data["component"]
        if kind == "mirror":
            mirrors.append(tuple(f"{name}.{port}.{direction}"
                                 for port in ("left", "right") for direction in ("in", "out")))
        elif kind in ("beamsplitter", "directional_beamsplitter"):
            target = splitters if kind == "beamsplitter" else directional
            target.append(tuple(f"{name}.{port}.{direction}"
                                for port in PORTS for direction in ("in", "out")))
        elif kind == "detector":
            # build.py resolves detector nodes to their physical target ports.
            # For balanced homodyne the two physical outputs stay separate.
            if data.get("sideband", "upper") != "upper":
                raise ValueError("unsupported corpus detector sideband")
            detectors.append(f"{data['target']}.{data['port']}.{data['direction']}")
    if not detectors:
        raise ValueError("corpus topology has no native detector")
    return keys, roles, (mirrors, splitters, directional, detectors)


def maximum_power_ratios(values: np.ndarray, port_index: dict,
                         groups, thresholds: dict) -> np.ndarray:
    """Native calculate_powers aggregation over already measured port powers."""
    if values.ndim != 2 or not np.isfinite(values).all() or (values < 0).any():
        raise ValueError("invalid saved port powers")
    mirrors, splitters, directional, detectors = groups

    def gather(names):
        return values[np.asarray([[port_index[name] for name in row] for row in names], dtype=np.int64)]

    hard_max, soft_max = 0.0, 0.0
    for names, side_size in ((mirrors, 2), (splitters, 4)):
        if not names:
            continue
        ports = gather(names)
        a = ports[:, :side_size, :].max(axis=1)
        b = ports[:, side_size:, :].max(axis=1)
        # Per-column side selection matches native calculate_powers exactly.
        hard_max = max(hard_max, float(np.maximum(a, b).max()))
        soft_max = max(soft_max, float(np.minimum(a, b).max()))
    if directional:
        soft_max = max(soft_max, float(gather(directional).max()))
    detector_max = float(values[[port_index[name] for name in detectors]].max())
    return np.asarray([hard_max / thresholds["hard"], soft_max / thresholds["soft"],
                       detector_max / thresholds["detector"]], dtype=np.float64)


def readout_bucket(topology: str) -> tuple[str, int]:
    boundary = topology.split("-")[1]
    return "".join(ch if ch in "DH" else "-" for ch in boundary), boundary.count("L")


def compile_bank(dataset: Path, output: Path, *, sizes: tuple[int, ...],
                 max_donors_per_size: int) -> dict:
    source = identify(dataset)
    from differometor.components import (
        HARD_SIDE_POWER_THRESHOLD, SOFT_SIDE_POWER_THRESHOLD, DETECTOR_POWER_THRESHOLD)
    thresholds = {"hard": float(HARD_SIDE_POWER_THRESHOLD), "soft": float(SOFT_SIDE_POWER_THRESHOLD),
                  "detector": float(DETECTOR_POWER_THRESHOLD)}
    if thresholds != {"hard": 3.5e6, "soft": 2000.0, "detector": 0.01}:
        raise ValueError("offline runtime physical limits differ from pinned native source")
    started = time.monotonic()
    stats, selected, selected_topologies = Counter(), [], set()
    with h5py.File(dataset, "r") as handle:
        required = {"entries", "bounded_params", "sensitivities", "frequency_values",
                    "power_values", "power_port_map_names", "power_port_map_indices",
                    "power_port_map_offsets"}
        if not required <= set(handle):
            raise ValueError("missing official HDF5 datasets")
        entries = handle["entries"][:]
        frequencies = np.asarray(handle["frequency_values"][:], dtype=np.float64)
        if frequencies.shape != (50,) or not np.isfinite(frequencies).all() or not np.all(np.diff(frequencies) > 0):
            raise ValueError("expected the published fifty-frequency broadband corpus")
        if handle["sensitivities"].shape != (len(entries), 50):
            raise ValueError("sensitivities are not entry-aligned")
        stats["source_entries"] = len(entries)
        by_size = defaultdict(lambda: defaultdict(list))
        for index, entry in enumerate(entries):
            size = int(entry["size"])
            if size not in sizes:
                stats["other_size"] += 1
                continue
            loss = float(entry["loss"])
            if not np.isfinite(loss):
                stats["nonfinite_saved_loss"] += 1
                continue
            topology = text(entry["topology_string"])
            topology_context(topology, size)
            by_size[size][readout_bucket(topology)].append(index)
        map_cache = {}

        def port_map(entry):
            map_id = int(entry["power_map_id"])
            if map_id not in map_cache:
                offsets = handle["power_port_map_offsets"]
                if not 0 <= map_id < len(offsets) - 1:
                    raise ValueError("invalid power map identity")
                start, stop = int(offsets[map_id]), int(offsets[map_id + 1])
                names = [text(x) for x in handle["power_port_map_names"][start:stop]]
                indices = handle["power_port_map_indices"][start:stop]
                if len(set(names)) != len(names) or len(names) != len(indices):
                    raise ValueError("power map names must be unique and aligned")
                mapping = dict(zip(names, (int(x) for x in indices)))
                # Cache only compact named indices, never full Setup graphs.
                if len(map_cache) >= 256:
                    map_cache.pop(next(iter(map_cache)))
                map_cache[map_id] = mapping
            mapping = map_cache[map_id]
            if any(not 0 <= i < int(entry["power_rows"]) for i in mapping.values()):
                raise ValueError("power map points outside its saved array")
            return mapping

        for size in sizes:
            buckets = {}
            for bucket, indices in by_size[size].items():
                buckets[bucket] = deque(sorted(indices, key=lambda i: (
                    float(entries[i]["loss"]), text(entries[i]["unique_hash"]))))
            active = deque(sorted(buckets))
            size_count = 0
            while active and size_count < max_donors_per_size:
                bucket = active.popleft()
                index = buckets[bucket].popleft()
                if buckets[bucket]:
                    active.append(bucket)
                entry = entries[index]
                topology = text(entry["topology_string"])
                if (size, topology) in selected_topologies:
                    stats["duplicate_selected_topology_skipped"] += 1
                    continue
                stats["power_records_inspected"] += 1
                keys, roles, groups = layout(topology, size)
                start, length = int(entry["param_offset"]), int(entry["param_length"])
                if start < 0 or length != len(keys) or start + length > len(handle["bounded_params"]):
                    raise ValueError(f"entry {index} does not match the native parameter layout")
                params = np.asarray(handle["bounded_params"][start:start + length], dtype=np.float64)
                sensitivity = np.asarray(handle["sensitivities"][index], dtype=np.float64)
                if not np.isfinite(params).all() or not np.isfinite(sensitivity).all() or not (sensitivity > 0).all():
                    stats["invalid_saved_design"] += 1
                    continue
                pstart, plen = int(entry["power_offset"]), int(entry["power_length"])
                rows, cols = int(entry["power_rows"]), int(entry["power_cols"])
                if pstart < 0 or rows < 1 or cols < 1 or plen != rows * cols or pstart + plen > len(handle["power_values"]):
                    raise ValueError(f"entry {index} has invalid power offsets")
                powers = np.asarray(handle["power_values"][pstart:pstart + plen], dtype=np.float64).reshape(rows, cols)
                ratios = maximum_power_ratios(powers, port_map(entry), groups, thresholds)
                if (ratios > 1.0).any():
                    stats["observed_power_infeasible"] += 1
                    continue
                selected.append({"size": size, "topology": topology, "keys": keys, "roles": roles,
                                 "values": params, "loss": float(entry["loss"]), "ratios": ratios,
                                 "entry_hash": text(entry["unique_hash"]),
                                 "initialized_from": text(entry["initialized_from"]), "entry_index": index})
                selected_topologies.add((size, topology))
                size_count += 1
            stats[f"selected_size_{size}"] = size_count
    if not selected:
        raise ValueError("no complete power-feasible donor could be compiled")
    role_by_key, role_values = {}, defaultdict(list)
    for donor in selected:
        for key, role, value in zip(donor["keys"], donor["roles"], donor["values"]):
            if key in role_by_key and role_by_key[key] != role:
                raise ValueError("inconsistent native component role")
            role_by_key[key] = role
            role_values[role].append(float(value))
    all_keys = sorted(role_by_key)
    key_index = {key: i for i, key in enumerate(all_keys)}
    values = np.full((len(selected), len(all_keys)), np.nan, dtype=np.float64)
    for index, donor in enumerate(selected):
        values[index, [key_index[key] for key in donor["keys"]]] = donor["values"]
    prior_roles = sorted(role_values)
    # Empirical medians only fill absent variables; transferred donor values
    # retain their joint correlations and original float64 precision.
    prior_values = np.asarray([np.median(role_values[role]) for role in prior_roles], dtype=np.float64)
    metadata = {
        "schema": BANK_SCHEMA, "source": source, "power_thresholds_watts": thresholds,
        "frequencies": frequencies.tolist(), "sizes": list(sizes),
        "max_donors_per_size": max_donors_per_size, "counts": dict(stats),
        "selection": "round-robin readout-placement/laser-count buckets; lowest saved loss first; one observed feasible donor per topology",
        "power_check": "all named physical ports, native side aggregation per column, unchanged <= thresholds",
        "parameter_map": "pinned official reconstruct_uifo_setup/constrain_inter_grid_cell_spaces",
        "provenance": [{"entry_index": d["entry_index"], "entry_hash": d["entry_hash"],
                        "initialized_from": d["initialized_from"]} for d in selected],
        "runtime": {name: importlib.metadata.version(name) for name in ("dfbench", "differometor", "h5py", "numpy")},
        "scope": "Saved donor observations. Transferred candidate feasibility and loss come only from its logged native Objective evaluations.",
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    with temporary.open("wb") as stream:
        np.savez_compressed(stream, metadata=np.asarray(json.dumps(metadata, sort_keys=True)),
            keys=np.asarray(all_keys), roles=np.asarray([role_by_key[key] for key in all_keys]), values=values,
            topologies=np.asarray([d["topology"] for d in selected]), sizes=np.asarray([d["size"] for d in selected], dtype=np.int16),
            losses=np.asarray([d["loss"] for d in selected], dtype=np.float64),
            entry_hashes=np.asarray([d["entry_hash"] for d in selected]), max_power_ratios=np.asarray([d["ratios"] for d in selected]),
            prior_roles=np.asarray(prior_roles), prior_values=prior_values)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, output)
    return {"source": source, "counts": dict(stats), "bank_bytes": output.stat().st_size,
            "bank_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "keys": len(all_keys), "prior_roles": len(prior_roles),
            "compile_wall_seconds": time.monotonic() - started}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("warmstart_bank.npz"))
    parser.add_argument("--sizes", type=int, nargs="+", default=[3, 4])
    parser.add_argument("--max-donors-per-size", type=int, default=512)
    args = parser.parse_args()
    if not args.sizes or any(not 1 <= size <= 8 for size in args.sizes) or len(set(args.sizes)) != len(args.sizes):
        parser.error("sizes must be unique supported UIFO sizes")
    if not 1 <= args.max_donors_per_size <= 4096:
        parser.error("max-donors-per-size must be in [1,4096]")
    print(json.dumps(compile_bank(args.dataset, args.output, sizes=tuple(args.sizes),
                                 max_donors_per_size=args.max_donors_per_size), indent=2), flush=True)


if __name__ == "__main__":
    main()
