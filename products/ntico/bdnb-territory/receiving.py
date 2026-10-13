#!/usr/bin/env python3
"""Complete customer receiving entry for the maintained BDNB Analysis product."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parents[3] / "stellar" / "scf-starforge-20261009" /
                  "sf30-seller-sdk" / "datasette-analysis" / "bdnb_receiving.py"), run_name="__main__")
