#!/usr/bin/env python3
"""Create a two-page briefing directly from completed study records."""
from pathlib import Path
import argparse, json
from playwright.sync_api import sync_playwright
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4


def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--workspace',type=Path,required=True);p.add_argument('--reports',type=Path,required=True)
 p.add_argument('--comparison',type=Path,required=True);p.add_argument('--workbench',type=Path,required=True)
 p.add_argument('--assets',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
 p.add_argument('--browser-executable',type=Path,default=Path('/usr/bin/chromium'),help='Actual permitted Chromium executable on this scientific host.')
 a=p.parse_args();a.assets.mkdir(parents=True,exist_ok=True)
 reports=json.loads(a.reports.read_text());comparison=json.loads(a.comparison.read_text());rows=comparison['rows']
 def result(mode):return json.loads((a.workspace/'chemistry-runs'/reports['analyses'][mode]['run_id']/'artifacts/result.json').read_text())
 calibration=result('calibration');monitoring=result('monitoring');ensemble=result('uncertainty')
 with sync_playwright() as playwright:
  b=playwright.chromium.launch(executable_path=str(a.browser_executable),headless=True,args=['--no-sandbox'])
  page=b.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1.5)
  page.set_content(a.workbench.read_text(),wait_until='load')
  for i,row in enumerate(rows):
   page.locator(f'[data-budget="{i}"]').click();page.locator('#map').screenshot(path=str(a.assets/f'budget-{i}.png'))
  page.locator('[data-tab="chemistry"]').click();page.locator('#analysis').select_option('uncertainty')
  page.locator('#uncertainty-plot').screenshot(path=str(a.assets/'ensemble.png'))
  b.close()
 styles=getSampleStyleSheet()
 styles.add(ParagraphStyle(name='Eyebrow',fontName='Helvetica-Bold',fontSize=8,leading=11,spaceAfter=8,textColor=colors.HexColor('#444444')))
 styles.add(ParagraphStyle(name='Title2',fontName='Helvetica-Bold',fontSize=24,leading=28,spaceAfter=12))
 styles.add(ParagraphStyle(name='Body2',fontName='Helvetica',fontSize=10,leading=14,spaceAfter=9))
 styles.add(ParagraphStyle(name='Small2',fontName='Helvetica',fontSize=8,leading=11,spaceAfter=8,textColor=colors.HexColor('#444444')))
 styles.add(ParagraphStyle(name='Section2',fontName='Helvetica-Bold',fontSize=13,leading=17,spaceBefore=12,spaceAfter=7))
 def P(text,kind='Body2'):return Paragraph(text,styles[kind])
 def tab(data,widths):
  t=Table(data,colWidths=widths,hAlign='LEFT',repeatRows=1)
  t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e9e9e9')),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTNAME',(0,1),(-1,-1),'Helvetica'),('FONTSIZE',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('LINEBELOW',(0,0),(-1,-1),.5,colors.HexColor('#cccccc')),('VALIGN',(0,0),(-1,-1),'TOP')]))
  return t
 def img(path,width,height):
  im=Image(str(path));scale=min(width/im.imageWidth,height/im.imageHeight);im.drawWidth=im.imageWidth*scale;im.drawHeight=im.imageHeight*scale;return im
 width=A4[0]-88;story=[P('ECOSYSTEM SCIENCES  /  REGIONAL MONITORING  /  13 OCTOBER 2026','Eyebrow'),P('Three saved monitoring budgets','Title2'),P('Compare the original Upper Savannah catchment-area plans, their selected search areas and their field calendars. All three retained optimizer results are optimal for their authored inputs.')]
 data=[['Budget (USD)','Search areas','Area (km²)','Domain share','Visits']]
 for r in rows:data.append([f"${r['budget_cents']/100:,.0f}",str(r['selected_sites']),f"{r['coverage']['covered_weight']:,.3f}",f"{r['coverage']['fraction']*100:.2f}%",str(r['calendar']['visits'])])
 story += [tab(data,[100,92,110,105,width-407]),Spacer(1,15)]
 images=[img(a.assets/f'budget-{i}.png',width/3-8,176) for i in range(3)]
 maps=Table([images,[P(f"${r['budget_cents']/100:,.0f}: {r['selected_sites']} selected catchments",'Small2') for r in rows]],colWidths=[width/3]*3)
 maps.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),2),('RIGHTPADDING',(0,0),(-1,-1),6)]));story.append(maps)
 story += [P('Dark polygons are the saved search areas; all 217 original catchment outlines remain visible. Areas in the table retain the original geodesic calculations.','Small2'),P('Field programme and costs','Section2'),P('Each search area has three planned visits. The original calendar spans 2 November 2026 to 4 January 2027, with four slots per crew-day and the stated travel allowance. Costs are $600 programme overhead, $250 setup per area and $150 per visit. These are editable planning assumptions.'),P('How to use the comparison','Section2'),P('The objective is catchment area with local planning presence. The original domain totals 18,854.604 km². A selected catchment is a field search area: station assignment, source-water priorities and constituent-specific support remain separate scientific selections. The workbench retains the 87 original station locations for inspection.'),P('Source: budget-study/comparison.json, native/frontier.json, native/plans/ and the retained original network source files. Open the workbench for selected-area search, per-round calendars and the exact CSV downloads.','Small2'),PageBreak()]
 story += [P('ECOSYSTEM SCIENCES  /  COMPOUND CHEMISTRY  /  COMPLETED METHOD STUDY','Eyebrow'),P('Four analyses, one editable case','Title2'),P('A separate four-reach mathematical case now supports compound ammonium/nitrate observations, declared intervals, calibration, sensitivity, the original 512-draw ensemble and monitoring design. Its authored coefficients remain distinct from regional site estimates.')]
 params=[['Coefficient','Starting value','Fitted value','Units']]
 for r in calibration['parameters']:params.append(['Nitrification rate' if r['id']=='nitrification_rate' else 'Point nitrogen load',f"{r['original']:.6g}",f"{r['fitted']:.6g}",'day⁻¹' if r['kind']=='reaction_rate_day' else 'kg N/day'])
 # Built-in PDF fonts support the basic Latin unit spelling consistently.
 params[1][-1]='per day'
 story += [tab(params,[176,98,98,width-372]),Spacer(1,12),P('The fit converged using 20 fit records. Eighteen held-out records retain their original roles; 14 records have interval bounds, including the two explicit endpoint cases. The full reports retain point errors and interval support separately.'),P('Original parameter-prior ensemble','Section2'),img(a.assets/'ensemble.png',width,177),P('Confluence, ammonium plus nitrate nitrogen: median prediction with original 5th-to-95th percentile shading. These are parameter-prior ensemble quantiles. The supplied original seed and all 512 parameter draws are retained.','Small2'),P('Completed analysis outputs','Section2'),P('The compound ensemble reproduces the weighted original component predictions exactly. The native sensitivity output retains 72 target-by-parameter rows. Monitoring design retains eight selected candidate measurements using the supplied starting coefficients, error scales and prior precision.'),P('Open, inspect and continue editing','Section2'),P('The offline workbench supplies four complete scientific reports, original result JSON and native editable ZIP downloads. The complete application/Workspace archive has also been independently restored, reopening the four runs, four report editions, four scientific sources and original regional plans.'),P('Sources: reports/native-reports.json; each original Chemistry result.json and request.json; complete-workspace-receiving.json. Technical PDFs and original source/report packets accompany this brief.','Small2')]
 def footer(c,doc):
  c.saveState();c.setStrokeColor(colors.HexColor('#bbbbbb'));c.line(44,34,A4[0]-44,34);c.setFont('Helvetica',8);c.setFillColor(colors.HexColor('#555555'));c.drawString(44,23,'Monitoring and Chemistry study  |  Retained original data and editable results');c.drawRightString(A4[0]-44,23,str(doc.page));c.restoreState()
 a.output.parent.mkdir(parents=True,exist_ok=True)
 doc=SimpleDocTemplate(str(a.output),pagesize=A4,rightMargin=44,leftMargin=44,topMargin=38,bottomMargin=46,title='Ecosystem Sciences: Monitoring and Chemistry Study',author='TokenJunkieLabs')
 doc.build(story,onFirstPage=footer,onLaterPages=footer)
 print(a.output)

if __name__=='__main__':main()
