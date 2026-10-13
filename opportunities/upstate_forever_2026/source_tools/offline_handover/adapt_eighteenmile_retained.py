#!/usr/bin/env python3
"""Expose the already-derived Eighteenmile result index to the offline reader.

This is a format adapter, not another analytical calculation. Original bounds
are copied from analysis/source-result-index.csv. Result source bytes and exact
row joins are checked before carrying complete original fields into the view.
"""
from __future__ import annotations
import argparse, csv, hashlib, json
from pathlib import Path

def adapt(root: Path, output: Path) -> dict:
    index_path=root/'analysis/source-result-index.csv'
    index=list(csv.DictReader(index_path.open(encoding='utf-8-sig', newline='')))
    originals={}
    for path in (root/'original').glob('nutrients-*.csv'):
        body=path.read_bytes(); digest=hashlib.sha256(body).hexdigest()
        originals[digest]=(path.relative_to(root).as_posix(), list(csv.DictReader(body.decode('utf-8-sig').splitlines())))
    records=[]
    for item in index:
        source_path,raws=originals[item['source_sha256']]
        ordinal=int(item['source_data_row']); original=raws[ordinal-1]
        for a,b in [('ActivityIdentifier','activity'),('ActivityStartDate','date'),('CharacteristicName','characteristic')]:
            if original[a]!=item[b]: raise ValueError(f'Original row join differs: {source_path}:{ordinal}:{a}')
        censored=item['censored']=='true'
        lower=float(item['lower']) if item['lower'].strip() else None
        upper=float(item['upper']) if item['upper'].strip() else None
        status='left_censored' if censored and upper is not None else ('left_censored_without_comparable_limit' if censored else ('reported_numeric' if lower is not None and upper is not None else 'unquantified'))
        def val(key): return original.get(key,'')
        record={
          'record_id':item['source_path']+':data-row:'+str(ordinal),
          'station_id':original['MonitoringLocationIdentifier'], 'group':'Nutrient',
          'activity_id':item['activity'],'result_id':val('ResultIdentifier'),
          'date':item['date'],'time':item['time'],'time_zone':item['timezone'],
          'activity_type':val('ActivityTypeCode'),'sample_media':val('ActivityMediaName'),
          'sample_media_subdivision':val('ActivityMediaSubdivisionName'),
          'characteristic':item['characteristic'],'fraction':item['fraction'],
          'value_text':item['reported'],'unit':item['reported_unit'],
          'detection_condition':item['condition'],'limit_type':item['limit_type'],
          'limit_value':item['limit'],'limit_unit':item['limit_unit'],
          'qualifier':val('MeasureQualifierCode'),'result_status':val('ResultStatusIdentifier'),
          'result_value_type':item['value_type'],'method_id':item['method'],
          'method_context':val('ResultAnalyticalMethod/MethodIdentifierContext'),
          'method_name':val('ResultAnalyticalMethod/MethodName'),
          'method_specification':val('MethodSpecificationName'),
          'depth_value':item['depth'],'depth_unit':item['depth_unit'],
          'depth_reference':val('ActivityDepthAltitudeReferencePointText'),
          'result_depth_value':val('ResultDepthHeightMeasure/MeasureValue'),
          'result_depth_unit':val('ResultDepthHeightMeasure/MeasureUnitCode'),
          'result_depth_reference':val('ResultDepthAltitudeReferencePointText'),
          'temperature_basis':val('ResultTemperatureBasisText'),
          'weight_basis':item['weight_basis'],'analytical_fraction':val('ResultParticleSizeBasisText'),
          'source_file':source_path,'source_row':ordinal+1,'source_data_row':ordinal,
          'source_sha256':item['source_sha256'],'original_source_path':item['source_path'],
          'interval':{'status':status,'lower':lower,'upper':upper,'lower_inclusive':True,
                      'upper_inclusive':item['upper_open']!='true','unit':item['unit'],
                      'unit_basis':item['unit_source']},'original':original,'retained_index_row':item}
        records.append(record)
    records.sort(key=lambda r:(r['date'],r['activity_id'],r['characteristic'],r['record_id']))
    source_summary=json.loads((root/'source-summary.json').read_text())
    data={'summary':{'title':'Eighteenmile stream nutrients, original records 2020-2025',
          'records':len(records),'activities':len({r['activity_id'] for r in records}),
          'stations':sorted({r['station_id'] for r in records}),
          'source_index':'analysis/source-result-index.csv',
          'source_index_sha256':hashlib.sha256(index_path.read_bytes()).hexdigest(),
          'format_adapter':'Retained interval endpoints and original result rows, without analytical recalculation.',
          'original_source_summary':source_summary},'records':records}
    output.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
    return {'records':len(records),'activities':data['summary']['activities'],'stations':data['summary']['stations']}
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('output',type=Path);a=p.parse_args();print(json.dumps(adapt(a.root,a.output),indent=2))
