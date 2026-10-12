#!/usr/bin/env python3
"""Render the complete Markdown workshare as a portable, branded PDF."""
import argparse, hashlib, html, json, pathlib, re
from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

def normalise(text):
    return text.translate(str.maketrans({"–":"-","—":"-","‑":"-","−":"-","’":"'","‘":"'","“":'"',"”":'"',"\u00a0":" "}))

def inline(text):
    text=html.escape(normalise(text), quote=False)
    text=re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", lambda m:'<link href="'+html.escape(m.group(2),quote=True)+'" color="#174960">'+m.group(1)+'</link>', text)
    text=re.sub(r"\*\*(.+?)\*\*",r"<b>\1</b>",text)
    return text

def fonts(directory=None):
    candidates=[pathlib.Path(directory)] if directory else []
    candidates += [pathlib.Path("/usr/share/fonts/truetype/dejavu"), pathlib.Path(rl_config.__file__).parent/"fonts"]
    for root in candidates:
        regular=root/"DejaVuSans.ttf";bold=root/"DejaVuSans-Bold.ttf"
        if not regular.is_file():
            regular=root/"Vera.ttf";bold=root/"VeraBd.ttf"
        if regular.is_file() and bold.is_file():
            pdfmetrics.registerFont(TTFont("Offer",str(regular)))
            pdfmetrics.registerFont(TTFont("OfferBold",str(bold)))
            pdfmetrics.registerFontFamily("Offer",normal="Offer",bold="OfferBold",italic="Offer",boldItalic="OfferBold")
            return "Offer","OfferBold"
    return "Helvetica","Helvetica-Bold"

def build(source,out,font_directory=None):
    raw=source.read_bytes();text=raw.decode("utf-8")
    normal,bold=fonts(font_directory)
    width,height=A4; usable=width-88
    styles={
      "body":ParagraphStyle("body",fontName=normal,fontSize=9.1,leading=13.4,textColor=colors.HexColor("#232932"),spaceAfter=8,allowWidows=0,allowOrphans=0),
      "title":ParagraphStyle("title",fontName=bold,fontSize=22,leading=26,textColor=colors.HexColor("#142c38"),spaceAfter=14,keepWithNext=True),
      "h2":ParagraphStyle("h2",fontName=bold,fontSize=13.5,leading=17.2,textColor=colors.HexColor("#173e4f"),spaceBefore=13,spaceAfter=8,keepWithNext=True),
      "h3":ParagraphStyle("h3",fontName=bold,fontSize=10.5,leading=14,textColor=colors.HexColor("#173e4f"),spaceBefore=10,spaceAfter=6,keepWithNext=True),
      "cell":ParagraphStyle("cell",fontName=normal,fontSize=8.1,leading=11.5,spaceAfter=0),
      "thead":ParagraphStyle("thead",fontName=bold,fontSize=8.1,leading=11.5,textColor=colors.white)
    }
    lines=text.splitlines();story=[];i=0
    while i<len(lines):
        line=lines[i].strip()
        if not line: i+=1;continue
        if line.startswith("|"):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith("|"):
                values=[x.strip() for x in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r"[: -]+",x or "-") for x in values): rows.append(values)
                i+=1
            count=len(rows[0])
            if not all(len(row)==count for row in rows): raise ValueError("Malformed source table")
            proportions=[.25,.21,.54] if count==3 else [.29,.71]
            cells=[[Paragraph(inline(v),styles["thead" if r==0 else "cell"]) for v in row] for r,row in enumerate(rows)]
            t=Table(cells,colWidths=[usable*x for x in proportions],repeatRows=1,hAlign="LEFT")
            t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#173e4f")),
              ("BACKGROUND",(0,1),(-1,-1),colors.HexColor("#f2f5f6")),
              ("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),8),
              ("RIGHTPADDING",(0,0),(-1,-1),8),("TOPPADDING",(0,0),(-1,-1),7),
              ("BOTTOMPADDING",(0,0),(-1,-1),7),("LINEBELOW",(0,0),(-1,-1),.35,colors.HexColor("#d1dce0"))]))
            story.extend([t,Spacer(1,9)]);continue
        if line.startswith("# "): story.append(Paragraph(inline(line[2:]),styles["title"]));i+=1;continue
        if line.startswith("## "): story.append(Paragraph(inline(line[3:]),styles["h2"]));i+=1;continue
        if line.startswith("### "): story.append(Paragraph(inline(line[4:]),styles["h3"]));i+=1;continue
        parts=[line];i+=1
        while i<len(lines) and lines[i].strip() and not lines[i].lstrip().startswith(("#","|")):
            parts.append(lines[i].strip());i+=1
        story.append(Paragraph(inline(" ".join(parts)),styles["body"]))
    def frame(canvas,doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#cbd5da"));canvas.setLineWidth(.5)
        canvas.line(44,height-35,width-44,height-35)
        canvas.setFont(bold,7.5);canvas.setFillColor(colors.HexColor("#173e4f"))
        canvas.drawString(44,height-27,"TOKENJUNKIELABS")
        canvas.setFont(normal,7.1);canvas.drawRightString(width-44,height-27,"DISO COURSE PRODUCTION | 12 OCTOBER 2026")
        canvas.line(44,36,width-44,36)
        canvas.setFont(normal,7);canvas.setFillColor(colors.HexColor("#52616b"))
        canvas.drawString(44,25,"Prepared supplier workshare | R445,000 | 35 business days")
        canvas.drawRightString(width-44,25,"Page "+str(doc.page))
        canvas.restoreState()
    out.parent.mkdir(parents=True,exist_ok=True)
    doc=SimpleDocTemplate(str(out),pagesize=A4,rightMargin=44,leftMargin=44,topMargin=48,bottomMargin=49,
      title="DISO course production and Moodle delivery workshare",author="TokenJunkieLabs",
      subject="Complete 13-module DISO course production scope, fixed fee and receiving")
    doc.build(story,onFirstPage=frame,onLaterPages=frame)
    final=out.read_bytes()
    return {"source":source.name,"sourceBytes":len(raw),"sourceSha256":hashlib.sha256(raw).hexdigest(),
      "filename":out.name,"bytes":len(final),"sha256":hashlib.sha256(final).hexdigest()}

def main():
    p=argparse.ArgumentParser();p.add_argument("--source",type=pathlib.Path,default=pathlib.Path(__file__).with_name("WORKSHARE.md"))
    p.add_argument("--out",type=pathlib.Path,required=True);p.add_argument("--font-directory")
    args=p.parse_args();print(json.dumps(build(args.source,args.out,args.font_directory),indent=2))
if __name__=="__main__": main()
