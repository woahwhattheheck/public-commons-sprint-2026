"""Authored capacity case; executes the complete specified linear network."""
import json,resource,time,sys
from pathlib import Path
from reach_chemistry.model import Project
from reach_chemistry.solver import simulate
n=int(sys.argv[1]) if len(sys.argv)>1 else 20000
provenance={'kind':'constructed-capacity-case','reference':'REACT12 explicit chain, 100 m3/day boundary throughflow, independently tagged 0.001 kg/day point sources; not field measurements.'}
start=time.perf_counter()
raw={'schema':'reach-chemistry/1','title':str(n)+'-reach complete capacity run','species':[{'id':s,'basis':b,'provenance':provenance} for s,b in [('A','N'),('B','N'),('C','P'),('D','P')]], 'reaches':[{'id':'r'+str(i),'volume_m3':10000,'provenance':provenance} for i in range(n)], 'flows':[{'id':'f'+str(i),'source':'r'+str(i-1) if i else None,'target':'r'+str(i) if i<n else None,'m3_day':100,'provenance':provenance} for i in range(n+1)], 'loads':[{'id':'source-'+str(i),'reach':'r'+str(i),'species':'A' if i%2 else 'C','kg_day':.001,'source_tag':'source-'+str(i),'provenance':provenance} for i in range(n)],'reactions':[{'id':'n','source':'A','products':{'B':1},'rate_day':.1,'provenance':provenance},{'id':'p','source':'C','products':{'D':1},'rate_day':.04,'provenance':provenance}], 'phases':[{'until_day':10}]}
p=Project(raw);op=p.compile(p.phases[0]);nnz=op.A.nnz;tags=len(op.forcing_by_tag);stored=sum(len(v) for v in op.forcing_by_tag.values());del op
r=simulate(p,[0,10],targets=[{'reach':'r'+str(n-1),'species':'B'}]).result()
result={'case':'constructed full chain capacity','reaches':n,'states':p.n,'operator_nonzero_entries':nnz,'distinct_sources':tags,'stored_source_state_values':stored,'elapsed_seconds':time.perf_counter()-start,'peak_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'maximum_relative_budget_residual':max(abs(b['relative_residual']) for b in r['budgets']),'budgets':r['budgets']}
print(json.dumps(result,indent=2))
