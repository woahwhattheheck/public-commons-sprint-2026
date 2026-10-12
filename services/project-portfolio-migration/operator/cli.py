"""Operate and receive the original portfolio migration workspace."""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from portfolio_target.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
