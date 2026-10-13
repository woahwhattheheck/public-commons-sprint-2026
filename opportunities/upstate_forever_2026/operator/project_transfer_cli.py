"""Compatibility entry point for complete-project continuity.

The maintained command is project_continuity_cli.py. The original incremental
protocol CLI remains available as python -m model.project_transfer_cli.
"""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from project_continuity_cli import (ContinuityOperator, execute, main, parser)

TransferOperator = ContinuityOperator

if __name__ == "__main__":
    raise SystemExit(main())
