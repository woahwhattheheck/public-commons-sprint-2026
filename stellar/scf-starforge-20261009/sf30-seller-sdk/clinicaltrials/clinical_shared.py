"""MIT. Reuse the installed NDJSON/XML source workspace and native dataset engine."""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
NDJSON = HERE.parent / "ndjson"
sys.path.insert(0, str(NDJSON))
try:
    from application import Workspace as SourceWorkspace, Handler as RetainedHandler, RetainedServer
    from application import InputError, json_bytes, load_json, private_write, file_digest, sync_dir
    import ndjson_source as source_json
finally:
    sys.path.remove(str(NDJSON))
