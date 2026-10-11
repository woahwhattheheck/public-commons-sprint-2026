"""Compare complete report outputs while retaining duplicate, null and numeric semantics."""
from __future__ import annotations

from collections import Counter, defaultdict
import csv
from decimal import Decimal, InvalidOperation
import io
import json


def read_csv(data):
    text = data.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)):
        raise ValueError("The CSV needs a unique, nonempty header for each field.")
    if any(not str(h).strip() for h in reader.fieldnames):
        raise ValueError("CSV headers cannot be empty.")
    rows = []
    for index, row in enumerate(reader, 2):
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f"CSV row {index} has a different field count.")
        rows.append(row)
    return reader.fieldnames, rows


def csv_bytes(headers, rows):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, headers, lineterminator="\n", extrasaction="raise")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def _number(text, field):
    try:
        value = Decimal(text)
    except (InvalidOperation, TypeError):
        raise ValueError(f"Field {field} contains a value that is not a decimal number.")
    if not value.is_finite():
        raise ValueError(f"Field {field} contains a nonfinite number.")
    return value


def compare_outputs(left_data, right_data, spec):
    left_headers, left_rows = read_csv(left_data)
    right_headers, right_rows = read_csv(right_data)
    fields = spec.get("fields") or [{"left": name, "right": name, "type": "text"} for name in left_headers]
    if not fields:
        raise ValueError("Select comparison fields.")
    names = [f["left"] for f in fields]
    if len(names) != len(set(names)):
        raise ValueError("A comparison field may be mapped only once.")
    for field in fields:
        if field["left"] not in left_headers or field["right"] not in right_headers:
            raise ValueError(f"Comparison field {field['left']} → {field['right']} is absent from an input.")
        if field.get("type", "text") not in {"text", "number", "date", "boolean"}:
            raise ValueError("Use text, number, date or boolean comparison types.")
        if field.get("type") == "number":
            for key in ("absolute", "relative"):
                if _number(str(field.get(key, "0")), key) < 0:
                    raise ValueError("Numeric tolerances cannot be negative.")
    keys = spec.get("keys", [])
    if not isinstance(keys, list) or len(keys) != len(set(keys)) or any(k not in names for k in keys):
        raise ValueError("Comparison keys must be distinct mapped left-side field names.")
    null_token = spec.get("null_token", None)

    def normalize(value, field):
        if null_token is not None and value == null_token:
            return ("null", "")
        kind = field.get("type", "text")
        if kind == "number":
            return ("number", _number(value, field["left"]))
        if kind == "boolean":
            normalized = value.lower()
            if normalized not in {"true", "false", "1", "0"}:
                raise ValueError(f"Invalid boolean in {field['left']}.")
            return ("boolean", normalized in {"true", "1"})
        if kind == "date":
            from datetime import datetime
            try:
                return ("date", datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat())
            except ValueError:
                raise ValueError(f"Use ISO dates for {field['left']}.")
        return ("text", value.strip() if field.get("trim", False) else value)

    def prepared(rows, side):
        return [tuple(normalize(row[field[side]], field) for field in fields) for row in rows]

    left, right = prepared(left_rows, "left"), prepared(right_rows, "right")
    differences = []
    totals = {"missing_rows": 0, "extra_rows": 0, "different_cells": 0, "duplicate_keys": 0}
    numeric_totals = []

    def add(kind, detail):
        if len(differences) < 500:
            differences.append({"kind": kind, **detail})

    if not keys:
        if any(_number(str(f.get("absolute", 0)), "absolute") or _number(str(f.get("relative", 0)), "relative") for f in fields if f.get("type") == "number"):
            raise ValueError("Select unique row keys when using numeric tolerances.")
        lc, rc = Counter(left), Counter(right)
        for row, count in (lc - rc).items():
            totals["missing_rows"] += count
            add("missing", {"count": count, "values": [str(v[1]) if v[0] == "number" else v[1] for v in row]})
        for row, count in (rc - lc).items():
            totals["extra_rows"] += count
            add("extra", {"count": count, "values": [str(v[1]) if v[0] == "number" else v[1] for v in row]})
    else:
        positions = [names.index(k) for k in keys]
        groups = []
        for side, rows in (("left", left), ("right", right)):
            grouped = defaultdict(list)
            for row in rows:
                grouped[tuple(row[i] for i in positions)].append(row)
            for key, values in grouped.items():
                if len(values) > 1:
                    totals["duplicate_keys"] += 1
                    add("duplicate_key", {"side": side, "key": [str(v[1]) for v in key], "count": len(values)})
            groups.append(grouped)
        lg, rg = groups
        for key in lg.keys() | rg.keys():
            l, r = lg.get(key, []), rg.get(key, [])
            readable_key = [str(v[1]) for v in key]
            if not r:
                totals["missing_rows"] += len(l)
                add("missing", {"key": readable_key, "count": len(l)})
                continue
            if not l:
                totals["extra_rows"] += len(r)
                add("extra", {"key": readable_key, "count": len(r)})
                continue
            if len(l) != 1 or len(r) != 1:
                continue
            for index, field in enumerate(fields):
                a, b = l[0][index], r[0][index]
                matches = a == b
                if a[0] == b[0] == "number":
                    absolute = _number(str(field.get("absolute", 0)), "absolute")
                    relative = _number(str(field.get("relative", 0)), "relative")
                    matches = abs(a[1] - b[1]) <= max(absolute, abs(a[1]) * relative)
                if not matches:
                    totals["different_cells"] += 1
                    add("value", {"key": readable_key, "field": field["left"], "left": str(a[1]), "right": str(b[1])})
    for index, field in enumerate(fields):
        if field.get("type") == "number":
            lsum = sum((r[index][1] for r in left if r[index][0] == "number"), Decimal(0))
            rsum = sum((r[index][1] for r in right if r[index][0] == "number"), Decimal(0))
            numeric_totals.append({"field": field["left"], "left": str(lsum), "right": str(rsum), "delta": str(rsum - lsum)})
    return {"status": "PASS" if not any(totals.values()) else "DIFFERENT", "left_rows": len(left),
            "right_rows": len(right), "counts": totals, "differences": differences,
            "difference_sample_limit": 500, "numeric_totals": numeric_totals,
            "spec": spec, "all_rows_compared": True}
