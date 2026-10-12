# SPDX-License-Identifier: MIT
"""Source-checkout namespace for the canonical stac/postgis/qgis adapter."""
from pathlib import Path
__path__ = [str(Path(__file__).resolve().parents[3] / "postgis" / "qgis")]
from .package import software_files
