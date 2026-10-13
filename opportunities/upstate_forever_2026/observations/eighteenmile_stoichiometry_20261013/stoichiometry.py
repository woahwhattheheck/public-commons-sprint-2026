"""Exact-decimal interval analysis of the retained Eighteenmile nutrient cohort.

Only Python's standard library is required. Source numbers are converted directly
from their original decimal strings to Fraction, never via binary floats. Bounds
express the publisher's censoring, not sampling or analytical confidence limits.
"""
from __future__ import annotations

import csv
import hashlib
import io
import itertools
from collections import Counter, defaultdict
from dataclasses import dataclass
from fractions import Fraction as F
from typing import Any

EDITION = "eighteenmile-nutrient-composition-20261013-v1"
MOLAR_FACTOR = F(30974, 14007)  # CIAAW abridged representative P / N atomic weights.
INPUTS = [
    {"path": "source/eighteenmile-stream-nutrients-20261013/original/nutrient-results-2020-2022.csv", "bytes": 69221,
     "sha256": "90ca40a8697c6bc301e97e394452235ecf0ea0653024b93a2dc61f60ef1f6733"},
    {"path": "source/eighteenmile-stream-nutrients-20261013/original/nutrient-results-2023-2025.csv", "bytes": 153018,
     "sha256": "6c36b486618b4569454ecc8e531c4b4adbd739c5f6f726f97f8e5ceafe7a7f03"},
]
CHARACTERS = {"Kjeldahl nitrogen": "tkn", "Nitrate + Nitrite": "nox", "Phosphorus": "p", "Ammonia": "ammonia", "Nitrogen": "agency_n"}
METHODS = {"tkn": "10-107-06-2-E", "nox": "10-107-04-1-C", "p": "LACHAT 10-115-01-1-E", "ammonia": "LACHAT 10-107-06-1-C", "agency_n": "Total Nitrogen"}
ACTIVITY_FIELDS = ["MonitoringLocationIdentifier", "ActivityStartDate", "ActivityStartTime/Time", "ActivityStartTime/TimeZoneCode", "ActivityTypeCode", "ActivityMediaName", "ActivityDepthHeightMeasure/MeasureValue", "ActivityDepthHeightMeasure/MeasureUnitCode", "ProjectIdentifier"]


@dataclass(frozen=True)
class Interval:
    """An interval with explicit open endpoints; None is an unbounded endpoint."""
    lo: F | None
    hi: F | None
    lo_open: bool = False
    hi_open: bool = False

    def __post_init__(self):
        if self.lo is not None and self.hi is not None:
            if self.lo > self.hi or (self.lo == self.hi and (self.lo_open or self.hi_open)):
                raise ValueError("Empty interval")

    def as_dict(self) -> dict[str, Any]:
        return {"lower": None if self.lo is None else float(self.lo),
                "upper": None if self.hi is None else float(self.hi),
                "lower_exact": None if self.lo is None else str(self.lo),
                "upper_exact": None if self.hi is None else str(self.hi),
                "lower_open": self.lo is None or self.lo_open,
                "upper_open": self.hi is None or self.hi_open,
                "lower_unbounded": self.lo is None, "upper_unbounded": self.hi is None}

    def scale(self, factor: F) -> "Interval":
        if factor <= 0:
            raise ValueError("Scale must be positive")
        return Interval(None if self.lo is None else self.lo * factor,
                        None if self.hi is None else self.hi * factor, self.lo_open, self.hi_open)


def plus(a: Interval, b: Interval) -> Interval:
    return Interval(None if a.lo is None or b.lo is None else a.lo + b.lo,
                    None if a.hi is None or b.hi is None else a.hi + b.hi,
                    a.lo_open or b.lo_open, a.hi_open or b.hi_open)


def minus(a: Interval, b: Interval) -> Interval:
    return Interval(None if a.lo is None or b.hi is None else a.lo - b.hi,
                    None if a.hi is None or b.lo is None else a.hi - b.lo,
                    a.lo_open or b.hi_open, a.hi_open or b.lo_open)


