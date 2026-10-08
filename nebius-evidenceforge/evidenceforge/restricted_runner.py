"""Restricted pure-Python task adapter with measured focused checks.

This is a capability-restricted fixture runner, not an OS security sandbox.
It admits only small pure modules needed by the published curated workload.
"""
from __future__ import annotations
import ast, csv, hashlib, io, json, multiprocessing as mp, operator, os
import sys, time, types
from decimal import Decimal, InvalidOperation
from pathlib import Path
from .core import EvidenceError, _safe_relpath, canonical_bytes, sha256_hex
from .workloads import check_functions

MAX_SOURCE_BYTES=16000
MAX_VALUE_LENGTH=4096
MAX_STEPS=20000
CHECK_TIMEOUT=25
METHODS={"get","keys","items","values","append","add","remove","strip","lower","lstrip",
         "encode","hexdigest","is_finite","quantize","issubset",
         "DictReader","StringIO","dumps","sha256","Decimal","InvalidOperation","fieldnames"}
MODULE_EXPORTS={
    "csv":{"DictReader":csv.DictReader},
    "io":{"StringIO":io.StringIO},
    "decimal":{"Decimal":Decimal,"InvalidOperation":InvalidOperation},
    "json":{"dumps":json.dumps},
    "hashlib":{"sha256":hashlib.sha256},
}
FORBIDDEN_NAMES={"eval","exec","compile","open","input","globals","locals","vars",
                 "getattr","setattr","delattr","dir","help","breakpoint","memoryview"}

def bounded(value):
    if isinstance(value,(str,bytes,list,tuple,dict,set,frozenset)) and len(value)>MAX_VALUE_LENGTH:
        raise EvidenceError("intermediate value limit")
    if type(value) is int and value.bit_length()>256:
        raise EvidenceError("integer size limit")
    if isinstance(value,Decimal) and value.is_finite() and abs(value.adjusted())>1000:
        raise EvidenceError("Decimal exponent limit")
    return value

def call_guard(function,*args,**kwargs):
    name=getattr(function,"__name__","")
    target=getattr(function,"__self__",None)
    if name in {"append","add"} and isinstance(target,(list,set)) and len(target)>=256:
        raise EvidenceError("container growth limit")
    if name=="encode" and isinstance(target,str) and len(target)>MAX_VALUE_LENGTH:
        raise EvidenceError("encoding size limit")
    if function is range:
        result=range(*args)
        if len(result)>256:raise EvidenceError("range limit")
        return result
    if function in {list,tuple,set,dict}:
        # Inputs are the bounded fixture data or source-created iterables; line
        # tracing bounds generator/list-comprehension iteration in the worker.
        result=function(*args,**kwargs)
        if len(result)>256:raise EvidenceError("container size limit")
        return result
    return bounded(function(*args,**kwargs))

BINARY={ast.Add:operator.add,ast.Sub:operator.sub,ast.Mult:operator.mul,
        ast.Div:operator.truediv,ast.FloorDiv:operator.floordiv,ast.Mod:operator.mod}
def binary_guard(left,right,name):
    if name=="Mod" and isinstance(left,(str,bytes)):
        raise EvidenceError("string-format expansion unsupported")
    if name=="Mult":
        sequence,count=(left,right) if isinstance(left,(str,bytes,list,tuple)) else (right,left)
        if isinstance(sequence,(str,bytes,list,tuple)) and type(count) is int:
            if len(sequence)*max(0,count)>MAX_VALUE_LENGTH:raise EvidenceError("sequence expansion limit")
    if name=="Add" and isinstance(left,(str,bytes,list,tuple)) and isinstance(right,type(left)):
        if len(left)+len(right)>MAX_VALUE_LENGTH:raise EvidenceError("sequence expansion limit")
    return bounded(BINARY[getattr(ast,name)](left,right))

