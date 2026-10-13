"""Adjacent observed land-cover accounts from one complete original ledger.

Pure standard-library projection: no raster imports, new masks, sampling,
interpolation, scientific execution or mutation of the supplied ledger.
Canonical classes/groups match model.landcover_ledger at 8e5cb23856eb6f141184c367954177e5722ec8ed.
"""
from __future__ import annotations
from copy import deepcopy
import math
import re

SCHEMA = "upstate.landcover-change-accounts/v1"
REL_TOL = 3e-10
ABS_TOL_HA = 1e-8
CLASSES = {
    11: "Open water", 12: "Perennial ice/snow", 21: "Developed, open space",
    22: "Developed, low intensity", 23: "Developed, medium intensity",
    24: "Developed, high intensity", 31: "Barren land", 41: "Deciduous forest",
    42: "Evergreen forest", 43: "Mixed forest", 51: "Dwarf scrub",
    52: "Shrub/scrub", 71: "Grassland/herbaceous", 72: "Sedge/herbaceous",
    73: "Lichens", 74: "Moss", 81: "Pasture/hay", 82: "Cultivated crops",
    90: "Woody wetlands", 95: "Emergent herbaceous wetlands",
}
GROUPS = {
    "developed": (21, 22, 23, 24), "forest": (41, 42, 43),
    "wetland": (90, 95), "cultivated_crop": (82,), "pasture_hay": (81,),
    "water": (11,), "shrub": (51, 52), "herbaceous": (71, 72, 73, 74),
}
MEASURES = ("opening_ha", "retained_ha", "gained_ha", "lost_ha", "closing_ha", "net_ha")
DEFINITIONS = {
    "unit": "hectare",
    "support": "Identical valid supported pixels across every selected observation, using the original fractional polygon/pixel weights.",
    "opening_ha": "Area in the class or group at the earlier selected observation.",
    "retained_ha": "Area in the class or group at both adjacent selected observations. Within-group class exchanges remain retained in that group.",
    "gained_ha": "Area entering the class or group from outside it between the selected endpoints.",
    "lost_ha": "Area leaving the class or group to outside it between the selected endpoints.",
    "closing_ha": "Area in the class or group at the later selected observation.",
    "net_ha": "Closing minus opening; equivalently gained minus lost. Negative values represent net loss.",
    "conservation": "Opening = retained + lost; closing = retained + gained; net = closing - opening = gained - lost. Annual stocks equal transition row/column totals.",
    "interval": "Adjacent selected observations; gap_years is their calendar-label difference. No intervening year, event date, annualized rate or continuous persistence is inferred.",
    "group_scope": "These are adjacent-interval crossings. They differ from the original whole-history ever-entered/ever-exited groups; returns can cross in both directions in different intervals.",
    "groups": "Canonical original groups are not an exhaustive partition of NLCD classes. Forest is 41/42/43; woody wetland 90 remains wetland. Developed open space is a class, not measured impervious cover.",
    "geography": "Each original zone is retained. The __domain__ row is the unique polygon union; overlapping zones must not be summed for study-wide area.",
    "unavailable": "With zero all-observation analysis area, all six account measures are null and available is false. This is unavailable comparison, not evidence of zero change.",
    "interpretation": "Mapped category differences can include classification disagreement and source revision. Accounts do not establish ground-truth change, causation, hydrologic effects or benefit.",
}


class AccountsError(ValueError):
    """Original stocks, transitions or source binding cannot support these accounts."""


def _fail(message):
    raise AccountsError(message)


def _area(value, label):
    if type(value) not in (int, float):
        _fail(label + " must be a finite nonnegative hectare quantity")
    try:
        result = float(value)
    except (OverflowError, ValueError):
        _fail(label + " must be finite")
    if not math.isfinite(result) or result < 0:
        _fail(label + " must be a finite nonnegative hectare quantity")
    return result


def _sum(values, label):
    try:
        result = math.fsum(values)
    except (OverflowError, ValueError):
        _fail(label + " does not have a finite total")
    if not math.isfinite(result):
        _fail(label + " does not have a finite total")
    return result


def _same(actual, expected, label, scale=0.0):
    tolerance = max(ABS_TOL_HA, REL_TOL * scale)
    if not math.isclose(actual, expected, rel_tol=REL_TOL, abs_tol=tolerance):
        _fail(label + ": original area conservation differs")


def _records(items, key, label):
    if not isinstance(items, list):
        _fail(label + " must retain its original list")
    result = {}
    for row in items:
        if not isinstance(row, dict) or not isinstance(row.get(key), str) or not row[key]:
            _fail(label + " contains an invalid original identifier")
        if row[key] in result:
            _fail(label + " repeats an original identifier")
        result[row[key]] = row
    return result


