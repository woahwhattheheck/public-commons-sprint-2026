"""Editable CSV round-trips for CircularValue cases (standard library only)."""
from __future__ import annotations

import argparse
import csv
import io
import os
from pathlib import Path
import re
import stat
import sys
from typing import Any

from .core import CircularValueError, canonical_json, compile_case, loads_strict

MAX_BYTES = 4 * 1024 * 1024
MAX_ROWS = 10_000
MAX_FIELD_BYTES = 64 * 1024
CASE_COLUMNS = (
    "schema", "caseId", "evaluatedOn", "currency", "horizonYears",
    "discountRateBps", "maxEvidenceAgeDays", "oneOffCostMinor",
    "annualRecurringCostMinor",
)
EVIDENCE_COLUMNS = ("id", "sourceType", "locator", "sha256", "observedOn", "note")
LEVER_COLUMNS = (
    "id", "label", "category", "confidence", "lowMinor", "centralMinor",
    "highMinor", "evidenceIds",
)
INTEGER_COLUMNS = frozenset(CASE_COLUMNS[4:] + LEVER_COLUMNS[4:7])
_INTEGER = re.compile(r"(?:0|-[1-9][0-9]*|[1-9][0-9]*)\Z", re.ASCII)


def _identity(info: os.stat_result) -> tuple[int, int]:
    return info.st_dev, info.st_ino


def read_text(path: Path) -> str:
    """Read a bounded, regular, non-symlink UTF-8 file without JSON coercion."""
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BYTES:
        raise CircularValueError("input must be a regular non-symlink file within 4 MiB")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags)
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or _identity(opened) != _identity(before):
            raise CircularValueError("input changed while opening")
        data = bytearray()
        while len(data) <= MAX_BYTES:
            chunk = os.read(fd, min(65536, MAX_BYTES + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        if len(data) > MAX_BYTES:
            raise CircularValueError("input exceeds 4 MiB")
        if (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (
            after.st_size, after.st_mtime_ns, after.st_ctime_ns
        ):
            raise CircularValueError("input changed during reading")
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise CircularValueError("input must be UTF-8") from exc
    finally:
        os.close(fd)


def read_object(path: Path) -> dict[str, Any]:
    """Read strict JSON; preserve the compiler's duplicate/float rejection."""
    value = loads_strict(read_text(path))
    if type(value) is not dict:
        raise CircularValueError("top-level JSON must be an object")
    return value


def write_new(path: Path, text: str) -> None:
    """Create an output without overwriting; remove our own partial file on error."""
    data = text.encode("utf-8")
    if len(data) > MAX_BYTES:
        raise CircularValueError("output exceeds 4 MiB")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise OSError("short write")
            view = view[written:]
    except BaseException:
        try:
            if _identity(path.lstat()) == _identity(os.fstat(fd)):
                path.unlink()
        except OSError:
            pass
        raise
    finally:
        os.close(fd)


def _needs_escape(value: str) -> bool:
    return value.startswith(("'", "\t", "\r", "\n")) or value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@"))


def _encode_cell(column: str, value: Any) -> str:
    if column == "evidenceIds":
        return canonical_json(value)
    if column in INTEGER_COLUMNS:
        return str(value)
    return "'" + value if _needs_escape(value) else value


def _decode_cell(column: str, value: str, where: str) -> Any:
    if column == "evidenceIds":
        refs = loads_strict(value)
        if type(refs) is not list or not all(type(ref) is str for ref in refs):
            raise CircularValueError(f"{where}: evidenceIds must be a JSON array of strings")
        return refs
    if column in INTEGER_COLUMNS:
        if len(value) > 17 or not _INTEGER.fullmatch(value):
            raise CircularValueError(f"{where}: {column} must be a plain ASCII integer, not a decimal or exponent")
        return int(value)
    if value.startswith("'") and _needs_escape(value[1:]):
        return value[1:]
    return value


def _table(columns: tuple[str, ...], rows: list[dict[str, Any]]) -> str:
    if len(rows) > MAX_ROWS:
        raise CircularValueError(f"table exceeds {MAX_ROWS} rows")
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        cells = [_encode_cell(column, row[column]) for column in columns]
        if any(len(cell.encode("utf-8")) > MAX_FIELD_BYTES for cell in cells):
            raise CircularValueError("CSV field exceeds 64 KiB")
        writer.writerow(cells)
    text = output.getvalue()
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise CircularValueError("table exceeds 4 MiB")
    return text


def export_tables(case: dict[str, Any]) -> dict[str, str]:
    """Validate and export three deterministic tables without changing the case."""
    compile_case(case)
    return {
        "case.csv": _table(CASE_COLUMNS, [case]),
        "evidence.csv": _table(EVIDENCE_COLUMNS, case["evidence"]),
        "levers.csv": _table(LEVER_COLUMNS, case["levers"]),
    }


def _parse_table(text: str, columns: tuple[str, ...], name: str) -> list[dict[str, Any]]:
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise CircularValueError(f"{name}: input exceeds 4 MiB")
    reader = csv.reader(io.StringIO(text.removeprefix("\ufeff"), newline=""), strict=True)
    try:
        header = next(reader, None)
        if header != list(columns):
            raise CircularValueError(f"{name}: expected exact header {','.join(columns)}")
        rows = []
        for row in reader:
            where = f"{name}: line {reader.line_num}"
            if len(row) != len(columns):
                raise CircularValueError(f"{where}: expected {len(columns)} cells, received {len(row)}")
            if any(len(cell.encode("utf-8")) > MAX_FIELD_BYTES for cell in row):
                raise CircularValueError(f"{where}: CSV field exceeds 64 KiB")
            if len(rows) >= MAX_ROWS:
                raise CircularValueError(f"{name}: exceeds {MAX_ROWS} rows")
            rows.append({column: _decode_cell(column, cell, where) for column, cell in zip(columns, row)})
        return rows
    except csv.Error as exc:
        raise CircularValueError(f"{name}: malformed CSV at line {reader.line_num}") from exc


def import_tables(case_csv: str, evidence_csv: str, levers_csv: str) -> dict[str, Any]:
    """Build a normal compiler-validated case; no inference or default values."""
    cases = _parse_table(case_csv, CASE_COLUMNS, "case.csv")
    if len(cases) != 1:
        raise CircularValueError("case.csv must contain exactly one case row")
    case = cases[0]
    case["evidence"] = _parse_table(evidence_csv, EVIDENCE_COLUMNS, "evidence.csv")
    case["levers"] = _parse_table(levers_csv, LEVER_COLUMNS, "levers.csv")
    compile_case(case)
    return case


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export", help="export a case into a NEW directory of editable CSV files")
    export.add_argument("case", type=Path)
    export.add_argument("--out-dir", type=Path, required=True)
    imp = commands.add_parser("import", help="compile tables into a NEW normal case JSON file")
    imp.add_argument("directory", type=Path)
    imp.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "export":
            tables = export_tables(read_object(args.case))
            args.out_dir.mkdir(mode=0o700)
            # A failed export is left visible for inspection. Never overwrite it.
            for filename, text in tables.items():
                write_new(args.out_dir / filename, text)
            print(f"EXPORTED {len(tables)} tables")
        else:
            case = import_tables(*(read_text(args.directory / name) for name in ("case.csv", "evidence.csv", "levers.csv")))
            write_new(args.out, canonical_json(case) + "\n")
            packet = compile_case(case)
            print(packet["decisionSupportState"], packet["sourceCaseSha256"])
        return 0
    except (OSError, CircularValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
