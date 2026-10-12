"""MIT. Utility receiving on the original retained NDJSON/XML workspace."""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
NDJSON = HERE.parent / "ndjson"
sys.path.insert(0, str(NDJSON))
try:
    from application import Workspace as SourceWorkspace, RetainedHandler, RetainedServer
    from application import InputError, json_bytes, load_json, private_write, file_digest, sync_dir
    import ndjson_source as source_json
    import xml_source as source_xml
finally:
    sys.path.remove(str(NDJSON))
