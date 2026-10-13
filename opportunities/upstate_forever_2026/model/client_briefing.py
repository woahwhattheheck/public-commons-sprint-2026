"""Offline customer briefings from the complete original client report.

The retained report supplies every scientific quantity and interpretation.
This module paginates that content and provides local meeting notes; it does
not evaluate a model, rank alternatives, or alter the original report.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import re
from pathlib import Path, PurePosixPath
from urllib.parse import quote

EDITION = "upstate.client-briefing/v1"
NOTES_SCHEMA = "upstate.client-briefing-notes/v1"
CORE_SECTIONS = frozenset({
    "decisions", "native-study", "study", "current", "alternatives",
    "atlas", "priorities", "parcels", "project-notes",
})
ROWS_PER_PAGE = 6
PARAGRAPHS_PER_PAGE = 3


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def _text(value):
    return html.escape(str(value if value is not None else ""), quote=True)


def _path(value):
    if not isinstance(value, str) or not value or "\\" in value:
        return None
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    path = PurePosixPath(value)
    if (path.is_absolute() or ":" in value or "?" in value or "#" in value
            or any(part in ("", ".", "..") for part in value.split("/"))):
        return None
    return quote(value, safe="/")


def _chunks(rows, count):
    for start in range(0, len(rows), count):
        yield start, rows[start:start + count]


def _binding(report, report_model_bytes=None):
    if report.get("schema") != "upstate.client-report/v1":
        raise ValueError("Select the original client report model")
    required = ("title", "baseline_run_id", "alternative_run_ids", "sections", "maps")
    if any(key not in report for key in required):
        raise ValueError("Retain the complete original client report")
    if not isinstance(report["sections"], list) or not isinstance(report["maps"], list):
        raise ValueError("Client report sections and map inventory must be complete lists")
    if not isinstance(report["alternative_run_ids"], list) or any(
            not isinstance(value, str) for value in report["alternative_run_ids"]):
        raise ValueError("Retain the original ordered alternative run IDs")
    if report_model_bytes is None:
        digest_bytes = _json(report).encode("utf-8")
        digest_method = "sha256-canonical-json-utf8"
    else:
        if not isinstance(report_model_bytes, bytes):
            raise ValueError("Report model input must contain its complete original bytes")
        original = json.loads(report_model_bytes.decode("utf-8"))
        if _json(original) != _json(report):
            raise ValueError("The original report model differs from the briefing content")
        digest_bytes = report_model_bytes
        digest_method = "sha256-original-report-model-bytes"
    digest = hashlib.sha256(digest_bytes).hexdigest()
    return {
        "schema": EDITION, "report_sha256": digest, "report_digest_method": digest_method,
        "report_edition": report.get("report_edition"),
        "delivery_id": report.get("delivery_id"),
        "baseline_run_id": report["baseline_run_id"],
        "alternative_run_ids": list(report["alternative_run_ids"]),
        "title": report["title"], "delivery_mode": report.get("delivery_mode"),
        "grid_id": (report.get("quantity_provenance") or {}).get("grid_id"),
        "profile_id": (report.get("quantity_provenance") or {}).get("profile_id"),
    }


def _table(table, rows, start, total):
    columns = table["columns"]
    if any(not isinstance(row, (list, tuple)) or len(row) != len(columns) for row in rows):
        raise ValueError("Keep every original report column with each table row")
    caption = str(table.get("caption") or "")
    scope = ("Rows " + str(start + 1) + "–" + str(start + len(rows)) +
             " of " + str(total)) if total else "No retained rows"
    return ('<div class="table-scroll"><table><caption>' + _text(caption) +
            (' · ' if caption else '') + _text(scope) +
            '</caption><thead><tr>' +
            ''.join('<th scope="col">' + _text(value) + '</th>' for value in columns) +
            '</tr></thead><tbody>' +
            ''.join('<tr>' + ''.join('<td>' + _text(value) + '</td>' for value in row) +
                    '</tr>' for row in rows) + '</tbody></table></div>')


def _assets(values):
    links = []
    for value in values:
        path = _path(value.get("path"))
        if path:
            links.append('<li><a href="' + _text(path) + '" target="_blank" rel="noopener">' +
                         _text(value.get("title") or value["path"]) + '</a></li>')
    return '<ul class="assets">' + ''.join(links) + '</ul>' if links else ''


def _slides(report):
    slides, chapters = [], []
    seen = set()

    def add(chapter, heading, body, *, source_section=None, source_table=None,
            row_start=None, row_count=None, kind="content"):
        key = "slide-" + str(len(slides) + 1)
        slides.append({
            "id": key, "chapter": chapter, "title": str(heading), "html": body,
            "kind": kind, "source_section": source_section,
            "source_table": source_table, "row_start": row_start,
            "row_count": row_count,
        })

    chapters.append({"id": "opening", "title": "Study and meeting purpose", "core": True})
    baseline_title = ((report.get("quantity_provenance") or {}).get("baseline_scenario") or {}).get("title")
    opening = (
        '<p class="lead">' + _text(report.get("report_kind_label") or "Study assessment") +
        '</p><dl class="facts"><div><dt>Baseline</dt><dd>' +
        _text(baseline_title or "Retained baseline") + '</dd></div><div><dt>Alternatives</dt><dd>' +
        str(len(report["alternative_run_ids"])) + '</dd></div><div><dt>Map families</dt><dd>' +
        _text(report.get("map_families_present")) + ' of ' +
        _text(report.get("map_families_expected")) + '</dd></div></dl>'
        '<p>The following pages retain the report’s own quantities, support descriptions, '
        'interpretation and source context. Use the agenda to choose the material for this meeting.</p>'
        '<p>Record questions, decisions and assigned follow-up in Meeting notes. '
        'Those notes remain separate from the scientific report.</p>')
    add("opening", report["title"], opening, kind="opening")
    for index, section in enumerate(report["sections"]):
        source_id = section.get("id")
        if not isinstance(source_id, str) or not source_id or source_id in seen:
            raise ValueError("Each original client report section needs a unique identity")
        seen.add(source_id)
        chapter = "chapter-" + str(index + 1)
        title = str(section.get("title") or source_id)
        chapters.append({"id": chapter, "source_id": source_id,
                         "title": title, "core": source_id in CORE_SECTIONS})
        paragraphs = section.get("paragraphs", [])
        tables = section.get("tables", [])
        if not isinstance(paragraphs, list) or not isinstance(tables, list):
            raise ValueError("Keep the complete original report paragraphs and tables")
        for start, values in _chunks(paragraphs, PARAGRAPHS_PER_PAGE):
            add(chapter, title,
                ''.join('<p>' + _text(value) + '</p>' for value in values),
                source_section=source_id)
        for table_index, table in enumerate(tables):
            columns, rows = table.get("columns"), table.get("rows")
            if not isinstance(columns, list) or not isinstance(rows, list):
                raise ValueError("Original client table columns and rows must be lists")
            if not columns:
                continue
            if not rows:
                add(chapter, title, _table(table, [], 0, 0), source_section=source_id,
                    source_table=table_index, row_start=0, row_count=0, kind="table")
            for start, values in _chunks(rows, ROWS_PER_PAGE):
                add(chapter, title, _table(table, values, start, len(rows)),
                    source_section=source_id, source_table=table_index,
                    row_start=start, row_count=len(values), kind="table")
        assets = _assets(section.get("assets", []))
        if assets:
            add(chapter, title + " — working material", assets, source_section=source_id,
                kind="assets")
        if not paragraphs and not tables and not assets:
            add(chapter, title, "<p>This retained section has no additional content.</p>",
                source_section=source_id)
    chapters.append({"id": "maps", "title": "Open the retained maps", "core": True})
    for item in report["maps"]:
        files = item.get("files") or []
        if files:
            add("maps", str(item.get("title") or item.get("role") or "Map family"),
                '<p>Open the original map sheet alongside this briefing. The file retains '
                'its own legend, native study domain and selected alternative.</p>' +
                _assets([{"path": file.get("path"),
                          "title": str(item.get("title") or "Map") + " / " +
                                   str(file.get("role") or "Retained file")}
                         for file in files]), kind="maps")
    if not any(slide["chapter"] == "maps" for slide in slides):
        chapters.pop()
    return slides, chapters


STYLE = r"""
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;color:#202020;background:#ececec;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
button,input,select,textarea{font:inherit;color:inherit}button,.button{background:#fff;border:1px solid #777;padding:7px 12px;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block}
button:hover,.button:hover{background:#ededed}button:disabled{opacity:.45;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #333;outline-offset:3px}
a{color:inherit;text-underline-offset:3px}[hidden]{display:none!important}.toolbar{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid #aaa;padding:12px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.brand{font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.08em;margin:0 auto 0 0}.toolbar label{font-size:12px}.toolbar select{max-width:300px;padding:6px;background:#fff;border:1px solid #777}
.layout{display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1680px;margin:auto}.sidebar{background:#f7f7f7;border-right:1px solid #ccc;padding:20px;align-self:start;position:sticky;top:66px;max-height:calc(100vh - 66px);overflow:auto}
.sidebar h2{font-size:15px;margin:0 0 10px}.sidebar ol{list-style:none;padding:0;margin:0}.sidebar li{margin:5px 0}.sidebar a{display:block;padding:5px;text-decoration:none;font-size:13px}.sidebar a[aria-current]{background:#dedede;font-weight:650}
.sidebar .small{font-size:12px}.stage{min-width:0;padding:24px}.slide{background:#fff;padding:38px 44px;margin-bottom:24px;border:1px solid #c7c7c7;min-height:500px;overflow-wrap:anywhere}
.slide h1{font-size:38px;line-height:1.18;margin:0 0 22px}.slide h2{font-size:27px;line-height:1.25;margin:0 0 22px}.slide p{max-width:100ch}.slide p:last-child{margin-bottom:0}.slide .kicker{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#555;margin-bottom:14px}
.slide-footer{border-top:1px solid #ccc;margin-top:28px;padding-top:12px;font-size:11px;color:#555;display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px}.slide-footer a{font-size:12px}
.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.facts dt{font-size:12px;color:#555}.facts dd{margin:5px 0;font-size:18px;overflow-wrap:anywhere}.lead{font-size:22px}
.table-scroll{overflow:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.4}caption{text-align:left;font-weight:650;padding-bottom:10px}th,td{border:1px solid #c6c6c6;text-align:left;vertical-align:top;padding:10px;min-width:95px}th{background:#f0f0f0}tr:nth-child(even){background:#fafafa}td{white-space:pre-wrap}.assets li{margin:13px 0}
.panel{position:fixed;z-index:5;inset:70px 24px 24px auto;width:min(620px,calc(100vw - 48px));overflow:auto;background:#fff;border:1px solid #777;box-shadow:0 5px 25px #0002;padding:24px}.panel h2{font-size:22px;margin-top:0}.panel h3{font-size:17px}
.panel label{display:block;margin-top:13px;font-size:13px;font-weight:600}.panel input:not([type=checkbox]),.panel textarea,.panel select{display:block;width:100%;border:1px solid #888;background:#fff;padding:8px;margin-top:5px}.panel textarea{min-height:100px;resize:vertical}
.panel .choices label{display:flex;align-items:flex-start;gap:9px;font-weight:400}.panel .choices input{margin-top:4px}.panel .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.panel .close{float:right}.notice{font-size:13px;color:#444}.note-card{border-top:1px solid #bbb;margin:18px 0;padding-top:14px}.note-card header{display:flex;gap:10px;align-items:center}.note-card header strong{margin-right:auto}.field-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.error{border-left:3px solid #333;padding:10px;background:#eee}
.deck .sidebar{display:none}.deck .layout{grid-template-columns:minmax(0,1fr)}.deck .stage{max-width:1440px;width:100%;margin:auto}.deck .slide{min-height:calc(100vh - 130px);font-size:20px}.deck table{font-size:15px}.deck .slide h2{font-size:34px}.deck .slide h1{font-size:46px}.deck .slide:not(.current){display:none}
#status{margin:0 20px;font-size:12px;color:#444}.footer{font-size:12px;color:#555;padding:16px 24px;max-width:1400px;margin:auto}.print-notes{display:none}
@media(max-width:800px){.layout{display:block}.sidebar{position:static;max-height:none;border-right:0}.sidebar ol{display:flex;flex-wrap:wrap;gap:4px 12px}.stage{padding:12px}.slide{padding:24px 20px}.slide h1{font-size:29px}.slide h2{font-size:23px}.facts{grid-template-columns:1fr}.deck .slide{font-size:17px}.deck .slide h1{font-size:34px}.deck .slide h2{font-size:27px}.panel{inset:80px 12px 12px auto;width:calc(100vw - 24px)}}
@media print{@page{size:landscape;margin:14mm}body{background:#fff;font-size:12pt}.toolbar,.sidebar,.panel,#status,.footer,.slide-footer a{display:none!important}.layout{display:block}.stage{padding:0;max-width:none!important}.slide,.deck .slide,.deck .slide:not(.current){display:block;min-height:0;border:0;padding:0;margin:0;break-after:page;font-size:12pt}.slide.print-exclude{display:none!important}.slide h1,.deck .slide h1{font-size:28pt}.slide h2,.deck .slide h2{font-size:21pt}.table-scroll{overflow:visible}table,.deck table{font-size:9pt}th,td{min-width:0;padding:6px}tr{break-inside:avoid}thead{display:table-header-group}.slide-footer{font-size:8pt}.facts{grid-template-columns:repeat(3,minmax(0,1fr))}.print-with-notes .print-notes{display:block;break-before:page}.print-notes pre{white-space:pre-wrap;font:11pt/1.5 system-ui,sans-serif}}
"""


SCRIPT = r"""
(function(){
'use strict';
var model=JSON.parse(document.getElementById('briefing-data').textContent);
var binding=model.binding,slides=Array.from(document.querySelectorAll('.slide'));
var chapterById=new Map(model.chapters.map(function(c){return[c.id,c];}));
var agenda=new Set(model.chapters.filter(function(c){return c.core;}).map(function(c){return c.id;}));
var index=0,visible=[],presenting=false,printing=false,scrollScheduled=false,notesKey='eco-client-briefing:'+binding.schema+':'+binding.report_sha256;
var status=document.getElementById('status'),notesPanel=document.getElementById('notes-panel'),agendaPanel=document.getElementById('agenda-panel');
var notes={schema:model.notes_schema,binding:binding,meeting:{title:'',date:'',participants:'',purpose:''},entries:[],agenda:Array.from(agenda),updated_at:null};
function message(text){status.textContent=text;}
function text(value){return String(value==null?'':value);}
function current(){return visible[index]||null;}
function currentMeta(){var s=current();return s?model.slides.find(function(v){return v.id===s.id;}):null;}
function bindMatches(value){return value&&value.schema===model.notes_schema&&value.binding&&value.binding.schema===binding.schema&&value.binding.report_sha256===binding.report_sha256&&value.binding.report_digest_method===binding.report_digest_method&&value.binding.delivery_id===binding.delivery_id;}
function validate(value){
 if(!bindMatches(value))throw Error('Choose meeting notes for this exact report edition.');
 if(!value.meeting||typeof value.meeting!=='object'||!Array.isArray(value.entries)||value.entries.length>500)throw Error('The meeting file is incomplete or exceeds 500 entries.');
 var m={};['title','date','participants','purpose'].forEach(function(k){if(typeof value.meeting[k]!=='string'||value.meeting[k].length>20000)throw Error('Invalid meeting field: '+k);m[k]=value.meeting[k];});
 var ids=new Set(),entries=value.entries.map(function(v){
  if(!v||typeof v.id!=='string'||!v.id||v.id.length>100||ids.has(v.id))throw Error('Each meeting entry needs one distinct identity.');ids.add(v.id);
  if(!['question','decision','action'].includes(v.kind)||!['open','in-progress','complete'].includes(v.status))throw Error('Invalid meeting entry kind or status.');
  if(!model.slides.some(function(s){return s.id===v.slide_id;}))throw Error('A meeting entry refers to another report page.');
  var r={id:v.id,kind:v.kind,status:v.status,slide_id:v.slide_id};
  ['body','owner','due'].forEach(function(k){if(typeof v[k]!=='string'||v[k].length>(k==='body'?20000:500))throw Error('Invalid meeting entry field: '+k);r[k]=v[k];});
  return r;
 });
 var a=Array.isArray(value.agenda)?value.agenda:Array.from(agenda);
 if(!a.length||a.some(function(id){return !chapterById.has(id);}))throw Error('The selected agenda is not in this report.');
 return {schema:model.notes_schema,binding:binding,meeting:m,entries:entries,agenda:Array.from(new Set(a)),updated_at:value.updated_at||null};
}
function save(){
 notes.agenda=Array.from(agenda);notes.updated_at=new Date().toISOString();
 try{localStorage.setItem(notesKey,JSON.stringify(notes));document.getElementById('save-status').textContent='Notes saved in this browser. Export the meeting file to share or keep a separate copy.';}
 catch(e){document.getElementById('save-status').textContent='This browser cannot retain local notes. Export the meeting file before closing.';}
}
try{var stored=localStorage.getItem(notesKey);if(stored){notes=validate(JSON.parse(stored));agenda=new Set(notes.agenda);}}catch(e){message('Saved notes could not be reopened: '+e.message+' You can import an exported meeting file.');}
function update(){
 var old=current();visible=slides.filter(function(s){return agenda.has(s.dataset.chapter);});
 if(old&&visible.includes(old))index=visible.indexOf(old);else index=Math.min(index,visible.length-1);if(index<0)index=0;
 slides.forEach(function(s){s.classList.toggle('current',s===current());s.hidden=!agenda.has(s.dataset.chapter);});
 document.body.classList.toggle('deck',presenting);
 document.getElementById('previous').disabled=index===0;document.getElementById('next').disabled=index>=visible.length-1;
 document.getElementById('page-counter').textContent=visible.length?(index+1)+' / '+visible.length:'No pages selected';
 document.getElementById('present').textContent=presenting?'Read report':'Present';
 document.querySelectorAll('[data-chapter-link]').forEach(function(a){var on=current()&&a.dataset.chapterLink===current().dataset.chapter;a.toggleAttribute('aria-current',!!on);a.parentElement.hidden=!agenda.has(a.dataset.chapterLink);});
 var select=document.getElementById('chapter-select');select.value=current()?current().dataset.chapter:'';
 Array.from(select.options).forEach(function(o){o.disabled=!agenda.has(o.value);});
 var meta=currentMeta();document.getElementById('note-context').textContent=meta?meta.title+' · '+meta.id:'';
}
function go(next){index=Math.max(0,Math.min(next,visible.length-1));update();if(current()){if(presenting)window.scrollTo({top:0,behavior:'auto'});else current().scrollIntoView({block:'start'});current().focus({preventScroll:true});}}
function chapter(id){var n=visible.findIndex(function(s){return s.dataset.chapter===id;});if(n>=0)go(n);}
// Reading mode follows the actual page on screen, so meeting entries keep
// the section the operator is looking at, including ordinary mouse scrolling.
window.addEventListener('scroll',function(){
 if(printing||presenting||!notesPanel.hidden||!agendaPanel.hidden||scrollScheduled)return;
 scrollScheduled=true;requestAnimationFrame(function(){scrollScheduled=false;if(printing||presenting||!notesPanel.hidden||!agendaPanel.hidden)return;
  var top=document.querySelector('.toolbar').getBoundingClientRect().bottom+24,best=0,distance=Infinity;
  visible.forEach(function(s,n){var box=s.getBoundingClientRect(),d=box.top<=top&&box.bottom>top?0:Math.abs(box.top-top);if(d<distance){best=n;distance=d;}});
  if(best!==index){index=best;update();}
 });
},{passive:true});
slides.forEach(function(slide){slide.addEventListener('focusin',function(){if(!printing&&!presenting&&visible.includes(slide)){index=visible.indexOf(slide);update();}});});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){if(!notesPanel.hidden){close(notesPanel);e.preventDefault();}else if(!agendaPanel.hidden){close(agendaPanel);e.preventDefault();}}});
document.getElementById('previous').onclick=function(){go(index-1);};document.getElementById('next').onclick=function(){go(index+1);};
document.getElementById('present').onclick=function(){presenting=!presenting;update();go(index);};
document.getElementById('chapter-select').onchange=function(e){chapter(e.target.value);};
document.querySelectorAll('[data-chapter-link]').forEach(function(a){a.onclick=function(e){e.preventDefault();chapter(a.dataset.chapterLink);};});
document.getElementById('fullscreen').onclick=function(){if(document.fullscreenElement){document.exitFullscreen().catch(function(e){message(e.message);});}else if(document.documentElement.requestFullscreen){document.documentElement.requestFullscreen().catch(function(){message('Fullscreen is unavailable; presentation mode remains available.');});}else message('Fullscreen is unavailable in this browser.');};
document.addEventListener('keydown',function(e){if(e.target.closest('input,textarea,select,button')||!notesPanel.hidden||!agendaPanel.hidden)return;if(presenting&&['ArrowRight','PageDown','ArrowLeft','PageUp','Home','End'].includes(e.key)){e.preventDefault();go(e.key==='Home'?0:e.key==='End'?visible.length-1:index+(['ArrowRight','PageDown'].includes(e.key)?1:-1));}if(e.key==='Escape'&&presenting){presenting=false;update();}});
function close(panel){panel.hidden=true;(panel===notesPanel?document.getElementById('notes'):document.getElementById('agenda')).focus();}
document.querySelectorAll('[data-close]').forEach(function(b){b.onclick=function(){close(document.getElementById(b.dataset.close));};});
document.getElementById('agenda').onclick=function(){notesPanel.hidden=true;agendaPanel.hidden=false;agendaPanel.querySelector('button').focus();};
document.getElementById('notes').onclick=function(){agendaPanel.hidden=true;notesPanel.hidden=false;update();notesPanel.querySelector('button').focus();};
function setAgenda(values){agenda=new Set(values);document.querySelectorAll('[data-agenda]').forEach(function(e){e.checked=agenda.has(e.dataset.agenda);});save();update();}
document.querySelectorAll('[data-agenda]').forEach(function(e){e.checked=agenda.has(e.dataset.agenda);e.onchange=function(){var next=new Set(agenda);if(e.checked)next.add(e.dataset.agenda);else next.delete(e.dataset.agenda);if(!next.size){e.checked=true;message('Keep at least one section in the agenda.');return;}setAgenda(Array.from(next));};});
document.getElementById('agenda-core').onclick=function(){setAgenda(model.chapters.filter(function(c){return c.core;}).map(function(c){return c.id;}));};
document.getElementById('agenda-all').onclick=function(){setAgenda(model.chapters.map(function(c){return c.id;}));};
function bindMeeting(){['title','date','participants','purpose'].forEach(function(k){var e=document.querySelector('[data-meeting="'+k+'"]');e.value=notes.meeting[k];e.oninput=function(){notes.meeting[k]=e.value;save();};});}
function field(label,value,type,change){var wrap=document.createElement('label');wrap.textContent=label;var input=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value;input.maxLength=type==='textarea'?20000:500;input.oninput=function(){change(input.value);save();};wrap.append(input);return wrap;}
function choices(label,value,values,change){var wrap=document.createElement('label');wrap.textContent=label;var input=document.createElement('select');values.forEach(function(v){var o=document.createElement('option');o.value=v[0];o.textContent=v[1];input.append(o);});input.value=value;input.onchange=function(){change(input.value);save();};wrap.append(input);return wrap;}
function renderNotes(){
 var holder=document.getElementById('note-list');holder.replaceChildren();
 notes.entries.forEach(function(v,n){var card=document.createElement('section');card.className='note-card';var head=document.createElement('header'),title=document.createElement('strong'),jump=document.createElement('button'),remove=document.createElement('button');title.textContent=(n+1)+'. '+v.kind;jump.type=remove.type='button';jump.textContent='Open report page';remove.textContent='Remove';
 jump.onclick=function(){var s=model.slides.find(function(x){return x.id===v.slide_id;});if(!agenda.has(s.chapter))setAgenda(Array.from(agenda).concat([s.chapter]));close(notesPanel);go(visible.findIndex(function(x){return x.id===v.slide_id;}));};
 remove.onclick=function(){if(!window.confirm('Remove this meeting entry?'))return;notes.entries=notes.entries.filter(function(x){return x.id!==v.id;});save();renderNotes();};
 head.append(title,jump,remove);card.append(head);var context=document.createElement('p');context.className='notice';context.textContent=model.slides.find(function(x){return x.id===v.slide_id;}).title+' · '+v.slide_id;card.append(context);
 card.append(choices('Kind',v.kind,[['question','Question'],['decision','Decision'],['action','Follow-up action']],function(x){v.kind=x;title.textContent=(n+1)+'. '+x;}));
 card.append(field('Meeting entry',v.body,'textarea',function(x){v.body=x;}));var pair=document.createElement('div');pair.className='field-pair';pair.append(field('Owner',v.owner,'text',function(x){v.owner=x;}),field('Due date',v.due,'date',function(x){v.due=x;}));card.append(pair);
 card.append(choices('Status',v.status,[['open','Open'],['in-progress','In progress'],['complete','Complete']],function(x){v.status=x;}));holder.append(card);});
 document.getElementById('note-count').textContent=notes.entries.length+' meeting entries';
}
document.getElementById('add-note').onclick=function(){if(notes.entries.length>=500){message('Export this meeting before starting another; this file supports 500 entries.');return;}var meta=currentMeta();if(!meta)return;notes.entries.push({id:(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),kind:document.getElementById('new-note-kind').value,status:'open',slide_id:meta.id,body:'',owner:'',due:''});save();renderNotes();var fields=document.querySelectorAll('#note-list textarea');fields[fields.length-1].focus();};
function markdown(){
 var lines=['# '+(notes.meeting.title||binding.title)+' — meeting notes','','Report: '+binding.title,'Delivery: '+text(binding.delivery_id),'Baseline: '+binding.baseline_run_id,'Report edition: '+text(binding.report_edition),'Report SHA-256: '+binding.report_sha256,'Digest method: '+binding.report_digest_method,'Date: '+notes.meeting.date,'Participants: '+notes.meeting.participants,'','## Meeting purpose','',notes.meeting.purpose,'','## Selected agenda',''];
 model.chapters.filter(function(c){return agenda.has(c.id);}).forEach(function(c){lines.push('- '+c.title);});
 lines.push('','## Questions, decisions and follow-up','');
 notes.entries.forEach(function(v,i){var s=model.slides.find(function(x){return x.id===v.slide_id;});lines.push('### '+(i+1)+'. '+v.kind+' — '+v.status,'','Report section: '+s.title+' / '+v.slide_id,'Owner: '+v.owner,'Due: '+v.due,'',v.body,'');});
 lines.push('These are meeting notes associated with the retained report edition. Original scientific quantities and files remain in that report.','');
 return lines.join('\n');
}
function download(name,type,body){var url=URL.createObjectURL(new Blob([body],{type:type}));var a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);}
document.getElementById('export-json').onclick=function(){save();download('meeting-notes-'+binding.report_sha256.slice(0,12)+'.json','application/json',JSON.stringify(notes,null,2)+'\n');};
document.getElementById('export-markdown').onclick=function(){save();download('meeting-notes-'+binding.report_sha256.slice(0,12)+'.md','text/markdown;charset=utf-8',markdown());};
document.getElementById('import-notes').onchange=async function(e){
 var file=e.target.files[0];if(!file)return;try{if(file.size>8*1024*1024)throw Error('Choose a meeting file under 8 MiB.');var next=validate(JSON.parse(await file.text()));if(notes.entries.length||Object.values(notes.meeting).some(Boolean)){if(!window.confirm('Replace the notes open in this browser with the imported meeting? Export the current notes first if you want to keep both.'))return;}notes=next;agenda=new Set(notes.agenda);bindMeeting();renderNotes();setAgenda(notes.agenda);message('Meeting notes opened for this report edition.');}catch(error){message(error.message);}finally{e.target.value='';}
};
function preparePrint(){
 printing=true;
 var scope=document.getElementById('print-scope').value,page=current();
 slides.forEach(function(s){s.classList.toggle('print-exclude',scope==='current'?s!==page:!agenda.has(s.dataset.chapter));});
 document.body.classList.toggle('print-with-notes',scope==='agenda-notes');
 document.getElementById('printed-notes').textContent=markdown();
}
window.addEventListener('beforeprint',preparePrint);
window.addEventListener('afterprint',function(){slides.forEach(function(s){s.classList.remove('print-exclude');});document.body.classList.remove('print-with-notes');printing=false;});
document.getElementById('print').onclick=function(){preparePrint();window.print();};
bindMeeting();renderNotes();update();document.querySelectorAll('[data-enhanced]').forEach(function(e){e.hidden=false;});
})();
"""


def render(report, *, report_href, model_href, report_model_bytes=None):
    binding = _binding(report, report_model_bytes)
    for value in (report_href, model_href):
        if not _path(value):
            raise ValueError("Briefing links must refer to files in the same delivery")
    slides, chapters = _slides(report)
    model = {"schema": EDITION, "binding": binding, "notes_schema": NOTES_SCHEMA,
             "chapters": chapters,
             "slides": [{key: value for key, value in slide.items() if key != "html"}
                        for slide in slides]}
    navigation, options, choices, pages = [], [], [], []
    for chapter in chapters:
        first = next((slide["id"] for slide in slides if slide["chapter"] == chapter["id"]), None)
        if first is None:
            continue
        navigation.append('<li><a href="#' + first + '" data-chapter-link="' + chapter["id"] +
                          '">' + _text(chapter["title"]) + '</a></li>')
        options.append('<option value="' + chapter["id"] + '">' + _text(chapter["title"]) + '</option>')
        choices.append('<label><input type="checkbox" data-agenda="' + chapter["id"] + '">' +
                       _text(chapter["title"]) + '</label>')
    for index, slide in enumerate(slides):
        section_link = _path(report_href)
        if slide["source_section"]:
            section_link += "#" + quote(slide["source_section"], safe="")
        pages.append('<section tabindex="-1" class="slide" id="' + slide["id"] +
                     '" data-chapter="' + slide["chapter"] + '"><div class="kicker">' +
                     _text(report.get("report_kind_label") or "Study briefing") + " · " +
                     str(index + 1) + " / " + str(len(slides)) + '</div><h2>' +
                     _text(slide["title"]) + '</h2>' + slide["html"] +
                     '<footer class="slide-footer"><span>' + _text(report["title"]) +
                     '</span><a href="' + _text(section_link) +
                     '" target="_blank" rel="noopener">Open this material in the complete report</a></footer></section>')
    data = _json(model).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    script_hash = base64.b64encode(hashlib.sha256(SCRIPT.encode("utf-8")).digest()).decode("ascii")
    policy = ("default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-" + script_hash +
              "'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
    document = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta http-equiv="Content-Security-Policy" content="' + _text(policy) + '">'
        '<title>' + _text(report["title"]) + ' — customer briefing</title><style>' + STYLE +
        '</style></head><body><header class="toolbar"><h1 class="brand">Study briefing</h1>'
        '<a class="button" href="' + _text(_path(report_href)) + '">Complete report</a>'
        '<button id="agenda" data-enhanced hidden>Agenda</button>'
        '<button id="notes" data-enhanced hidden>Meeting notes</button>'
        '<button id="present" data-enhanced hidden>Present</button>'
        '<button id="fullscreen" data-enhanced hidden>Fullscreen</button>'
        '<label data-enhanced hidden>Print <select id="print-scope">'
        '<option value="current">Current briefing page</option>'
        '<option value="agenda">Selected agenda</option>'
        '<option value="agenda-notes" selected>Agenda and meeting notes</option></select></label>'
        '<button id="print" data-enhanced hidden>Print</button>'
        '<label data-enhanced hidden>Section <select id="chapter-select">' + ''.join(options) +
        '</select></label><button id="previous" aria-label="Previous briefing page" data-enhanced hidden>Previous</button>'
        '<span id="page-counter" aria-live="polite"></span>'
        '<button id="next" aria-label="Next briefing page" data-enhanced hidden>Next</button></header>'
        '<p id="status" role="status" aria-live="polite"></p><div class="layout">'
        '<nav class="sidebar" aria-label="Briefing sections"><h2>Retained report material</h2>'
        '<p class="small">Each table keeps its original columns, values and row order. '
        'Long tables continue across briefing pages.</p><ol>' + ''.join(navigation) +
        '</ol><p class="small"><a href="' + _text(_path(model_href)) + '">Original report model</a></p></nav>'
        '<main class="stage">' + ''.join(pages) + '</main></div>'
        '<aside id="agenda-panel" class="panel" aria-labelledby="agenda-heading" hidden>'
        '<button class="close" data-close="agenda-panel">Close agenda</button><h2 id="agenda-heading">Meeting agenda</h2>'
        '<p class="notice">Choose complete sections to discuss. All original material remains available in '
        'All sections and in the complete report.</p><div class="actions">'
        '<button id="agenda-core">Core briefing</button><button id="agenda-all">All sections</button></div>'
        '<div class="choices">' + ''.join(choices) + '</div></aside>'
        '<aside id="notes-panel" class="panel" aria-labelledby="notes-heading" hidden>'
        '<button class="close" data-close="notes-panel">Close notes</button><h2 id="notes-heading">Meeting notes</h2>'
        '<p class="notice" id="save-status">Notes stay in this browser. Export a meeting file to share or retain them.</p>'
        '<label>Meeting title<input data-meeting="title" maxlength="500"></label>'
        '<div class="field-pair"><label>Date<input type="date" data-meeting="date"></label>'
        '<label>Participants<input data-meeting="participants" maxlength="20000"></label></div>'
        '<label>Meeting purpose<textarea data-meeting="purpose" maxlength="20000"></textarea></label>'
        '<div class="actions"><button id="export-json">Export meeting file</button>'
        '<button id="export-markdown">Export readable notes</button></div>'
        '<label>Open a saved meeting file<input id="import-notes" type="file" accept=".json,application/json"></label>'
        '<h3>Add a question, decision or action</h3><p class="notice" id="note-context"></p>'
        '<label>Kind<select id="new-note-kind"><option value="question">Question</option>'
        '<option value="decision">Decision</option><option value="action">Follow-up action</option></select></label>'
        '<div class="actions"><button id="add-note">Add entry for this page</button></div>'
        '<p id="note-count" class="notice"></p><div id="note-list"></div></aside>'
        '<section class="print-notes"><h2>Meeting notes</h2><pre id="printed-notes"></pre></section>'
        '<footer class="footer"><p>Keep this briefing with the extracted delivery so its report and map links '
        'remain available. Presentation keys: Left/Right, Page Up/Page Down, Home/End; Escape returns to reading.</p>'
        '<p>Delivery ' + _text(binding["delivery_id"] or "working edition") + ' · Report edition ' +
        _text(binding["report_edition"]) + '</p></footer>'
        '<script type="application/json" id="briefing-data">' + data + '</script>'
        '<script>' + SCRIPT + '</script></body></html>')
    return document, model


def write(directory, report, *, stem="client-report"):
    """Write a complete briefing and its original-source page index."""
    if not isinstance(stem, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", stem):
        raise ValueError("Choose a simple delivery filename stem")
    directory = Path(directory)
    html_name, index_name = stem + "-briefing.html", stem + "-briefing.json"
    model_path = directory / (stem + "-model.json")
    report_path = directory / (stem + ".html")
    if not model_path.is_file() or not report_path.is_file():
        raise ValueError("Keep the original report HTML and model beside its briefing")
    document, model = render(report, report_href=stem + ".html",
                             model_href=stem + "-model.json",
                             report_model_bytes=model_path.read_bytes())
    directory.mkdir(parents=True, exist_ok=True)
    (directory / html_name).write_text(document, encoding="utf-8")
    (directory / index_name).write_text(_json(model) + "\n", encoding="utf-8")
    return {"report_briefing": html_name, "report_briefing_index": index_name}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-model", type=Path, required=True,
                        help="Original generated client-report-model.json")
    parser.add_argument("--directory", type=Path, required=True,
                        help="Existing delivery directory containing the report and maps")
    parser.add_argument("--stem", default="client-report")
    args = parser.parse_args(argv)
    if args.report_model.resolve() != (args.directory / (args.stem + "-model.json")).resolve():
        raise ValueError("Select the original report model within its delivery directory")
    report = json.loads(args.report_model.read_text(encoding="utf-8"))
    print(json.dumps(write(args.directory, report, stem=args.stem), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
