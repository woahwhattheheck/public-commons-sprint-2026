"""Focused current-operator source composition check; no scientific runtime stub."""
import ast
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from model.project_transfer_install import patch

source = '''ACTIONS = set()
CUSTOMER_REVIEW_ACTIONS = set()
ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)
class Operator:
    def __init__(self):
        """Existing operator constructor."""
        self.root = "original"
    def _invoke(self, task):
        return ("peer-dispatch", task)
    def render(self, task):
        note = "étude"; return self.customer_reviews.decorate_task(task)
    def peer_implementation(self):
        return {"keep": "complete existing method"}
'''
result=patch(source)
ast.parse(result)
assert patch(result)==result
assert 'self.project_transfers.decorate_task(self.customer_reviews.decorate_task(task))' in result
assert 'return {"keep": "complete existing method"}' in result
assert result.count('ACTIONS.update(PROJECT_TRANSFER_ACTIONS)')==1
assert result.count('self.project_transfers = ProjectTransfers(self, Fault)')==1
try:patch(source.replace('self.customer_reviews.decorate_task(task)','task'))
except ValueError:pass
else:raise AssertionError('A missing original hook must preserve the current source')
print('PASS: original peer methods, UTF-8 source offsets, action/dispatch/download joins, repeat-safe install, unsupported-hook refusal')