def ratio(a: Interval, b: Interval) -> Interval:
    """Range of a/b for a>0 and b>0; censored b may include zero.

    The b=0 point is undefined, not an infinity-valued observation. The range over
    b>0 is unbounded when zero is a permitted b endpoint. Callers expose that fact.
    """
    if a.lo is None or a.lo <= 0 or b.lo is None or b.lo < 0 or b.hi is None or b.hi <= 0:
        raise ValueError("This positive-numerator ratio needs finite nonnegative concentration bounds")
    return Interval(a.lo / b.hi,
                    None if b.lo == 0 or a.hi is None else a.hi / b.lo,
                    a.lo_open or b.hi_open,
                    True if b.lo == 0 or a.hi is None else a.hi_open or b.lo_open)


def nox_fraction(nox: Interval, tkn: Interval) -> Interval:
    """Tight NOx/(NOx+TKN) bounds, retaining shared numerator dependence."""
    if any(x is None for x in (nox.lo, nox.hi, tkn.lo, tkn.hi)) or nox.lo <= 0 or tkn.lo < 0:
        raise ValueError("Invalid nitrogen component bounds")
    return Interval(nox.lo / (nox.lo + tkn.hi), nox.hi / (nox.hi + tkn.lo),
                    nox.lo_open or tkn.hi_open, nox.hi_open or tkn.lo_open)


def direction(i: Interval) -> str:
    if i.lo is not None and (i.lo > 0 or (i.lo == 0 and i.lo_open)):
        return "higher"
    if i.hi is not None and (i.hi < 0 or (i.hi == 0 and i.hi_open)):
        return "lower"
    if i.lo == i.hi == 0:
        return "equal"
    return "overlapping"


def concentration(row: dict[str, str]) -> Interval:
    """Read exact original measured or strict below-quantitation concentrations."""
    status = row["ResultDetectionConditionText"]
    value, limit = row["ResultMeasureValue"], row["DetectionQuantitationLimitMeasure/MeasureValue"]
    if row["ResultSampleFractionText"] != "Unfiltered" or row["ResultStatusIdentifier"] != "Final":
        raise ValueError("Unexpected source fraction or status")
    if row["MeasureQualifierCode"]:
        raise ValueError("An additional source qualifier requires an explicit mapping")
    if status == "Present Below Quantification Limit":
        if value or row["DetectionQuantitationLimitMeasure/MeasureUnitCode"] != "mg/L" or F(limit) <= 0:
            raise ValueError("Inconsistent censored concentration")
        if row["DetectionQuantitationLimitTypeName"] != "Lower Quantitation Limit":
            raise ValueError("Unexpected limit meaning")
        return Interval(F(0), F(limit), False, True)
    if status or not value or row["ResultMeasure/MeasureUnitCode"] != "mg/L" or F(value) < 0:
        raise ValueError("Unrecognized original concentration")
    return Interval(F(value), F(value))


def _bound_quantile(items: list[Interval], upper: bool, fraction: F) -> tuple[F | None, bool]:
    """Linear order-statistic envelope. Open flags conservatively close finite quantiles.

    Quantile and mean summary ranges are deliberately closed enclosing bounds,
    rather than pretending exact endpoint attainability for censored order ties.
    """
    values = [i.hi if upper else i.lo for i in items]
    values.sort(key=lambda x: (x is None, x or F(0)))
    p = (len(values) - 1) * fraction
    j = p.numerator // p.denominator
    rem = p - j
    a = values[j]
    if not rem:
        return a, a is None
    b = values[j + 1]
    if a is None or b is None:
        return None, True
    return a + rem * (b - a), False


def summary_interval(items: list[Interval], statistic: str) -> Interval:
    if not items:
        raise ValueError("Empty summary")
    if statistic == "mean":
        lo = None if any(i.lo is None for i in items) else sum((i.lo for i in items), F(0)) / len(items)
        hi = None if any(i.hi is None for i in items) else sum((i.hi for i in items), F(0)) / len(items)
        return Interval(lo, hi)
    q = {"q25": F(1, 4), "median": F(1, 2), "q75": F(3, 4)}[statistic]
    lo, _ = _bound_quantile(items, False, q)
    hi, _ = _bound_quantile(items, True, q)
    return Interval(lo, hi)


