"""Use the maintained SF36 statement API; this module has no ledger writes."""
from pathlib import Path
import sys

_NATIVE = Path(__file__).resolve().parent.parent
if str(_NATIVE) not in sys.path:
    sys.path.insert(0, str(_NATIVE))
from statement import read_snapshot, build_statement, COLUMNS, parse_labels, utc_day


def capture_ledger(path):
    resolved = Path(path).expanduser().resolve(strict=True)
    snapshot = read_snapshot(resolved)
    report = build_statement(snapshot)
    stat = resolved.stat()
    return {"path": str(resolved), "identity": {"device": str(stat.st_dev), "inode": str(stat.st_ino)},
            "snapshot": snapshot, "report": report}


def capture_source(path, kind="sf36_ledger", node=None):
    if kind == "sf36_ledger":
        return capture_ledger(path)
    if kind == "mcp_quote":
        from native_mcp import capture_mcp_quotes
        return capture_mcp_quotes(path, node=node)
    raise ValueError("Choose an original SF36 ledger or native MCP quote workspace")
