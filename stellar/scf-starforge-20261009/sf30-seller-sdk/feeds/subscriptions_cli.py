"""MIT. Complete subscription-library CLI on the original feed workspace."""
from pathlib import Path
from original import InputError, private_write, file_digest
from opml_source import MAX_OPML_BYTES

def add_arguments(sub):
    s = sub.add_parser("subscriptions", help="Retained OPML collections, acquisition, native editions and receiving")
    commands = s.add_subparsers(dest="subscription_command", required=True)
    commands.add_parser("state")
    p = commands.add_parser("import"); p.add_argument("--file",required=True); p.add_argument("--operation",required=True)
    p = commands.add_parser("plan"); p.add_argument("--source",required=True)
    p = commands.add_parser("save"); p.add_argument("--file",required=True,help="JSON collection-save action")
    p = commands.add_parser("show"); p.add_argument("--collection",required=True); p.add_argument("--revision",type=int)
    p = commands.add_parser("capture"); p.add_argument("--collection",required=True); p.add_argument("--revision",type=int,required=True)
    p.add_argument("--revisions",required=True,help="JSON mapping feed IDs to their displayed revisions")
    p.add_argument("--operation",required=True); p.add_argument("--pages",type=int,default=100); p.add_argument("--force",action="store_true")
    p = commands.add_parser("resume"); p.add_argument("--run",required=True)
    p = commands.add_parser("review"); p.add_argument("--run",required=True)
    p = commands.add_parser("edition"); p.add_argument("--run",required=True); p.add_argument("--name",required=True)
    p.add_argument("--fields",required=True); p.add_argument("--revisions",required=True); p.add_argument("--operation",required=True)
    p = commands.add_parser("opml"); p.add_argument("--collection",required=True); p.add_argument("--revision",type=int); p.add_argument("--out",required=True)
    p = commands.add_parser("original"); p.add_argument("--source",required=True); p.add_argument("--out",required=True)
    p = commands.add_parser("export"); p.add_argument("--binding",required=True); p.add_argument("--out",required=True)
    p = commands.add_parser("receive"); p.add_argument("--file",required=True); p.add_argument("--operation",required=True)

def run_command(ws, a, read_json, execute):
    model, c = ws.subscriptions, a.subscription_command
    if c == "state": return model.state()
    if c == "import":
        path=Path(a.file)
        if path.stat().st_size>MAX_OPML_BYTES: raise InputError("Original OPML exceeds 16 MiB")
        return model.import_opml(path.read_bytes(),a.operation)
    if c == "plan": return model.plan(a.source)
    if c == "save":
        action=read_json(a.file)
        if action.get("action")!="collection-save": raise InputError("Choose a collection-save action")
        return execute(ws,action)
    if c == "show": return model.view(a.collection,a.revision)
    if c == "capture": return model.capture(a.collection,a.revision,read_json(a.revisions),a.operation,a.pages,a.force)
    if c == "resume": return model.resume(a.run)
    if c == "review": return model.review(a.run)
    if c == "edition": return model.edition(a.run,a.name,a.fields.split(","),read_json(a.revisions),a.operation)
    if c in ("opml","original"):
        data=model.opml(a.collection,a.revision) if c=="opml" else model.source_path(a.source).read_bytes()
        private_write(Path(a.out),data)
        return {"file":str(Path(a.out).absolute()),"bytes":len(data),"sha256":file_digest(Path(a.out),MAX_OPML_BYTES)}
    if c == "export": return model.export(a.binding,Path(a.out))
    if c == "receive": return model.receive(Path(a.file),a.operation)
    raise InputError("Unknown subscription command")
