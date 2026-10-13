#!/usr/bin/env python3
"""Repair delayed saved-review reads in the original Nine Study reader.

The original HTML and every embedded observation remain unchanged on disk.
Writes a distinct repaired HTML and an exact source/output receipt.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

REPAIRS = json.loads(r'''[{"old":"let D, study,selected='',source='',query='',stationQuery='',pageNo=0,filtered=[],view=[],drag=null;","new":"let D, study,selected='',source='',query='',stationQuery='',pageNo=0,filtered=[],view=[],drag=null,reviewRead=0;"},{"old":"$('viewFile').onchange=async()=>{const f=$('viewFile').files[0];if(!f)return;try{if(f.size>1000000)throw Error('Review file exceeds 1 MB');const v=JSON.parse(await f.text()),s=D.studies.find(s=>s.id===v.study_id);if(v.schema!=='upstate.station-review-view/v1'||!s||s.edition_id!==v.edition_id)throw Error('Review file does not match a retained native edition');renderStudy(s.id);selected=s.stations.some(s=>s.station_id===v.selected_station_id)?v.selected_station_id:'';source=[...$('sourceFilter').options].some(o=>o.value===v.source_id)?v.source_id:'';query=typeof v.row_search==='string'?v.row_search:'';stationQuery=typeof v.station_search==='string'?v.station_search:'';$('rowSearch').value=query;$('stationSearch').value=stationQuery;$('sourceFilter').value=source;$('notes').value=typeof v.notes==='string'?v.notes:'';if(Array.isArray(v.map_view)&&v.map_view.length===4&&v.map_view.every(Number.isFinite)&&v.map_view[2]>0&&v.map_view[3]>0)view=v.map_view;renderStations();updateView();renderRecords();signal('Saved review view reopened against the same native edition.');}catch(e){signal('Could not reopen review: '+e.message);}finally{$('viewFile').value='';}};","new":"$('viewFile').onchange=async()=>{const f=$('viewFile').files[0];if(!f)return;const request=++reviewRead,snapshot=JSON.stringify(review());const ownsReview=()=>request===reviewRead&&snapshot===JSON.stringify(review());try{if(f.size>1000000)throw Error('Review file exceeds 1 MB');const contents=await f.text();if(!ownsReview()){if(request===reviewRead)signal('The review changed while the file was loading. Reopen the file when you are ready to replace the current view.');return;}const v=JSON.parse(contents),s=D.studies.find(s=>s.id===v.study_id);if(v.schema!=='upstate.station-review-view/v1'||!s||s.edition_id!==v.edition_id)throw Error('Review file does not match a retained native edition');renderStudy(s.id);selected=s.stations.some(s=>s.station_id===v.selected_station_id)?v.selected_station_id:'';source=[...$('sourceFilter').options].some(o=>o.value===v.source_id)?v.source_id:'';query=typeof v.row_search==='string'?v.row_search:'';stationQuery=typeof v.station_search==='string'?v.station_search:'';$('rowSearch').value=query;$('stationSearch').value=stationQuery;$('sourceFilter').value=source;$('notes').value=typeof v.notes==='string'?v.notes:'';if(Array.isArray(v.map_view)&&v.map_view.length===4&&v.map_view.every(Number.isFinite)&&v.map_view[2]>0&&v.map_view[3]>0)view=v.map_view;renderStations();updateView();renderRecords();signal('Saved review view reopened against the same native edition.');}catch(e){if(ownsReview())signal('Could not reopen review: '+e.message);}finally{if(request===reviewRead)$('viewFile').value='';}};"}]''')
DATA = re.compile(r'<script\b(?=[^>]*\bid=["\x27]data["\x27])[^>]*>([\s\S]*?)</script>', re.I)

def identity(body):
    return {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}

def retain(path, body):
    if path.exists():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != body:
            raise ValueError("A different file already exists at " + str(path))
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name("." + path.name + ".pending")
    with pending.open("xb") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(pending, path)

def repair(input_path, output_path, expected_sha256=None):
    source = Path(input_path).resolve(strict=True)
    target = Path(output_path).resolve()
    if source == target:
        raise ValueError("Choose a distinct output HTML; retain the original reader")
    original = source.read_bytes()
    if expected_sha256 and identity(original)["sha256"] != expected_sha256:
        raise ValueError("The original reader differs from the selected SHA-256")
    text = original.decode("utf-8")
    payloads = DATA.findall(text)
    if len(payloads) != 1:
        raise ValueError("Expected exactly one original embedded data script")
    states = [(text.count(item["old"]), text.count(item["new"])) for item in REPAIRS]
    if all(state == (0, 1) for state in states):
        changed = False
    elif all(state == (1, 0) for state in states):
        for item in REPAIRS:
            text = text.replace(item["old"], item["new"], 1)
        changed = True
    else:
        raise ValueError("The viewer is not the exact original or complete repaired edition; inspect its maintained source")
    if DATA.findall(text) != payloads:
        raise ValueError("The embedded original data changed")
    output = text.encode("utf-8")
    receipt = {
        "schema": "upstate.station-review-saved-view-repair/v1",
        "original": {"filename": source.name, **identity(original)},
        "output": {"filename": target.name, **identity(output)},
        "embedded_original_data": identity(payloads[0].encode("utf-8")),
        "repair_script": identity(Path(__file__).read_bytes()),
        "changed": changed,
        "scope": "saved-review request ownership and current-review preservation",
        "original_library_file_id": "libfile_15558dd7231081918054f037544f2dc3",
        "original_archive_sha256": "e845f21e67a27ebca3ac7cdffe522f67fd00cbc37b8171956fef2cbbc036366c",
    }
    retain(target, output)
    receipt_path = target.with_name(target.name + ".repair.json")
    retain(receipt_path, (json.dumps(receipt, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return {**receipt, "path": str(target), "receipt": str(receipt_path)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--expected-sha256")
    args = parser.parse_args()
    print(json.dumps(repair(args.input, args.output, args.expected_sha256), ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
