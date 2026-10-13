#!/usr/bin/env python3
"""Rebuild the named regional reference table from the two retained publications."""
from __future__ import annotations
import argparse,csv,hashlib,io,json,os,tempfile
from pathlib import Path

EXPECTED={
    "georgia-2019-table-a1.csv":"1005b2ed6492456561f4ecd7374fbbda369d99d9",
    "duke-forest-2022-table4.csv":"6129dba36fd1e10fc8e2c88f82e5c8f52d577290",
}
CODES=(11,21,22,23,24,31,41,42,43,52,71,81,82,90,95)
FIELDS=("lucode","load_n","load_p","load_type_n","load_type_p","eff_n","eff_p",
        "crit_len_n","crit_len_p","proportion_subsurface_n","usle_c","usle_p",
        "georgia_land_cover_label","duke_land_cover_label")

def source(root,name,key):
    body=(root/name).read_bytes()
    blob=hashlib.sha1(b"blob "+str(len(body)).encode()+b"\0"+body).hexdigest()
    if blob!=EXPECTED[name]:
        raise ValueError("Source table differs from the selected published edition: "+name)
    reader=csv.DictReader(io.StringIO(body.decode("utf-8")))
    rows={}
    positions={}
    for line,row in enumerate(reader,2):
        code=int(row[key])
        if code in rows: raise ValueError("Duplicate source class "+str(code))
        rows[code]=row;positions[code]=line
    if tuple(sorted(rows))!=CODES:
        raise ValueError("Published table does not have the exact selected 15-class coverage")
    return rows,positions,{"path":name,"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest(),"git_blob":blob}

def rebuild(root):
    georgia,gpos,gmeta=source(root,"georgia-2019-table-a1.csv","Lucode")
    duke,dpos,dmeta=source(root,"duke-forest-2022-table4.csv","lucode")
    rows=[];lineage=[]
    for code in CODES:
        g,d=georgia[code],duke[code]
        rows.append((str(code),g["load_n"],g["load_p"],"measured-runoff","measured-runoff",
                     g["eff_n"],g["eff_p"],"30","30","0",d["usle_c"],d["usle_p"],
                     g["LULC_desc"],d["land_use_class_name"]))
        lineage.append({"lucode":code,
                        "nutrients":{"source":"georgia-2019-table-a1.csv","csv_line":gpos[code],"table":"A1","source_fields":["load_n","load_p","eff_n","eff_p"]},
                        "sediment":{"source":"duke-forest-2022-table4.csv","csv_line":dpos[code],"table":"4","source_fields":["usle_c","usle_p"]}})
    stream=io.StringIO(newline="")
    writer=csv.writer(stream,lineterminator="\n")
    writer.writerow(FIELDS);writer.writerows(rows)
    body=stream.getvalue().encode("utf-8")
    description={
        "schema":"upstate.regional-biophysical-join/v1",
        "title":"Georgia 2019 A1 nutrients and Duke Forest 2022 Table 4 sediment — NLCD regional reference",
        "output":{"path":"regional-biophysical.csv","bytes":len(body),"sha256":hashlib.sha256(body).hexdigest(),"rows":15,"columns":list(FIELDS)},
        "sources":[gmeta,dmeta],"row_lineage":lineage,
        "adoption":{
            "nutrient_load_units":"kg/ha/year","efficiency_units":"ratio","critical_length_units":"m","usle_factors":"dimensionless",
            "crit_len_n":"30","crit_len_p":"30","proportion_subsurface_n":"0",
            "constants_source":"Georgia paper Appendix A1 NLCD footnote",
            "load_type_n":"measured-runoff","load_type_p":"measured-runoff",
            "load_type_basis":"The retained Georgia inputs are land-cover nutrient export coefficients; modern InVEST field values describe that published input basis.",
            "land_cover_join":"Exact integer NLCD code; preserve both publications' class labels.",
            "parameter_provenance":"Original numeric CSV strings are retained without rounding or interpolation.",
            "model_parameters":"Native NDR/SDR algorithm parameters and local calibration remain named choices in the saved model profile."
        },
        "study_context":{
            "georgia":{"year":2019,"doi":"10.3390/environments6050052","table":"A1","published_land_cover":"NLCD 2006","original_model_version":"InVEST 3.4.2","scope":"57 Georgia watersheds"},
            "duke":{"year":2022,"title":"Ecosystem Service Analysis of Duke Forest","authors":["Shouta Hayashi","Eamon Horrigan"],"table":"4","classification":"NLCD","report_url":"https://dukespace.lib.duke.edu/bitstreams/57c6d8cb-9ce3-4740-b1d5-39c92bda284c/download","author_story_date":"2022-03-29","author_story_url":"https://storymaps.arcgis.com/stories/ae40930c3caa4ba38005a1ab7da083a7","advisor_bibliography_url":"https://sites.nicholas.duke.edu/nicolettecagle/cagle-lab/people/","table_attribution":"Hamel et al. 2015","attributed_doi":"10.1016/j.scitotenv.2015.04.027"}
        },
        "source_comparison":[{
            "parameter":"usle_c","lucode":82,"selected_value":"0.2","selected_source":"Duke Forest 2022 Table 4",
            "other_value":"0.25","other_context":"Agricultural corn in the Cape Fear discussion of Hamel et al. 2017",
            "other_doi":"10.1016/j.scitotenv.2016.12.103","other_source_url":"https://repository.library.noaa.gov/view/noaa/57797/noaa_57797_DS1.pdf",
            "treatment":"Retain Duke's published 0.2 in this edition; keep the Cape Fear value as a separately attributable sensitivity choice."
        }],
        "references":[
            "https://doi.org/10.3390/environments6050052",
            "https://dukespace.lib.duke.edu/bitstreams/57c6d8cb-9ce3-4740-b1d5-39c92bda284c/download",
            "https://doi.org/10.1016/j.scitotenv.2015.04.027",
            "https://repository.library.noaa.gov/view/noaa/57797/noaa_57797_DS1.pdf"
        ]
    }
    return body,(json.dumps(description,ensure_ascii=False,indent=2)+"\n").encode("utf-8")

def publish(path,body):
    if path.exists():
        if path.read_bytes()!=body: raise ValueError("Destination already contains a different edition: "+str(path))
        return
    fd,tmp=tempfile.mkstemp(prefix="."+path.name+".",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as target:
            target.write(body);target.flush();os.fsync(target.fileno())
        try: os.link(tmp,path)
        except FileExistsError:
            if path.read_bytes()!=body: raise ValueError("A concurrent writer published another edition")
    finally:
        Path(tmp).unlink(missing_ok=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source",type=Path,default=Path(__file__).resolve().parent)
    parser.add_argument("--output",type=Path,required=True,help="New directory or an identical retained rebuild")
    args=parser.parse_args()
    table,provenance=rebuild(args.source.resolve(strict=True))
    args.output.mkdir(parents=True,exist_ok=True)
    publish(args.output/"regional-biophysical.csv",table)
    publish(args.output/"provenance.json",provenance)
    print(json.dumps({"directory":str(args.output.resolve()),"rows":15,"csv_sha256":hashlib.sha256(table).hexdigest()}))
if __name__=="__main__": main()
