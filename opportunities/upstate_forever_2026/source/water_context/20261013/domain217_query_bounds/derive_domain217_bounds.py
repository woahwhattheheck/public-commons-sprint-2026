"""Derive exact native EPSG3857 envelopes from the retained original217 WBD ring geometry."""
import argparse,csv,gzip,hashlib,io,json,math
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--domain",required=True,help="Extracted original217 domain directory containing sources.json and model-domain.esri.json.gz")
parser.add_argument("--output",required=True)
args=parser.parse_args()
root=Path(args.domain); target=Path(args.output); target.mkdir(parents=True,exist_ok=True)
compressed=(root/"model-domain.esri.json.gz").read_bytes(); decoded=gzip.decompress(compressed)
assert hashlib.sha256(compressed).hexdigest()=="6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9"
assert hashlib.sha256(decoded).hexdigest()=="2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"
original=json.loads(decoded); source=json.loads((root/"sources.json").read_text())["entries"][0]
assert original["spatialReference"]=={"wkid":102100,"latestWkid":3857}
assert len(original["features"])==217
rows=[]
for index,feature in enumerate(original["features"]):
 a=feature["attributes"]; rings=feature["geometry"]["rings"]; coords=[point for ring in rings for point in ring]
 assert coords and all(len(p)>=2 and all(isinstance(v,(int,float)) and math.isfinite(v) for v in p[:2]) for p in coords)
 assert isinstance(a["huc12"],str) and len(a["huc12"])==12 and a["huc12"].isdigit()
 row={name:a.get(name) for name in ("huc12","objectid","name","globalid","tnmid")}
 row.update(xmin=min(p[0] for p in coords),ymin=min(p[1] for p in coords),xmax=max(p[0] for p in coords),ymax=max(p[1] for p in coords),
  native_wkid=102100,latest_wkid=3857,source_feature_index=index,ring_count=len(rings),coordinate_count=len(coords),
  original_rings_pointer="/features/"+str(index)+"/geometry/rings",source_id=source["id"],source_uri=source["uri"],
  source_vintage=source["vintage"],source_compressed_sha256=source["sha256"],source_decoded_sha256=source["decoded_sha256"])
 rows.append(row)
assert len({row["huc12"] for row in rows})==len({row["objectid"] for row in rows})==217
stream=io.StringIO(newline=""); writer=csv.DictWriter(stream,fieldnames=list(rows[0]),lineterminator="\n"); writer.writeheader();writer.writerows(rows)
body=stream.getvalue().encode();(target/"domain217-native3857-bounds.csv").write_bytes(body)
metadata={"schema":"upstate.original-domain-bounds/v1","source":{k:source[k] for k in ("id","title","uri","vintage","sha256","bytes","decoded_sha256","decoded_bytes","source_crs")},
 "original_spatial_reference":original["spatialReference"],"feature_count":217,"output":{"path":"domain217-native3857-bounds.csv","bytes":len(body),"sha256":hashlib.sha256(body).hexdigest()},
 "method":"Per-feature minima and maxima over every X/Y position in every original Esri geometry ring. Original feature ordering, numeric precision and native feature identifiers retained; no reprojection, simplification, rounding, buffer or envelope union.",
 "use":"Original217 domain feature query envelopes for source-side NHD/FW capture. Envelope queries require final intersection against the original rings; bounds alone include space outside the original polygon.",
 "original_geometry":"model-domain.esri.json.gz","original_ring_identity":"CSV original_rings_pointer selects each feature in the exact decoded source body.",
 "native_extent":{"xmin":min(r["xmin"] for r in rows),"ymin":min(r["ymin"] for r in rows),"xmax":max(r["xmax"] for r in rows),"ymax":max(r["ymax"] for r in rows)}}
(target/"domain217-native3857-bounds.json").write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+"\n")
manifest={"schema":"upstate.sources/v1","title":"Original217 Upper Savannah WBD native3857 query envelopes","captured_at":source["vintage"],
 "entries":[{"id":"upstate-domain217-native3857-bounds-20261013","title":"Original217 WBD ring envelopes","kind":"table","role":"ORIGINAL_DOMAIN_QUERY_BOUNDS",
 "path":"domain217-native3857-bounds.csv","uri":source["uri"],"vintage":source["vintage"],"sha256":hashlib.sha256(body).hexdigest(),"source_crs":"EPSG:3857",
 "metadata":metadata,"companions":[{"path":"domain217-native3857-bounds.json","sha256":hashlib.sha256((target/"domain217-native3857-bounds.json").read_bytes()).hexdigest()}]}]}
(target/"sources.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
print(json.dumps({"csv":metadata["output"],"count":len(rows),"extent":metadata["native_extent"],"directory":str(target)}))
