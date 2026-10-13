import copy,json,math,tempfile,unittest
from pathlib import Path
import numpy as np
from scipy.linalg import expm
from reach_chemistry.model import Project,ModelError
from reach_chemistry.solver import simulate,attribute_sources,Cancelled,propagate
from reach_chemistry.inference import Parameters,tangent_predictions,fit_observations,design_monitoring,uncertainty
HOME=Path(__file__).resolve().parents[1]
P={'kind':'constructed-reference','reference':'Closed-form verification case.'}
def one():return {'schema':'reach-chemistry/1','title':'One completely mixed reach','species':[{'id':'N','basis':'N','provenance':P}], 'reaches':[{'id':'r','volume_m3':1000,'provenance':P}], 'flows':[{'id':'in','source':None,'target':'r','m3_day':200,'concentration_mg_l':{'N':3},'provenance':P},{'id':'out','source':'r','target':None,'m3_day':200,'provenance':P}], 'initial':[{'id':'initial','reach':'r','species':'N','kg':1,'provenance':P}],'phases':[{'until_day':10}]}
class Engine(unittest.TestCase):
 def setUp(self):self.p=json.loads((HOME/'examples/network.json').read_text());self.q=json.loads((HOME/'examples/calibration-request.json').read_text())
 def test_analytic_cstr_and_export(self):
  result=simulate(one()).result();m=3+(1-3)*math.exp(-.2*10)
  self.assertAlmostEqual(result['final'][0]['kg'],m,places=12)
  self.assertAlmostEqual(result['budgets'][0]['boundary_export_kg'],1+6-m,places=12)
 def test_sparse_matches_dense_augmented_matrix(self):
  p=Project(self.p);op=p.compile(p.phases[0]);n=p.n;dt=1.73
  H=np.zeros((2*n+1,2*n+1));H[:n,:n]=op.A.toarray();H[:n,-1]=op.forcing;H[n:2*n,:n]=np.eye(n)
  expected=expm(H*dt)@np.r_[p.initial,np.zeros(n),1.]
  m,integral=propagate(op.A,op.forcing,p.initial,dt)
  np.testing.assert_allclose(np.r_[m,integral],expected[:2*n],rtol=1e-12,atol=1e-12)
 def test_phase_source_superposition_and_mass(self):
  r=attribute_sources(self.p,[0,1,3,7,10,20]);self.assertLess(r['closure']['relative_error'],1e-12)
  for b in r['baseline']['budgets']:self.assertLess(abs(b['relative_residual']),1e-12)
 def test_cancellation_checkpoint_resume_and_identity(self):
  saved=[];times=[0,1,3,8,10,15,20]
  with self.assertRaises(Cancelled):simulate(self.p,times,checkpoint=saved.append,cancelled=lambda:len(saved)>=3)
  received=simulate(self.p,times,resume=saved[-1]).result();whole=simulate(self.p,times).result()
  self.assertEqual(received['samples'],whole['samples']);self.assertEqual(received['budgets'],whole['budgets'])
  with self.assertRaises(ModelError):simulate(self.p,[0,20],resume=saved[-1])
 def test_hydraulic_basis_and_geometry_errors(self):
  bad=one();bad['flows'][0]['m3_day']=210
  with self.assertRaises(ModelError):Project(bad)
  bad=copy.deepcopy(self.p);bad['reactions'][0]['products']={'DP':1}
  with self.assertRaises(ModelError):Project(bad)
  bad=one();bad['reaches'][0]['geometry']={'type':'Point','coordinates':[0,0]}
  with self.assertRaises(ModelError):Project(bad)
 def test_analytic_tangents_all_supported_fields(self):
  q=copy.deepcopy(self.q);q['parameters'] += [{'id':'initial','kind':'initial_kg','target':'initial_n','lower':0,'upper':10},{'id':'boundary','kind':'boundary_mg_l','target':'boundary_a','species':'NH4-N','lower':0,'upper':1}]
  # Example IDs are read from actual input instead of assumed schema names.
  q['parameters'][-2]['target']=self.p['initial'][0]['id'];q['parameters'][-1]['target']=self.p['flows'][0]['id'];q['parameters'][-1]['species']=next(iter(self.p['flows'][0]['concentration_mg_l']))
  pars=Parameters.parse(Project(self.p),q['parameters']);obs=q['observations']
  predicted,J=tangent_predictions(pars,pars.values,obs)
  for j in range(len(pars.rows)):
   delta=1e-5;plus=pars.values.copy();minus=plus.copy();plus[j]+=delta;minus[j]-=delta
   yp,_=tangent_predictions(pars,plus,obs);ym,_=tangent_predictions(pars,minus,obs)
   np.testing.assert_allclose(J[:,j],(yp-ym)/(2*delta),rtol=2e-7,atol=1e-8)
 def test_calibration_holdout_is_not_fit(self):
  result=fit_observations(self.p,self.q['parameters'],self.q['observations'])
  np.testing.assert_allclose([r['fitted'] for r in result['parameters']],[.23,12.3],rtol=1e-10)
  changed=copy.deepcopy(self.q['observations'])
  for row in changed:
   if row['role']=='holdout':row['mg_l']+=100
  again=fit_observations(self.p,self.q['parameters'],changed)
  self.assertEqual(result['parameters'],again['parameters']);self.assertTrue(result['identifiability']['full_rank'])
 def test_prior_ensemble_reproducibility_and_design(self):
  args=dict(draws=12,seed=42,distributions=[{'id':q['id'],'kind':'uniform'} for q in self.q['parameters']])
  a=uncertainty(self.p,self.q['parameters'],self.q['observations'],**args);b=uncertainty(self.p,self.q['parameters'],self.q['observations'],**args)
  self.assertEqual(a['parameter_draws'],b['parameter_draws']);self.assertEqual(a['prediction_draws_mg_l'],b['prediction_draws_mg_l'])
  self.assertLess(a['maximum_relative_budget_residual'],1e-12)
  d=design_monitoring(self.p,self.q['parameters'],self.q['observations'],count=5,prior_precision=[[100,0],[0,.04]])
  self.assertEqual(len({r['candidate']['id'] for r in d['selected']}),5);self.assertGreater(d['total_logdet_gain'],0)
if __name__=='__main__':unittest.main()
