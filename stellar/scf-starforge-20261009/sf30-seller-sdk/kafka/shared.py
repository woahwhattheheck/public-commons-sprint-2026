"""MIT. Kafka adapter imports the original retained NDJSON implementation."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
NDJSON = SOURCE / "ndjson"
_NAME = "_stellar_forge_kafka_original_ndjson_application"
if _NAME not in sys.modules:
    specification = importlib.util.spec_from_file_location(_NAME, NDJSON / "application.py")
    module = importlib.util.module_from_spec(specification)
    sys.modules[_NAME] = module
    sys.path.insert(0, str(NDJSON))
    try:
        specification.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(_NAME, None)
        raise
    finally:
        sys.path.remove(str(NDJSON))
original = sys.modules[_NAME]
RetainedWorkspace = original.Workspace
RetainedHandler = original.Handler
RetainedServer = original.RetainedServer
InputError = original.InputError
json_bytes = original.json_bytes
load_json = original.load_json
private_write = original.private_write
file_digest = original.file_digest
sync_dir = original.sync_dir
ndjson_source = original.ndjson_source
