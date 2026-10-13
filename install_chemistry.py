#!/usr/bin/env python3
"""Install reach chemistry into the maintained original operator."""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).resolve().parent / "operator" / "install_chemistry.py"),
                   run_name="__main__")
