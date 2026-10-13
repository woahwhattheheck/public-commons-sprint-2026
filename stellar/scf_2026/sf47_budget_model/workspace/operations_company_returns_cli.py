"""Read-only company return intake over the original Operations owner."""
from __future__ import annotations
import base64
from model import canonical

def register(command, mutation):
    target = command("installation-company-return-inspect", "Inspect a complete company-only return against its original Installation", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    select = target.add_mutually_exclusive_group(required=True)
    select.add_argument("--archive")
    select.add_argument("--archive-source")
    target.add_argument("--sha256", required=True)
    target = command("installation-company-return-linked", "Verify retained package and original returned JSON before native receiving", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--archive-source", required=True)
    target.add_argument("--return-source", required=True)
    target.add_argument("--sha256", required=True)

def operate(ops, args, read_bytes, publish):
    body = {"expectedVersion": args.expected_version, "archiveSha256": args.sha256}
    if args.operation == "installation-company-return-inspect":
        if args.archive:
            body["archiveBase64"] = base64.b64encode(read_bytes(args.archive, 8 * 1024 * 1024)).decode("ascii")
        else:
            body["archiveSourceId"] = args.archive_source
        result = ops.inspect_company_return(args.case, body)
    else:
        body.update(archiveSourceId=args.archive_source, returnSourceId=args.return_source)
        result = ops.linked_company_return(args.case, body)
    return {"output": publish(args.output, (canonical(result) + "\n").encode("utf-8"))} if args.output else result
