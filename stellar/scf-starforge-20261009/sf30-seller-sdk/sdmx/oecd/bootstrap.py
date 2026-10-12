"""MIT. Bind the original SDMX and Macrobond implementation."""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
SDMX = HERE.parent
MACROBOND = SDMX / "macrobond"
for directory in (SDMX, MACROBOND):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

from catalog import Catalog, projected_number, series_identity
from sdmx_workspace import (
    InputError, identity, text, page, now, digest, json_bytes, load_json,
    private_write, regular, file_digest, sync_dir, qualified,
)

# Native SDMX imports add their XML source directory to sys.path. Restore this
# application's directory only after those unchanged imports have completed.
if str(HERE) in sys.path:
    sys.path.remove(str(HERE))
sys.path.insert(0, str(HERE))

