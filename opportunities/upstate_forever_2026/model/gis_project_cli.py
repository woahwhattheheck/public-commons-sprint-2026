"""Run from the original product, or from the complete GIS package's tools directory."""
from __future__ import annotations
import argparse
import json
import subprocess
from pathlib import Path
import sys
import zipfile

# These tools are inventoried original package members. Importing them must not
# add __pycache__ files to the sender before verify, receive, open or seal runs.
sys.dont_write_bytecode = True

if __package__:
    from . import gis_project as gis
else:
    # Keep portable_fs -> windows_fs relative imports in their real package.
    sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
    from model import gis_project as gis


def main(argv=None):
    parser=argparse.ArgumentParser(description="Create, receive and continue complete editable GIS projects")
    sub=parser.add_subparsers(dest="command",required=True)
    b=sub.add_parser("build",help="Build from an explicit retained-file GIS request")
    b.add_argument("request");b.add_argument("destination");b.add_argument("--source-root")
    p=sub.add_parser("pack");p.add_argument("directory");p.add_argument("archive")
    r=sub.add_parser("receive");r.add_argument("archive");r.add_argument("destination")
    v=sub.add_parser("verify");v.add_argument("directory");v.add_argument("--hashes-only",action="store_true")
    s=sub.add_parser("seal",help="Retain an intentional recipient edit as a new edition")
    s.add_argument("directory");s.add_argument("--reason",required=True);s.add_argument("--project-file",choices=["project.qgs","project.qgz"])
    e=sub.add_parser("workspace-export",help="Use the original scientific Workspace API")
    e.add_argument("workspace");e.add_argument("selection")
    c=sub.add_parser("workspace-catalogue");c.add_argument("workspace")
    wr=sub.add_parser("workspace-receive",help="Receive a complete GIS edition into the original scientific Workspace")
    wr.add_argument("workspace");wr.add_argument("archive")
    wa=sub.add_parser("workspace-adopt-sources",help="Append selected received working layers as an original source edition")
    wa.add_argument("workspace");wa.add_argument("selection")
    gr=sub.add_parser("workspace-review",help="Compare a received GIS edition with its retained original export")
    gr.add_argument("workspace");gr.add_argument("selection")
    nr=sub.add_parser("native-receive",help="Open/render/save/reopen using the installed QGIS Python")
    nr.add_argument("directory");nr.add_argument("output")
    nr.add_argument("--qgis-python",help="QGIS Python executable or Windows python-qgis*.bat")
    nr.add_argument("--qgis-prefix",help="Optional QGIS resource prefix")
    rt=sub.add_parser("qgis-runtime",help="Find the actual installed QGIS Python and version")
    rt.add_argument("--qgis-python",help="QGIS Python executable or Windows python-qgis*.bat")
    rt.add_argument("--qgis-prefix",help="Optional QGIS resource prefix")
    op=sub.add_parser("open",help="Open the complete editable project in QGIS Desktop")
    op.add_argument("directory")
    args=parser.parse_args(argv)
    def progress(value):
        print(json.dumps(value,ensure_ascii=False,allow_nan=False),file=sys.stderr,flush=True)
    try:
        if args.command in {"native-receive", "open", "qgis-runtime"}:
            if __package__:
                from . import gis_project_native as native
            else:
                from model import gis_project_native as native
            if args.command=="open":
                result=native.open_project(args.directory)
            elif args.command=="qgis-runtime":
                runtime=native.select_runtime(args.qgis_python,args.qgis_prefix)
                result={key:runtime[key] for key in ("executable","version")}
            else:
                result=native.receive(args.directory,args.output,python=args.qgis_python,prefix=args.qgis_prefix)
        elif args.command=="build":
            path=Path(args.request).resolve(strict=True)
            result=gis.build(gis.load(path),args.source_root or path.parent,args.destination,progress=progress)
        elif args.command=="pack":
            result=gis.pack(args.directory,args.archive)
        elif args.command=="receive":
            result=gis.receive(args.archive,args.destination)
        elif args.command=="verify":
            result=gis.verify(args.directory,native=not args.hashes_only)
        elif args.command=="seal":
            result=gis.seal(args.directory,args.reason,project_file=args.project_file)
        else:
            sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
            from model.workspace import Workspace
            from model.gis_workspace import export,catalogue,receive,adopt_sources
            ws=Workspace(args.workspace)
            if args.command=="workspace-review":
                from model.gis_edition_review import review
                result=review(ws,gis.load(Path(args.selection)),progress=progress)
            elif args.command=="workspace-export":result=export(ws,gis.load(Path(args.selection)),progress=progress)
            elif args.command=="workspace-receive":result=receive(ws,args.archive)
            elif args.command=="workspace-adopt-sources":result=adopt_sources(ws,gis.load(Path(args.selection)))
            else:result=catalogue(ws)
        print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))
        return 0
    except (ValueError,OSError,RuntimeError,KeyError,TypeError,ImportError,zipfile.BadZipFile,subprocess.SubprocessError) as exc:
        print(json.dumps({"error":{"type":type(exc).__name__,"message":str(exc)}},ensure_ascii=False),file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("GIS operation interrupted.",file=sys.stderr)
        return 130

if __name__=="__main__":
    raise SystemExit(main())