def _stock(observed, year, codes, label):
    if not isinstance(observed, dict) or type(observed.get("year")) is not int or observed.get("year") != year:
        _fail(label + " changed the selected observation order")
    rows = observed.get("classes")
    if not isinstance(rows, list):
        _fail(label + " is missing original class stocks")
    stock = {}
    for row in rows:
        if (not isinstance(row, dict) or type(row.get("code")) is not int
                or row["code"] not in codes or row["code"] in stock):
            _fail(label + " contains an unknown or repeated class")
        stock[row["code"]] = _area(row.get("ha"), label + " class " + str(row["code"]))
    if set(stock) != set(codes):
        _fail(label + " must retain every original class, including zero stocks")
    return stock


def _matrix(interval, first, second, codes, label):
    if (not isinstance(interval, dict) or type(interval.get("from_year")) is not int
            or type(interval.get("to_year")) is not int or interval.get("from_year") != first
            or interval.get("to_year") != second):
        _fail(label + " changed its adjacent selected years")
    rows = interval.get("transitions")
    if not isinstance(rows, list):
        _fail(label + " is missing original transitions")
    matrix = {}
    for row in rows:
        if (not isinstance(row, dict) or type(row.get("from_code")) is not int
                or type(row.get("to_code")) is not int
                or row["from_code"] not in codes or row["to_code"] not in codes):
            _fail(label + " contains an unknown transition class")
        pair = row["from_code"], row["to_code"]
        if pair in matrix:
            _fail(label + " repeats an original transition")
        matrix[pair] = _area(row.get("ha"), label + " transition " + str(pair))
    return matrix


def _account(members, opening, closing, matrix, available, label):
    selected = set(members)
    before = _sum((opening[c] for c in members), label + " opening")
    after = _sum((closing[c] for c in members), label + " closing")
    retained = _sum((v for (a, b), v in matrix.items() if a in selected and b in selected), label + " retained")
    gained = _sum((v for (a, b), v in matrix.items() if a not in selected and b in selected), label + " gains")
    lost = _sum((v for (a, b), v in matrix.items() if a in selected and b not in selected), label + " losses")
    _same(before, _sum([retained, lost], label), label + " opening balance")
    _same(after, _sum([retained, gained], label), label + " closing balance")
    net = after - before
    _same(net, gained - lost, label + " net balance", max(before, after, gained, lost))
    if not available:
        return dict.fromkeys(MEASURES, None)
    return dict(zip(MEASURES, (before, retained, gained, lost, after, net)))


