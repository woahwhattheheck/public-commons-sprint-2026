#!/usr/bin/env python3
"""MIT. Overlay native respondent cells in an uploaded original XLSX.

Python standard library only. DOM serialization preserves original namespace
prefixes, including declarations referenced by mc:Ignorable. No formulas, macros
or external links execute. Unedited ZIP members retain their original bytes.
"""
import copy, json, posixpath, re, sys, zipfile
from pathlib import Path
from xml.dom import minidom, Node
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
XML='http://www.w3.org/XML/1998/namespace'
def fail(message): raise ValueError(message)
def xml(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():fail('XML entities are not accepted.')
    return minidom.parseString(data)
def children(node,name=None):
    return [x for x in node.childNodes if x.nodeType==Node.ELEMENT_NODE and (name is None or (x.namespaceURI==NS and x.localName==name))]
def first(node,name):return next(iter(children(node,name)),None)
def content(node):return ''.join(x.data for x in node.childNodes if x.nodeType in (Node.TEXT_NODE,Node.CDATA_SECTION_NODE)) if node is not None else ''
def norm(value):return ' '.join(str(value or '').split())
def column_num(value):
    result=0
    for c in value:result=result*26+ord(c)-64
    return result

def create(document,name,attributes=None,parent=None,value=None):
    prefix=document.documentElement.prefix
    node=document.createElementNS(NS,(prefix+':' if prefix else '')+name)
    for key,entry in (attributes or {}).items():node.setAttribute(key,str(entry))
    if value is not None:node.appendChild(document.createTextNode(str(value)))
    if parent is not None:parent.appendChild(node)
    return node

class Workbook:
    def __init__(self,path):
        self.archive=zipfile.ZipFile(path);self.members={};self.documents={};self.names={};self.values={}
        infos=self.archive.infolist()
        if len(infos)>3000 or sum(x.file_size for x in infos)>100*1024*1024:fail('Workbook expansion exceeds 100 MiB or 3,000 members.')
        for info in infos:
            if info.filename in self.members or info.filename.startswith('/') or '..' in info.filename.split('/') or info.flag_bits&1:fail('Unsafe or repeated workbook member.')
            if info.filename.lower().endswith('vbaproject.bin'):fail('Use the original .xlsx workbook without macros.')
            self.members[info.filename]=self.archive.read(info)
        self.workbook=xml(self.members['xl/workbook.xml'])
        relationships=xml(self.members['xl/_rels/workbook.xml.rels'])
        targets={r.getAttribute('Id'):r.getAttribute('Target') for r in children(relationships.documentElement) if r.getAttribute('TargetMode')!='External'}
        strings=[]
        if 'xl/sharedStrings.xml' in self.members:
            strings=[''.join(content(t) for t in si.getElementsByTagNameNS(NS,'t')) for si in children(xml(self.members['xl/sharedStrings.xml']).documentElement,'si')]
        for sheet in children(first(self.workbook.documentElement,'sheets'),'sheet'):
            target=targets[sheet.getAttributeNS(REL,'id')]
            name=posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join('xl',target))
            if not name.startswith('xl/') or name not in self.members:fail('Invalid internal worksheet relationship.')
            document=xml(self.members[name]);title=sheet.getAttribute('name');self.names[title]=name;self.documents[title]=document
            cells={}
            for cell in document.getElementsByTagNameNS(NS,'c'):
                match=re.fullmatch(r'([A-Z]+)([1-9][0-9]*)',cell.getAttribute('r'))
                if not match:fail('A workbook cell address is invalid.')
                value=content(first(cell,'v'))
                if cell.getAttribute('t')=='s':value=strings[int(value)]
                elif cell.getAttribute('t')=='inlineStr':value=''.join(content(t) for t in cell.getElementsByTagNameNS(NS,'t'))
                cells.setdefault(int(match[2]),{})[match[1]]=value
            self.values[title]=cells
    def at(self,sheet,row,column):return self.values.get(sheet,{}).get(row,{}).get(column,'')
    def verify(self,kind,reference):
        allowed=set();checks=[]
        if kind=='requirements':
            for item in reference['acceptance-requirements.json']['items']:
                sheet,row=item['worksheet'],item['source_row'];values=item['original_values']
                checks.extend((sheet,row,col,values[i]) for i,col in enumerate('ABCD'))
                allowed.update((sheet,row,col) for col in 'EFGH')
                for continuation in item.get('continuations',[]):
                    original=continuation.get('original_values',continuation.get('values',[]))
                    checks.extend((sheet,continuation['source_row'],col,original[i]) for i,col in enumerate('ABCD'))
        elif kind=='interfaces':
            for item in reference['interfaces.json']['interfaces']:
                row=item['source_row'];checks.extend(('Interfaces',row,col,item['original_values'][i]) for i,col in enumerate('ABCD'))
                allowed.update(('Interfaces',row,col) for col in 'EFGHIJKL')
        elif kind=='staffing':
            for n in range(1,11):checks.append(('Phases',3+n,'A','Phase '+str(n)));allowed.update(('Phases',3+n,col) for col in 'BC')
            for sheet in ['Offeror Staffing','City Staffing']:
                for i in range(1,25):checks.append((sheet,6,chr(67+i) if i<=23 else 'AA',str(i)))
                for row in range(7,37):allowed.update((sheet,row,col) for col in list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')+['AA'])
        elif kind=='price':
            checks.extend([('2-Software',4,'A','Product Name'),('2-Software',4,'F','Initial Cost'),('3-Services',4,'F','Amount'),('4-Other Fees',4,'C','Cost')])
            for row in range(6,33):allowed.update(('2-Software',row,col) for col in 'ABCDEFGHIJKM')
            for row in range(5,32):allowed.update(('3-Services',row,col) for col in 'ABCDEFG')
            for row in range(5,20):allowed.update(('4-Other Fees',row,col) for col in 'ABC')
            allowed.add(('1-Summary',3,'B'));allowed.update(('1-Summary',row,'D') for row in [9,10,11,12,13,15,16,17])
        else:fail('Unknown native workbook kind.')
        for sheet,row,column,expected in checks:
            if sheet not in self.documents or norm(self.at(sheet,row,column))!=norm(expected):fail(f'Original template mismatch at {sheet}!{column}{row}. Upload the published workbook for this source revision.')
        return allowed,len(checks)
    def overlay(self,patches,allowed,destination):
        edited=set()
        for patch in patches:
            sheet,row,column=patch['sheet'],patch['row'],patch['column']
            if (sheet,row,column) not in allowed:fail('A requested edit is outside native respondent cells.')
            document=self.documents[sheet];data=first(document.documentElement,'sheetData')
            if data is None:fail('Worksheet data is missing.')
            target=next((r for r in children(data,'row') if int(r.getAttribute('r') or '0')==row),None)
            if target is None:
                target=create(document,'row',{'r':row});following=next((r for r in children(data,'row') if int(r.getAttribute('r') or '0')>row),None);data.insertBefore(target,following)
            address=column+str(row);cell=next((c for c in children(target,'c') if c.getAttribute('r')==address),None)
            if cell is None:
                cell=create(document,'c',{'r':address});following=next((c for c in children(target,'c') if column_num(re.sub(r'\d','',c.getAttribute('r')))>column_num(column)),None);target.insertBefore(cell,following)
            if first(cell,'f') is not None:fail('A native respondent cell contains a formula; review this workbook version.')
            for child in list(cell.childNodes):cell.removeChild(child)
            if cell.hasAttribute('t'):cell.removeAttribute('t')
            value=str(patch.get('value',''))
            if value and patch.get('type')=='number':
                if not re.fullmatch(r'(0|[1-9]\d*)(\.\d{1,2})?',value):fail('Invalid exact numeric response.')
                create(document,'v',parent=cell,value=value)
            elif value:
                cell.setAttribute('t','inlineStr');inline=create(document,'is',parent=cell);t=create(document,'t',parent=inline,value=value);t.setAttributeNS(XML,'xml:space','preserve')
            edited.add(sheet)
        members=dict(self.members)
        for sheet in edited:members[self.names[sheet]]=self.documents[sheet].toxml(encoding='utf-8')
        calc=first(self.workbook.documentElement,'calcPr')
        if calc is None:calc=create(self.workbook,'calcPr',parent=self.workbook.documentElement)
        for key,value in [('calcMode','auto'),('fullCalcOnLoad','1'),('forceFullCalc','1')]:calc.setAttribute(key,value)
        members['xl/workbook.xml']=self.workbook.toxml(encoding='utf-8')
        with zipfile.ZipFile(destination,'x') as out:
            for info in self.archive.infolist():out.writestr(copy.copy(info),members[info.filename])
        return {'editedSheets':sorted(edited),'unchangedMembers':sum(data==members[name] for name,data in self.members.items()),'totalMembers':len(members),'formulaRecalculation':'Automatic on opening in the spreadsheet application'}

def main():
    request=json.load(sys.stdin);reference={}
    for name in ['acceptance-requirements.json','interfaces.json']:reference[name]=json.loads((Path(request['reference'])/name).read_text())
    workbook=Workbook(request['input']);allowed,count=workbook.verify(request['kind'],reference)
    result={'schema':'erp-burbank.native-workbook.v1','kind':request['kind'],'verifiedSourceCells':count,'sheets':list(workbook.names)}
    if request['action']=='inspect':result['values']=workbook.values
    elif request['action']=='overlay':result.update(workbook.overlay(request['patches'],allowed,request['output']))
    else:fail('Unknown workbook action.')
    print(json.dumps(result))
if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'error':str(error)}));sys.exit(1)
