"""Render the complete proposed Sling workshare as a two-page customer PDF."""
import argparse, hashlib, json, pathlib, html
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

NAVY=colors.HexColor("#152b42")
BLUE=colors.HexColor("#126a83")
INK=colors.HexColor("#24354a")
MUTED=colors.HexColor("#56697b")
PALE=colors.HexColor("#edf4f7")
LINE=colors.HexColor("#cbd9e2")
def esc(value): return html.escape(str(value),quote=True)
def file_identity(path):
    raw=path.read_bytes()
    return {"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}
def render(source, output, result_path=None):
    p=json.loads(source.read_text(encoding="utf-8"))
    if p.get("schema")!="tjlabs.sling-workshare.v1": raise ValueError("Select the retained complete workshare input")
    terms=p["commercial"]
    if sum(x["days"] for x in p["phases"])!=terms["durationBusinessDays"]: raise ValueError("Phase days differ from priced duration")
    if terms["deposit"]+terms["acceptancePayment"]!=terms["fee"]: raise ValueError("Payment milestones differ from proposed fee")
    result=None
    if result_path:
        result=json.loads(result_path.read_text(encoding="utf-8"))
        if result.get("schema")!="tjlabs.sling-customer-result.v1" or result.get("status")!="complete" or result.get("source",{}).get("originalSlingCommit")!=p["reference"]["commit"]:
            raise ValueError("The supplied actual receiving result is not this complete original source selection")
    font_paths=[
        pathlib.Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf")
    ]
    regular=next((x for x in font_paths if x.is_file()),None)
    font="Helvetica";bold="Helvetica-Bold"
    if regular:
        bold_file=regular.with_name(regular.name.replace(".ttf","-Bold.ttf")) if "DejaVu" in regular.name else regular.with_name("LiberationSans-Bold.ttf")
        pdfmetrics.registerFont(TTFont("Workshare",str(regular)));font="Workshare"
        if bold_file.is_file(): pdfmetrics.registerFont(TTFont("Workshare-Bold",str(bold_file)));bold="Workshare-Bold"
        else: bold=font
        pdfmetrics.registerFontFamily("Workshare",normal=font,bold=bold,italic=font,boldItalic=bold)
    styles={
      "label":ParagraphStyle("label",fontName=bold,fontSize=8.2,leading=11,textColor=BLUE,spaceAfter=7),
      "title":ParagraphStyle("title",fontName=bold,fontSize=25,leading=29,textColor=NAVY,spaceAfter=11),
      "deck":ParagraphStyle("deck",fontName=font,fontSize=10.7,leading=15.5,textColor=INK,spaceAfter=13),
      "h":ParagraphStyle("h",fontName=bold,fontSize=12,leading=16,textColor=NAVY,spaceBefore=10,spaceAfter=6),
      "body":ParagraphStyle("body",fontName=font,fontSize=9.2,leading=13.6,textColor=INK,spaceAfter=7),
      "small":ParagraphStyle("small",fontName=font,fontSize=8,leading=11.5,textColor=MUTED,spaceAfter=5),
      "cell":ParagraphStyle("cell",fontName=font,fontSize=8.5,leading=12,textColor=INK),
      "cellbold":ParagraphStyle("cellbold",fontName=bold,fontSize=8.5,leading=12,textColor=NAVY),
      "price":ParagraphStyle("price",fontName=bold,fontSize=23,leading=27,textColor=NAVY),
      "pricecaption":ParagraphStyle("pricecaption",fontName=font,fontSize=9.3,leading=13.5,textColor=INK)
    }
    def para(text,key="body"): return Paragraph(text,styles[key])
    def section(title,text): return [para(esc(title),"h"),para(text)]
    def bullet(text): return para("&#8226; "+text)
    width=174*mm
    output.parent.mkdir(parents=True,exist_ok=True)
    doc=SimpleDocTemplate(str(output),pagesize=(210*mm,297*mm),rightMargin=18*mm,leftMargin=18*mm,topMargin=18*mm,bottomMargin=19*mm,title=p["title"],author=p["brand"],subject="Proposed native migration implementation, acceptance and receiving workshare",pageCompression=1)
    def chrome(canvas,doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE);canvas.setLineWidth(.5);canvas.line(18*mm,16*mm,192*mm,16*mm)
        canvas.setFont(font,7.4);canvas.setFillColor(MUTED)
        canvas.drawString(18*mm,11.5*mm,"TOKENJUNKIELABS  /  SLING MIGRATION IMPLEMENTATION")
        canvas.drawRightString(192*mm,11.5*mm,f'{p["edition"]}  |  {doc.page}/2')
        canvas.restoreState()
    story=[para("PROPOSED IMPLEMENTATION WORKSHARE","label"),
           para("A reviewed path<br/>from configuration<br/>to cutover.","title"),
           para(esc(p["proposition"]),"deck")]
    price=Table([[para("USD "+f'{terms["fee"]:,}',"price"),
                  para(f'<b>{terms["durationBusinessDays"]} business days</b><br/>USD {terms["deposit"]:,} at start<br/>USD {terms["acceptancePayment"]:,} at acceptance',"pricecaption")]],
                  colWidths=[width*.52,width*.48])
    price.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PALE),("BOX",(0,0),(-1,-1),.6,LINE),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("LEFTPADDING",(0,0),(-1,-1),12),("RIGHTPADDING",(0,0),(-1,-1),12),("TOPPADDING",(0,0),(-1,-1),12),("BOTTOMPADDING",(0,0),(-1,-1),12)]))
    story.extend([price,Spacer(1,6*mm)])
    story+=section("The work","One existing Airbyte connection; up to five selected tables; one agreed source/target database connector pair supported by the selected original Sling release. We retain the configuration, namespaces, cursor, primary keys and explicit type/column mappings.")
    story+=section("What your team receives","An editable operator application, original native execution and recovery, complete baseline and incremental comparisons, one reversible consumer switch, and a full receiving package with source, outputs and decisions.")
    story+=section("Where the engagement starts","The included reference uses original complete CSV inputs and distinct SQLite source/parallel target databases. The agreed customer connector and complete typed-export adapter are implemented during the paid engagement.")
    story.append(para("Each comparison round covers up to 250,000 aggregate selected rows and 512 MiB of complete selected exported data. Every selected business cell and duplicate multiplicity is compared. One consumer transition may include up to five reviewed downstream text files.","small"))
    story+=section("The decision","Choose the source/target connector pair and the existing connection for the first implementation. The proposal is open through October 27, 2026, subject to the agreed start slot and stated inputs.")
    story.append(PageBreak())
    story+=[para("DELIVERY AND ACCEPTANCE","label"),para("A handoff your team<br/>can operate.","title")]
    table_rows=[[para("Phase","cellbold"),para("Days","cellbold"),para("Delivered result","cellbold")]]
    short=[
      ("Configuration contract","3","Original inputs, selected streams and explicit acceptance bindings"),
      ("Baseline and adaptation","4","Original engine, customer export adapter and complete baseline"),
      ("Change and comparison","4","Incremental edition and every selected typed business row"),
      ("Cutover and rollback","2","Observed consumer switch, prior selection and reviewed final state"),
      ("Receiving and handoff","2","Editable source, complete native package and operating instructions")
    ]
    table_rows += [[para(a,"cellbold"),para(b,"cell"),para(c,"cell")] for a,b,c in short]
    schedule=Table(table_rows,colWidths=[width*.31,width*.08,width*.61],repeatRows=1,hAlign="LEFT")
    schedule.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),PALE),("VALIGN",(0,0),(-1,-1),"TOP"),
      ("LINEBELOW",(0,0),(-1,0),.6,LINE),("LINEBELOW",(0,1),(-1,-1),.35,LINE),
      ("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
    story.append(schedule)
    story.append(para("Acceptance is concrete","h"))
    for item in [
      "The original configuration and executable identities match the agreed connector bindings.",
      "Both comparisons cover all selected rows and cells. Schema/key checks pass, multiplicities match, and native commands have successful exit receipts.",
      "The consumer reads the accepted edition; rollback restores its recorded prior selection.",
      "Fresh receiving preserves source bytes, native attempts, decisions, full history and the same named package bytes."
    ]:story.append(bullet(item))
    story+=section("Inputs and review","Your team provides permitted source/parallel-target access, the chosen configuration, an owned host, a representative change input, the consumer owner and one consolidated review. The clock starts after scope acceptance, the first milestone and these inputs. Review is due within three business days; one consolidated correction cycle is included.")
    story.append(para("Customer compute, storage, network and warehouse consumption remain customer operating costs. Additional connections/volume, CDC or history reconstruction, unsupported connectors and undeclared transformation rewrites need a separately agreed scope.","small"))
    if result:
        n=result["native"]; text=f'Completed included reference: {n["baselineReplication"]:,} baseline rows and {n["changedReplication"]:,} changed-edition rows. The accompanying result records the original native, consumer, browser and receiving outcomes.'
    else:
        text="Selected original reference: Sling 1.6.5; 1,000 baseline rows plus 14 changed rows (12 updates and two inserts). Expected final count: 1,002. Actual execution and receiving outcomes accompany the completed delivery."
    story.append(para(text,"small"))
    story.append(para('Context: <link href="https://slingdata.io/articles/migrating-from-airbyte-to-sling/" color="#126a83">SlingData Airbyte migration guide</link> · <link href="https://docs.slingdata.io/sling-cli/getting-started" color="#126a83">Original engine documentation</link>',"small"))
    doc.build(story,onFirstPage=chrome,onLaterPages=chrome)
    return {"schema":"tjlabs.sling-workshare-render.v1","input":file_identity(source),"result":file_identity(result_path) if result_path else None,"output":{"filename":output.name,**file_identity(output)}}
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",type=pathlib.Path,required=True);parser.add_argument("--output",type=pathlib.Path,required=True);parser.add_argument("--result",type=pathlib.Path)
    args=parser.parse_args()
    print(json.dumps(render(args.input,args.output,args.result),indent=2))
if __name__=="__main__":main()