def guarded_import(name,globals=None,locals=None,fromlist=(),level=0):
    if level or name not in MODULE_EXPORTS:raise EvidenceError("unapproved import")
    if fromlist and any(item not in MODULE_EXPORTS[name] for item in fromlist):
        raise EvidenceError("unapproved imported symbol")
    return types.SimpleNamespace(**MODULE_EXPORTS[name])

class RestrictedTransforms(ast.NodeTransformer):
    def visit_Call(self,node):
        self.generic_visit(node)
        return ast.copy_location(ast.Call(func=ast.Name(id="__ef_call",ctx=ast.Load()),
                    args=[node.func,*node.args],keywords=node.keywords),node)
    def visit_BinOp(self,node):
        self.generic_visit(node)
        return ast.copy_location(ast.Call(func=ast.Name(id="__ef_binary",ctx=ast.Load()),
                    args=[node.left,node.right,ast.Constant(type(node.op).__name__)],keywords=[]),node)

def admit_source(source):
    if not isinstance(source,str) or len(source.encode())>MAX_SOURCE_BYTES:
        raise EvidenceError("source size limit")
    try:tree=ast.parse(source)
    except SyntaxError as exc:raise EvidenceError("source syntax invalid") from exc
    if len(list(ast.walk(tree)))>2500:raise EvidenceError("source complexity limit")
    for top in tree.body:
        if not isinstance(top,(ast.Import,ast.ImportFrom,ast.FunctionDef)) and not (
                isinstance(top,ast.Expr) and isinstance(top.value,ast.Constant) and isinstance(top.value.value,str)):
            raise EvidenceError("module top level permits only imports and functions")
    for node in ast.walk(tree):
        if isinstance(node,(ast.ClassDef,ast.AsyncFunctionDef,ast.With,ast.AsyncWith,
                            ast.Global,ast.Nonlocal,ast.Lambda,ast.Await,ast.Yield,ast.YieldFrom,
                            ast.JoinedStr,ast.FormattedValue)):
            raise EvidenceError("unsupported pure-module capability")
        if isinstance(node,ast.FunctionDef):
            if "__" in node.name:
                raise EvidenceError("private hook definitions are not admitted")
            if node.decorator_list or node.returns or any(arg.annotation for arg in node.args.args):
                raise EvidenceError("decorators/annotations unsupported")
            if any(not isinstance(default,ast.Constant) for default in node.args.defaults):
                raise EvidenceError("function defaults must be constants")
        if isinstance(node,ast.Name) and (node.id in FORBIDDEN_NAMES or "__" in node.id):
            raise EvidenceError("forbidden execution/reflection name")
        if isinstance(node,ast.arg) and "__" in node.arg:
            raise EvidenceError("private hook parameters are not admitted")
        if isinstance(node,ast.Attribute) and node.attr not in METHODS:
            raise EvidenceError("unapproved attribute")
        if isinstance(node,ast.Import):
            for alias in node.names:
                if alias.name not in MODULE_EXPORTS or (alias.asname and "__" in alias.asname):
                    raise EvidenceError("unapproved module")
        if isinstance(node,ast.ImportFrom):
            if node.level or node.module not in MODULE_EXPORTS:
                raise EvidenceError("unapproved module")
            for alias in node.names:
                if alias.name not in MODULE_EXPORTS[node.module] or (alias.asname and "__" in alias.asname):
                    raise EvidenceError("unapproved imported symbol")
        if isinstance(node,ast.Constant):
            if isinstance(node.value,(str,bytes)) and len(node.value)>512:
                raise EvidenceError("literal size limit")
            if type(node.value) is int and abs(node.value)>1000000:
                raise EvidenceError("literal integer limit")
        if isinstance(node,ast.BinOp) and type(node.op) not in BINARY:
            raise EvidenceError("unapproved binary operator")
        if isinstance(node,ast.Starred) or (isinstance(node,ast.keyword) and node.arg is None):
            raise EvidenceError("dynamic argument expansion unsupported")
        if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id in FORBIDDEN_NAMES:
            raise EvidenceError("forbidden call")
    return ast.fix_missing_locations(RestrictedTransforms().visit(tree))

