#!/usr/bin/env python3
"""Customer client for original SF101 purchased API passes and saved results."""
from __future__ import annotations
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import sys
from urllib.parse import quote, urlencode, urlsplit

class ClientError(Exception):
    pass

def need(condition, code):
    if not condition:
        raise ClientError(code)

def base_origin(value):
    parsed = urlsplit(value)
    need(parsed.scheme in {"http","https"} and parsed.hostname and not parsed.username
         and not parsed.password and parsed.path in {"","/"} and not parsed.query
         and not parsed.fragment,"HTTPS_OR_LOOPBACK_BASE_ORIGIN_REQUIRED")
    need(parsed.scheme=="https" or parsed.hostname in {"127.0.0.1","::1","localhost"},
         "HTTPS_OR_LOOPBACK_BASE_ORIGIN_REQUIRED")
    return parsed

def request(base_url, path, *, token, method="GET", body=None, headers=None, timeout=150):
    parsed = base_origin(base_url)
    need(isinstance(token,str) and 32<=len(token.encode("utf-8"))<=1024
         and all(32<=ord(c)<=126 for c in token),"CLAIM_TOKEN_UNAVAILABLE")
    cls = http.client.HTTPSConnection if parsed.scheme=="https" else http.client.HTTPConnection
    options = {"timeout":timeout}
    if parsed.scheme=="https":
        options["context"] = ssl.create_default_context()
    connection = cls(parsed.hostname,parsed.port,**options)
    try:
        connection.request(method,path,body=body,
            headers={"Authorization":"Bearer "+token,"Accept":"application/json",
                     "Connection":"close",**(headers or {})})
        response = connection.getresponse()
        data = response.read(4*1024*1024+1)
        need(len(data)<=4*1024*1024,"RESPONSE_TOO_LARGE")
        return {"status":response.status,"headers":{k.lower():v for k,v in response.getheaders()},"body":data}
    except (http.client.HTTPException,OSError,ValueError):
        raise ClientError("REQUEST_OUTCOME_UNKNOWN_RECOVER_THE_SAME_REQUEST_ID") from None
    finally:
        connection.close()

def metadata(response):
    try:
        value = json.loads(response["body"])
    except (ValueError,UnicodeError):
        raise ClientError("SERVER_METADATA_INVALID") from None
    if response["status"]>=400:
        code = value.get("error") if isinstance(value,dict) else None
        raise ClientError(code if isinstance(code,str) and re.fullmatch(r"[A-Z][A-Z0-9_]{1,100}",code)
                          else "SERVER_REQUEST_REJECTED")
    return value

def main(argv=None):
    parser = argparse.ArgumentParser(description="Use or recover an original SF101 purchased API pass.")
    parser.add_argument("action",choices=("inspect","calls","call","recover"))
    parser.add_argument("--base-url",required=True)
    parser.add_argument("--order",required=True)
    parser.add_argument("--claim-env",default="SF101_CLAIM_TOKEN")
    parser.add_argument("--route")
    parser.add_argument("--request-id")
    parser.add_argument("--method",default="GET",choices=("GET","HEAD","POST","PUT","PATCH","DELETE"))
    parser.add_argument("--query",nargs=2,action="append",default=[])
    parser.add_argument("--body")
    parser.add_argument("--content-type",default="application/octet-stream")
    parser.add_argument("--out")
    parser.add_argument("--after")
    parser.add_argument("--limit",type=int,default=100)
    args = parser.parse_args(argv)
    need(re.fullmatch(r"[A-Z][A-Z0-9_]{1,64}",args.claim_env),"INVALID_CLAIM_ENV")
    token = os.environ.get(args.claim_env,"")
    need(re.fullmatch(r"[A-Za-z0-9._:-]{1,80}",args.order),"INVALID_ORDER_REFERENCE")
    path = "/v1/passes/"+quote(args.order,safe="")
    method,body,headers = "GET",None,{}
    if args.action=="calls":
        need(1<=args.limit<=500,"INVALID_PAGE_LIMIT")
        path += "/calls?"+urlencode({"limit":args.limit,**({"after":args.after} if args.after else {})})
    elif args.action in {"call","recover"}:
        need(isinstance(args.request_id,str) and
             re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}",args.request_id),"STABLE_REQUEST_ID_REQUIRED")
        need(isinstance(args.out,str) and Path(args.out).is_absolute(),"ABSOLUTE_PRIVATE_OUTPUT_REQUIRED")
        need(not Path(args.out).exists(),"OUTPUT_ALREADY_EXISTS")
        if args.action=="call":
            need(isinstance(args.route,str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}",args.route),"ROUTE_REQUIRED")
            need(0<len(args.content_type)<=255 and all(32<=ord(c)<=126 for c in args.content_type),
                 "INVALID_CONTENT_TYPE")
            method = args.method
            path += "/routes/"+quote(args.route,safe="")
            if args.query:
                path += "?"+urlencode([(key,value) for key,value in args.query])
            if args.body:
                with open(args.body,"rb") as source:
                    body = source.read(1024*1024+1)
                need(len(body)<=1024*1024,"REQUEST_TOO_LARGE")
            headers = {"Idempotency-Key":args.request_id,"Content-Type":args.content_type}
        else:
            path += "/calls/"+quote(args.request_id,safe="")+"/result"
    response = request(args.base_url,path,token=token,method=method,body=body,headers=headers)
    if args.action in {"inspect","calls"}:
        print(json.dumps(metadata(response),indent=2,ensure_ascii=False))
        return
    digest = response["headers"].get("x-sf101-result-sha256")
    if digest is None:
        metadata(response)
        raise ClientError("REQUEST_HAS_NO_COMPLETED_RESULT")
    need(digest==hashlib.sha256(response["body"]).hexdigest(),"RESPONSE_DIGEST_MISMATCH")
    from cli import private_write
    output = private_write(args.out,response["body"])
    print(json.dumps({"orderRef":args.order,"requestId":args.request_id,"status":response["status"],
        "file":output,"bytes":len(response["body"]),"sha256":digest,
        "replayed":response["headers"].get("x-sf101-replayed")=="true",
        "state":response["headers"].get("x-sf101-call-state"),
        "units":int(response["headers"].get("x-sf101-units","0"))},indent=2))

if __name__=="__main__":
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error,ClientError) else getattr(error,"code","CUSTOMER_COMMAND_FAILED")
        print(json.dumps({"ok":False,"error":code}),file=sys.stderr)
        sys.exit(1)
