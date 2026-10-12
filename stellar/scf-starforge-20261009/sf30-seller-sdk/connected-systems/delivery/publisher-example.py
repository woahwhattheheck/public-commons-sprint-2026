"""MIT. Receive the exact committed OGC indoor-temperature example.

This example is illustrative publisher data. It is not a live sensor observation
or evidence that one of the public CSAPI demonstration servers is operational.
All HTTP resources are fetched and retained by the maintained Workspace.
"""
from __future__ import annotations
import argparse, hashlib, json, runpy, sys
from pathlib import Path

COMMIT="fb858be23aa03e2b824ec50b5a97ac2c2a1d3fec"
REPOSITORY="opengeospatial/ogcapi-connected-systems"
BASE="https://raw.githubusercontent.com/"+REPOSITORY+"/"+COMMIT+"/"
FILES=json.loads("{\"datastream-simple\":{\"path\":\"api/part2/openapi/examples/datastreams/datastream-simple.json\",\"gitBlob\":\"dae95471c4192a93d5823acc79e99e1452350060\",\"bytes\":1238,\"sha256\":\"75e43bcfa85af757f22f5ef3e248e8cdfead1cd44d16ecf896459c4c9b1e2000\"},\"obs-simple\":{\"path\":\"api/part2/openapi/examples/observations/obs-simple.json\",\"gitBlob\":\"412ebe2d7a580fccbb24c9e4faec34f2ad099f92\",\"bytes\":178,\"sha256\":\"57aa8e6b29c4a054ec6bcce4dd6f6a0b16d9bb00263b5b04fe91f8dc65f17fba\"},\"scalar-schema\":{\"path\":\"api/part2/openapi/examples/schemas/observationSchema-scalar-json.json\",\"gitBlob\":\"f1da3dd85359b8299b846d55931d3f2d781642bc\",\"bytes\":633,\"sha256\":\"918c8541367b4b851768e72989314400a7f492aea3df44b4044d5cbf175476bf\"},\"thermometer\":{\"path\":\"api/part1/openapi/examples/systems/thermometer-sensor-sml.json\",\"gitBlob\":\"841fdd0c60499720a69f6a57b8b2a905e459c93c\",\"bytes\":853,\"sha256\":\"f27c4b096ad3de331a09cd2f082200bb03232f9560efa00fa911ef3821bfa54e\"},\"license\":{\"path\":\"LICENSE\",\"gitBlob\":\"698ee66576b5c3c7dab3b2cc42ddc12292964355\",\"bytes\":4443,\"sha256\":\"b3b9a76d230f057844d004c374406453d92f863caecaa42ccd9c7863e143fed1\"}}")
COMPLETE="CONNECTED_SYSTEMS_PUBLISHER_REFERENCE_COMPLETE"

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root",type=Path,required=True)
    parser.add_argument("--operation-root",type=Path,required=True)
    parser.add_argument("--operation-id",default="ogc-room-temperature-reference-v1")
    parser.add_argument("--node")
    args=parser.parse_args(argv)
    root=args.source_root.resolve(strict=True)
    sys.path.insert(0,str(root))
    if args.node:
        import os
        os.environ["SF30_XML_NODE"]=str(Path(args.node).resolve(strict=True))
    import csapi_source as source
    from csapi_workspace import Workspace,json_bytes,private_dir,retained,operation_id
    native=runpy.run_path(str(root/"delivery"/"native-receive.py"),run_name="_csapi_original_native_receiver")
    operation_id(args.operation_id)
    operation=private_dir(args.operation_root.expanduser().absolute())
    output=private_dir(operation/"publisher-reference")
    workspace_path=operation/"workspace"
    intent={"schema":"stellar-forge.connected-systems-publisher-reference-intent.v1",
        "operationId":args.operation_id,"repository":REPOSITORY,"commit":COMMIT,
        "resources":FILES,"observationResource":"single",
        "classification":"Unmodified illustrative example supplied in the publisher repository; not a field measurement."}
    with native["owner_lock"](output/"publisher-owner.lock"):
        retained(output/"publisher-intent.json",json_bytes(intent))
        license_path=root/"examples"/"ogc-connected-systems-LICENSE.txt"
        if native["identity"](license_path)!={k:FILES["license"][k] for k in ("bytes","sha256")}:
            raise ValueError("Keep the exact publisher license beside this reference.")
        native["copy_original"](license_path,output/"OGC-LICENSE.txt",native["identity"](license_path))
        if (output/"publisher-result.json").exists():
            result=native["read_json"](output/"publisher-result.json",1024*1024)
            if result.get("status")!=COMPLETE or result.get("intentSha256")!=hashlib.sha256(json_bytes(intent)).hexdigest():
                raise ValueError("The existing publisher result belongs to another original reference.")
            prior=native["read_json"](operation/"native"/"native-progress.json")
            if prior.get("status")!="CONNECTED_SYSTEMS_NATIVE_RECEIVING_COMPLETE":
                raise ValueError("The original completed native receipt is unavailable.")
            if native["identity"](operation/"native"/"native-result.json")!=result["nativeResult"]:
                raise ValueError("The original completed native result changed.")
            print(json.dumps({"status":COMPLETE,"replayed":True,"result":str(output/"publisher-result.json")}),flush=True)
            return result
        with Workspace(workspace_path,create=not workspace_path.exists()) as workspace:
            connection=workspace.save_connection({"name":"Exact committed OGC room-temperature reference",
                "baseUrl":BASE,"allowedOrigins":[],"authorizationEnv":None})
            query_input={"schema":source.QUERY_SCHEMA,"connectionId":connection["id"],
                "name":"OGC committed indoor-temperature example (one original observation)",
                "datastreamUrl":BASE+FILES["datastream-simple"]["path"],
                "schemaUrl":BASE+FILES["scalar-schema"]["path"],
                "observationsUrl":BASE+FILES["obs-simple"]["path"],
                "systemUrl":BASE+FILES["thermometer"]["path"],"obsFormat":"application/json",
                "observationResource":"single","schemaUrlPolicy":"exact","params":[],
                "limits":{"maxPages":1,"maxRows":1,"maxBytes":1048576},
                "rights":{"license":"https://github.com/"+REPOSITORY+"/blob/"+COMMIT+"/LICENSE",
                    "attribution":"Open Geospatial Consortium, original committed examples",
                    "usage":"Illustrative publisher example, not a field measurement. Preserve the original license and all metadata, including the publisher's differing indoor/outdoor labels and original resultTime interval.",
                    "sourceUrl":"https://github.com/"+REPOSITORY+"/tree/"+COMMIT}}
            saved=workspace.save_query(query_input)
            original_query_path=output/"query.json"
            acquisition_id=args.operation_id
            correction=None
            if original_query_path.exists():
                original_saved=native["read_json"](original_query_path)
                if original_saved["id"]!=saved["id"]:
                    previous=workspace.operation(args.operation_id)
                    previous_body=dict(original_saved["query"])
                    previous_body.pop("schemaUrlPolicy",None)
                    candidate=dict(saved["query"]);candidate.pop("schemaUrlPolicy",None)
                    candidate["schemaUrl"]=source.query_url(candidate["schemaUrl"],[{"name":"obsFormat","value":"application/json"}])
                    if previous_body!=candidate or previous.get("request")!={"queryId":original_saved["id"],"label":original_saved["query"]["name"]}:
                        raise ValueError("The retained publisher query differs by more than its explicit static schema URL.")
                    if previous.get("status")=="complete":
                        saved=original_saved
                    else:
                        if previous.get("status")!="failed" or previous.get("result") is not None:
                            raise ValueError("Reconcile the original acquisition before selecting the exact schema URL.")
                        acquisition_id=args.operation_id[:74]+"-schema-"+saved["id"][:12]
                        operation_id(acquisition_id)
                        correction={"schema":"stellar-forge.connected-systems-publisher-query-correction.v1",
                            "originalOperationId":args.operation_id,"originalQueryId":original_saved["id"],
                            "selectedOperationId":acquisition_id,"selectedQueryId":saved["id"],
                            "previousRequestSha256":previous["requestSha256"],"schemaUrlPolicy":"exact",
                            "reason":"The publisher supplies an immutable static schema URL; preserve that selected URL without adding a live-service format parameter."}
                        retained(output/"exact-schema-query-selection.json",json_bytes(correction))
            else:
                retained(original_query_path,json_bytes(saved))
            query_id=saved["id"]
            retained(output/"connection.json",json_bytes(connection))
            retained(private_dir(output/"query-selections")/(query_id+".json"),json_bytes(saved))
            print(json.dumps({"event":"original_publisher_acquisition","operationId":args.operation_id,
                              "queryId":query_id,"acquisitionOperationId":acquisition_id,"workspace":str(workspace_path)}),flush=True)
            acquired=workspace.acquire(query_id,acquisition_id,label=saved["query"]["name"])
            sid=acquired["source"]["id"]
            original=workspace.source(sid)
            capture_path=workspace.root/"sources"/(sid+".connected-systems")
            with capture_path.open("rb") as stream,source.Capture(stream) as capture:
                capture.validate()
                if capture.manifest["selection"].get("observationResource")!="single":
                    raise ValueError("The publisher example must remain an explicit single observation resource.")
                roles={"datastream":"datastream-simple","schema":"scalar-schema",
                       "schemaAfter":"scalar-schema","system":"thermometer"}
                for role,name in roles.items():
                    data=capture.read(capture.manifest["resources"][role])
                    expected=FILES[name]
                    if len(data)!=expected["bytes"] or hashlib.sha256(data).hexdigest()!=expected["sha256"]:
                        raise ValueError("Actual publisher HTTP bytes differ from the committed "+name+" resource.")
                if len(capture.manifest["pages"])!=1:raise ValueError("The publisher supplies exactly one original observation object.")
                original_observation=capture.read(capture.manifest["pages"][0])
                expected=FILES["obs-simple"]
                if len(original_observation)!=expected["bytes"] or hashlib.sha256(original_observation).hexdigest()!=expected["sha256"]:
                    raise ValueError("Actual publisher observation bytes differ from the committed original.")
                expected_observation=source.json_value(original_observation,True)
                if capture.manifest["coverage"]!={"status":"exhausted","pages":1,"observations":1,
                    "nextUrl":None,"consistency":"sequential-pages-not-transactional-snapshot",
                    "scope":"single-observation-resource"}:
                    raise ValueError("The example must disclose exactly one selected observation resource.")
            retained(output/"original-acquisition.json",json_bytes(acquired))
            receipt={"schema":"stellar-forge.connected-systems-publisher-acquisition.v1",
                "operationId":args.operation_id,"repository":REPOSITORY,"commit":COMMIT,
                "queryId":query_id,"acquisitionOperationId":acquisition_id,"queryCorrection":correction,"source":sid,"sourceBytes":original["bytes"],
                "files":FILES,"coverage":acquired["coverage"],"rights":original["inventory"]["rights"]}
            retained(output/"publisher-acquisition.json",json_bytes(receipt))
        native_args=["--source-root",str(root),"--operation-root",str(operation),
            "--operation-id",args.operation_id,"--workspace",str(workspace_path),
            "--source",sid,"--coverage-policy","require-exhausted","--page-size","1"]
        if args.node:native_args.extend(["--node",args.node])
        result=native["main"](native_args)
        row=result["sources"][0]["traversal"]["first"]["rows"][0]
        if row["observation_id"]!=expected_observation["id"] or row["datastream_id"]!=expected_observation["datastream@id"]:
            raise ValueError("Native cells differ from the original publisher observation identity.")
        if row["result_time"]!=expected_observation["resultTime"]:
            raise ValueError("Native result time differs from the original publisher value.")
        encoded=source.json_value(row["original_observation"].encode("utf-8"),True)
        if source.lexical_json(encoded,True)!=source.lexical_json(expected_observation,True):
            raise ValueError("Native original_observation changed the publisher's exact JSON values.")
        if any(item["rowCount"]!=1 for item in result["receiving"]):
            raise ValueError("The independent customer did not retain exactly the original example.")
        finished={"schema":"stellar-forge.connected-systems-publisher-reference.v1","status":COMPLETE,
            "operationId":args.operation_id,"intentSha256":hashlib.sha256(json_bytes(intent)).hexdigest(),
            "repository":REPOSITORY,"commit":COMMIT,"queryId":query_id,"acquisitionOperationId":acquisition_id,"queryCorrection":correction,"source":sid,
            "nativeResult":native["identity"](operation/"native"/"native-result.json"),
            "originalObservation":FILES["obs-simple"],"rowCount":1,
            "snapshot":result["sources"][0]["build"]["native"]["snapshot"],
            "projectPacket":{k:result["sources"][0]["packet"][k] for k in ("bytes","sha256")},
            "customerPacket":{k:result["receiving"][0]["packet"][k] for k in ("bytes","sha256")},
            "originalCellsVerified":True,"coldReopenVerified":True,
            "coverage":acquired["coverage"],"classification":intent["classification"]}
        retained(output/"publisher-result.json",json_bytes(finished))
        print(json.dumps({"status":COMPLETE,"result":str(output/"publisher-result.json"),
                          "rows":1,"snapshot":finished["snapshot"]}),flush=True)
        return finished

if __name__=="__main__":
    main()
