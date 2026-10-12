"""MIT. Shared original FHIR/eLTSS/Gravity runtime for directory operations."""
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parent
for parent in [HERE.parent/"fhir_eltss",HERE.parent/"fhir_referral"]:
    if str(parent) not in sys.path:
        sys.path.insert(0,str(parent))
from referral_workspace import Workspace as BaseWorkspace
from referral_runtime import (InputError,ConflictError,ProviderError,Transport,
    private_directory,atomic_json,safe_read,now,retry_time,fhir,original_workspace,
    original_server,MAX_SOURCE,Credentials,write_zip)
import eltss_source as source
