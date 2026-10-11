"""Extract the original SANDAG 2024 bulletin's published aggregate tables.

No incident or person-level source is used. Source anomalies remain explicit.
Requires the retained original PDF and pdftotext -layout output beside this file.
"""
from pathlib import Path
import csv
import hashlib
import io
import json
import re
import unicodedata
from collections import Counter, defaultdict

ROOT=Path(__file__).resolve().parent
PDF=ROOT/'SANDAG_2024_annual_crime.pdf'
TEXT=ROOT/'SANDAG_2024_annual_crime.txt'
SOURCE_URL='https://www.sandag.org/-/media/SANDAG/Documents/PDF/data-and-research/criminal-justice-and-public-safety/criminal-justice-research-clearinghouse/cj-bulletin/cj-bulletin-2024-crime-in-the-san-diego-region-2025-08-18.pdf'
EXPECTED_PDF_SHA='e25453715fbf0712c8b690ba09b2fb6c44191534f24f228b19d626d2da59738b'
sha=hashlib.sha256(PDF.read_bytes()).hexdigest()
if sha!=EXPECTED_PDF_SHA:raise ValueError('Review a new issuer PDF before applying this exact-layout extraction')
pages=TEXT.read_text().split('\f')
OUT=ROOT/'dataset';OUT.mkdir(exist_ok=True)

def ident(value):
    value=unicodedata.normalize('NFKC',value).casefold()
    return re.sub(r'[^a-z0-9]+','-',value).strip('-')

SIDE_A=['Carlsbad','Chula Vista','Coronado','El Cajon','Escondido','La Mesa','National City','Oceanside','San Diego','Sheriff-Total','Del Mar','Encinitas','Imperial Beach']
SIDE_B=['Lemon Grove','Poway','San Marcos','Santee','Solana Beach','Vista','Unincorporated','Sheriff Other','Harbor','UCSD','CSUSM','SDSU']
SHERIFF_COMPONENTS={'Del Mar','Encinitas','Imperial Beach','Lemon Grove','Poway','San Marcos','Santee','Solana Beach','Vista','Unincorporated','Sheriff Other'}
FULL_LABELS={'Harbor':'San Diego Harbor Police','UCSD':'University of California San Diego','CSUSM':'Calif. State University San Marcos','SDSU':'San Diego State University'}
ALIASES={v:k for k,v in FULL_LABELS.items()}
ALIASES.update({'Total':'San Diego Region','Unincor- porated':'Unincorporated'})
TOKEN=re.compile(r'(?<!\S)(?:,?\d[\d,]*|—|--|–)(?!\S)')
CATEGORIES={'Crimes Against Persons','Crimes Against Property','Crimes Against Society','Group B Offenses'}
SUBTOTALS={
 'Non-consensual Sex Offenses':['Rape','Sodomy','Sexual Assault with An Object','Fondling'],
 'Consensual Sex Offenses':['Incest','Statutory Rape'],
 'Larceny/Theft Offenses':['Pocket-picking','Purse-snatching','Shoplifting','Theft From Building','Theft From Coin Operated Machine or Device','Theft From Motor Vehicle','Theft of Motor Vehicle Parts/Accessories','All Other Larceny'],
 'Fraud Offenses':['False Pretenses/Swindle/Confidence Game','Credit Card/Automatic Teller Fraud','Impersonation','Welfare Fraud','Wire Fraud','Identity Theft','Hacking/Computer Invasion'],
 'Gambling Offenses':['Betting/Wagering','Operating/Promoting/Assisting Gambling','Gambling Equipment Violations','Sports Tampering']}
CHILDREN={ident(c):p for p,children in SUBTOTALS.items() for c in children}
subtotals={ident(x) for x in SUBTOTALS}
warnings=[];footnotes=[];tables=[];raw_rows=[]

def jurisdiction_fields(label):
    key=ALIASES.get(label,label)
    level='region_total' if key=='San Diego Region' else 'subtotal' if key=='Sheriff-Total' else 'leaf'
    parent=None if level=='region_total' else 'Sheriff-Total' if key in SHERIFF_COMPONENTS else 'San Diego Region'
    return {'jurisdiction_id':ident(key),'jurisdiction':key,'jurisdiction_label':FULL_LABELS.get(key,key),
       'jurisdiction_raw':label,'jurisdiction_level':level,'jurisdiction_parent_id':ident(parent) if parent else None,
       'is_regional_component':level!='region_total' and key not in SHERIFF_COMPONENTS,
       'is_sheriff_component':key in SHERIFF_COMPONENTS}

