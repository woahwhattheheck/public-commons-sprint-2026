"""Run the intelligence workspace against a host-produced catalog projection."""
from pathlib import Path
import argparse
from fastapi import FastAPI
from .api import install_intelligence
from .adapters import CatalogRepository, CallbackGateway

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog',type=Path,required=True)
    parser.add_argument('--data-root',type=Path,required=True)
    parser.add_argument('--state',type=Path,required=True)
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--port',type=int,default=8000)
    args=parser.parse_args()
    app=FastAPI(title='Eco Science intelligence workspace')
    install_intelligence(app,repository=CatalogRepository(args.catalog,args.data_root),
                         state_path=args.state,gateway=CallbackGateway(None))
    import uvicorn
    uvicorn.run(app,host=args.host,port=args.port)

if __name__=='__main__': main()
