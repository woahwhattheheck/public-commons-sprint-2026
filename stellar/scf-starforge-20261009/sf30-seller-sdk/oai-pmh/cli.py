"""MIT. Complete OAI operator workflow; all commands use one retained workspace."""
import argparse
import json
from pathlib import Path
import sys
from workspace import Workspace
from harvest import InputError, decode

def document(path):
    return decode(sys.stdin.buffer.read() if path=="-" else Path(path).read_bytes())

def main():
    p=argparse.ArgumentParser(description="Starforge repository metadata workspace")
    p.add_argument("--workspace",required=True,help="Private original XML/OAI workspace directory")
    sub=p.add_subparsers(dest="command",required=True)
    sub.add_parser("init");sub.add_parser("state")
    a=sub.add_parser("serve");a.add_argument("--port",type=int,default=0)
    a=sub.add_parser("repository");a.add_argument("--url",required=True);a.add_argument("--label");a.add_argument("--interval",type=float,default=2.1)
    a=sub.add_parser("start");a.add_argument("--repository",required=True);a.add_argument("--verb",required=True)
    a.add_argument("--arguments",required=True,help="JSON request arguments file, or - for stdin")
    a.add_argument("--id",required=True);a.add_argument("--baseline")
    for name in ("run","resume"):
        a=sub.add_parser(name);a.add_argument("--id",required=True)
    a=sub.add_parser("import-response");a.add_argument("--id",required=True);a.add_argument("--body",required=True)
    a.add_argument("--transport",required=True,help="JSON with observed url,status,headers,finalURL,observedAt")
    a=sub.add_parser("preview");a.add_argument("--id",required=True);a.add_argument("--choices")
    a=sub.add_parser("review");a.add_argument("--id",required=True);a.add_argument("--expected",required=True)
    a.add_argument("--reviewer",required=True);a.add_argument("--note",required=True)
    a=sub.add_parser("mapping");a.add_argument("--plan",required=True)
    sub.add_parser("default-mapping")
    a=sub.add_parser("build");a.add_argument("--edition",required=True);a.add_argument("--mapping",required=True)
    a=sub.add_parser("query");a.add_argument("--build",required=True);a.add_argument("--parameters",required=True)
    a=sub.add_parser("export-source");a.add_argument("--build",required=True);a.add_argument("--out",required=True)
    a=sub.add_parser("backup");a.add_argument("--out",required=True)
    a=sub.add_parser("restore");a.add_argument("--archive",required=True)
    for name in ("records","changes","requests"):
        a=sub.add_parser(name);a.add_argument("--id",required=True);a.add_argument("--offset",type=int,default=0)
        a.add_argument("--limit",type=int,default=100)
    args=p.parse_args()
    if args.command=="serve":
        from server import serve
        serve(args.workspace,args.port);return
    if args.command=="restore":
        result=Workspace.restore(args.archive,args.workspace)
    else:
        ws=Workspace(args.workspace,create=args.command=="init")
        try:
            c=args.command
            if c in {"init","state"}:result=ws.state()
            elif c=="repository":result=ws.add_repository(args.url,args.label,args.interval)
            elif c=="start":result=ws.start(args.repository,args.verb,document(args.arguments),args.id,args.baseline)
            elif c=="run":result=ws.run(args.id)
            elif c=="resume":result=ws.resume(args.id)
            elif c=="import-response":
                m=document(args.transport)
                result=ws.ingest(args.id,args.body,m["url"],m["status"],m.get("headers",[]),m.get("finalURL"),m.get("observedAt"))
            elif c=="preview":result=ws.preview(args.id,document(args.choices) if args.choices else None)
            elif c=="review":result=ws.review(args.id,args.expected,args.reviewer,args.note)
            elif c=="mapping":result=ws.save_mapping(document(args.plan))
            elif c=="default-mapping":result=ws.default_mapping()
            elif c=="build":result=ws.build(args.edition,args.mapping)
            elif c=="query":result=ws.query(args.build,document(args.parameters))
            elif c=="export-source":result=ws.export_source(args.build,args.out)
            elif c=="backup":result=ws.backup(args.out)
            elif c=="records":result=ws.records(args.id,args.offset,args.limit)
            elif c=="changes":result=ws.changes(args.id,offset=args.offset,limit=args.limit)
            elif c=="requests":result=ws.requests(args.id,args.offset,args.limit)
        finally:ws.close()
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=="__main__":
    try:main()
    except (InputError,OSError,ValueError,KeyError) as e:
        print(json.dumps({"error":str(e)}),file=sys.stderr);sys.exit(2)