def offense_fields(label,category,group):
    key=ident(label)
    if not label:level='unlabeled_source_row';parent=None
    elif label in ('Total Group A Offenses','Total Group B Offenses'):level='group_total';parent=None
    elif label.startswith('Total Crimes Against'):level='category_total';parent='Total Group '+group+' Offenses'
    elif key in subtotals:level='subtotal';parent='Total '+category
    else:level='leaf';parent=CHILDREN.get(key,'Total '+category if group=='A' else 'Total Group B Offenses')
    return {'offense_id':key or None,'offense':label or None,'offense_raw':label or None,'offense_level':level,
      'offense_parent_id':ident(parent) if parent else None,'category':category,'group':group}

def value_fields(raw,year,jurisdiction,page):
    if raw in ('—','--','–',''):
        if raw=='':state='blank_in_source'
        elif year==2021 and jurisdiction=='Coronado':state='partial_year_not_presented'
        elif year==2021 and jurisdiction in ('UCSD','CSUSM','SDSU'):state='not_reported'
        else:state='not_published'
        return {'raw_value':raw,'value':None,'value_state':state,'numeric_format_anomaly':False}
    if not re.fullmatch(r',?\d[\d,]*',raw):raise ValueError((page,raw))
    anomaly=raw.startswith(',')
    if anomaly:warnings.append({'code':'PRINTED_NUMERIC_FORMAT','page':page,'jurisdiction':jurisdiction,'raw_value':raw,'interpretation':'Remove grouping commas for typed integer; original leading comma remains visible.'})
    return {'raw_value':raw,'value':int(raw.replace(',','')),'value_state':'reported','numeric_format_anomaly':anomaly}

def extract_table(table,group,year,page_numbers,side):
    jurisdictions=SIDE_A if side=='a' else SIDE_B
    rows=[];category='Group B Offenses' if group=='B' else None
    for number in page_numbers:
        text=pages[number-1];lines=text.splitlines()
        ni=next((i for i,l in enumerate(lines) if l.strip().startswith(('Note:','Notes:','Note :'))),len(lines))
        note='\n'.join(lines[ni:]).split('Crime in the San Diego Region: 2024')[0].strip()
        if note:footnotes.append({'id':f'page-{number}','table':table,'page':number,'text':note})
        for line_no,line in enumerate(lines[:ni],1):
            stripped=line.strip()
            if stripped in CATEGORIES:category=stripped;continue
            if stripped in ('Device','Game') and rows:
                rows[-1]['label']+=' '+stripped;rows[-1]['raw_lines'].append(line);continue
            matches=list(TOKEN.finditer(line))
            if not matches:continue
            label=line[:matches[0].start()].strip()
            if not category or label.startswith(('Crime in the San Diego Region','San Diego Region','Appendix')):continue
            raw=[x.group() for x in matches]
            if len(raw)!=len(jurisdictions):
                if number==34 and label=='Sports Tampering' and len(raw)==9:
                    raw+=['','','']
                    warnings.append({'code':'BLANK_PUBLISHED_CELLS','table':table,'page':number,'offense':label,'jurisdictions':['UCSD','CSUSM','SDSU'],'detail':'Three cells are visibly blank in the original table; retained as null, not zero.'})
                elif len(raw)>=8:raise ValueError(f'Unexpected count field layout on page{number}: {line}')
                else:continue
            if not label:
                warnings.append({'code':'UNLABELED_PUBLISHED_ROW','table':table,'page':number,'source_line':line_no,'raw_values':raw,'detail':'Published numeric row has no offense label. It is retained with a null offense and excluded from additive measures. No inferred label/row shift is applied.'})
            rows.append({'table':table,'group':group,'year':year,'page':number,'source_line':line_no,'label':label,'category':category,'values':raw,'raw_lines':[line],'jurisdictions':jurisdictions})
    tables.append({'id':table,'group':group,'year':year,'pages':page_numbers,'jurisdictions':jurisdictions,'published_rows':len(rows),'footnote_ids':[f['id'] for f in footnotes if f['table']==table]})
    raw_rows.extend(rows)
    return rows

for year,table,page in [(2021,10,31),(2023,11,35),(2024,12,39)]:
    extract_table(str(table)+'a','A',year,[page,page+1],'a')
    extract_table(str(table)+'b','A',year,[page+2,page+3],'b')
for year,table,page in [(2021,14,44),(2023,15,46),(2024,16,48)]:
    extract_table(str(table)+'a','B',year,[page],'a')
    extract_table(str(table)+'b','B',year,[page+1],'b')