def derive_accounts(report):
    """Return accounts bound to the exact supplied original timeline.

    Raises AccountsError for malformed or nonconserving original data. No
    incomplete result is returned; neither the ledger nor its nested values are
    modified. The caller preserves ledger.json and writes a distinct report copy.
    """
    if (not isinstance(report, dict) or report.get("schema") != "upstate.landcover-ledger/1"
            or report.get("complete") is not True
            or not isinstance(report.get("signature"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", report["signature"])
            or not isinstance(report.get("options"), dict)
            or report["options"].get("support_scope") != "all"):
        _fail("Choose the complete original all-observation land-cover ledger")
    labels = report.get("classes")
    if labels != {str(code): name for code, name in CLASSES.items()}:
        _fail("Original NLCD class definitions differ from the supported ledger")
    timeline = report.get("timeline")
    if not isinstance(timeline, dict) or timeline.get("schema") != "upstate.landcover-timeline/v1":
        _fail("The original observed timeline is unavailable")
    years = timeline.get("years")
    if (not isinstance(years, list) or len(years) < 2
            or any(type(y) is not int or not 1 <= y <= 9999 for y in years)
            or any(a >= b for a, b in zip(years, years[1:]))):
        _fail("Retain the explicit increasing selected observation years")
    intervals = [{"from_year": a, "to_year": b, "gap_years": b - a} for a, b in zip(years, years[1:])]
    if timeline.get("intervals") != intervals:
        _fail("Original selected interval metadata differs")
    scenarios = report.get("scenarios")
    if (not isinstance(scenarios, list) or len(scenarios) != len(years) - 1
            or any(not isinstance(x, str) or not x for x in scenarios)
            or len(set(scenarios)) != len(scenarios)):
        _fail("Original alternative inventory differs from the observed chronology")
    zones = _records(report.get("zones"), "id", "Original zones")
    if not zones or "__domain__" not in zones:
        _fail("Retain all original reporting zones and the unique study-area union")
    timeline_rows = _records(timeline.get("rows"), "zone_id", "Timeline zones")
    if set(timeline_rows) != set(zones):
        _fail("Timeline reporting zones differ from the original ledger")
    supports = {}
    if not isinstance(report.get("rows"), list):
        _fail("Original ledger support rows are absent")
    for row in report["rows"]:
        if not isinstance(row, dict):
            _fail("Original ledger support row is invalid")
        pair = row.get("zone_id"), row.get("scenario")
        if (not isinstance(pair[0], str) or not isinstance(pair[1], str)
                or pair[0] not in zones or pair[1] not in scenarios or pair in supports):
            _fail("Original ledger support inventory differs")
        supports[pair] = row
    if len(supports) != len(zones) * len(scenarios):
        _fail("Original ledger omits a reporting zone or alternative")
    output = []
    for zone_id, zone in zones.items():
        row = timeline_rows[zone_id]
        if not isinstance(zone.get("name"), str) or row.get("zone_name") != zone["name"]:
            _fail("Original zone label differs")
        label = "Zone " + zone_id
        analysis = _area(row.get("analysis_ha"), label + " common support")
        covered = _area(row.get("covered_ha"), label + " covered area")
        if analysis > covered and not math.isclose(analysis, covered, rel_tol=REL_TOL, abs_tol=ABS_TOL_HA):
            _fail(label + " common support exceeds its covered area")
        coverage = analysis / covered * 100 if covered else None
        if coverage is None:
            if row.get("coverage_pct") is not None:
                _fail(label + " coverage should be unavailable")
        else:
            _same(_area(row.get("coverage_pct"), label + " coverage percent"), coverage, label + " coverage percent")
        for scenario in scenarios:
            original = supports[(zone_id, scenario)]
            if original.get("zone_name") != zone["name"] or not isinstance(original.get("support"), dict):
                _fail(label + " original support binding differs")
            _same(_area(original["support"].get("analysis_valid_ha"), label), analysis, label + " all-observation support")
            _same(_area(original["support"].get("covered_ha"), label), covered, label + " original covered area")
        annual = row.get("annual")
        adjacent = row.get("adjacent")
        if not isinstance(annual, list) or len(annual) != len(years) or not isinstance(adjacent, list) or len(adjacent) != len(intervals):
            _fail(label + " must retain every annual stock and adjacent transition")
        stocks = [_stock(value, year, CLASSES, label + "/" + str(year)) for year, value in zip(years, annual)]
        for year, stock in zip(years, stocks):
            _same(_sum(stock.values(), label), analysis, label + "/" + str(year) + " annual total")
            if analysis == 0 and any(stock.values()):
                _fail(label + " zero-support annual stocks must be zero")
        available = analysis > 0
        result_intervals = []
        for i, interval in enumerate(intervals):
            tag = label + "/" + str(interval["from_year"]) + "-" + str(interval["to_year"])
            matrix = _matrix(adjacent[i], interval["from_year"], interval["to_year"], CLASSES, tag)
            _same(_sum(matrix.values(), tag), analysis, tag + " transition total")
            if analysis == 0 and any(matrix.values()):
                _fail(tag + " zero-support transitions must be zero")
            for code in CLASSES:
                _same(_sum((v for (a, b), v in matrix.items() if a == code), tag), stocks[i][code], tag + " opening class " + str(code))
                _same(_sum((v for (a, b), v in matrix.items() if b == code), tag), stocks[i + 1][code], tag + " closing class " + str(code))
            classes = [{"code": code, "name": labels[str(code)], **_account(
                (code,), stocks[i], stocks[i + 1], matrix, available, tag + "/" + str(code))} for code in CLASSES]
            groups = [{"name": name, "codes": list(codes), **_account(
                codes, stocks[i], stocks[i + 1], matrix, available, tag + "/" + name)} for name, codes in GROUPS.items()]
            result_intervals.append({**interval, "classes": classes, "groups": groups})
        output.append({
            "zone_id": zone_id, "zone_name": zone["name"], "analysis_ha": analysis,
            "covered_ha": covered, "coverage_pct": coverage, "available": available,
            "unavailable_reason": None if available else "No common supported area across all selected observations.",
            "intervals": result_intervals,
        })
    return {
        "schema": SCHEMA, "ledger_signature": report["signature"], "years": list(years),
        "definitions": deepcopy(DEFINITIONS), "zones": deepcopy(report["zones"]),
        "validation": {"relative_tolerance": REL_TOL, "absolute_tolerance_ha": ABS_TOL_HA,
                       "basis": "Annual class stocks, every adjacent transition row/column, and every original all-observation support row."},
        "rows": output,
    }
