"""Structural compatibility checks against the read original integration anchors."""
import unittest
from install_chemistry import patch_server,patch_app,patch_index
SERVER='''from model.spatial_exports import SpatialExports
ACTIONS=set()
ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)
class Operator:
    def __init__(self):
        self.customer_reviews = CustomerReviews(self, Fault)
    def _invoke(self,task):
        action=task['action']
        if action in CUSTOMER_REVIEW_ACTIONS:
            return None
    def task(self,task):
        return self.programmes.decorate_task(self.customer_reviews.decorate_task(task))
class Handler:
    def get(self):
        if True:
            if True:
                review_reads = {"/api/reviews/" + name: name for name in CUSTOMER_REVIEW_READS}
                if selected not in {"app.mjs", "reviews.mjs", "programmes.mjs"}:
                    return None
    def post(self):
        if True:
            value = self.body()
'''
APP="""import {attachCustomerReviews} from './reviews.mjs';
const viewLabels={};
const actionLabels={};
function toast(message){}
function render(){
  const d=state.data;let html='';
}
function switchWorkspace(id){workspace=id;}
function dispatch(button){
 const action=button.dataset.action,id=button.dataset.id;
}
"""
class Installer(unittest.TestCase):
 def test_repeated_composition_preserves_other_module(self):
  server=patch_server(SERVER);self.assertEqual(patch_server(server),server)
  self.assertIn('self.chemistry.decorate_task(self.programmes.decorate_task(self.customer_reviews.decorate_task(task)))',server)
  self.assertIn('"programmes.mjs"',server)
  app=patch_app(APP);self.assertEqual(patch_app(app),app)
  index='<link rel="stylesheet" href="/web/reviews.css">\n';self.assertEqual(patch_index(patch_index(index)),patch_index(index))
if __name__=='__main__':unittest.main()
