#!/usr/bin/env python3
"""Original source entry for the same installed groundwater CLI."""
import sys
sys.dont_write_bytecode = True
from groundwater_workspace.cli import entrypoint
if __name__ == "__main__":
    sys.exit(entrypoint())
