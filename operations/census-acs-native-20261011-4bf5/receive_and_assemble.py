"""Read original acquired SF100 bytes and invoke the original private assembler."""
import argparse,hashlib,json,sys
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('--checkout',required=True);p.add_argument('--run',required=True);p.add_argument('--node',required=True);p.add_argument('--peoria-source',required=True);args=p.parse_args()
checkout=Path(args.checkout);run=Path(args.run)
prefix=checkout/'stellar/scf-starforge-20261009'
sys.path.insert(0,str(prefix/'sf88-operator-buyer-cli/python'))
sys.path.insert(0,str(prefix/'sf30-seller-sdk/census-acs/consumer'))
from stellar_forge_buyer.datasets import DatasetAcquisition
from census_delivery import restore_source_files
from peoria_assemble import load_original_assembler,assemble_received

expected={2023:('830ca9e4a8c2f386d66b1be4ef2b4877ff2e6a1b6f1bd72b9b0db79dd25c3598','23115cea68ed5d0e8250b717f8c9789713f9a8b39288b670451eb69fd1cb65e0'),2024:('fd511a0887a4be43cfa5265beb48224ff68f995cda3e1dcc1d3c9cc12cf19fd6','0d06d7db2d45c0003424515f00e8017a54428194c29d95f41ef8d509b2cff054')}
assembler_path=Path(args.peoria_source).resolve()
raw=(assembler_path/'acs.py').read_bytes()
assert hashlib.sha1(('blob '+str(len(raw))+'\0').encode()+raw).hexdigest()=='57e4436d117d44b169a4d0bf46123c33e8f87cde'
assembler=load_original_assembler(assembler_path)
results=[]
for year in [2023,2024]:
    acquisition=DatasetAcquisition(checkout=checkout,session=run/('acquisition-'+str(year)),node=args.node,timeout=360)
    original=acquisition.inspect()
    assert original['status']=='COMPLETE',original
    delivery=acquisition.deliver(run/('delivery-'+str(year)))
    received=restore_source_files(delivery,run/('received-'+str(year)),expected_capture_id=expected[year][0],expected_year=year)
    assert hashlib.sha256(received.native_package_bytes()).hexdigest()==expected[year][1]
    assert len(received.method_sources())==1
    output=run/('peoria-'+str(year));marker=run/('assembled-'+str(year)+'.json')
    if marker.exists():
        assembled=json.loads(marker.read_text())
        assert hashlib.sha256(Path(assembled['bundle_path']).read_bytes()).hexdigest()==assembled['sha256']
    else:
        native=assemble_received(received,assembler,output)
        assembled={k:v for k,v in native.items() if k!='bundle'}
        marker.write_text(json.dumps(assembled,sort_keys=True)+'\n');marker.chmod(0o600)
    reopened=restore_source_files(acquisition.deliver(run/('delivery-'+str(year))),run/('received-'+str(year)),expected_capture_id=expected[year][0])
    assert reopened.reopened
    results.append({'received':received.summary(),'reopened':reopened.reopened,'assembled':assembled})
print(json.dumps(results,ensure_ascii=False,allow_nan=False))
