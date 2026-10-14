"""One source-native saved-edition course, explicitly synthetic and no Workspace/model."""
import argparse
import json
from pathlib import Path

from measurement_workspace import temporal_analysis as engine
from measurement_workspace import temporal_comparison as comparison

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,required=True)
    args = parser.parse_args()
    output = args.output.absolute(); output.mkdir(parents=True,exist_ok=False)
    source = output/"synthetic-original-inputs"
    relative = "source/temporal-workspace-observations"
    folder = source/relative; folder.mkdir(parents=True)
    records = []
    for basis, values in (("as N",(10,12,14)),("as NO3",(30,24,18))):
        for year,value in zip((2024,2025,2026),values):
            original = {"synthetic":True,"basis":basis,"value":value,"year":year}
            record = {key:"" for key in engine.DIMENSIONS}
            record.update(id=engine.sha(engine.canonical(original))[:24],dataset="workspace",
                source_table=relative+"/records.json",source_csv_row=len(records)+2,raw=original,
                station="synthetic-station",parameter="Nitrate",unit="mg/L",method="synthetic-method",
                date=str(year)+"-03-12",year=year,month=3,time="",timezone="",
                activity=basis+"-"+str(year),activity_identity_basis="source_activity",
                project="explicitly-synthetic",value_type="Actual",lower=float(value),upper=float(value),
                eligible=True,censored=False,flags=[],qualifiers=[],comment="Synthetic source exercise only",
                source_context={"source_quantity":{"chemical_basis":basis}})
            records.append(record)
    body=engine.canonical(records); (folder/"records.json").write_bytes(body)
    manifest={"schema":"upstate.temporal-workspace-source/v1","sources":[],
              "records":{"path":relative+"/records.json","bytes":len(body),"sha256":engine.sha(body)}}
    (folder/"manifest.json").write_bytes(engine.canonical(manifest))
    selected=engine.checked_selection({"title":"Synthetic before","datasets":["workspace"]})
    original=engine.build(source,output/"before",selected)
    retitled=engine.build(source,output/"retitled",{**selected,"title":"Synthetic title-only after"})
    shortened=engine.build(source,output/"shortened",{**selected,"title":"Synthetic changed date support","end_date":"2025-12-31"})
    original_zip=output/"before"/"temporal-analysis.zip"
    results=[]
    for name, after, expected_points in (("title-only","retitled",2),("changed-support","shortened",0)):
        target=output/name
        result=comparison.build(original_zip,output/after/"temporal-analysis.zip",target,
            {"title":"Synthetic "+name,"before_edition_id":None,"after_edition_id":None})
        document=json.loads((target/"comparison.json").read_text("utf-8"))
        assert document["summary"]["point_deltas"]==expected_points
        assert document["summary"]["series"]==2
        assert len(document["before"]["records"])==len(document["after"]["records"])==6
        assert sorted(row["estimate"]["slope_lower"] for row in document["before"]["cohorts"])==[-6.0,2.0]
        if expected_points:
            assert all(row["after_minus_before_point_slope"]==0 for row in document["series"])
        else:
            assert all(row["after_minus_before_point_slope"] is None and row["comparison_reasons"] for row in document["series"])
        received=comparison.receive(target/"temporal-comparison.zip",output/(name+"-cold"))
        assert received["id"]==result["id"]
        assert comparison._digest_file(target/"before"/"temporal-analysis.zip")==comparison._digest_file(original_zip)
        assert comparison._digest_file(output/(name+"-cold")/"temporal-comparison.zip")==comparison._digest_file(target/"temporal-comparison.zip")
        results.append({"case":name,"comparison_id":result["id"],"summary":result["summary"],"cold_reopen":"matched"})
    receipt={"schema":"upstate.temporal-comparison-source-course/v1","input_kind":"six explicit synthetic rows, two original chemical bases",
             "original_analysis_id":original["id"],"retitled_analysis_id":retitled["id"],
             "changed_support_analysis_id":shortened["id"],"cases":results,
             "source_unchanged":(folder/"records.json").read_bytes()==body,
             "native_models_started":0,"workspace_created":False}
    (output/"course-result.json").write_bytes(engine.canonical(receipt))
    print(json.dumps(receipt,ensure_ascii=False,sort_keys=True))
if __name__=="__main__": main()
