"""MIT. Original SF30 workspace, exact FHIR JSON and credential/HTTP helpers."""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
SDK = HERE.parent
BULK = SDK / "fhir_bulk"
if str(BULK) not in sys.path:
    sys.path.insert(0, str(BULK))
from fhir_runtime import original_workspace, original_server, InputError, MAX_SOURCE
import fhir_source as fhir
from fhir_acquisition import (
    Credentials, Transport, ConflictError, ProviderError, atomic_json,
    private_directory, safe_read, now, later, retry_time, decoded_body, write_zip
)
