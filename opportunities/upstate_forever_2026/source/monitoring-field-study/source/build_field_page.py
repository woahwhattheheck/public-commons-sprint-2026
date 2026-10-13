#!/usr/bin/env python3
"""Embed the completed original field-support data into its offline workbench."""
import argparse,base64,hashlib,json,mimetypes
from pathlib import Path

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--study',required=True,type=Path);p.add_argument('--template',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
 root=a.study.resolve(strict=True);data=json.loads((root/'field-support.json').read_text());network=json.loads((root/'native/network.json').read_text())
 from pyproj import Transformer
 from shapely.geometry import shape
 from shapely.ops import transform
 pr=Transformer.from_crs('EPSG:4326','EPSG:3857',always_xy=True).transform
 shapes=[transform(pr,shape(n['geometry'])) for n in network['nodes'].values()]
 left=min(g.bounds[0] for g in shapes);bottom=min(g.bounds[1] for g in shapes);right=max(g.bounds[2] for g in shapes);top=max(g.bounds[3] for g in shapes)
 scale=min(840/(right-left),660/(top-bottom));data['map_transform']={'left':left,'top':top,'scale':scale,'mx':(900-(right-left)*scale)/2,'my':(720-(top-bottom)*scale)/2}
 data['downloads']=[]
 def add(path,title,description,name=None):
  b=path.read_bytes();data['downloads'].append({'name':name or path.name,'title':title,'description':description,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'type':mimetypes.guess_type(path.name)[0] or 'application/octet-stream','base64':base64.b64encode(b).decode()})
 add(root/'budget-field-support.csv','Three-plan source support','Selected search areas, original station support, retained result conditions and dates.')
 add(root/'original-plan-calendars.csv','Original unmodified calendar slots','All three original plans, retained local times, dates, crew and visit identities.')
 add(root/'field-support.json','Complete analytical result','All 730 original rows, 36 coordinate records, 87 native assessment stations and every plan join.')
 groups=list((root/'original').iterdir())
 for group in groups:
  record=json.loads((group/'source-collection.json').read_text())
  for entry in record['entries']:
   path=group/entry['id']/entry['body'].get('view_path',entry['body']['filename'])
   if path.exists():add(path,entry['title'],entry['vintage'])
 html=a.template.read_text().replace('__MAP__',(root/'catchments.svg').read_text()).replace('__DATA__',json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False).replace('<','\\u003c'))
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(html)
 print(json.dumps({'path':str(a.output),'bytes':a.output.stat().st_size,'original_downloads':len(data['downloads']),'support_id':data['id']},indent=2))
if __name__=='__main__':main()
