"""Build a compact printable brief from the completed native source join."""
import argparse
from pathlib import Path
import json
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,KeepTogether
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--study', required=True, type=Path, help='Existing completed field-support directory')
    parser.add_argument('--output', type=Path, help='PDF destination; defaults to the study directory')
    args=parser.parse_args()
    r=args.study.resolve(strict=True)
    d=json.loads((r/'field-support.json').read_text(encoding='utf-8'))
    output=args.output.resolve() if args.output else r/'Monitoring_Field_Support_Brief.pdf'
    output.parent.mkdir(parents=True, exist_ok=True)
    s=getSampleStyleSheet();s.add(ParagraphStyle(name='BodyField',fontName='Helvetica',fontSize=10,leading=14,spaceAfter=9,textColor=colors.HexColor('#222222')));s.add(ParagraphStyle(name='TableField',fontName='Helvetica',fontSize=9,leading=12));s.add(ParagraphStyle(name='SmallField',fontName='Helvetica',fontSize=8,leading=11,textColor=colors.HexColor('#444444')))
    def P(t,style='BodyField'):return Paragraph(t,s[style])
    def T(rows,widths):
     table=Table([[P(escape(str(c)),'TableField') for c in row] for row in rows],colWidths=widths,repeatRows=1,hAlign='LEFT')
     table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eeeeee')),('LINEBELOW',(0,0),(-1,0),.7,colors.HexColor('#777777')),('LINEBELOW',(0,1),(-1,-1),.4,colors.HexColor('#cccccc')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]));return table
    story=[P('UPPER SAVANNAH  /  MONITORING FIELD SUPPORT','SmallField'),Spacer(1,6),Paragraph('Field evidence behind the budget',s['Title']),P('Three original monitoring plans, joined to their retained station evidence. Prepared 13 October 2026.'),Spacer(1,5),P('<b>Key finding.</b> All three budgets reach the same 234 historical E. coli records at 11 stations in two selected catchments. Increasing the original area-maximizing budget expands geographic coverage, but does not add records from this retained observation edition.')]
    rows=[['Saved budget','Search areas','Draft-assessment sites','Historical stations','Original results','Planned visits']]
    for p in d['plans']:rows.append(['${:,.0f}'.format(float(p['budget_usd'])),len(p['selected_ids']),len(p['assessment_station_ids']),len(p['observation_station_ids']),p['historical_results'],len(p['original_calendar']['visits'])])
    story += [T(rows,[78,75,101,85,80,81]),Spacer(1,16),P('<b>Where those historical records are located</b>')]
    rows=[['Original catchment','Records','Retained sampling dates']]
    for area in d['plans'][0]['search_areas']:
     if area['historical_results']:rows.append([area['name']+' / '+area['huc12'],area['historical_results'],area['historical_first_date']+' to '+area['historical_last_date']])
    story += [T(rows,[280,60,160]),Spacer(1,11),P('The 234 records comprise 233 routine samples and one separately retained field replicate. Across all activities, 158 are numeric measurements, 62 are below a reported limit, 13 are not detected and one is not reported. Censored values remain limits or missing results; they are not replaced with zero or a fraction of a limit.'),P('<b>Use the field-planning desk.</b> Select a saved budget and catchment, inspect original station coordinates and source fields, and explicitly choose a candidate station for review. Add the field note, select original calendar rounds, then download the crew CSV and editable selection JSON. Reopening that JSON restores the exact source-bound choices in another browser.'),P('<b>Read the two source periods separately.</b> Measurements retain their original 2021–2025 dates. The winter 2026–2027 visits are planned local time slots with a 60-minute visit and 60-minute travel allowance. Draft-assessment causes retain their 2026 draft status. These records support scientific planning; they do not change the optimizer or establish future access arrangements.'),P('<b>Delivered files.</b> Open <font name="Courier">Ecosystem_Monitoring_Field_Planning.html</font> for the offline desk. The complete ZIP contains original CSVs, original coordinate families, assessment inputs, full catchment geometry, saved plans, all source and an example field-selection file. Its <font name="Courier">source-manifest.json</font> imports the finished desk and complete source hierarchy into the original native Workspace.'),Spacer(1,6),P('Source inventory: field-support.json, source-selection.json, original source catalogs and native/frontier.json. Original Water Quality Portal observations, declared WGS84/NAD83 station coordinates, SCDES draft-assessment records and retained Monitoring plan outputs remain individually traceable.','SmallField')]
    def footer(c,doc):
     c.setFont('Helvetica',8);c.setFillColor(colors.HexColor('#555555'));c.drawString(42,28,'Original source support | Field study '+d['id'][:12]);c.drawRightString(570,28,str(doc.page))
    SimpleDocTemplate(str(output),pagesize=(612,792),leftMargin=56,rightMargin=56,topMargin=38,bottomMargin=44).build(story,onFirstPage=footer,onLaterPages=footer)


if __name__ == '__main__':
    main()
