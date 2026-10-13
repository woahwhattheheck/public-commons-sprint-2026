"""Editable Excel and PowerPoint editions of the frozen safe report model.

Uses the existing source-owned register writer and native Office chart parts.
The renderer reads one projected payload and never loads private workspace data.
"""
from __future__ import annotations
import copy
import io
import math
import re
import textwrap
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree as ET
from document_exports import document_model, _view_tables, _view_chart, _metric, _date, METRIC_LABELS
from document_charts import chart_panels, _chart_xml, _workbook
from respondent_operations import make_xlsx

ROOT=Path(__file__).resolve().parent
S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
P='http://schemas.openxmlformats.org/presentationml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'
C='http://schemas.openxmlformats.org/drawingml/2006/chart'
EMU=9525

def x(parent,namespace,tag,text=None,**attrs):
    child=ET.SubElement(parent,'{'+namespace+'}'+tag,{k:str(v) for k,v in attrs.items()})
    if text is not None:child.text=str(text)
    return child

def xml(root):return ET.tostring(root,encoding='utf-8',xml_declaration=True)

def content_types_xml(root):
    outgoing=ET.Element('Types',{'xmlns':CT})
    for item in root:ET.SubElement(outgoing,item.tag.rsplit('}',1)[-1],dict(item.attrib))
    return xml(outgoing)

