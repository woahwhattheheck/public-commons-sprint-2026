"""Rebuild the proposal. Optional build dependencies: python3 -m pip install reportlab pymupdf."""
from pathlib import Path
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import argparse, hashlib, json, fitz, reportlab

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description='Build the two-page workshare from its maintained quote. Requires ReportLab and PyMuPDF.')
parser.add_argument('--preview-dir',type=Path,help='Optional directory for rendered previews and the extracted text.')
parser.add_argument('--font-dir',type=Path,help='Optional font directory containing DejaVu Sans or the bundled ReportLab Vera family.')
args=parser.parse_args()
PREVIEW=args.preview_dir.resolve() if args.preview_dir else None
if PREVIEW: PREVIEW.mkdir(parents=True,exist_ok=True)
quote=json.loads((ROOT/'quote.json').read_text())
assert sum(x['amount_cents'] for x in quote['fees']) == quote['proposed_total_cents'] == 840000
assert sum(x['amount_cents'] for x in quote['milestones']) == 840000
font_roots=[args.font_dir.resolve()] if args.font_dir else [ROOT/'fonts',Path('/usr/share/fonts/truetype/dejavu'),Path(reportlab.__file__).resolve().parent/'fonts']
font_files=None
for directory in font_roots:
 for regular,bold in [('DejaVuSans.ttf','DejaVuSans-Bold.ttf'),('Vera.ttf','VeraBd.ttf')]:
  if (directory/regular).is_file() and (directory/bold).is_file():
   font_files=[directory/regular,directory/bold]
   break
 if font_files: break
if not font_files: parser.error('Install ReportLab with its bundled Vera fonts, or select a complete DejaVu Sans/Vera directory with --font-dir.')
for name,file in zip(['DejaVu','DejaVu-Bold'],font_files):
 pdfmetrics.registerFont(TTFont(name,str(file)))
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleX',fontName='DejaVu-Bold',fontSize=22,leading=27,spaceAfter=10,textColor=colors.HexColor('#202020')))
styles.add(ParagraphStyle(name='SubX',fontName='DejaVu',fontSize=10,leading=14,spaceAfter=11,textColor=colors.HexColor('#505050')))
styles.add(ParagraphStyle(name='BodyX',fontName='DejaVu',fontSize=9.2,leading=13.2,spaceAfter=8))
styles.add(ParagraphStyle(name='HeadX',fontName='DejaVu-Bold',fontSize=11.2,leading=15,spaceBefore=8,spaceAfter=6))
styles.add(ParagraphStyle(name='CellX',fontName='DejaVu',fontSize=8.5,leading=11.6))
styles.add(ParagraphStyle(name='SmallX',fontName='DejaVu',fontSize=7.8,leading=10.5,spaceAfter=6,textColor=colors.HexColor('#505050')))
p=lambda text,style='BodyX':Paragraph(text,styles[style])
def table(rows,widths):
 t=Table([[p(cell,'CellX') for cell in row] for row in rows],colWidths=widths,hAlign='LEFT')
 t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BOX',(0,0),(-1,-1),.5,colors.HexColor('#aaaaaa')),('INNERGRID',(0,0),(-1,-1),.3,colors.HexColor('#d0d0d0')),('BACKGROUND',(0,0),(0,-1),colors.HexColor('#f1f1f1')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
 return t
