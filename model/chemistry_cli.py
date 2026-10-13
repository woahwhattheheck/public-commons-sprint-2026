"""Use the existing scientific Workspace; no second project implementation."""
import argparse,json,sys
from .workspace import Workspace
from .chemistry import Chemistry,invoke,ACTIONS

def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument('--workspace',required=True)
    p.add_argument('action',choices=sorted(ACTIONS|{'chemistry.cancel','chemistry.receive-file'}))
    p.add_argument('payload',help='JSON file containing the original operation payload')
    args=p.parse_args(argv)
    try:
        ws=Workspace(args.workspace)
        with open(args.payload,encoding='utf-8') as f: value=json.load(f)
        if args.action=='chemistry.cancel': result=Chemistry(ws).request_cancel(value['run_id'])
        elif args.action=='chemistry.receive-file': result=Chemistry(ws).receive(value['path'])
        else: result=invoke(ws,args.action,value)
        print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False));return 0
    except (ValueError,OSError,KeyError,TypeError) as exc:
        print(json.dumps({'error':type(exc).__name__,'message':str(exc)}),file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
