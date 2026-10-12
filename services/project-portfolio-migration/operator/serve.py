"""Start the original portfolio migration operator desk."""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from portfolio_target.server import main

if __name__ == "__main__":
    main()
