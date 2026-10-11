#!/usr/bin/env python3
"""Run the authored Tenderly Python customer against the matching SF88 release."""
from pathlib import Path
import os
import sys

# These are the original adjacent packages in the complete product distribution.
_PILOT = Path(__file__).resolve().parents[1]
_ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(_ROOT / "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"))
sys.path.insert(0, str(_PILOT / "customer/python"))
os.environ.setdefault("STELLAR_FORGE_CHECKOUT", str(_ROOT))

from stellar_forge_tenderly.__main__ import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
