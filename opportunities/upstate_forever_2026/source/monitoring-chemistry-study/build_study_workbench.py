#!/usr/bin/env python3
"""Build a self-contained native-result study browser with original downloads."""
from pathlib import Path
import argparse,base64,json,mimetypes
from html.parser import HTMLParser

class Links(HTMLParser):
    def __init__(self):super().__init__();self.links=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a':
            href=dict(attrs).get('href')
            if href:self.links.append(href)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace',type=Path,required=True);p.add_argument('--budget-study',type=Path,required=True)
    p.add_argument('--reports',type=Path,required=True);p.add_argument('--pdfs',type=Path,required=True)
    p.add_argument('--template',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();ws=args.workspace.resolve(strict=True);budget=args.budget_study.resolve(strict=True)
    course=json.loads(args.reports.read_text());modes=('calibration','sensitivity','uncertainty','monitoring')
    data={'budget':json.loads((budget/'view-data.json').read_text()),'chemistry':{
        'case_id':course['course_inputs']['case_id'],'engine_version':course['course_inputs']['engine_version'],
        'results':{},'html':{}},'files':{}}
    def add(key,path,name=None):
        b=path.read_bytes();data['files'][key]={'name':name or path.name,'type':mimetypes.guess_type(path.name)[0] or 'application/octet-stream','base64':base64.b64encode(b).decode('ascii')}
    add('editable',ws/course['editable_export']['artifact']['path'],'Compound_Chemistry_Editable_Four_Analyses.zip')
    for key,filename in [('comparison-csv','comparison.csv'),('selection-csv','selected-search-areas.csv'),('comparison-json','comparison.json')]:add(key,budget/filename)
    for i,row in enumerate(data['budget']['comparison']['rows']):add('calendar-'+str(i),budget/(row['budget_display']+'-calendar.csv'),'Monitoring_'+row['budget_display']+'_Calendar.csv')
    for mode in modes:
        report=course['reports'][mode];html_path=ws/report['report']['path'];body=html_path.read_text()
        data['chemistry']['html'][mode]=body
        path=ws/'chemistry-runs'/course['analyses'][mode]['run_id']/'artifacts/result.json'
        data['chemistry']['results'][mode]=json.loads(path.read_text());add('result-'+mode,path,mode+'-result.json')
        add('pdf-'+mode,args.pdfs/(mode+'.pdf'),'Chemistry_'+mode.title()+'_Complete_Report.pdf')
        add('native-report-'+mode,ws/report['artifact']['path'],'Chemistry_'+mode.title()+'_Native_Report.zip')
        links=Links();links.feed(body)
        for href in links.links:
            path=(html_path.parent/href).resolve(strict=True)
            if not path.is_relative_to(html_path.parent):raise ValueError('Report link leaves its retained report directory')
            add('report:'+mode+':'+href,path)
    payload=json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False).replace('<','\\u003c')
    output=args.template.read_text().replace('__MAP__',(budget/'catchments.svg').read_text()).replace('__DATA__',payload)
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(output)
    print(json.dumps({'path':str(args.output),'bytes':args.output.stat().st_size,'embedded_downloads':len(data['files'])}))

if __name__=='__main__':main()
