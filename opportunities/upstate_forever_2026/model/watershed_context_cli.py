#!/usr/bin/env python3
"""Export retained Upper Savannah watershed context and selected watersheds."""
from __future__ import annotations

from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"

from .watershed_context import main

if __name__ == "__main__":
    raise SystemExit(main())
