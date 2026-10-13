"""Offline scientific review for the original disturbance study outputs."""
from __future__ import annotations
import base64
import json
from pathlib import Path
import zlib


def write(path, report, joint, arrays, source):
    import numpy as np
    import rasterio
    payload=dict(report)
    previews={}
    for row in report['rows']:
        key=row['run_id']+'-'+row['quantity']
        if key not in previews:
            values=(arrays[row['run_id'],row['quantity']]-arrays[row['baseline_run_id'],row['quantity']]).copy()
            values[~joint]=np.nan
            packed=np.asarray(values,dtype='<f8').tobytes()
            previews[key]=base64.b64encode(zlib.compress(packed,9)).decode('ascii')
    masks={}
    for case in report['cases']:
        key=case['mask_id']
        if key not in masks:
            with rasterio.open(source/(key+'.tif')) as ds: data=ds.read(1)
            masks[key]=base64.b64encode(zlib.compress(data.tobytes(),9)).decode('ascii')
    payload['preview_maps']=previews;payload['masks']=masks
    payload['review']={'note':'','selection':{}}
    template=Path(__file__).with_name('disturbance_report.html').read_text(encoding='utf-8')
    serialized=json.dumps(payload,ensure_ascii=False,allow_nan=False,separators=(',',':')).replace('<','\\u003c')
    Path(path).write_text(template.replace('__STUDY_DATA__',serialized),encoding='utf-8')
