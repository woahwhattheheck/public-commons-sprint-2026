"""Build the original core and its complete reviewed application as wheel data."""
from pathlib import Path
from shutil import copy2
from setuptools import setup
from setuptools.command.build_py import build_py

class BuildApplication(build_py):
    def run(self):
        super().run()
        original = Path(__file__).resolve().parent
        target = Path(self.build_lib) / "groundwater_workspace" / "_application"
        # Explicit source roots exclude model workspaces, run files, credentials and VCS data.
        names = ("groundwater_workspace", "ui", "publisher", "examples", "tethys_app")
        roots = [original / name for name in names if (original / name).is_dir()]
        leaves = [path for path in original.iterdir() if path.is_file() and (path.name == "LICENSE" or path.suffix in (".py", ".mjs", ".md", ".toml", ".json", ".mts"))]
        for path in leaves + [path for root in roots for path in root.rglob("*") if path.is_file()]:
            relative = path.relative_to(original)
            if any(part in ("__pycache__", "_application", "node_modules", ".git", "build", "dist", ".venv") or part.endswith(".egg-info") for part in relative.parts):
                continue
            if path.suffix == ".pyc" or path.is_symlink():
                continue
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            copy2(path, destination)

setup(cmdclass={"build_py": BuildApplication})
