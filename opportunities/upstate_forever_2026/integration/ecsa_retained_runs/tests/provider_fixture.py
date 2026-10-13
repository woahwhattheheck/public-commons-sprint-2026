"""Execution-protocol fixture, not a watershed model or customer dataset."""
from pathlib import Path
import os
import time
import uuid
import numpy as np
import pandas as pd
from ecsa_runs.context import emit_event,current_execution
COUNT=0

def run_model(family,inputs,data_dir):
    global COUNT
    COUNT+=1
    emit_event('fixture_computation', {'rows':inputs.get('rows',3)})
    if inputs.get('sleep'):time.sleep(inputs['sleep'])
    if inputs.get('crash_once') and current_execution()['attempt']==1:os._exit(23)
    if inputs.get('error'):raise RuntimeError('Fixture requested failure')
    if inputs.get('mutate'):Path(data_dir,'retained.txt').write_text('changed')
    rows=inputs.get('rows',3);value=inputs.get('value',2)
    frame=pd.DataFrame({'source_cell_id':pd.Series([f'{x:06d}' for x in range(rows)],dtype='string'),
                        'nitrate_final_mg_l':np.arange(rows,dtype='float64')+value})
    metrics=pd.DataFrame([{'metric':'fixture_value','label':'Fixture value','value':value,'unit':'mg/L'},
                          {'metric':'zero','label':'Zero','value':0,'unit':'mg/L'}])
    weather=Path(inputs['weather_csv']).read_bytes() if inputs.get('weather_csv') else b''
    out=Path('native-outputs')/uuid.uuid4().hex;out.mkdir(parents=True)
    (out/'result.bin').write_bytes(bytes(range(256))*4096)
    (out/'cells.csv').write_text(frame.to_csv(index=False))
    return {'family':family,'run_id':uuid.uuid4().hex,'inputs':inputs,'metrics':metrics,'spatial':frame,
            'weather_received':weather,'native_output':str(out.resolve()),'original_data':Path(data_dir,'retained.txt').read_text(),
            'warm_count':COUNT,'pid':os.getpid()}

def run_scenario(family,inputs,scenario_name,data_dir):
    result=run_model(family,inputs,data_dir);result['scenario_name']=scenario_name;return result