facts=[]
for r in raw_rows:
    for column,(j,raw) in enumerate(zip(r['jurisdictions'],r['values']),1):
        fact={'source_record_id':f'appendix-{r["table"]}-p{r["page"]}-l{r["source_line"]}-c{column}',
          'table':r['table'],'page':r['page'],'year':r['year'],'source_column':column,'measure':'offenses','unit':'count',
          **jurisdiction_fields(j),**offense_fields(r['label'],r['category'],r['group']),**value_fields(raw,r['year'],j,r['page']),
          'source_table_alignment_review':r['table']=='11b','source_url':SOURCE_URL,'source_sha256':sha,
          'footnote_ids':'|'.join(f['id'] for f in footnotes if f['table']==r['table'])}
        fact['is_detail_leaf']=fact['offense_level']=='leaf' and fact['jurisdiction_level']=='leaf'
        fact['is_regional_group_component']=fact['is_regional_component'] and fact['offense_level']=='group_total'
        facts.append(fact)

# The separate regional/jurisdiction summary tables retain their own printed values.
# They are reference comparisons, not additional rows to UNION into the fact table.
summaries=[]
for table,number,offense in [(6,27,'Total Group A Offenses'),(7,28,'Total Crimes Against Persons'),(8,29,'Total Crimes Against Property'),(9,30,'Total Crimes Against Society')]:
    lines=pages[number-1].splitlines();notes_at=next(i for i,l in enumerate(lines) if l.strip().startswith('Notes:'))
    note='\n'.join(lines[notes_at:]).split('Crime in the San Diego Region: 2024')[0].strip()
    footnotes.append({'id':f'page-{number}','table':str(table),'page':number,'text':note})
    for line_no,line in enumerate(lines[:notes_at],1):
        matches=list(TOKEN.finditer(line))
        if len(matches)<3:continue
        label=line[:matches[0].start()].strip()
        if label not in set(SIDE_A+SIDE_B+list(FULL_LABELS.values())+['Total']):continue
        for year,match in zip([2021,2023,2024],matches[:3]):
            j=ALIASES.get(label,label)
            category={'6':'All Group A','7':'Crimes Against Persons','8':'Crimes Against Property','9':'Crimes Against Society'}[str(table)]
            item={'source_record_id':f'appendix-{table}-p{number}-l{line_no}-y{year}','table':str(table),'page':number,'year':year,
                **jurisdiction_fields(label),**offense_fields(offense,category,'A'),**value_fields(match.group(),year,j,number),
                'unit':'count','footnote_ids':f'page-{number}','source_url':SOURCE_URL,'source_sha256':sha}
            if j=='Coronado' and year==2021 and item['value'] is not None:item['value_state']='reported_partial_year'
            summaries.append(item)

population=[];pop_lines=pages[49].splitlines();notes_at=next(i for i,l in enumerate(pop_lines) if l.strip().startswith('Notes:'))
pop_note='\n'.join(pop_lines[notes_at:]).split('Crime in the San Diego Region: 2024')[0].strip()
footnotes.append({'id':'page-50','table':'17','page':50,'text':pop_note})
for line_no,line in enumerate(pop_lines[:notes_at],1):
    matches=list(TOKEN.finditer(line))
    if len(matches)!=2:continue
    label=line[:matches[0].start()].strip()
    if label not in set(SIDE_A+SIDE_B+['Total']):continue
    for period,years,match in zip(['2021','2023/2024'],[[2021],[2023,2024]],matches):
        population.append({'source_record_id':f'appendix-17-p50-l{line_no}-{period.replace("/","-")}',
            'table':'17','page':50,'year':2021 if period=='2021' else None,'year_label':period,'applicable_years':'|'.join(map(str,years)),
            **jurisdiction_fields(label),**value_fields(match.group(),2021 if period=='2021' else None,label,50),
            'measure':'population','unit':'residents','population_source':'SANDAG Population and Housing Estimates v2023',
            'footnote_ids':'page-50','source_url':SOURCE_URL,'source_sha256':sha})

issues=[];index={(f['year'],f['jurisdiction_id'],f['offense_id']):f for f in facts if f['offense_id']}
for s in summaries:
    if s['jurisdiction_level']=='region_total':continue
    f=index.get((s['year'],s['jurisdiction_id'],s['offense_id']))
    if f is None or f['value']!=s['value']:
        issues.append({'kind':'detailed_to_summary','year':s['year'],'jurisdiction':s['jurisdiction'],'offense':s['offense'],
          'detailed_value':f['value'] if f else None,'detailed_record':f['source_record_id'] if f else None,
          'summary_value':s['value'],'summary_record':s['source_record_id'],
          'delta':f['value']-s['value'] if f and f['value'] is not None and s['value'] is not None else None})

