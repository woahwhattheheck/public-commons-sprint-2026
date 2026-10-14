#!/usr/bin/env python3
"""Open one complete received project with the maintained Windows lifecycle."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[1]
REQUIRED = (
    "operator/server.py",
    "model/windows_fs.py",
    "source_tools/open_received_study.py",
    "source_tools/workbench_session.py",
    "operator/web/startup_guide.mjs",
    "operator/web/startup_guide.css",
)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-directory", required=True)
    parser.add_argument("--profile", type=Path,
                        help="Existing original launch profile; defaults to workbench.json")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--adopt-session", type=Path,
                        help="Original private startup JSON for adopting an already running operator")
    args = parser.parse_args(argv)
    if os.name != "nt":
        parser.error("Use Open_Workbench.sh with the supplied runtime on Linux.")
    if sys.version_info[:2] != (3, 12):
        parser.error("Select the receiving machine's installed Python 3.12 through ECOSYSTEMS_PYTHON.")
    os.environ.pop("PYTHONHOME", None)
    os.environ.pop("PYTHONPATH", None)
    try:
        project = Path(args.project_directory).expanduser().resolve(strict=True)
        if not project.is_dir():
            raise ValueError("Select this received project's opening directory.")
        for relative in REQUIRED:
            member = APPLICATION / relative
            if member.is_symlink() or not member.is_file():
                raise ValueError("Receive the complete maintained application member: " + relative)
        sys.path.insert(0, str(APPLICATION))
        from source_tools import workbench_session as session
        profile = (args.profile.expanduser().absolute() if args.profile
                   else project / "workbench.json")
        has_profile = profile.exists() or profile.is_symlink()
        selected = None
        if has_profile:
            if profile.is_symlink() or not profile.is_file():
                raise ValueError("The existing workbench launch profile must be a regular file.")
            selected = session._json(profile)
            base = profile.parent.resolve(strict=True)
            application = session._path(selected.get("application") or str(APPLICATION), base)
            workspace = session._path(selected.get("workspace")
                                      or str(application.parent / "workspace"), base)
            if application != APPLICATION:
                raise ValueError("The original profile selects another application; use its original opening route.")
        else:
            if args.profile:
                raise ValueError("The explicitly selected original profile does not exist.")
            application = project / "application"
            workspace = project / "workspace"
            if (application.is_symlink() or workspace.is_symlink()
                    or application.resolve(strict=True) != APPLICATION
                    or not workspace.is_dir()):
                raise ValueError("Keep application and workspace beside this shortcut, or select the actual existing --profile.")
        if not workspace.is_dir():
            raise ValueError("The original selected Workspace directory is missing.")
        identity_file = workspace / "workspace.json"
        if identity_file.is_symlink() or not identity_file.is_file():
            raise ValueError("Receive the original workspace/workspace.json with this application.")
        identity = session._json(identity_file)
        if (identity.get("schema") != "upstate.scientific-workbench/v1"
                or not isinstance(identity.get("id"), str) or not identity["id"]):
            raise ValueError("Select the original scientific Workspace.")
        options = ["--plain", "--python", sys.executable]
        if has_profile:
            options += ["--profile", str(profile)]
            state = selected.get("operator_state")
            if state is not None:
                if not isinstance(state, str) or not state or "\0" in state:
                    raise ValueError("The original profile's operator_state must be a valid path.")
                state_path = Path(state).expanduser()
                if not state_path.is_absolute():
                    state_path = base / state_path
                options += ["--operator-state", str(state_path)]
        else:
            options += ["--application", str(application), "--workspace", str(workspace)]
            if not args.status:
                options += ["--save-profile", str(profile)]
        if args.no_browser:
            options.append("--no-browser")
        if args.status:
            options.append("--status")
        if args.adopt_session:
            options += ["--adopt-session", str(args.adopt_session.expanduser().absolute())]
        if not args.status:
            print("Opening this Workspace in your Windows browser.", flush=True)
            print("Keep this window open. Press Ctrl+C here for a normal close.", flush=True)
        # The original helper owns authentication, session reuse, queue drain,
        # process creation and cold reopening. This entry adds no server.
        return session.main(application, options)
    except (OSError, ValueError, ImportError) as exc:
        print("Workbench could not open: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
