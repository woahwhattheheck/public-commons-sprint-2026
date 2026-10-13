#!/usr/bin/env python3
"""Compatibility command for the maintained original-resolution Gura receiver.

Both command names use receive_gura_native.main and the same retained operation,
native arguments, source-cell checks, progress files and Workspace locks.
"""
from __future__ import annotations

if __package__:
    from .receive_gura_native import main, parser
else:
    from receive_gura_native import main, parser

if __name__ == "__main__":
    raise SystemExit(main())
