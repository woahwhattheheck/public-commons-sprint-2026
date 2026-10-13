"""Lossless observation of the actual SQLite values produced by native Sling."""
import argparse, base64, hashlib, json, pathlib, sqlite3, struct
from datetime import datetime, timezone

def digest(path):
    h=hashlib.sha256(); size=0
    with open(path,"rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""): h.update(block); size+=len(block)
    return {"sha256":h.hexdigest(),"bytes":size}

def quote(name):
    if not isinstance(name,str) or not name or "\x00" in name: raise ValueError("Invalid SQLite identifier")
    return '"'+name.replace('"','""')+'"'

def cell(value):
    if value is None: return {"type":"null"}
    if isinstance(value,bool): return {"type":"boolean","value":"true" if value else "false"}
    if isinstance(value,int): return {"type":"integer","value":str(value)}
    if isinstance(value,float): return {"type":"float64","value":struct.pack(">d",value).hex()}
    if isinstance(value,bytes): return {"type":"binary","value":base64.b64encode(value).decode("ascii")}
    if isinstance(value,str): return {"type":"text","value":value}
    raise TypeError("Unsupported actual SQLite value: "+type(value).__name__)

def table_name(table):
    if isinstance(table,str): return {"namespace":"main","name":table}
    if not isinstance(table,dict): raise ValueError("Expected a named SQLite table")
    return {"namespace":table.get("namespace") or "main","name":table["name"]}

def open_read(path):
    return sqlite3.connect(pathlib.Path(path).resolve().as_uri()+"?mode=ro",uri=True)

def export_table(path, table, *, relative_path, recorded_at):
    table=table_name(table); namespace=table["namespace"]; name=table["name"]
    with open_read(path) as connection:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        listed=connection.execute("SELECT name,type FROM "+quote(namespace)+".sqlite_master WHERE name=? AND type IN ('table','view')",(name,)).fetchone()
        if not listed: raise ValueError("Selected original SQLite table does not exist: "+namespace+"."+name)
        cursor=connection.execute("SELECT * FROM "+quote(namespace)+"."+quote(name))
        names=[item[0] for item in cursor.description]
        info=connection.execute("PRAGMA "+quote(namespace)+".table_info("+quote(name)+")").fetchall()
        declared={row[1]:row[2] for row in info}
        rows=[[cell(value) for value in row] for row in cursor]
        columns=[{"name":name,"type":declared.get(name,""),"ordinal":i} for i,name in enumerate(names)]
        connection.rollback()
    return {"columns":columns,"rows":rows,"source":{"kind":"sqlite_snapshot","path":relative_path,"sha256":digest(path)["sha256"],"recordedAt":recorded_at}}

def schema(path):
    with open_read(path) as connection:
        connection.execute("PRAGMA query_only=ON");connection.execute("BEGIN")
        result=[{"name":r[0],"type":r[1],"table":r[2],"sql":r[3]} for r in connection.execute("SELECT name,type,tbl_name,sql FROM sqlite_master ORDER BY type,name")]
        connection.rollback();return result

def snapshot(source, target):
    target=pathlib.Path(target)
    if target.exists(): target.unlink()
    target.parent.mkdir(parents=True,exist_ok=True)
    with open_read(source) as original, sqlite3.connect(target) as receiving:
        original.backup(receiving)
        check=receiving.execute("PRAGMA integrity_check").fetchall()
        if check!=[("ok",)]: raise ValueError("SQLite snapshot integrity_check failed")
    return digest(target)

def observations(directory, tables, phase, native):
    directory=pathlib.Path(directory); at=native["completedAt"]
    rows=[]
    for table in tables:
        left=export_table(directory/"artifacts/source.sqlite",table["source"],relative_path="artifacts/source.sqlite",recorded_at=at)
        right=export_table(directory/"artifacts/target.sqlite",table["target"],relative_path="artifacts/target.sqlite",recorded_at=at)
        rows.append({"streamId":table["streamId"],"left":left,"right":right,"native":native})
    return {"schema":"slingdata.migration-observations.v1","phase":phase,"streams":rows}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--database",required=True);p.add_argument("--table",required=True);p.add_argument("--namespace",default="main")
    p.add_argument("--output",required=True);p.add_argument("--relative-path",default="database.sqlite");p.add_argument("--recorded-at",required=True)
    a=p.parse_args(); result=export_table(a.database,{"namespace":a.namespace,"name":a.table},relative_path=a.relative_path,recorded_at=a.recorded_at)
    out=pathlib.Path(a.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":"))+"\n")
    print(json.dumps({"path":str(out),**digest(out),"rows":len(result["rows"]),"columns":len(result["columns"])}))
if __name__=="__main__": main()
