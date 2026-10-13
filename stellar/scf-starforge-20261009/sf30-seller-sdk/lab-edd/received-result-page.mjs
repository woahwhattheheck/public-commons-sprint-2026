// MIT. Local entry page for a completely verified Laboratory result.
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const href=value=>String(value).split('/').map(encodeURIComponent).join('/');
const bytes=value=>new Intl.NumberFormat('en-US').format(value)+' bytes';
const label=value=>String(value??'Not recorded').replaceAll('_',' ').toLowerCase();
const anchor=(path,text,download=false)=>'<a href="'+html(href(path))+'"'+(download?' download':'')+'>'+html(text)+'</a>';
const hash=value=>'<code>'+html(value)+'</code>';
function table(rows,headings){
  return '<div class="scroll"><table><thead><tr>'+headings.map(v=>'<th scope="col">'+html(v)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function nativeSection(family){
  const note=family.preparation?.error?.message;
  const rows=family.files.map(file=>[
    anchor(file.path,file.filename,true),
    file.sourceFile?html(file.sourceFile.filename)+' → '+html(file.filename):'Original receiving format',
    html(bytes(file.bytes)),
    hash(file.sha256),
  ]);
  return '<section><div class="heading"><h2>'+html(family.label)+' native files</h2><span class="state">'+html(label(family.preparation?.status))+'</span></div>'+
    '<p>'+html(family.files.length? 'These are the complete receiving files from the saved review.':'The saved result contains no prepared native files for this edition.')+'</p>'+
    (note?'<p class="notice">'+html(note)+'</p>':'')+
    (rows.length?table(rows,['File','Source and format','Size','SHA-256']):'<p>Open the original review to inspect its preparation details and record the next explicit choices.</p>')+'</section>';
}
export function renderReceivedLabResult(view){
  const id=view.identity,current=view.families[0],baseline=view.families[1];
  const reviews=view.reports.map(row=>'<a class="button" href="'+html(href(row.path))+'">'+html(row.label)+'</a>').join('');
  const originals=table(view.originals.map(file=>[
    anchor(file.path,file.filename,true),html(file.slot),html(bytes(file.bytes)),hash(file.sha256),
  ]),['Original file','Input role','Size','SHA-256']);
  const choices=table(view.choices.map(file=>[
    anchor(file.path,file.label,true),html(bytes(file.bytes)),hash(file.sha256),
  ]),['Saved choices','Size','SHA-256']);
  const inventory=table(view.members.map(file=>[
    anchor(file.path,file.filename,true),html(bytes(file.bytes)),hash(file.sha256),
  ]),['Result member','Size','SHA-256']);
  const profile=family=>'<article class="edition"><div class="heading"><h3>'+html(family.label)+'</h3><span class="state">'+html(label(family.report.disposition))+'</span></div>'+
    '<p>'+html(family.profile.id)+' · '+html(family.profile.version)+'</p><dl><div><dt>Errors</dt><dd>'+html(family.report.counts?.error??0)+'</dd></div>'+
    '<div><dt>Review observations</dt><dd>'+html(family.report.counts?.review??0)+'</dd></div><div><dt>Information</dt><dd>'+html(family.report.counts?.info??0)+'</dd></div></dl></article>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'+
    '<title>Laboratory delivery · '+html(id.reviewName??'Saved result')+'</title><style>'+
    ':root{font:15px/1.55 system-ui,sans-serif;color:#1b2529;background:#edf0ef}*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:1320px;margin:auto;padding:28px}header{background:#fff;border-top:7px solid #23564e;border-bottom:1px solid #aab7b2}h1{font-size:32px;line-height:1.15;margin:8px 0 14px}h2{font-size:21px;margin:0}h3{font-size:17px;margin:0}p{margin:10px 0}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#3e6258}.heading,.actions{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.actions{justify-content:flex-start;margin-top:18px}a{color:#174c42;text-underline-offset:3px}.button{display:inline-block;padding:10px 16px;background:#23564e;color:white;text-decoration:none;border:1px solid #23564e;border-radius:3px}.button:focus-visible,a:focus-visible{outline:3px solid #a8631a;outline-offset:3px}.secondary{background:white;color:#174c42}.state{display:inline-block;padding:4px 10px;border:1px solid #adbbb5;background:#f4f7f5;font-size:12px;font-weight:650;text-transform:capitalize}section{padding:22px;background:white;border:1px solid #b9c3bf;margin-bottom:20px}.editions{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:20px}.edition{background:white;border:1px solid #b9c3bf;padding:20px}.edition p{color:#53645c}dl{display:flex;flex-wrap:wrap;gap:28px;margin:14px 0 0}dt{font-size:12px;color:#53645c}dd{margin:0;font-size:25px;font-weight:650}.scroll{overflow:auto;margin-top:14px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d3dbd7;padding:11px 12px}th{background:#eef2ef;font-size:12px}td:first-child{min-width:190px}code{font:11px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}details{margin-top:14px}summary{cursor:pointer;font-weight:600}.notice{padding:12px;border-left:4px solid #9d621f;background:#fbf5e9}.muted,footer{color:#53645c;font-size:13px}.identity{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px 16px;font-size:13px}.identity dt{font-weight:650}.identity dd{font:inherit;margin:0;overflow-wrap:anywhere}@media(max-width:680px){header,main,footer{padding:18px}h1{font-size:27px}section{padding:16px}.button{width:100%;text-align:center}.identity{grid-template-columns:1fr;gap:2px}.identity dd{margin-bottom:10px}th,td{padding:9px}}'+
    '</style></head><body><header><div class="eyebrow">Laboratory delivery</div><div class="heading"><h1>'+html(id.reviewName??'Saved review')+'</h1><span class="state">Files verified</span></div>'+
    '<p>Open the saved review, inspect the original files and choices, and take the prepared native files into your receiving system.</p>'+
    '<p class="muted">File verification preserves the recorded result. Profile observations and native preparation retain their separate states below.</p><div class="actions">'+reviews+
    '<a class="button secondary" href="original-result.zip" download>Complete original result ZIP</a></div></header><main>'+
    '<div class="editions">'+profile(current)+(baseline?profile(baseline):'')+'</div>'+
    view.families.map(nativeSection).join('')+
    '<section><h2>Original inputs</h2><p>Every selected original file remains unchanged, including the earlier delivery and input decision files when present.</p>'+originals+'</section>'+
    '<section><h2>Saved decisions and correspondence</h2><p>These files belong to this completed review. Use the original editors to prepare explicit choices for a new edition; the received result stays unchanged.</p>'+choices+'</section>'+
    '<section><h2>Delivery identity</h2><dl class="identity"><dt>Function</dt><dd>'+html(id.functionId)+'</dd><dt>Job</dt><dd>'+html(id.jobId??'No job identity in this result')+'</dd>'+
    '<dt>Current source</dt><dd>'+hash(id.sourceSha256)+'</dd><dt>Current decisions</dt><dd>'+hash(id.documentSha256)+'</dd><dt>Current review</dt><dd>'+hash(id.reviewSha256)+'</dd>'+
    (baseline?'<dt>Baseline source</dt><dd>'+hash(id.baseline.sourceSha256)+'</dd><dt>Baseline review</dt><dd>'+hash(id.baseline.reviewSha256)+'</dd>':'')+
    (id.reconciliation?'<dt>Correspondence</dt><dd>'+hash(id.reconciliation.reviewSha256)+'</dd>':'')+
    '<dt>Complete result</dt><dd>'+html(bytes(id.archiveBytes))+' · '+hash(id.archiveSha256)+'</dd></dl>'+
    '<p>'+anchor('receipt.json','Open full receiving receipt',true)+' · '+anchor('result/manifest.json','Open original result manifest',true)+'</p>'+
    '<details><summary>All '+view.members.length+' original result members</summary>'+inventory+'</details></section></main>'+
    '<footer>TokenJunkieLabs · Local Laboratory EDD receiving. This page and the complete result work from the received folder. Keep the folder together when transferring it.</footer></body></html>\n';
}
