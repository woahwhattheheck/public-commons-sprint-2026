#!/usr/bin/env python3
"""Receive an exported browser plan through the original native import API."""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--application',type=Path,required=True)
parser.add_argument('--workspace',type=Path,required=True)
parser.add_argument('--plan-json',type=Path,required=True)
parser.add_argument('--expected-revision',type=int,required=True)
args=parser.parse_args()
application=args.application.resolve();workspace=args.workspace.resolve()
if not (application/'model/implementation.py').is_file():
    parser.error('Select the original received application directory.')
if not (workspace/'workspace.json').is_file():
    parser.error('Select an existing native scientific workspace.')
if args.expected_revision < 0:
    parser.error('Expected revision must be zero or a positive integer.')
sys.path.insert(0,str(application))
from model.implementation import ImplementationStore
from model.implementation_schema import document_digest
returned=json.loads(args.plan_json.read_text(encoding='utf-8-sig'))
result=ImplementationStore(workspace).import_document(
    returned, expected_revision=args.expected_revision, actor='portable-field-plan-return')
plan=result['plan']
print(json.dumps({'status':result['status'],'plan_id':plan['id'],
    'applied_revision':result['applied_revision'],'document_digest':document_digest(plan),
    'observations':len(plan['observations']),'visits':len(plan['visits'])},indent=2))
