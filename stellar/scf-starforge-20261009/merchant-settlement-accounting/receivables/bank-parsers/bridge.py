"""Original OFX/MT940 modules behind a fixed private JSON pipe; no network operations."""
import base64
import importlib.util
import json
import sys
from pathlib import Path

def main():
    if sys.version_info < (3, 10):
        raise ValueError("BANK_PARSER_PYTHON_VERSION")
    request = json.loads(sys.stdin.buffer.read(2_000_001))
    kind = request["format"]
    if kind not in ("OFX", "MT940"):
        raise ValueError("BANK_PARSER_FORMAT")
    raw = base64.b64decode(request["sourceBase64"], validate=True)
    if not 0 < len(raw) <= 1_000_000:
        raise ValueError("BANK_PARSER_SOURCE_LIMIT")
    path = Path(__file__).with_name("ofx_intake.py" if kind == "OFX" else "mt940_engine.py")
    spec = importlib.util.spec_from_file_location("merchant_original_" + kind.lower(), path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    plan = request["plan"]
    key = plan["sources"][0]["file" if kind == "OFX" else "id"]
    report = module.compile_report(plan, {key: raw})
    metadata = {}
    if kind == "OFX":
        metadata["ofxOccurrenceSignatures"] = {
            item["ref"]: module.digest({key: value for key, value in item["row"].items() if key != "source_line"})
            for item in report["occurrences"] + report["pending_observations"]
        }
    sys.stdout.write(json.dumps({"ok": True, "report": report, "metadata": metadata}, ensure_ascii=True, allow_nan=False, separators=(",", ":")))

try:
    main()
except Exception as error:
    safe = {"code": getattr(error, "code", "BANK_PARSER_FAILED")}
    for name in ("location", "line"):
        value = getattr(error, name, None)
        if isinstance(value, (str, int)):
            safe[name] = value
    if isinstance(error, ValueError) and str(error) in ("BANK_PARSER_PYTHON_VERSION", "BANK_PARSER_FORMAT", "BANK_PARSER_SOURCE_LIMIT"):
        safe["code"] = str(error)
    sys.stdout.write(json.dumps({"ok": False, "error": safe}, separators=(",", ":")))
    sys.exit(1)