def write_json(name,value):
    path=OUT/name;path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');return path
def write_jsonl(name,values):
    path=OUT/name
    with path.open('w') as stream:
        for value in values:stream.write(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')
    return path
def write_csv(name,values):
    path=OUT/name;columns=list(dict.fromkeys(k for r in values for k in r))
    with path.open('w',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=columns);writer.writeheader();writer.writerows(values)
    return path

files=[]
for stem,values in [('offenses',facts),('population',population),('summary_reference',summaries)]:
    files += [write_jsonl(stem+'.jsonl',values),write_csv(stem+'.csv',values)]
files += [write_json('tables.json',tables),write_json('footnotes.json',footnotes),write_json('raw_table_rows.json',raw_rows),
          write_json('source_warnings.json',warnings),write_json('published_table_comparison.json',issues)]

jurisdictions={f['jurisdiction_id']:{k:f[k] for k in ['jurisdiction_id','jurisdiction','jurisdiction_label','jurisdiction_level','jurisdiction_parent_id','is_regional_component','is_sheriff_component']} for f in facts+population}
offenses={f['offense_id']:{k:f[k] for k in ['offense_id','offense','offense_level','offense_parent_id','category','group']} for f in facts if f['offense_id']}
files += [write_csv('jurisdictions.csv',list(jurisdictions.values())),write_csv('offense_dimension.csv',list(offenses.values()))]

guidance={
 'schema':'sandag-public-crime-aggregate/v1','dataset':'Crime in the San Diego Region, 2024; original Appendix Tables10–12,14–17',
 'source_url':SOURCE_URL,'source_sha256':sha,'snapshot':'Original publication reports March/April2025 extractions; SDSO2024 includes its separately supplied November19–December31 period.',
 'source_story':'https://opendata.sandag.org/stories/s/4x56-7rbz','license_metadata':'The official story metadata lists Use Limitations: Allowed to Publish.',
 'fact_counts':{'offenses':len(facts),'population':len(population),'summary_reference':len(summaries)},
 'fact_grain':'one printed table/year/jurisdiction/offense cell, including published subtotal cells; a null-offense orphan row remains separate',
 'value_states':dict(Counter(f['value_state'] for f in facts)),
 'hierarchy':[
   'Do not SUM the whole fact table. Select one offense level and one jurisdiction aggregation set.',
   'For one jurisdiction/group/year total, select offense_level=group_total and the exact jurisdiction.',
   'For a region/group/year component calculation, select is_regional_group_component=true. This selects Sheriff-Total once and excludes its eleven components.',
   'To drill into Sheriff-Total, select is_sheriff_component=true. Its published note says unspecified incidents can make the rollup exceed the listed components; preserve the difference.',
   'For detailed offense analysis use offense_level=leaf; select jurisdiction_level=leaf for jurisdiction detail, or is_regional_component=true for nonduplicated regional components.',
   'Population2023/2024 is one published period, not two independently observed annual values. Use applicable_years when relating it to a chosen crime year.',
   'summary_reference.csv contains separately printed regional/category controls. Keep it separate from offenses.csv and never UNION it into the same additive measure.',
   'Do not compare this CIBRS/NIBRS series with earlier UCR Summary counts. Preserve partial/not-reported2021 coverage and all original footnotes.'
 ],
 'source_anomalies':warnings,'published_detailed_summary_differences':len(issues),
 'table11b_review':'Page37 has an unlabeled numeric row before page38 continues labeled rows. All printed labels and values are retained without inferring a shift; source_table_alignment_review marks that exact table. Use2024 for the primary native model exercise and retain2023 source review as a real exception workflow.',
 'blank_and_suppression_policy':'A dash or visibly blank source cell remains null with its raw token and observed coverage state. No omitted value is converted to zero.',
 'normalization':'Integer typing removes comma grouping, including the explicitly flagged printed leading comma in ,1,188. Raw tokens, labels, table rows and page references remain available.',
 'files':[]}
for path in files:
    body=path.read_bytes();guidance['files'].append({'path':path.name,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})
write_json('manifest.json',guidance)
print(json.dumps({'directory':str(OUT),'rows':guidance['fact_counts'],'values':guidance['value_states'],'tables':len(tables),'warnings':len(warnings),'comparison_differences':len(issues),'file_bytes':sum(f['bytes'] for f in guidance['files'])},indent=2))