def zipped(parts):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as archive:
        for name,body in sorted(parts.items()):
            entry=zipfile.ZipInfo(name,(2000,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(entry,body)
    return out.getvalue()

def number(value):
    if value is None or isinstance(value,bool):return value
    try:
        result=Decimal(str(value))
        if result.is_finite():return result
    except InvalidOperation:pass
    return value

def report_tables(model):
    """Keep complete frozen view tables and disclosure-safe response detail."""
    sections=[]
    for view in model['view_sections']:
        if view.get('kind')=='text':
            sections.append({'title':view['title'],'note':view.get('note',''),'headers':['Description'],'rows':[[view.get('text','')]]})
            continue
        rows=[['Statistic','Value']]
        rows += [[METRIC_LABELS[k],number(view['summary'].get(k))] for k in view['statistics']]
        rows.append(['Answered',number(view['summary'].get('answered',0))])
        rows.append(['Missing',number(view['summary'].get('missing',0))])
        sections.append({'title':view['title'],'note':view.get('note',''),'headers':rows[0],'rows':rows[1:]})
        for caption,headers,values in _view_tables(view,12.0):
            numeric={len(headers)-1}
            if view.get('cross_tab'):numeric=set(range(1,len(headers)))
            elif view.get('frequencies'):numeric={1,2}
            converted=[[None if value=='Not available' else number(value) if col in numeric else value for col,value in enumerate(row)] for row in values]
            sections.append({'title':view['title']+' · '+caption,'note':view.get('note',''),'headers':headers,'rows':converted})
    if not sections:
        sections=[{'title':'Numeric answers','note':'','headers':['Question','Unit','Answered','Sum','Mean','Minimum','Maximum'],
            'rows':[[r['label'],r['unit'],number(r['answered']),number(r['sum']),number(r['mean']),number(r['minimum']),number(r['maximum'])] for r in model['numeric_totals']]}]
    responses=[]
    for response in model['responses']:
        for question in response['questions']:
            if question['kind']=='table':
                for row_index,row in enumerate(question['rows'],1):
                    for column,cell in zip(question['columns'],row):
                        responses.append([response['heading'],question['label'],row_index,column['label'],number(cell['text']) if column.get('kind') in {'number','integer'} else cell['text'],column['unit'],cell['classification'],cell['alternative'],'\n'.join(question['context'])])
            else:responses.append([response['heading'],question['label'],None,'',number(question['text']) if question['kind'] in {'number','integer'} else question['text'],question['unit'],question['classification'],question['alternative'],'\n'.join(question['context'])])
    return sections,responses

def panels(model):
    result=[]
    for view in model['view_sections']:
        if view.get('kind')=='text':continue
        spec=_view_chart(view)
        if spec:result.extend(chart_panels(spec))
    return result

def _col(n):
    result=''
    while n:n,r=divmod(n-1,26);result=chr(65+r)+result
    return result

def _xlsx(model):
    sections,responses=report_tables(model)
    rows=[[],[model['title']],[model['edition'].capitalize()+' frozen report',model['created']],['Report ID',model['record_id']]]
    headers=[]
    for section in sections:
        rows.extend([[],[section['title']]])
        if section['note']:rows.append([section['note']])
        headers.append(len(rows)+1);rows.append(section['headers']);rows.extend(section['rows'])
    charts=panels(model);chart_rows=[];offsets=[]
    for panel in charts:
        start=len(chart_rows)+2
        chart_rows.append([panel['title']]);chart_rows.append(['Category']+[s['name'] for s in panel['series']])
        chart_rows += [[cat]+[number(s['values'][i]) for s in panel['series']] for i,cat in enumerate(panel['categories'])]
        offsets.append(start);chart_rows.extend([[],[]])
    tables={'Report':{'headers':[''], 'rows':rows},'Responses':{'headers':['Response','Question','Original row','Column','Value','Unit','Disclosure','Public alternative','Original question context'],'rows':responses}}
    if charts:tables['Chart data']={'headers':[''],'rows':chart_rows}
    original=make_xlsx(tables)
    with zipfile.ZipFile(io.BytesIO(original)) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    styles=ET.Element('{'+S+'}styleSheet')
    nf=x(styles,S,'numFmts',count=1);x(nf,S,'numFmt',numFmtId=164,formatCode='#,##0.##############')
    fonts=x(styles,S,'fonts',count=3)
    for index,size in enumerate([11,11,15]):
        font=x(fonts,S,'font');x(font,S,'sz',val=size);x(font,S,'name',val='DejaVu Sans');x(font,S,'color',rgb='FFFFFFFF' if index==1 else 'FF202020')
        if index:x(font,S,'b')
    fills=x(styles,S,'fills',count=3)
    for pattern,color in [('none',None),('gray125',None),('solid','FF303030')]:
        fill=x(fills,S,'fill');p=x(fill,S,'patternFill',patternType=pattern)
        if color:x(p,S,'fgColor',rgb=color);x(p,S,'bgColor',indexed=64)
    borders=x(styles,S,'borders',count=1);border=x(borders,S,'border')
    for side in ['left','right','top','bottom','diagonal']:x(border,S,side)
    base=x(styles,S,'cellStyleXfs',count=1);x(base,S,'xf',numFmtId=0,fontId=0,fillId=0,borderId=0)
    formats=x(styles,S,'cellXfs',count=5)
    for font,fill,numfmt in [(0,0,0),(1,2,0),(2,0,0),(0,0,164),(0,0,3)]:
        fmt=x(formats,S,'xf',numFmtId=numfmt,fontId=font,fillId=fill,borderId=0,xfId=0,applyAlignment=1)
        x(fmt,S,'alignment',vertical='top',wrapText=1)
    named=x(styles,S,'cellStyles',count=1);x(named,S,'cellStyle',name='Normal',xfId=0,builtinId=0)
    parts['xl/styles.xml']=xml(styles)
    rels=ET.fromstring(parts['xl/_rels/workbook.xml.rels']);x(rels,REL,'Relationship',Id='rIdStyles',Type=R+'/styles',Target='styles.xml');parts['xl/_rels/workbook.xml.rels']=xml(rels)
    content=ET.fromstring(parts['[Content_Types].xml']);x(content,CT,'Override',PartName='/xl/styles.xml',ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml')
    for sheet_index,(name,table) in enumerate(tables.items(),1):
        root=ET.fromstring(parts['xl/worksheets/sheet'+str(sheet_index)+'.xml']);root.find('{'+S+'}sheetViews/{'+S+'}sheetView').set('showGridLines','0')
        autofilter=root.find('{'+S+'}autoFilter')
        if name!='Responses' and autofilter is not None:root.remove(autofilter)
        values=[table['headers']]+table['rows'];data=root.find('{'+S+'}sheetData')
        root.find('{'+S+'}dimension').set('ref','A1:'+_col(max(len(row) for row in values))+str(len(values)))
        widths=[48]+[20]*max(1,max(len(row) for row in values)-1) if name=='Report' else [28,52,14,30,24,14,16,56,72] if name=='Responses' else [58]+[24]*4
        columns=ET.Element('{'+S+'}cols')
        for i,width in enumerate(widths,1):x(columns,S,'col',min=i,max=i,width=width,customWidth=1)
        root.insert(list(root).index(data),columns)
        for row_number,row in enumerate(data,1):
            actual=values[row_number-1];height=22
            for cell,column,value in zip(row,range(len(actual)),actual):
                if isinstance(value,Decimal) and len(value.as_tuple().digits)<=15:
                    for child in list(cell):cell.remove(child)
                    cell.set('t','n');cell.set('s','4' if value==value.to_integral() else '3');x(cell,S,'v',format(value,'f'))
                else:cell.set('s','0')
                if name=='Responses' and row_number==1 or name=='Report' and row_number in {n+1 for n in headers}:cell.set('s','1')
                if name=='Report' and row_number==3:cell.set('s','2')
                text='' if value is None else str(value)
                height=max(height,18*sum(max(1,math.ceil(len(line)/max(12,widths[min(column,len(widths)-1)]-2))) for line in text.split('\n'))+4)
            row.set('ht',str(height));row.set('customHeight','1')
        parts['xl/worksheets/sheet'+str(sheet_index)+'.xml']=xml(root)
    if charts:
        drawing=ET.Element('{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}wsDr')
        drawing_rels=ET.Element('{'+REL+'}Relationships')
        XD='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
        for index,(panel,start) in enumerate(zip(charts,offsets),1):
            chart=ET.fromstring(_chart_xml(panel,'rId1'))
            ext=chart.find('{'+C+'}externalData')
            if ext is not None:chart.remove(ext)
            chart_body=chart.find('{'+C+'}chart')
            title=ET.Element('{'+C+'}title')
            rich=x(x(title,C,'tx'),C,'rich');x(rich,A,'bodyPr');x(rich,A,'lstStyle')
            para=x(rich,A,'p');run=x(para,A,'r');props=x(run,A,'rPr',sz=1200,b=1);x(props,A,'latin',typeface='DejaVu Sans');x(run,A,'t',panel['title'])
            x(title,C,'layout');x(title,C,'overlay',val=0);chart_body.insert(0,title)
            chart_body.find('{'+C+'}autoTitleDeleted').set('val','0')
            for formula in chart.iter('{'+C+'}f'):
                match=re.search(r"\$([A-Z]+)\$(\d+)(?::\$([A-Z]+)\$(\d+))?",formula.text)
                if match:
                    a=int(match[2])+start;b=int(match[4])+start if match[4] else None
                    formula.text="'Chart data'!$"+match[1]+'$'+str(a)+((':$'+match[3]+'$'+str(b)) if b else '')
            parts['xl/charts/chart'+str(index)+'.xml']=xml(chart)
            x(content,CT,'Override',PartName='/xl/charts/chart'+str(index)+'.xml',ContentType='application/vnd.openxmlformats-officedocument.drawingml.chart+xml')
            anchor=x(drawing,XD,'oneCellAnchor');where=x(anchor,XD,'from')
            for key,value in [('col',9),('colOff',0),('row',2+(index-1)*24),('rowOff',0)]:x(where,XD,key,value)
            x(anchor,XD,'ext',cx=900*EMU,cy=430*EMU)
            frame=x(anchor,XD,'graphicFrame',macro='');nv=x(frame,XD,'nvGraphicFramePr');x(nv,XD,'cNvPr',id=index+1,name=panel['title']);x(nv,XD,'cNvGraphicFramePr')
            transform=x(frame,XD,'xfrm');x(transform,A,'off',x=0,y=0);x(transform,A,'ext',cx=900*EMU,cy=430*EMU)
            graphic=x(frame,A,'graphic');data=x(graphic,A,'graphicData',uri=C);reference=x(data,C,'chart');reference.set('{'+R+'}id','rId'+str(index));x(anchor,XD,'clientData')
            x(drawing_rels,REL,'Relationship',Id='rId'+str(index),Type=R+'/chart',Target='../charts/chart'+str(index)+'.xml')
        parts['xl/drawings/drawing1.xml']=xml(drawing);parts['xl/drawings/_rels/drawing1.xml.rels']=xml(drawing_rels)
        root=ET.fromstring(parts['xl/worksheets/sheet1.xml']);item=x(root,S,'drawing');item.set('{'+R+'}id','rIdDrawing');parts['xl/worksheets/sheet1.xml']=xml(root)
        sheet_rels=ET.Element('{'+REL+'}Relationships');x(sheet_rels,REL,'Relationship',Id='rIdDrawing',Type=R+'/drawing',Target='../drawings/drawing1.xml');parts['xl/worksheets/_rels/sheet1.xml.rels']=xml(sheet_rels)
        x(content,CT,'Override',PartName='/xl/drawings/drawing1.xml',ContentType='application/vnd.openxmlformats-officedocument.drawing+xml')
    parts['[Content_Types].xml']=content_types_xml(content)
    return zipped(parts)

def text_box(tree,identity,text,left,top,width,height,size=22,bold=False):
    shape=x(tree,P,'sp');nv=x(shape,P,'nvSpPr');x(nv,P,'cNvPr',id=identity,name='Text '+str(identity));x(nv,P,'cNvSpPr',txBox=1);x(nv,P,'nvPr')
    props=x(shape,P,'spPr');transform=x(props,A,'xfrm');x(transform,A,'off',x=int(left*EMU),y=int(top*EMU));x(transform,A,'ext',cx=int(width*EMU),cy=int(height*EMU))
    geometry=x(props,A,'prstGeom',prst='rect');x(geometry,A,'avLst');x(props,A,'noFill');x(x(props,A,'ln'),A,'noFill')
    body=x(shape,P,'txBody');x(body,A,'bodyPr',wrap='square');x(body,A,'lstStyle')
    for line in str(text).split('\n'):
        para=x(body,A,'p');run=x(para,A,'r');properties=x(run,A,'rPr',lang='en-CA',sz=int(size*75),b='1' if bold else '0');fill=x(properties,A,'solidFill');x(fill,A,'srgbClr',val='202020');x(properties,A,'latin',typeface='DejaVu Sans');x(run,A,'t',line)

def _pptx(model):
    sections,responses=report_tables(model)
    pages=[{'title':model['title'],'text':model['edition'].capitalize()+' report\n'+model['created']+'\n'+str(len(model['responses']))+' accepted responses\n'+model.get('description','')+'\nBlank numeric cells represent unavailable values.'}]
    def row_height(row,widths):
        return max(38,max(22*(sum(max(1,math.ceil(len(line)/max(9,(widths[i]-24)/11))) for line in str('' if value is None else value).split('\n'))+1) for i,value in enumerate(row)))
    def add_table(title,note,header,rows,widths):
        header_height=row_height(header,widths)
        limit=440-header_height
        chunk=[];used=0
        for row in rows:
            height=row_height(row,widths)
            if chunk and used+height>limit:pages.append({'title':title,'note':note,'headers':header,'header_height':header_height,'rows':chunk,'widths':widths});chunk=[];used=0
            chunk.append((row,height));used+=height
        if chunk or not rows:pages.append({'title':title,'note':note,'headers':header,'header_height':header_height,'rows':chunk,'widths':widths})
    for section in sections:
        header=section['headers'];rows=section['rows'];widths=[430]+[(1160-430)/max(1,len(header)-1)]*(len(header)-1) if len(header)>2 else [720,440]
        add_table(section['title'],section['note'],header,rows,widths)
    for panel in panels(model):pages.append({'title':panel['title'],'chart':panel})
    # Complete scalar/table records and alternatives remain editable row records.
    if model['include_response_details']:
        current=None;group=[]
        def flush_response_group():
            if not group:return
            add_table('Selected response values','','Response Question Value'.split(),group,[200,450,510])
        for r in responses:
            if r[8]!=current:
                flush_response_group();group=[];current=r[8]
                if current:
                    lines=[wrapped for line in current.split('\n') for wrapped in textwrap.wrap(line,90,break_long_words=True) or ['']]
                    for start in range(0,len(lines),14):pages.append({'title':'Original question context','text':'\n'.join(lines[start:start+14])})
            group.append([r[0],r[1]+(' / '+r[3] if r[3] else ''),str('' if r[4] is None else r[4])+('\nPublic alternative: '+r[7] if r[7] else '')])
        flush_response_group()
    template=ROOT/'office-assets'/'blank-report.pptx'
    with zipfile.ZipFile(template) as archive:parts={name:archive.read(name) for name in archive.namelist() if not name.startswith(('ppt/slides/','ppt/notesSlides/'))}
    presentation=ET.fromstring(parts['ppt/presentation.xml']);ids=presentation.find('{'+P+'}sldIdLst')
    if ids is None:ids=x(presentation,P,'sldIdLst')
    for item in list(ids):ids.remove(item)
    relationships=ET.fromstring(parts['ppt/_rels/presentation.xml.rels'])
    for relation in list(relationships):
        if relation.get('Type')==R+'/slide':relationships.remove(relation)
    content=ET.fromstring(parts['[Content_Types].xml'])
    for item in list(content):
        if item.get('PartName','').startswith(('/ppt/slides/','/ppt/notesSlides/')):content.remove(item)
    layout=next(name for name in sorted(parts) if name.startswith('ppt/slideLayouts/') and name.endswith('.xml') and '/_rels/' not in name)
    for index,page in enumerate(pages,1):
        slide=ET.Element('{'+P+'}sld');common=x(slide,P,'cSld');tree=x(common,P,'spTree');nv=x(tree,P,'nvGrpSpPr');x(nv,P,'cNvPr',id=1,name='');x(nv,P,'cNvGrpSpPr');x(nv,P,'nvPr');group=x(tree,P,'grpSpPr');transform=x(group,A,'xfrm')
        for tag,attrs in [('off',{'x':0,'y':0}),('ext',{'cx':0,'cy':0}),('chOff',{'x':0,'y':0}),('chExt',{'cx':0,'cy':0})]:x(transform,A,tag,**attrs)
        text_box(tree,2,page['title'],60,36,1160,110,size=42,bold=True)
        text_box(tree,3,model['edition'].capitalize()+'  '+model['created']+'  '+str(index)+' / '+str(len(pages)),60,671,1160,30,size=14)
        rels=ET.Element('{'+REL+'}Relationships');x(rels,REL,'Relationship',Id='rIdLayout',Type=R+'/slideLayout',Target='../slideLayouts/'+Path(layout).name)
        if page.get('text'):text_box(tree,4,page['text'],60,170,1160,420,size=25)
        if page.get('headers'):
            frame=x(tree,P,'graphicFrame');nv=x(frame,P,'nvGraphicFramePr');x(nv,P,'cNvPr',id=4,name='Editable retained table');x(nv,P,'cNvGraphicFramePr');x(nv,P,'nvPr');transform=x(frame,P,'xfrm');x(transform,A,'off',x=60*EMU,y=180*EMU);x(transform,A,'ext',cx=1160*EMU,cy=int((page['header_height']+sum(h for _,h in page['rows']))*EMU))
            graphic=x(frame,A,'graphic');data=x(graphic,A,'graphicData',uri='http://schemas.openxmlformats.org/drawingml/2006/table');table=x(data,A,'tbl');x(table,A,'tblPr',firstRow=1,bandRow=0);grid=x(table,A,'tblGrid')
            for width in page['widths']:x(grid,A,'gridCol',w=int(width*EMU))
            for row_index,(row,height) in enumerate([(page['headers'],page['header_height'])]+page['rows']):
                tr=x(table,A,'tr',h=int(height*EMU))
                for value in row:
                    cell=x(tr,A,'tc');body=x(cell,A,'txBody');x(body,A,'bodyPr',wrap='square');x(body,A,'lstStyle')
                    for line in str('' if value is None else value).split('\n'):
                        para=x(body,A,'p');run=x(para,A,'r');rp=x(run,A,'rPr',lang='en-CA',sz=1700,b='1' if row_index==0 else '0');fill=x(rp,A,'solidFill');x(fill,A,'srgbClr',val='FFFFFF' if row_index==0 else '202020');x(rp,A,'latin',typeface='DejaVu Sans');x(run,A,'t',line)
                    props=x(cell,A,'tcPr',marL=12*EMU,marR=12*EMU,marT=5*EMU,marB=5*EMU);fill=x(props,A,'solidFill');x(fill,A,'srgbClr',val='303030' if row_index==0 else 'FFFFFF')
            if page.get('note'):text_box(tree,5,page['note'],60,140,1160,36,size=16)
        if page.get('chart'):
            panel=page['chart'];frame=x(tree,P,'graphicFrame');nv=x(frame,P,'nvGraphicFramePr');x(nv,P,'cNvPr',id=4,name='Editable retained chart');x(nv,P,'cNvGraphicFramePr');x(nv,P,'nvPr');transform=x(frame,P,'xfrm');x(transform,A,'off',x=60*EMU,y=160*EMU);x(transform,A,'ext',cx=1160*EMU,cy=480*EMU)
            graphic=x(frame,A,'graphic');data=x(graphic,A,'graphicData',uri=C);chart=x(data,C,'chart');chart.set('{'+R+'}id','rIdChart')
            name='chart'+str(index);parts['ppt/charts/'+name+'.xml']=_chart_xml(panel,'rId1');parts['ppt/embeddings/'+name+'.xlsx']=_workbook(panel)
            chart_rels=ET.Element('{'+REL+'}Relationships');x(chart_rels,REL,'Relationship',Id='rId1',Type=R+'/package',Target='../embeddings/'+name+'.xlsx');parts['ppt/charts/_rels/'+name+'.xml.rels']=xml(chart_rels)
            x(rels,REL,'Relationship',Id='rIdChart',Type=R+'/chart',Target='../charts/'+name+'.xml');x(content,CT,'Override',PartName='/ppt/charts/'+name+'.xml',ContentType='application/vnd.openxmlformats-officedocument.drawingml.chart+xml')
        x(x(slide,P,'clrMapOvr'),A,'masterClrMapping');parts['ppt/slides/slide'+str(index)+'.xml']=xml(slide);parts['ppt/slides/_rels/slide'+str(index)+'.xml.rels']=xml(rels)
        identifier=x(ids,P,'sldId',id=255+index);identifier.set('{'+R+'}id','rIdReportSlide'+str(index));x(relationships,REL,'Relationship',Id='rIdReportSlide'+str(index),Type=R+'/slide',Target='slides/slide'+str(index)+'.xml')
        x(content,CT,'Override',PartName='/ppt/slides/slide'+str(index)+'.xml',ContentType='application/vnd.openxmlformats-officedocument.presentationml.slide+xml')
    if not any(e.get('Extension')=='xlsx' for e in content):x(content,CT,'Default',Extension='xlsx',ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    parts['ppt/presentation.xml']=xml(presentation);parts['ppt/_rels/presentation.xml.rels']=xml(relationships);parts['[Content_Types].xml']=content_types_xml(content)
    if 'docProps/core.xml' in parts:
        core=ET.fromstring(parts['docProps/core.xml'])
        for namespace,tag,value in [('http://purl.org/dc/elements/1.1/','title',model['title']),('http://purl.org/dc/elements/1.1/','creator','Questionnaire Operations'),('http://purl.org/dc/terms/','created',model['created']),('http://purl.org/dc/terms/','modified',model['created'])]:
            old=core.find('{'+namespace+'}'+tag)
            if old is None:old=x(core,namespace,tag)
            old.text=value
        parts['docProps/core.xml']=xml(core)
    return zipped(parts)

def render_office_report(payload,format_name):
    model=document_model(payload)
    fields={q['id']:q for q in payload.get('questions',payload.get('definition',{}).get('questions',[]))}
    for response in model['responses']:
        for question in response['questions']:
            for column in question.get('columns',[]):
                column['kind']=next(c['kind'] for c in fields[question['id']]['columns'] if c['id']==column['id'])
    if format_name=='xlsx':return _xlsx(model)
    if format_name=='pptx':return _pptx(model)
    raise ValueError('Choose Excel or PowerPoint report edition')
