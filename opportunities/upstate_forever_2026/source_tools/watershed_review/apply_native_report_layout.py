#!/usr/bin/env python3
"""Apply portable table layout improvements to the current implementation formatter.

The replacements are limited to table markup and CSS. Other maintained source
is retained verbatim. Stop rather than overwrite an unrecognized same-leaf edit.
"""
import argparse,ast,hashlib,json,os,tempfile
from pathlib import Path
BEFORE_TABLE='    return "<div class=\\"table-scroll\\"><table><thead>" + header + "</thead><tbody>" + body + "</tbody></table></div>"'
AFTER_TABLE='''    label = html.escape("Scrollable report table: " + ", ".join(str(x) for x in headers[:3]), quote=True)
    width = max(520, len(headers) * 104)
    return ("<div class=\\"table-scroll\\" role=\\"region\\" tabindex=\\"0\\" aria-label=\\"" + label +
            "\\"><table style=\\"min-width:" + str(width) + "px\\"><thead>" + header +
            "</thead><tbody>" + body + "</tbody></table></div>")'''
CHANGES=[(BEFORE_TABLE,AFTER_TABLE),
('        "th,td{padding:8px;border:1px solid #ccc;text-align:left;vertical-align:top;"',
 '        "th,td{min-width:90px;padding:8px;border:1px solid #ccc;text-align:left;vertical-align:top;"'),
('        "@media print{body{padding:0;font-size:10px}table{font-size:8px}"',
 '        ".table-scroll:focus-visible{outline:2px solid #555;outline-offset:3px}.meta{overflow-wrap:anywhere}"\n        "@media(max-width:600px){body{padding:16px}h1{font-size:24px}}"\n        "@media print{body{padding:0;font-size:10px}table{font-size:8px;min-width:0!important}th,td{min-width:0}"')]
def maintained_layout(text):
 """Recognize the newer maintained responsive formatter without rewriting it."""
 tree=ast.parse(text)
 tables=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name=='_table']
 if len(tables)!=1:return False
 table='\n'.join(node.value for node in ast.walk(tables[0]) if isinstance(node,ast.Constant) and isinstance(node.value,str))
 return all(token in table for token in ('class="table-scroll"','tabindex="0"','role="region"','aria-label=','--report-columns:','<th scope="col">')) and all(
  token in text for token in ('.table-scroll:focus-visible{','min-width:calc(var(--report-columns,2)*8rem)','@media(max-width:600px)','@media print{'))

def compose(old):
 """Return only the compatible layout change, retaining all other source."""
 if maintained_layout(old):return old
 new=old
 for before,after in CHANGES:
  if after in new:continue
  if new.count(before)!=1:raise ValueError('Current formatter has a different table/layout predecessor; compose this layout with the maintained source instead.')
  new=new.replace(before,after,1)
 ast.parse(new)
 return new

def apply(app):
 p=Path(app).resolve()/'model/implementation_reporting.py';old=p.read_text(encoding='utf-8');new=compose(old)
 if new!=old:
  pending=None
  try:
   with tempfile.NamedTemporaryFile(dir=p.parent,prefix='.review-layout-',delete=False) as out:
    pending=Path(out.name);out.write(new.encode('utf-8'));out.flush();os.fsync(out.fileno())
   if p.read_text(encoding='utf-8')!=old:raise ValueError('Current formatter changed during layout composition')
   os.chmod(pending,p.stat().st_mode & 0o777)
   os.replace(pending,p);pending=None
  finally:
   if pending is not None:pending.unlink(missing_ok=True)
 return {'path':str(p),'changed':new!=old,'before_sha256':hashlib.sha256(old.encode()).hexdigest(),'after_sha256':hashlib.sha256(new.encode()).hexdigest()}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--application',required=True);args=p.parse_args();print(json.dumps(apply(args.application),indent=2))
