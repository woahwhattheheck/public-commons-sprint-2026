#!/usr/bin/env python3
"""Original SF88 finalized room -> complete WordPress source; no second payment path."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
parser=argparse.ArgumentParser()
for key in ("checkout","node","delivery","session","destination","capture","workspace"):
    parser.add_argument("--"+key,required=True)
args=parser.parse_args()
root=Path(args.checkout).resolve(strict=True)
base=root/"stellar/scf-starforge-20261009"
sys.path.insert(0,str(base/"sf88-operator-buyer-cli/python"))
sys.path.insert(0,str(base/"sf30-seller-sdk"))
from stellar_forge_buyer.analysis_native_delivery import open_finalized
from wordpress.source_files import restore_wordpress_source
original,receipt=open_finalized(root,args.node,args.delivery,session=args.session)
received=restore_wordpress_source(original,args.destination,expected_capture_id=args.capture,
                                  expected_workspace_id=args.workspace)
state=received.workspace()
print(json.dumps({"schema":"stellar-forge.wordpress-native-receiving.v1",
    "workspaceId":state["id"],"revision":state["revision"],"manifestSha256":args.capture,
    "files":len(received.manifest["files"]),"directory":str(received.workspace_directory),
    "originalReceiving":receipt},ensure_ascii=False,separators=(",",":")))
