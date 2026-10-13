"""Launch the original Upper Savannah operator with the source-refresh extension.

All original server flags, workspaces, task persistence and native methods remain
owned by server.py. This entry installs the extension before the original main.
"""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import server
from source_refresh_native import install

install(vars(server))

if __name__ == '__main__':
    server.main()
