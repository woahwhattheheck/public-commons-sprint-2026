"""MIT. Human Services Directory CLI on the original private workspace."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from directory_runtime import InputError,ConflictError,ProviderError,source,original_workspace,safe_read
from directory_workspace import Workspace
import directory_schema as schema

HERE=Path(__file__).resolve().parent
def emit(value):print(source.lexical_json(value),flush=True)
def input_file(path,maximum=schema.MAX_RECORD):
    raw=sys.stdin.buffer.read(maximum+1)if path=="-"else safe_read(Path(path),maximum)
    if len(raw)>maximum:raise InputError("The complete selected native input exceeds its declared byte limit")
    return source.json_value(raw)
def copy_output(path,destination):
    dest=Path(destination).expanduser().absolute()
    with Path(path).open("rb")as inp,dest.open("xb")as out:
        dest.chmod(0o600);shutil.copyfileobj(inp,out,65536);out.flush();os.fsync(out.fileno())
    return {"file":str(dest),"bytes":dest.stat().st_size,"sha256":original_workspace.file_digest(dest,2147483648)}

def main(argv=None):
    argv=list(sys.argv[1:]if argv is None else argv)
    if argv and argv[0]=="serve":
        from directory_server import main as serve
        return serve(argv[1:])
    if argv and argv[0]=="native":
        return subprocess.run([sys.executable,str(HERE.parent/"fhir_referral"/"cli.py"),*argv[1:]],check=False).returncode
    p=argparse.ArgumentParser(description="Complete original Directory sources, reviewed choices and Gravity receiving")
    sub=p.add_subparsers(dest="command",required=True)
    common=argparse.ArgumentParser(add_help=False)
    common.add_argument("--workspace");common.add_argument("--credentials-file")
    def command(name):
        c=sub.add_parser(name,parents=[common]);return c
    command("init");command("state");command("catalogue");command("guidance");command("operating-plan-catalog")
    for name in ["operating-plan-document","operating-plan-draft","operating-plan-input","operating-plan-basis"]:
        c=command(name);c.add_argument("--id",required=True)
        if name=="operating-plan-draft":c.add_argument("--revision",type=int)
    for name in ["operating-return-review","operating-return-comparison","operating-return-input"]:
        command(name).add_argument("--id",required=True)
    operations={a["id"]:(a["python"],a["input"])for a in source.json_value((HERE/"directory-schema.json").read_bytes())["actions"]}
    operations.update({"connection-save":("directory_connection","connection"),"request-save":("directory_request","request"),
        "edition-save":("directory_edition","edition"),"edition-compare":("directory_compare","comparison"),"import-profile-save":("save_directory_import","import")})
    for name in operations:command(name).add_argument("--input",required=True)
    for name in ["discover","acquire"]:command(name).add_argument("--input",required=True)
    for name in ["advance","pause","resume","capture-source"]:
        command(name).add_argument("--operation",required=True)
    command("correction-worksheet-document").add_argument("--id",required=True)
    c=command("correction-worksheet-receive");c.add_argument("--import-id",required=True);c.add_argument("--file",required=True)
    c=command("source-import");c.add_argument("--file",required=True);c.add_argument("--input");c.add_argument("--import-profile")
    c=command("records");c.add_argument("--kind",required=True);c.add_argument("--id");c.add_argument("--offset",type=int,default=0);c.add_argument("--limit",type=int,default=50);c.add_argument("--query",default="")
    c=command("rows");c.add_argument("--kind",choices=["source","edition","mapping-preview","selection","comparison","conformance-findings","conformance-rows","conformance-foreign-keys","conformance-foreign-key-candidates","conformance-foreign-key-matches","operating-return","correction","correction-worksheet","correction-worksheet-reconciliation"],required=True);c.add_argument("--id",required=True)
    c.add_argument("--collection",choices=["correctionPlans","correctionPreviews","corrections","correctionWorksheets","correctionWorksheetImports","correctionWorksheetReturns","correctionWorksheetReviews","correctionWorksheetReconciliations","correctionWorksheetReconciliationReviews"])
    c.add_argument("--table");c.add_argument("--group",default="findings");c.add_argument("--state");c.add_argument("--offset",type=int,default=0);c.add_argument("--limit",type=int,default=50);c.add_argument("--query",default="")
    c.add_argument("--severity");c.add_argument("--code");c.add_argument("--finding-source");c.add_argument("--finding-record")
    c.add_argument("--rule");c.add_argument("--target-group");c.add_argument("--source-id");c.add_argument("--record-id");c.add_argument("--outcome");c.add_argument("--candidate")
    c.add_argument("--row-key")
    c.add_argument("--row-kind",choices=["plan-field","step-field","step-presence","step-context","step-command","step-progress","step-order"])
    c.add_argument("--conflict",choices=["true","false"]);c.add_argument("--unresolved",choices=["true","false"])
    c=command("conformance-finding");c.add_argument("--assessment",required=True);c.add_argument("--finding",required=True)
    c=command("row");c.add_argument("--source",required=True);c.add_argument("--record",required=True);c.add_argument("--edition")
    c=command("links");c.add_argument("--edition",required=True);c.add_argument("--record");c.add_argument("--source");c.add_argument("--link");c.add_argument("--offset",type=int,default=0);c.add_argument("--limit",type=int,default=50)
    c=command("file");c.add_argument("--kind",required=True,choices=["source","source-index","edition-index","comparison-index","row","changes","capture","export","guidance","workspace","handoff","conformance-assessment","conformance-review","conformance-comparison","operating-return","correction","correction-worksheet","correction-worksheet-reconciliation"])
    c.add_argument("--collection",choices=["correctionPlans","correctionPreviews","corrections","correctionWorksheets","correctionWorksheetImports","correctionWorksheetReturns","correctionWorksheetReviews","correctionWorksheetReconciliations","correctionWorksheetReconciliationReviews"])
    c.add_argument("--id");c.add_argument("--record");c.add_argument("--member");c.add_argument("--out",required=True)
    for name in ["receive-workspace","receive-handoff"]:command(name).add_argument("--file",required=True)
    args=p.parse_args(argv)
    if args.command=="catalogue":emit(schema.catalogue());return 0
    if args.command=="guidance":emit(schema.guidance());return 0
    if not args.workspace:p.error("--workspace is required for the original native operation")
    root=Path(args.workspace).expanduser().absolute()
    with Workspace(root,create=args.command in {"init","receive-workspace","receive-handoff"}and not root.exists(),credentials_file=args.credentials_file)as ws:
        name=args.command
        if name in {"init","state"}:result=ws.state()
        elif name=="correction-worksheet-document":result=ws.directory_correction_worksheet_document(args.id)
        elif name=="correction-worksheet-receive":result=ws.import_directory_correction_worksheet_return(args.import_id,Path(args.file).expanduser().absolute())
        elif name=="operating-plan-catalog":result=ws.directory_operating_catalogue()
        elif name=="operating-plan-draft":result=ws.directory_operating_plan_draft(args.id,args.revision)
        elif name in {"operating-plan-document","operating-plan-input","operating-plan-basis"}:
            result=getattr(ws,{"operating-plan-document":"directory_operating_plan_document","operating-plan-input":"directory_operating_plan_input","operating-plan-basis":"directory_operating_plan_basis"}[name])(args.id)
        elif name in {"operating-return-review","operating-return-comparison","operating-return-input"}:
            result=getattr(ws,{"operating-return-review":"directory_operating_return_review","operating-return-comparison":"directory_operating_return_comparison","operating-return-input":"directory_operating_return_input"}[name])(args.id)
        elif name in operations:
            from directory_operating_returns import MAX_REQUEST as RETURN_REQUEST
            from directory_corrections_schema import MAX_INPUT as CORRECTION_REQUEST
            maximum=CORRECTION_REQUEST if name.startswith("correction-")else RETURN_REQUEST if name.startswith("operating-return-")else schema.MAX_RECORD
            result=getattr(ws,operations[name][0])(input_file(args.input,maximum))
        elif name in {"discover","acquire"}:
            raw=input_file(args.input)
            import directory_source_schema as native
            raw=native.typed(name,raw)
            result=ws.directory_discover(raw["connectionId"],raw["operationId"])if name=="discover"else ws.directory_acquire(raw["requestId"],raw["operationId"])
        elif name in {"advance","pause","resume","capture-source"}:
            result=getattr(ws,{"advance":"directory_advance","pause":"directory_pause","resume":"directory_resume","capture-source":"directory_capture_source"}[name])(args.operation)
        elif name=="source-import":
            if bool(args.input)==bool(args.import_profile):p.error("Choose exactly one --input profile or saved --import-profile")
            if args.input:result=ws.directory_import(Path(args.file),input_file(args.input))
            else:result=ws.import_directory_profile(args.import_profile,Path(args.file))
        elif name=="records":
            kind="acquisitions"if args.kind=="operations"else args.kind
            result=ws.directory_operation(args.id)if kind=="acquisitions"and args.id else ws.directory_record(kind,args.id)if args.id else ws.directory_records(kind,args.offset,args.limit,args.query)
        elif name=="rows":
            if args.kind=="correction-worksheet-reconciliation":
                if not args.collection:p.error("Reconciliation rows require their exact --collection")
                result=ws.directory_correction_worksheet_reconciliation_rows(args.collection,args.id,args.offset,args.limit,row_key=args.row_key,state=args.state)
            elif args.kind=="correction-worksheet":
                if not args.collection:p.error("Worksheet rows require their exact --collection")
                result=ws.directory_correction_worksheet_rows(args.collection,args.id,args.offset,args.limit,row_key=args.row_key,state=args.state)
            elif args.kind=="correction":
                if not args.collection:p.error("Correction rows require their exact --collection")
                result=ws.directory_correction_rows(args.collection,args.id,args.offset,args.limit)
            elif args.kind=="source":result=ws.directory_source_rows(args.id,args.offset,args.limit,args.table,args.query)
            elif args.kind=="edition":result=ws.directory_edition_rows(args.id,args.offset,args.limit,args.table,args.query)
            elif args.kind=="mapping-preview":result=ws.directory_preview_page(args.id,args.group,args.offset,args.limit)
            elif args.kind=="selection":result=ws.directory_selection_page(args.id,args.offset,args.limit,args.query)
            elif args.kind=="conformance-findings":result=ws.directory_conformance_findings(args.id,args.offset,args.limit,args.severity,args.table,args.code,args.finding_source,args.finding_record)
            elif args.kind=="conformance-rows":result=ws.directory_conformance_rows(args.id,args.offset,args.limit,args.table)
            elif args.kind=="conformance-foreign-keys":result=ws.directory_conformance_foreign_keys(args.id,args.offset,args.limit,args.table,args.state,args.rule,args.source_id,args.record_id)
            elif args.kind=="conformance-foreign-key-candidates":result=ws.directory_conformance_foreign_key_candidates(args.id,args.offset,args.limit,args.table,args.state,args.target_group,args.source_id,args.record_id)
            elif args.kind=="conformance-foreign-key-matches":result=ws.directory_conformance_foreign_key_matches(args.id,args.offset,args.limit,args.outcome,args.candidate)
            elif args.kind=="operating-return":
                result=ws.directory_operating_return_rows(args.id,args.offset,args.limit,args.row_kind,
                    None if args.conflict is None else args.conflict=="true",None if args.unresolved is None else args.unresolved=="true")
            else:result=ws.directory_changes(args.id,args.offset,args.limit,args.state)
        elif name=="conformance-finding":result=ws.directory_conformance_finding(args.assessment,args.finding)
        elif name=="row":result=ws.directory_edition_row(args.edition,args.source,args.record)if args.edition else ws.directory_source_row(args.source,args.record)
        elif name=="links":
            if bool(args.source)!=bool(args.link):p.error("A selected link target page requires both --source and --link")
            result=ws.directory_link_targets(args.edition,args.source,args.link,args.offset,args.limit)if args.link else ws.directory_edition_links(args.edition,args.offset,args.limit,args.record)
        elif name=="file":
            if args.kind=="workspace":result=ws.export_workspace(args.out)
            elif args.kind=="handoff":result=ws.export_directory_handoff(args.id,args.out)
            else:
                if args.kind=="correction-worksheet-reconciliation":
                    if not args.collection:p.error("Reconciliation files require their exact --collection")
                    path,d=ws.directory_correction_worksheet_reconciliation_file(args.collection,args.id,args.member or("comparison"if args.collection=="correctionWorksheetReconciliations"else"decisions"))
                elif args.kind=="correction-worksheet":
                    if not args.collection:p.error("Worksheet files require their exact --collection")
                    path,d=ws.directory_correction_worksheet_file(args.collection,args.id,args.member or "input")
                elif args.kind=="correction":
                    if not args.collection:p.error("Correction files require their exact --collection")
                    path,d=ws.directory_correction_file(args.collection,args.id,args.member or("input"if args.collection=="correctionPlans"else"changes"))
                elif args.kind.startswith("conformance-"):
                    kind={"conformance-assessment":"conformanceAssessments","conformance-review":"conformanceReviews","conformance-comparison":"conformanceComparisons"}[args.kind]
                    path,d=ws.directory_conformance_file(kind,args.id,args.member or"package")
                elif args.kind=="operating-return":path,d=ws.directory_operating_return_file(args.id,args.member or"review")
                elif args.kind=="source":path,d=ws.directory_source_file(args.id,args.member)
                elif args.kind.endswith("-index"):
                    kind={"source-index":"sources","edition-index":"editions","comparison-index":"comparisons"}[args.kind];path,d=ws.directory_index_file(kind,args.id)
                elif args.kind=="row":path,d=ws.directory_record_file(args.id,args.record)
                elif args.kind=="changes":path,d=ws.directory_changes_file(args.id)
                elif args.kind=="capture":path,d=ws.directory_capture_file(args.id)
                elif args.kind=="guidance":path,d=ws.directory_guidance_file(args.member)
                else:
                    record=ws.directory_record("exports",args.id);d=record["file"];path=ws._directory_file_path(d)
                result={**copy_output(path,args.out),"original":d}
        elif name in {"receive-workspace","receive-handoff"}:
            result=ws.import_workspace(args.file)if name=="receive-workspace"else ws.import_directory_handoff(args.file)
        else:raise InputError("Unknown Directory command")
        emit(result);return 0
if __name__=="__main__":
    try:sys.exit(main())
    except (InputError,ConflictError,ProviderError,OSError,ValueError)as error:
        print(json.dumps({"error":str(error),"type":type(error).__name__},ensure_ascii=False),file=sys.stderr,flush=True);sys.exit(2)