def _worker(task_id,source,queue):
    try:
        os.environ.clear()
        tree=admit_source(source)
        safe_builtins={name: value for name,value in {
            "bool":bool,"str":str,"int":int,"len":len,"set":set,"dict":dict,"list":list,
            "tuple":tuple,"range":range,"sorted":sorted,"enumerate":enumerate,"any":any,
            "all":all,"isinstance":isinstance,"ValueError":ValueError,"TypeError":TypeError,
            "Exception":Exception,"sum":sum,"min":min,"max":max,
            "__import__":guarded_import}.items()}
        namespace={"__builtins__":safe_builtins,"__ef_call":call_guard,"__ef_binary":binary_guard}
        steps=0
        def trace(frame,event,arg):
            nonlocal steps
            if event=="line":
                steps+=1
                if steps>MAX_STEPS:raise EvidenceError("execution step limit")
            return trace
        sys.settrace(trace)
        try:
            exec(compile(tree,"curated-task.py","exec"),namespace)
            result=check_functions(task_id,namespace)
        finally:sys.settrace(None)
        result["execution_steps"]=steps
        queue.put(result)
    except Exception as exc:
        queue.put({"exit_code":1,"cases":[],"error":type(exc).__name__,"error_message":str(exc)[:160]})

def execute_checks(task_id,source,timeout=10):
    admit_source(source)
    if not 0<timeout<=30:raise EvidenceError("check timeout outside allowed range")
    context=mp.get_context("spawn")
    queue=context.Queue()
    process=context.Process(target=_worker,args=(task_id,source,queue))
    started=time.monotonic();process.start()
    try:
        result=queue.get(timeout=max(0.001,timeout-(time.monotonic()-started)))
    except Exception:
        result={"exit_code":1,"cases":[],"error":"focused_check_deadline"}
    finally:
        if process.is_alive():
            process.join(max(0,min(0.1,timeout-(time.monotonic()-started))))
            if process.is_alive():process.terminate()
        process.join(2);queue.close()
    result["wall_seconds"]=time.monotonic()-started
    result["source_sha256"]=sha256_hex(source.encode())
    if result["wall_seconds"]>timeout:
        result.update(exit_code=1,error="focused_check_deadline")
    return result

class RestrictedPythonSandbox:
    def __init__(self,workspace,task_id,task,deadline):
        self.root=Path(workspace).resolve()
        self.task_id=task_id;self.task=task;self.deadline=deadline
        self.check_outputs=[]
        self.allowed={task["path"]}
    def _path(self,path):
        _safe_relpath(path)
        if ":" in path or path not in self.allowed:raise EvidenceError("path outside task scope")
        candidate=self.root/path
        if not candidate.resolve().is_relative_to(self.root):raise EvidenceError("resolved path escape")
        current=candidate
        while current!=self.root:
            if current.is_symlink():raise EvidenceError("symlink rejected")
            current=current.parent
        return candidate
    def read(self,path):
        target=self._path(path)
        if target.stat().st_size>MAX_SOURCE_BYTES:raise EvidenceError("source size limit")
        return target.read_text(encoding="utf-8")
    def write(self,path,content):
        target=self._path(path);admit_source(content)
        if time.monotonic()>=self.deadline:raise EvidenceError("whole run deadline")
        target.write_text(content,encoding="utf-8",newline="\n")
    def run_test(self,name):
        if name!=self.task["test"]:raise EvidenceError("undeclared check")
        remaining=self.deadline-time.monotonic()
        if remaining<=0:raise EvidenceError("whole run deadline")
        result=execute_checks(self.task_id,self.read(self.task["path"]),min(CHECK_TIMEOUT,remaining))
        self.check_outputs.append({"name":name,**result})
        output=json.dumps(result,sort_keys=True,allow_nan=False)
        return result["exit_code"],output
    def snapshot(self):
        return {path:self.read(path) for path in sorted(self.allowed)}

