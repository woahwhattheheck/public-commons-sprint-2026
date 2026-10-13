"""Read the currently selected immutable SQLite consumer snapshot."""
import argparse, hashlib, json, pathlib, sqlite3
from sqlite_exports import cell, quote, digest

def inspect_consumer(directory, project_id, stream_id, offset, limit):
    root=pathlib.Path(directory).resolve()/"consumer"/project_id
    pointer=json.loads((root/"current.json").read_text())
    selected=next((row for row in pointer["tables"] if row["streamId"]==stream_id),None)
    if selected is None: raise ValueError("The stream is not in the selected consumer binding")
    path=root/(pointer["snapshot"]["sha256"]+".sqlite")
    if digest(path)!=pointer["snapshot"]: raise ValueError("The actual consumer snapshot differs from its selected bytes")
    parts=selected["relation"];namespace=parts[-2] if len(parts)>1 else "main";name=parts[-1]
    with sqlite3.connect(path.resolve().as_uri()+"?mode=ro",uri=True) as db:
        db.execute("PRAGMA query_only=ON");db.execute("BEGIN")
        count=db.execute("SELECT COUNT(*) FROM "+quote(namespace)+"."+quote(name)).fetchone()[0]
        cur=db.execute("SELECT * FROM "+quote(namespace)+"."+quote(name)+" LIMIT ? OFFSET ?",(limit,offset))
        columns=[row[0] for row in cur.description];rows=[[cell(value) for value in row] for row in cur]
        db.rollback()
    return {"schema":"tjlabs.sling-consumer-observation.v1","projectId":project_id,"selection":pointer,"streamId":stream_id,"snapshot":pointer["snapshot"],"columns":columns,"rowCount":count,"offset":offset,"limit":limit,"rows":rows,"nextOffset":offset+len(rows) if offset+len(rows)<count else None}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--directory",required=True);p.add_argument("--project",required=True);p.add_argument("--stream",required=True);p.add_argument("--offset",type=int,default=0);p.add_argument("--limit",type=int,default=100)
    a=p.parse_args()
    if not a.project or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-" for c in a.project): p.error("Invalid original project ID")
    if a.offset<0 or a.limit<1 or a.limit>1000:p.error("Use offset>=0 and limit1..1000")
    print(json.dumps(inspect_consumer(a.directory,a.project,a.stream,a.offset,a.limit),ensure_ascii=False,separators=(",",":")))
if __name__=="__main__": main()
