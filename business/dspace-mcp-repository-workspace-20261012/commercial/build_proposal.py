#!/usr/bin/env python3
"""Render the existing scope and price as a portable two-page buyer proposal."""
from pathlib import Path
import json
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
ROOT=Path(__file__).resolve().parent
offer=json.loads((ROOT/'offer.json').read_text())
target=ROOT/'DSpace_Repository_Implementation_Workshare.pdf'
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleLocal',fontName='Helvetica-Bold',fontSize=22,leading=26,spaceAfter=15,textColor=colors.HexColor('#202020')))
styles.add(ParagraphStyle(name='SubLocal',fontName='Helvetica',fontSize=10,leading=14,spaceAfter=12,textColor=colors.HexColor('#555555')))
styles.add(ParagraphStyle(name='HeadLocal',fontName='Helvetica-Bold',fontSize=12,leading=16,spaceBefore=12,spaceAfter=6,textColor=colors.HexColor('#202020')))
styles.add(ParagraphStyle(name='BodyLocal',fontName='Helvetica',fontSize=10,leading=14,spaceAfter=8,textColor=colors.HexColor('#242424')))
styles.add(ParagraphStyle(name='SmallLocal',fontName='Helvetica',fontSize=8.3,leading=11,spaceAfter=6,textColor=colors.HexColor('#555555')))
story=[]
def para(text,style='BodyLocal'):story.append(Paragraph(text,styles[style]))
def heading(text):para(text,'HeadLocal')
def table(rows,widths):
 data=[[Paragraph(escape(str(v)),styles['BodyLocal']) for v in row] for row in rows]
 t=Table(data,colWidths=widths,hAlign='LEFT')
 t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,0),0.7,colors.HexColor('#555555')),('LINEBELOW',(0,1),(-1,-1),0.3,colors.HexColor('#cccccc')),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),12)]))
 story.append(t)
para('DSpace repository<br/>implementation workshare','TitleLocal')
para('Prepared for 4Science by TokenJunkie Labs | 12 October 2026','SubLocal')
table([['Fixed implementation','Delivery','Payment'],['$6,400','10 business days','$3,200 scheduling / $3,200 receiving']],[150,130,225])
heading('A complete operating workflow for one client repository')
para("We configure and hand over a retained staff workflow around your original DSpace MCP implementation: full source intake, exact metadata review, named execution, original-file receiving, interrupted-operation recovery, and complete staff handover.")
para("The delivery uses the original tool registration, DSpaceClient, and dependency lock. Staff keep the native repository, collection, user, full metadata values, and original response identities attached to each operation.")
heading('Agreed delivery cohort')
table([['Component','Included scope'],['Repository and collections','One existing DSpace 7+ REST service; two agreed collections'],['Records and submissions','Up to 500 existing item records; one configured draft-submission family'],['Original files','Up to 20 supplied originals, each at most 20 MiB'],['Review and receiving','Two correction cycles; named staff review; complete archive and fresh-process receiving']],[150,355])
heading('What your team receives')
para("A configured industrial browser workspace and command line; complete source and field disposition; reviewed metadata, move, file, and draft operations; original return reconciliation; a portable native workspace archive; operating notes; and a receiving walkthrough with your designated reviewer.")
para("Generated linked metadata is preserved. The institution's actual submission sections are used for draft work, and administrative archival is a distinct reviewed operation.")
story.append(PageBreak())
para('Delivery and receiving','TitleLocal')
table([['Period','Complete outcome'],['Days 1-2','Confirm original source, two collections, field disposition, submission sections, staff profile and reviewer.'],['Days 3-5','Configure the retained operating workflow and join the original native actions.'],['Days 6-8','Run the agreed cohort, receive native results, and complete the two correction cycles.'],['Days 9-10','Reopen the complete handover, receive original files, complete the staff walkthrough and transfer source/configuration.']],[95,410])
heading('Acceptance')
para("The agreed cohort reconciles to native identities. Each approved change retains its source, reviewer and original return. The selected draft resumes against the same created record. Uploaded files return with matching bytes. Interrupted work resolves against the original repository and user. Your operator reopens the complete selections, plans, files and execution history in a fresh process.")
heading('Support and terms')
para("The proposed payment milestones are $3,200 at scheduling and $3,200 at completed receiving. Fourteen calendar days of correction for reproducible defects in the delivered implementation are included, with acknowledgement within one business day.")
para("The delivery clock starts when the source sample, authorized repository access, exact target collections and designated reviewer are available. Expanded repository families, new SSO, a full platform upgrade, content authoring and additional systems are priced separately with 4Science.")
heading('Source and institutional control')
para("The institution retains its repository, accounts, content and deployment configuration. The complete workspace and included original implementation are delivered with their AGPL source and license notices. 4Science retains its client relationship and commercial terms.")
para('<link href="https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/business/dspace-mcp-repository-workspace-20261012/">Maintained workspace source and operating guide</link><br/><link href="https://github.com/4Science/dspace-mcp/tree/ee503ba97910f592867c897c1fa938f9e029d03c">Pinned original 4Science implementation</link>','SmallLocal')
para("This workshare follows 4Science's 29 September 2026 DSpace MCP community call and its published institutional installation, configuration, integration and training services. The complete technical scope is in commercial/SCOPE.md.",'SmallLocal')
def footer(canvas,doc):
 canvas.saveState();canvas.setStrokeColor(colors.HexColor('#bbbbbb'));canvas.line(45,38,A4[0]-45,38);canvas.setFont('Helvetica',8);canvas.setFillColor(colors.HexColor('#555555'));canvas.drawString(45,25,'TOKENJUNKIE LABS  |  DSPACE REPOSITORY WORKSHARE');canvas.drawRightString(A4[0]-45,25,str(doc.page));canvas.restoreState()
SimpleDocTemplate(str(target),pagesize=A4,rightMargin=45,leftMargin=45,topMargin=44,bottomMargin=52,title='DSpace repository implementation workshare',author='TokenJunkie Labs').build(story,onFirstPage=footer,onLaterPages=footer)
print(json.dumps({'file':str(target),'bytes':target.stat().st_size}))
