from pathlib import Path
import json
P={"kind":"constructed-reference", "reference":"TokenJunkieLabs authored four-reach mathematical example; coefficients are editable and are not site estimates."}
def row(**kw): return dict(kw, provenance=P.copy())
p={"schema":"reach-chemistry/1", "title":"Four-reach editable chemistry demonstration", "provenance":P,
   "species":[row(id='ammonium_n',basis='N'),row(id='nitrate_n',basis='N'),row(id='dissolved_p',basis='P'),row(id='particulate_p',basis='P')],
   "reaches":[row(id='tributary_a',volume_m3=1000),row(id='tributary_b',volume_m3=800),row(id='confluence',volume_m3=2000),row(id='reservoir',volume_m3=6000)],
   "flows":[row(id='boundary_a',source=None,target='tributary_a',m3_day=1000,concentration_mg_l={'ammonium_n':0.2,'nitrate_n':0.4},source_tag='upstream'),
            row(id='boundary_b',source=None,target='tributary_b',m3_day=400,concentration_mg_l={'nitrate_n':0.12},source_tag='upstream'),
            row(id='a_to_c',source='tributary_a',target='confluence',m3_day=1000),row(id='b_to_c',source='tributary_b',target='confluence',m3_day=400),
            row(id='c_to_r',source='confluence',target='reservoir',m3_day=1400),row(id='outlet',source='reservoir',target=None,m3_day=1400)],
   "exchanges":[row(id='reservoir_exchange',a='confluence',b='reservoir',m3_day=200)],
   "reactions":[row(id='nitrification',source='ammonium_n',products={'nitrate_n':1.0},rate_day=0.15),
                row(id='denitrification',source='nitrate_n',products={},rate_day=0.035,sink_label='untracked nitrogen gas'),
                row(id='sorption',source='dissolved_p',products={'particulate_p':1.0},rate_day=0.08),
                row(id='release',source='particulate_p',products={'dissolved_p':1.0},rate_day=0.02),
                row(id='settling',source='particulate_p',products={},rate_day=0.04,sink_label='untracked deposited phosphorus')],
   "loads":[row(id='point_n',reach='tributary_a',species='ammonium_n',kg_day=10.0,source_tag='point-source'),
            row(id='runoff_p',reach='tributary_b',species='dissolved_p',kg_day=0.2,source_tag='diffuse-source')],
   "initial":[row(id='initial_n',reach='reservoir',species='nitrate_n',kg=2)],
   "phases":[{'until_day':3}, {'until_day':10,'load_multipliers':{'runoff_p':2}}, {'until_day':20,'load_multipliers':{'point_n':0.5}}]}
base=Path(__file__).parent/'examples'; base.mkdir(exist_ok=True)
(base/'network.json').write_text(json.dumps(p,indent=2)+'\n')
parameters=[{'id':'nitrification_rate','kind':'reaction_rate_day','target':'nitrification','lower':0.01,'upper':0.5},
            {'id':'point_load','kind':'load_kg_day','target':'point_n','lower':2,'upper':20}]
(base/'parameters.json').write_text(json.dumps(parameters,indent=2)+'\n')
obs=[{'id':f'{reach}-{species}-{day}','reach':reach,'species':species,'day':day,'sigma_mg_l':0.05}
      for reach in ['tributary_a','confluence','reservoir'] for species in ['ammonium_n','nitrate_n'] for day in [1,3,6,10,15,20]]
(base/'monitoring-candidates.json').write_text(json.dumps(obs,indent=2)+'\n')
(base/'run-request.json').write_text(json.dumps({'operation':'run','project':p,'sample_days':[0,1,3,6,10,15,20],
    'targets':[{'reach':'reservoir','species':s} for s in ['ammonium_n','nitrate_n','dissolved_p','particulate_p']]},indent=2)+'\n')