def _season(date: str) -> str:
    return ("DJF", "MAM", "JJA", "SON")[(int(date[5:7]) % 12) // 3]


def analyze(captures: list[tuple[dict[str, Any], bytes]]) -> dict[str, Any]:
    rows, grouped = [], defaultdict(list)
    for expected, body in captures:
        if len(body) != expected["bytes"] or hashlib.sha256(body).hexdigest() != expected["sha256"]:
            raise ValueError("Original source identity changed: " + expected["path"])
        for ordinal, raw in enumerate(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))), 1):
            if len(raw) != 63 or None in raw:
                raise ValueError("Unexpected original CSV width")
            char = CHARACTERS.get(raw["CharacteristicName"])
            if not char or raw["ResultAnalyticalMethod/MethodIdentifier"] != METHODS[char]:
                raise ValueError("Unknown source species or analytical method")
            if raw["ResultValueTypeName"] != ("Calculated" if char == "agency_n" else "Actual"):
                raise ValueError("Unexpected publisher result value type")
            val = concentration(raw)
            r = {"source_path": expected["path"], "source_sha256": expected["sha256"],
                 "source_data_row": ordinal, "source_id": expected["sha256"] + ":" + str(ordinal),
                 "component": char, "interval": val.as_dict(), "original": raw}
            rows.append(r)
            grouped[raw["ActivityIdentifier"]].append((r, val))
    activities, internals = [], {}
    for activity, group in grouped.items():
        first = group[0][0]["original"]
        for record, unused in group:
            raw = record["original"]
            if any(raw[k] != first[k] for k in ACTIVITY_FIELDS):
                raise ValueError("Activity identity has conflicting sample metadata: " + activity)
        counts = Counter(r["component"] for r, _ in group)
        if any(n != 1 for n in counts.values()) or any(k not in counts for k in ("tkn", "nox", "p")):
            raise ValueError("Ambiguous or incomplete same-activity nitrogen/P match: " + activity)
        original = {r["component"]: r for r, _ in group}
        iv = {r["component"]: v for r, v in group}
        derived = dict(iv)
        derived["tn"] = plus(iv["tkn"], iv["nox"])
        derived["np_mass"] = ratio(derived["tn"], iv["p"])
        derived["np_molar"] = derived["np_mass"].scale(MOLAR_FACTOR)
        # P/TN stays defined at P=0. It complements the conditional N/P range.
        derived["pn_mass"] = Interval(iv["p"].lo / derived["tn"].hi,
                                      iv["p"].hi / derived["tn"].lo,
                                      iv["p"].lo_open or (iv["p"].lo != 0 and derived["tn"].hi_open),
                                      iv["p"].hi_open or derived["tn"].lo_open)
        derived["nox_fraction"] = nox_fraction(iv["nox"], iv["tkn"])
        if "ammonia" in iv:
            derived["organic_n_raw"] = minus(iv["tkn"], iv["ammonia"])
        a = {"activity_id": activity, "station_id": first["MonitoringLocationIdentifier"],
             "station": first["MonitoringLocationIdentifier"].split("-", 1)[1],
             "date": first["ActivityStartDate"], "time": first["ActivityStartTime/Time"],
             "timezone": first["ActivityStartTime/TimeZoneCode"], "project": first["ProjectIdentifier"],
             "depth": first["ActivityDepthHeightMeasure/MeasureValue"],
             "depth_unit": first["ActivityDepthHeightMeasure/MeasureUnitCode"],
             "year": first["ActivityStartDate"][:4], "season": _season(first["ActivityStartDate"]),
             "fraction": "Unfiltered", "zero_p_ratio_undefined": iv["p"].lo == 0,
             "source_ids": {k: r["source_id"] for k, r in original.items()},
             "values": {k: v.as_dict() for k, v in derived.items()},
             "agency_n_separate": "agency_n" in iv,
             "organic_n_status": "not_sampled" if "ammonia" not in iv else (
                 "incompatible_negative_range" if derived["organic_n_raw"].hi < 0 else
                 "negative_values_in_raw_difference" if derived["organic_n_raw"].lo < 0 else "nonnegative_difference")}
        activities.append(a)
        internals[activity] = derived
    activities.sort(key=lambda a: (a["date"], a["station"], a["time"], a["activity_id"]))
    metrics = ("tn", "p", "np_mass", "np_molar", "pn_mass", "nox_fraction")
    cohorts = []
    for group_by in ("station", "station_year", "station_season"):
        groups = defaultdict(list)
        for a in activities:
            key = a["station"] + (" / " + a[group_by.split("_")[1]] if "_" in group_by else "")
            groups[key].append(a)
        for name, aa in sorted(groups.items()):
            for metric in metrics:
                vv = [internals[a["activity_id"]][metric] for a in aa]
                cohorts.append({"group_by": group_by, "group": name, "metric": metric,
                                "n": len(aa), "activity_ids": [a["activity_id"] for a in aa],
                                "dates": sorted({a["date"] for a in aa}),
                                "unbounded_upper": sum(v.hi is None for v in vv),
                                "censored": sum(v.lo != v.hi for v in vv),
                                "statistics": {s: summary_interval(vv, s).as_dict() for s in ("mean", "q25", "median", "q75")}})
    pairs, pair_groups = [], defaultdict(list)
    bydate = defaultdict(list)
    for a in activities:
        bydate[a["date"]].append(a)
    for date, aa in sorted(bydate.items()):
        for a, b in itertools.combinations(sorted(aa, key=lambda x: (x["station"], x["activity_id"])), 2):
            if a["station"] == b["station"]:
                continue
            va, vb = internals[a["activity_id"]], internals[b["activity_id"]]
            deltas = {metric: minus(vb[metric], va[metric]) for metric in ("tn", "tkn", "nox", "p", "np_mass", "np_molar", "pn_mass", "nox_fraction")}
            for metric, delta in deltas.items():
                secs = lambda t: sum(int(v) * m for v, m in zip(t.split(":"), (3600, 60, 1)))
                clock = (secs(b["time"]) - secs(a["time"])) / 60 if a["timezone"] == b["timezone"] else None
                p = {"pair_id": a["activity_id"] + "|" + b["activity_id"], "station_a": a["station"], "station_b": b["station"],
                     "activity_a": a["activity_id"], "activity_b": b["activity_id"], "date": date, "year": date[:4], "season": _season(date),
                     "time_a": a["time"], "time_b": b["time"], "timezone_a": a["timezone"], "timezone_b": b["timezone"],
                     "clock_difference_minutes_b_minus_a": clock, "metric": metric,
                     "ratio_positive_p_condition": metric in ("np_mass", "np_molar") and (a["zero_p_ratio_undefined"] or b["zero_p_ratio_undefined"]),
                     "a": va[metric].as_dict(), "b": vb[metric].as_dict(), "b_minus_a": delta.as_dict(), "direction": direction(delta)}
                pairs.append(p)
                pair_groups[(a["station"], b["station"], metric)].append(p)
    pair_summaries = []
    for (a, b, metric), pp in sorted(pair_groups.items()):
        def summarise(sub):
            return {"n": len(sub), "counts": dict(Counter(p["direction"] for p in sub)), "conditional_positive_p": sum(p["ratio_positive_p_condition"] for p in sub), "dates": [p["date"] for p in sub]}
        byyear, byseason = defaultdict(list), defaultdict(list)
        for p in pp:
            byyear[p["year"]].append(p); byseason[p["season"]].append(p)
        pair_summaries.append({"station_a": a, "station_b": b, "metric": metric, **summarise(pp),
                               "by_year": {k: summarise(v) for k, v in sorted(byyear.items())},
                               "by_season": {k: summarise(v) for k, v in sorted(byseason.items())}})
    organic_status = dict(Counter(a["organic_n_status"] for a in activities))
    return {"schema": "upstate.nutrient-composition/v1", "edition": EDITION,
            "source_inputs": [x for x, _ in captures], "molar_factor": str(MOLAR_FACTOR),
            "coverage": {"source_records": len(rows), "activities": len(activities), "dates": len(bydate),
                         "stations": len({a["station"] for a in activities}),
                         "censored_source_records": sum(r["interval"]["lower"] != r["interval"]["upper"] for r in rows),
                         "tn_censored": sum(a["values"]["tn"]["lower"] != a["values"]["tn"]["upper"] for a in activities),
                         "p_censored": sum(a["zero_p_ratio_undefined"] for a in activities),
                         "mass_ratio_exact": sum(a["values"]["np_mass"]["lower"] == a["values"]["np_mass"]["upper"] for a in activities),
                         "matched_date_pairs": len(pairs) // 8, "pair_comparisons": len(pairs),
                         "organic_n_status": organic_status},
            "activities": activities, "cohorts": cohorts, "pairs": pairs, "pair_summaries": pair_summaries,
            "source_records": rows}
