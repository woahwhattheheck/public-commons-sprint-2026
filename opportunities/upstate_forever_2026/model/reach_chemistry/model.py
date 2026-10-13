"""Validated, explicitly unit-bearing reach chemistry project and sparse operator.

State is kg of each species' declared conserved basis, ordered reach-major.
All water rates are m3/day; first-order rates are 1/day. No watershed defaults
or implicit annual-to-daily conversion are applied.
"""
from __future__ import annotations
from dataclasses import dataclass
from copy import deepcopy
from hashlib import sha256
import json
import math
from typing import Any
import numpy as np
from scipy import sparse

SCHEMA = "reach-chemistry/1"

class ModelError(ValueError):
    """An input violates the model contract; message names the offending field."""

def number(value: Any, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        raise ModelError(f"{name}: expected a finite number")
    v = float(value)
    if not math.isfinite(v) or v < 0 or (positive and v == 0):
        raise ModelError(f"{name}: expected {'positive' if positive else 'nonnegative'} finite number")
    return v

def text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ModelError(f"{name}: expected a nonempty string")
    return value

def records(value: Any, name: str, *, nonempty: bool = False) -> list[dict]:
    if not isinstance(value, list) or any(not isinstance(x, dict) for x in value):
        raise ModelError(f"{name}: expected an array of objects")
    if nonempty and not value:
        raise ModelError(f"{name}: must not be empty")
    return value

def keyed(value: Any, name: str, *, nonempty: bool = False) -> dict[str, dict]:
    ans: dict[str, dict] = {}
    for row in records(value, name, nonempty=nonempty):
        k = text(row.get("id"), f"{name}.id")
        if k in ans:
            raise ModelError(f"{name}: duplicate id {k}")
        ans[k] = row
    return ans

def mapping(value: Any, name: str) -> dict:
    if not isinstance(value, dict):
        raise ModelError(f"{name}: expected an object")
    return value

def provenance(obj: dict, name: str) -> None:
    p = mapping(obj.get("provenance"), f"{name}.provenance")
    text(p.get("kind"), f"{name}.provenance.kind")
    text(p.get("reference"), f"{name}.provenance.reference")

def canonical_bytes(value: dict) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                          allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ModelError(f"project is not finite JSON: {exc}") from exc

@dataclass
class Operator:
    A: sparse.csc_matrix
    forcing: np.ndarray
    forcing_by_tag: dict[str, dict[int, float]]
    external_rate: np.ndarray
    reactions: list[dict]
    phase: dict
    water_balance: list[dict]

class Project:
    def __init__(self, raw: dict):
        if not isinstance(raw, dict):
            raise ModelError("project must be an object")
        self.raw = deepcopy(raw)
        raw = self.raw
        if raw.get("schema") != SCHEMA:
            raise ModelError(f"schema must be {SCHEMA}")
        self.title = text(raw.get("title"), "title")
        self.species = keyed(raw.get("species"), "species", nonempty=True)
        self.reaches = keyed(raw.get("reaches"), "reaches", nonempty=True)
        self.flows = keyed(raw.get("flows", []), "flows")
        self.exchanges = keyed(raw.get("exchanges", []), "exchanges")
        self.reactions = keyed(raw.get("reactions", []), "reactions")
        self.loads = keyed(raw.get("loads", []), "loads")
        self.initials = keyed(raw.get("initial", []), "initial")
        self.phases = records(raw.get("phases"), "phases", nonempty=True)
        self.sids, self.rids = list(self.species), list(self.reaches)
        self.ns, self.nr = len(self.sids), len(self.rids)
        self.n = self.ns * self.nr
        self.si = {s: i for i, s in enumerate(self.sids)}
        self.ri = {r: i for i, r in enumerate(self.rids)}
        self.bases = list(dict.fromkeys(text(s.get("basis"), f"species.{sid}.basis")
                                        for sid, s in self.species.items()))
        self.volume = np.asarray([number(r.get("volume_m3"), f"reaches.{rid}.volume_m3", positive=True)
                                  for rid, r in self.reaches.items()], dtype=float)
        self.state_volumes = np.repeat(self.volume, self.ns)
        for group, items in [("species", self.species), ("reaches", self.reaches),
                             ("flows", self.flows), ("exchanges", self.exchanges),
                             ("reactions", self.reactions), ("loads", self.loads),
                             ("initial", self.initials)]:
            for ident, obj in items.items():
                provenance(obj, f"{group}.{ident}")
        for rid, r in self.reaches.items():
            if "temperature_c" in r:
                t = r["temperature_c"]
                if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t):
                    raise ModelError(f"reach {rid}: temperature_c must be finite")
            if "geometry" in r:
                if raw.get("geometry_crs") != "EPSG:4326":
                    raise ModelError("geometry_crs must be EPSG:4326 for GeoJSON export")
                g = r["geometry"]
                if not isinstance(g, dict) or g.get("type") not in ("Point", "LineString"):
                    raise ModelError(f"reach {rid}: geometry must be a Point or LineString")
                coords = [g.get("coordinates")] if g["type"] == "Point" else g.get("coordinates")
                if not isinstance(coords, list) or len(coords) < (1 if g["type"] == "Point" else 2):
                    raise ModelError(f"reach {rid}: invalid coordinate array")
                for c in coords:
                    if not isinstance(c, list) or len(c) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in c):
                        raise ModelError(f"reach {rid}: expected finite longitude/latitude pairs")
                    if not (-180 <= c[0] <= 180 and -90 <= c[1] <= 90):
                        raise ModelError(f"reach {rid}: coordinates outside EPSG:4326")
        for fid, f in self.flows.items():
            src, dst = f.get("source"), f.get("target")
            if (src is None and dst is None) or src == dst:
                raise ModelError(f"flow {fid}: must connect distinct reaches or a reach and boundary")
            if src is not None: self.reach(src)
            if dst is not None: self.reach(dst)
            number(f.get("m3_day"), f"flow {fid}.m3_day")
            c = mapping(f.get("concentration_mg_l", {}), f"flow {fid}.concentration_mg_l")
            if c and src is not None:
                raise ModelError(f"flow {fid}: concentration applies only to boundary inflow")
            for sid, value in c.items():
                self.specie(sid); number(value, f"flow {fid}.concentration_mg_l.{sid}")
        for eid, e in self.exchanges.items():
            self.reach(e.get("a")); self.reach(e.get("b"))
            if e["a"] == e["b"]: raise ModelError(f"exchange {eid}: endpoints must differ")
            number(e.get("m3_day"), f"exchange {eid}.m3_day")
        for rid, r in self.reactions.items():
            self.specie(r.get("source"))
            number(r.get("rate_day"), f"reaction {rid}.rate_day")
            products = mapping(r.get("products", {}), f"reaction {rid}.products")
            total = 0.0
            for sid, fraction in products.items():
                self.specie(sid)
                if self.species[sid]["basis"] != self.species[r["source"]]["basis"]:
                    raise ModelError(f"reaction {rid}: source and products need the same conserved basis")
                total += number(fraction, f"reaction {rid}.products.{sid}")
            if total > 1.0:
                raise ModelError(f"reaction {rid}: product basis fractions sum to {total}, above 1")
            if total < 1:
                text(r.get("sink_label"), f"reaction {rid}.sink_label")
            if "reach_ids" in r:
                ids = r["reach_ids"]
                if not isinstance(ids, list) or not ids or len(set(ids)) != len(ids):
                    raise ModelError(f"reaction {rid}.reach_ids must be nonempty and unique")
                for reach in ids: self.reach(reach)
            if "theta" in r:
                number(r["theta"], f"reaction {rid}.theta", positive=True)
                temp = r.get("reference_temperature_c")
                if isinstance(temp, bool) or not isinstance(temp, (float, int)) or not math.isfinite(temp):
                    raise ModelError(f"reaction {rid}: reference_temperature_c must be explicit and finite")
                for reach in r.get("reach_ids", self.rids):
                    if "temperature_c" not in self.reaches[reach]:
                        raise ModelError(f"reaction {rid}: reach {reach} requires temperature_c")
        for lid, l in self.loads.items():
            self.index(l.get("reach"), l.get("species"))
            number(l.get("kg_day"), f"load {lid}.kg_day")
            if self.tag(l, f"load:{lid}") == "__initial__":
                raise ModelError("source_tag __initial__ is reserved")
        for fid, f in self.flows.items():
            if self.tag(f, f"boundary:{fid}") == "__initial__":
                raise ModelError("source_tag __initial__ is reserved")
        self.initial = np.zeros(self.n)
        for iid, row in self.initials.items():
            j = self.index(row.get("reach"), row.get("species"))
            self.initial[j] += number(row.get("kg"), f"initial {iid}.kg")
        end = 0.0
        for phase in self.phases:
            until = number(phase.get("until_day"), "phase.until_day", positive=True)
            if until <= end:
                raise ModelError("phase.until_day values must strictly increase")
            end = until
            for key, choices in [("flow_multipliers", self.flows), ("load_multipliers", self.loads),
                                 ("reaction_multipliers", self.reactions), ("exchange_multipliers", self.exchanges)]:
                for name, factor in mapping(phase.get(key, {}), f"phase.{key}").items():
                    if name not in choices: raise ModelError(f"phase.{key}: unknown id {name}")
                    number(factor, f"phase.{key}.{name}")
        self.end_day = end
        self.fingerprint = sha256(canonical_bytes(self.raw)).hexdigest()
        # Fixed-volume water continuity must hold in EVERY phase, not just baseline.
        for phase in self.phases:
            self.check_water(phase)

    def specie(self, sid: str) -> dict:
        if not isinstance(sid, str) or sid not in self.species:
            raise ModelError(f"unknown species {sid!r}")
        return self.species[sid]

    def reach(self, rid: str) -> dict:
        if not isinstance(rid, str) or rid not in self.reaches:
            raise ModelError(f"unknown reach {rid!r}")
        return self.reaches[rid]

    def index(self, reach: str, species: str) -> int:
        self.reach(reach); self.specie(species)
        return self.ri[reach] * self.ns + self.si[species]

    @staticmethod
    def tag(item: dict, default: str) -> str:
        return text(item.get("source_tag", default), "source_tag")

    def check_water(self, phase: dict) -> list[dict]:
        incoming, outgoing = np.zeros(self.nr), np.zeros(self.nr)
        for fid, f in self.flows.items():
            q = f["m3_day"] * phase.get("flow_multipliers", {}).get(fid, 1.0)
            if not math.isfinite(q): raise ModelError(f"flow {fid}: rate overflow")
            if f.get("source") is not None: outgoing[self.ri[f["source"]]] += q
            if f.get("target") is not None: incoming[self.ri[f["target"]]] += q
        residual = incoming - outgoing
        bad = np.where(np.abs(residual) > 1e-9 * np.maximum(1.0, np.maximum(incoming, outgoing)))[0]
        if len(bad):
            r = int(bad[0])
            raise ModelError(f"fixed-volume water balance fails at {self.rids[r]}, phase ending {phase['until_day']}: "
                             f"inflow {incoming[r]} != outflow {outgoing[r]} m3/day; add explicit boundary flow")
        return [{"reach": rid, "incoming_m3_day": float(incoming[i]), "outgoing_m3_day": float(outgoing[i]),
                 "residual_m3_day": float(residual[i])} for i, rid in enumerate(self.rids)]

    def compile(self, phase: dict) -> Operator:
        row: list[int] = []; col: list[int] = []; val: list[float] = []
        tags: dict[str, dict[int, float]] = {}
        b = np.zeros(self.n)
        external = np.zeros(self.n)
        ledger = []
        def entry(i: int, j: int, v: float):
            if v: row.append(i); col.append(j); val.append(v)
        def forcing(tag: str, i: int, amount: float):
            if tag not in tags: tags[tag] = {}
            tags[tag][i] = tags[tag].get(i, 0.0) + amount
            b[i] += amount
        def transport(src: str, dst: str | None, q: float):
            rate = q / self.volume[self.ri[src]]
            for sid in self.sids:
                j = self.index(src, sid)
                entry(j, j, -rate)
                if dst is not None: entry(self.index(dst, sid), j, rate)
                else: external[j] += rate
        for fid, f in self.flows.items():
            q = f["m3_day"] * phase.get("flow_multipliers", {}).get(fid, 1.0)
            if f.get("source") is not None:
                transport(f["source"], f.get("target"), q)
            else:
                for sid, c in f.get("concentration_mg_l", {}).items():
                    forcing(self.tag(f, f"boundary:{fid}"), self.index(f["target"], sid), q * c / 1000.0)
        for eid, e in self.exchanges.items():
            q = e["m3_day"] * phase.get("exchange_multipliers", {}).get(eid, 1.0)
            transport(e["a"], e["b"], q); transport(e["b"], e["a"], q)
        for lid, l in self.loads.items():
            forcing(self.tag(l, f"load:{lid}"), self.index(l["reach"], l["species"]),
                    l["kg_day"] * phase.get("load_multipliers", {}).get(lid, 1.0))
        for rid, r in self.reactions.items():
            for reach in r.get("reach_ids", self.rids):
                k = r["rate_day"] * phase.get("reaction_multipliers", {}).get(rid, 1.0)
                if "theta" in r:
                    try: k *= r["theta"] ** (self.reaches[reach]["temperature_c"] - r["reference_temperature_c"])
                    except OverflowError as exc: raise ModelError(f"reaction {rid}: temperature factor overflow") from exc
                if not math.isfinite(k): raise ModelError(f"reaction {rid}: rate overflow")
                j = self.index(reach, r["source"])
                entry(j, j, -k)
                for sid, yield_ in r.get("products", {}).items():
                    entry(self.index(reach, sid), j, k * yield_)
                ledger.append({"id": rid, "reach": reach, "source": r["source"], "source_index": j,
                               "products": dict(r.get("products", {})), "rate_day": float(k),
                               "basis": self.species[r["source"]]["basis"],
                               "sink_fraction": 1.0 - sum(r.get("products", {}).values()),
                               "sink_label": r.get("sink_label")})
        A = sparse.coo_matrix((val, (row, col)), shape=(self.n, self.n)).tocsc()
        if not np.isfinite(A.data).all() or not np.isfinite(b).all():
            raise ModelError("operator overflow; review model units and magnitudes")
        return Operator(A, b, tags, external, ledger, phase, self.check_water(phase))

    def state_rows(self, mass: np.ndarray) -> list[dict]:
        return [{"reach": rid, "species": sid, "basis": self.species[sid]["basis"],
                 "kg": float(mass[self.index(rid, sid)]),
                 "mg_l": float(1000.0 * mass[self.index(rid, sid)] / self.volume[i])}
                for i, rid in enumerate(self.rids) for sid in self.sids]

    def basis_sum(self, values: np.ndarray) -> dict[str, float]:
        reshaped = values.reshape(self.nr, self.ns)
        return {basis: float(reshaped[:, [j for j, sid in enumerate(self.sids)
                                        if self.species[sid]["basis"] == basis]].sum()) for basis in self.bases}
