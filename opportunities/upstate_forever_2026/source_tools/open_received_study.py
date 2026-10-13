#!/usr/bin/env python3
"""Open or reopen the existing received study with its original operator."""
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
from source_tools.workbench_session import main

if __name__ == "__main__":
    raise SystemExit(main(APPLICATION))
