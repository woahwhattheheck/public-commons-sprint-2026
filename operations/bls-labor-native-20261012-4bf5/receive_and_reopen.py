"""Deliver original acquired pages, import through Vitality, and reopen the same workspace."""
import argparse
import hashlib
import importlib
import json
from pathlib import Path
import sys

parser=argparse.ArgumentParser(description=__doc__)
for flag in ("--checkout","--run","--node","--capture-id","--vitality-source"):
    parser.add_argument(flag,required=True)
args=parser.parse_args()
checkout=Path(args.checkout).resolve();root=Path(args.run).resolve()
native=checkout/"stellar/scf-starforge-20261009"
sys.path[:0]=[str(native/"sf88-operator-buyer-cli/python"),
              str(native/"sf30-seller-sdk/bls-labor/consumer")]
from stellar_forge_buyer.datasets import DatasetAcquisition
from bls_delivery import restore_source_files
from vitality_import import load_original_vitality,import_received,reopen_received

original=load_original_vitality(args.vitality_source)
keys=["laus","qcew-50005","qcew-50009","qcew-50019"]
acquisition=DatasetAcquisition(checkout=checkout,session=root/"acquisition",node=args.node,timeout=900)
report=acquisition.inspect()
assert report["status"]=="COMPLETE",report
delivery=acquisition.deliver(root/"delivery")
received=restore_source_files(delivery,root/"received",expected_capture_id=args.capture_id)
store=importlib.import_module("store")
workspace_path=root/"vitality"
workspace=(original.workspace_type(workspace_path) if workspace_path.exists()
           else store.create_workspace(workspace_path,"Original acquired BLS source editions"))
with workspace:
    imported=import_received(received,original,workspace,"ASTRA-4BF5",only=keys)
    original_ids={item["key"]:item["result"]["id"] for item in imported["imports"]}
    observations={}
    for item in imported["imports"]:
        current=workspace.source(item["result"]["id"],full=True)
        envelope=current["envelope"]
        raw=workspace.source_bytes(current["source"]["sha256"])
        assert len(raw)==current["source"]["bytes"]
        assert hashlib.sha256(raw).hexdigest()==current["source"]["sha256"]
        definitions=[]
        for attachment in current["attachments"]:
            saved=workspace.source_bytes(attachment["sha256"])
            assert len(saved)==attachment["bytes"]
            definitions.append({"sha256":attachment["sha256"],"bytes":len(saved)})
        periods={}
        statuses={}
        for series in envelope["series"]:
            for row in series["observations"]:
                statuses[row["status"]]=statuses.get(row["status"],0)+1
            periods[series["frequency"]]=periods.get(series["frequency"],0)+len(series["observations"])
        observations[item["key"]]={
            "id":current["id"],"source":current["source"],
            "series":current["series_count"],"observations":current["observation_count"],
            "period_frequency":periods,"statuses":statuses,"definitions":definitions,
            "scope":envelope["scope"],"issues":envelope["issues"],
        }
reopened=reopen_received(received,original,workspace_path,"ASTRA-4BF5",only=keys)
assert {item["key"]:item["result"]["id"] for item in reopened["imports"]}==original_ids
assert all(item["result"]["reused"] for item in reopened["imports"])
received_again=restore_source_files(acquisition.deliver(root/"delivery"),root/"received",
                                    expected_capture_id=args.capture_id)
assert received_again.reopened
result={"schema":"bls-original-native-receiving-result.v1",
        "received":received.summary(),"source_capture_reopened":received_again.reopened,
        "original_workspace":str(workspace_path),"original_source_ids":original_ids,
        "all_native_imports_reused":True,"native_entries":observations}
out=root/"receiving-result.json"
out.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n")
out.chmod(0o600)
print(json.dumps(result,ensure_ascii=False,allow_nan=False))