story=[
 p('DEWR content and GIS<br/>migration workshare','TitleX'),
 p('Prepared for Orca Design Group’s CSKT DEWR project team<br/>TokenJunkieLabs · 11 October 2026','SubX'),
 p('A complete technical delivery beneath the prime’s website design: original content and documents, named staff decisions, native WordPress migration, GIS integration and a recoverable operating handover.'),
 p('<b>USD 8,400 · ten business days · 50/50 payment</b>','HeadX'),
 p('One source site and WordPress destination; up to <b>40 approved pages, 400 media/document records and four GIS app references</b>. Includes <b>two consolidated correction cycles</b>, the selected technical release and receiving-operator adoption.'),
 p('The current public source contains 33 pages and 353 actual media objects: 130 PDF, 3 DOCX, 2 ZIP, 201 images and 17 videos. The implementation scope starts from the approved original export and files.','SmallX'),
 p('What the receiving team gets','HeadX'),
 table([
 ['<b>Source and review</b>','Complete inventory; original/draft history; staff decisions to retain, revise, consolidate, archive or remove; named editor, reviewer and administrator responsibilities.'],
 ['<b>Content and documents</b>','Approved project/program/news/notice categories, searchable document metadata and versions, original-to-target mappings, and reviewed permanent redirects or intentional removals.'],
 ['<b>Native delivery</b>','WordPress destination integration, selected immutable release, original target capture, actual content/media results, interrupted-operation resume and recovery that accounts for intervening staff edits.'],
 ['<b>GIS and handover</b>','Four approved app integrations or current replacements, accessible descriptions/direct links, source/configuration, operating guides, staff walkthrough and complete backup/reopen.']
 ],[112,416]),
 p('Itemized implementation fee','HeadX'),
 table([[x['label'],f"USD {x['amount_cents']/100:,.0f}"] for x in quote['fees']]+[['<b>Total</b>','<b>USD 8,400</b>']],[422,106]),
 PageBreak(),
 p('Delivery and continuing operation','TitleX'),
 p('The original RFP anticipates project kickoff in January 2027. This ten-day workstream fits inside the prime’s agreed implementation plan.','SubX'),
 table([
 ['<b>Days 1–2</b>','Confirm original source/files, destination and roles. Complete inventory decisions, categories, routes, GIS references and the transfer plan.'],
 ['<b>Days 3–5</b>','Configure the original review and WordPress workflows. Prepare the first full staging release, document views and approved GIS fallback pages.'],
 ['<b>Days 6–8</b>','Operate both consolidated correction cycles. Inspect actual destination content, routes, documents and GIS behavior against the agreed source.'],
 ['<b>Days 9–10</b>','Complete the selected release, recipient walkthrough, restart/recovery exercise and source/configuration/admin handover.']
 ],[112,416]),
 p('Inputs and acceptance','HeadX'),
 p('Orca supplies the approved destination and theme/template interfaces, original exports/files, current GIS access and a designated coordinator for DEWR’s content decisions. The schedule starts when these inputs are ready and assumes consolidated review within one business day of each agreed session.'),
 p('Acceptance means every selected record has an agreed disposition; approved content and routes match the destination; the four GIS references have their approved integration or accessible fallback; staff can edit/review/release; and the original target state and full workspace can be recovered. Three source StoryMaps are accessible; the legacy MapSeries reference needs its approved replacement or fallback.'),
 p('Warranty, support and separately priced work','HeadX'),
 p('The fee includes <b>30 calendar days of implementation warranty</b> after technical handover. Initial response: <b>one business day</b> for loss of the delivered workflow or an implementation-caused public integration failure; <b>two business days</b> for routine implementation issues. Response includes diagnosis or a correction plan and agreed timing.'),
 p('<b>Optional care: USD 600/month for four technical hours.</b> Additional authorized work: USD 150/hour. Support is remote on weekdays excluding U.S. federal holidays; the handover records the working time zone and contacts. Unused hours do not roll over; monthly service can end before the next billing period.'),
 p('Substantive rewriting and existing PDF/DOCX accessibility remediation: USD 150/hour against an approved inventory and written ceiling. New maps, StoryMaps or multimedia production receive a separate fixed quote. Added hosting, plugins and subscriptions use actual agreed supplier costs.'),
 p('Ownership and commercial terms','HeadX'),
 p('USD 4,200 at kickoff and USD 4,200 at accepted handover. Orca leads institutional design, branding, the overall bid and customer relationship. CSKT retains its domain, hosting, CMS, GIS and applicable service accounts. Delivery includes editable source, configuration, release/recovery material and operating guides.'),
 p('<link href="https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/business/cskt-dewr-migration-20261011"><u>Maintained implementation</u></link> · <link href="https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/business/cskt-dewr-migration-20261011/commercial/WORKSHARE.md"><u>Full scope and acceptance</u></link> · <link href="https://csktwatercompact.com/wp-content/uploads/2026/10/DEWR_Website_RFP_Final.pdf"><u>Original DEWR RFP</u></link>','SmallX'),
 p('<b>Bryce · TokenJunkieLabs</b> · brycembusiness2@gmail.com','BodyX')
]
def footer(canvas,doc):
 canvas.setStrokeColor(colors.HexColor('#bbbbbb'));canvas.line(42,38,570,38)
 canvas.setFont('DejaVu',7.5);canvas.setFillColor(colors.HexColor('#555555'))
 canvas.drawString(42,25,'TokenJunkieLabs · CSKT DEWR content/GIS workshare · 11 October 2026')
 canvas.drawRightString(570,25,str(doc.page))
path=ROOT/'CSKT_DEWR_Content_GIS_Workshare.pdf'
doc=SimpleDocTemplate(str(path),pagesize=(612,792),leftMargin=42,rightMargin=42,topMargin=40,bottomMargin=50,title='CSKT DEWR content and GIS migration workshare',author='TokenJunkieLabs')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
pdf=fitz.open(path)
text='\n'.join(page.get_text() for page in pdf)
assert len(pdf)==2,len(pdf)
assert all(t in text for t in ['8,400','40 approved pages','400 media/document','4,200','600/month','30 calendar days'])
if PREVIEW:
 (PREVIEW/'proposal-text.txt').write_text(text)
 for i,page in enumerate(pdf):
  page.get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(str(PREVIEW/f'page-{i+1}.png'))
raw=path.read_bytes()
result={'path':str(path),'pages':len(pdf),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'quote_total_cents':quote['proposed_total_cents']}
if PREVIEW: (PREVIEW/'PDF_RESULT.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))

