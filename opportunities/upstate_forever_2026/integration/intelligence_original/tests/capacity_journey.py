"""Authored full-population capacity exercise, not environmental measurements."""
import json,math,resource,tempfile,time
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window
from eco_intelligence.profiling import table_profile,pair_tables,compare_rasters

def run():
    start=time.perf_counter(); measurements={}
    with tempfile.TemporaryDirectory(prefix='eco-capacity-') as tmp:
        root=Path(tmp); n=1_000_000
        a=root/'observations.csv';b=root/'predictions.csv'
        with a.open('w') as fa,b.open('w') as fb:
            fa.write('id,observed_sediment\n');fb.write('id,predicted_sediment\n')
            for i in range(1,n+1):fa.write(f'{i},{10*i}\n');fb.write(f'{i},{8*i}\n')
        t=time.perf_counter();profile=table_profile(a)
        assert profile['rows']==n
        assert profile['columns']['observed_sediment']['numeric']['sum']==5*n*(n+1)
        measurements['million_row_profile_seconds']=time.perf_counter()-t
        t=time.perf_counter();paired,obs,pred=pair_tables(a,b,['id'],'observed_sediment','predicted_sediment')
        assert paired['coverage']['paired_finite']==n and obs==[] and pred==[]
        assert abs(paired['pbias_percent']+20)<1e-9
        assert math.isclose(paired['rmse'],2*math.sqrt((n+1)*(2*n+1)/6),rel_tol=1e-10)
        measurements['million_row_complete_join_seconds']=time.perf_counter()-t
        width=4096; paths=[]
        for name,value in [('baseline',10.),('candidate',8.)]:
            path=root/(name+'.tif');paths.append(path)
            with rasterio.open(path,'w',driver='GTiff',width=width,height=width,count=1,dtype='float32',crs='EPSG:32617',transform=from_origin(400000,3900000,30,30),nodata=-9999,tiled=True,blockxsize=512,blockysize=512,compress='DEFLATE') as dst:
                dst.set_band_unit(1,'arbitrary_fixture_units')
                for y in range(0,width,512):
                    for x in range(0,width,512):
                        block=np.full((512,512),value,dtype='float32')
                        if x==y==0:block[0,0]=-9999
                        dst.write(block,1,window=Window(x,y,512,512))
        t=time.perf_counter();r=compare_rasters(*paths)
        assert r['paired_cells']==width*width-1
        assert r['relative_sum_change_percent']==-20
        assert r['candidate_minus_baseline']['mean']==-2
        measurements['16777215_cell_comparison_seconds']=time.perf_counter()-t
        measurements.update(rows_per_table=n,paired_raster_cells=r['paired_cells'],all_assertions_passed=True,
                            exercise='Authored capacity workload, not a scientific model run',
                            peak_rss_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                            total_seconds=time.perf_counter()-start)
    print(json.dumps(measurements,indent=2))

if __name__=='__main__':run()
