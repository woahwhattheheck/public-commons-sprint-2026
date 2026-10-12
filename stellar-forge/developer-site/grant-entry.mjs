// MIT. The reviewer opening uses the existing grant page, purchase workbench and source routes.
export const GRANT_ENTRY_SCHEMA = 'stellar-forge.grant-reviewer-entry.v1';
const START = '<!-- grant-reviewer-entry:start -->';
const END = '<!-- grant-reviewer-entry:end -->';
const STYLE = '<link rel="stylesheet" href="./grant-entry.css">';
const SCRIPT = '<script type="module" src="./grant-entry-browser.mjs"></script>';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const decode = value => String(value).replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
function need(value,message){if(!value)throw new TypeError(message);}
function href(value,label){
  const text=decode(value);
  need(typeof text==='string'&&!/[\u0000-\u0020\u007f]/.test(text)&&
    (text.startsWith('./')||/^https:\/\/[^/@?#]+(?:[/?#]|$)/.test(text)),
    'Retain the original public or local '+label+' link.');
  return text;
}
function anchor(html,label){
  const links=[...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const selected=links.find(row=>row[2].replace(/<[^>]*>/g,'').trim()===label);
  need(selected,'Keep the existing '+label+' in the grant source.');
  return href(selected[1],label);
}
export function grantEntryLinks(html,{filmUrl=null}={}){
  need(typeof html==='string','Use the full selected grant HTML.');
  const film=html.match(/<source\s+src="([^"]+)"\s+type="video\/mp4"/)??(filmUrl?[null,filmUrl]:null);
  const report=html.match(/href="([^"]*examples\/fred-briefing-[^"]*\/briefing\.html)"/);
  need(film&&report,'Retain the original film and complete economic-report routes.');
  const reportUrl=href(report[1],'economic report'), split=reportUrl.indexOf('/stellar/');
  need(split>0,'Keep the complete selected economic package beside its source report.');
  const root=reportUrl.slice(0,split);
  const dated=root.match(/fred-briefing-(\d{8})$/);
  need(dated,'Keep the dated original economic package selection.');
  return {
    film:href(film[1],'film'),report:reportUrl,
    reportPackage:root+'/stellar-forge-economic-briefing-'+dated[1]+'.zip',
    reportGuide:root+'/START_HERE.md',
    reviewerGuide:anchor(html,'Grant reviewer operating guide'),
    runtimeGuide:anchor(html,'Runtime installation'),
    application:'./grant-data/application.md',
    companion:'./grant-data/product-and-finance.md',
    budget:'./grant-data/budget.csv',
    sourceIndex:'./grant-data/source-index.json'
  };
}
const link=(url,label,extra='')=>'<a href="'+escape(url)+'"'+extra+'>'+escape(label)+'</a>';
function panel(links,filmHtml){
  const external=' target="_blank" rel="noopener noreferrer"';
  return START+'\n<section class="grant-entry shell" id="review-the-product" aria-labelledby="grant-entry-title" data-grant-entry="'+GRANT_ENTRY_SCHEMA+'">'+
    '<header class="grant-entry-heading"><p class="eyebrow">WORKING PRODUCT</p><h2 id="grant-entry-title">Follow useful work from purchase to handover.</h2>'+
    '<p>Watch the operated purchase, inspect a complete customer report, or reopen the original purchase in the installed reviewer. The full application and funded delivery plan follow below.</p></header>'+
    '<nav class="grant-entry-jumps" aria-label="Choose a product review"><a href="#review-watch">Watch the purchase</a><a href="#review-result">Inspect a complete result</a><a href="#review-operate">Operate the reviewer</a><a href="#project-and-requested-outcome">Read the application</a></nav>'+
    '<div class="grant-entry-grid"><section class="grant-entry-card" id="review-watch" aria-labelledby="review-watch-title"><h3 id="review-watch-title">Watch the purchase</h3>'+
    '<p>The 3:32 product film follows the source query, approved terms, native testnet purchase, complete result and reopening.</p>'+
    filmHtml+
    '<p class="grant-entry-caption">The original HPD query produces 100 rows and 14 columns. Its source vintage and query remain available with the saved result.</p>'+
    link(links.film,'Open the film in a separate window',external)+'</section>'+
    '<section class="grant-entry-card" id="review-result" aria-labelledby="review-result-title"><h3 id="review-result-title">Inspect a complete result</h3>'+
    '<p>Open the retained economic briefing, compare its series and source states, and inspect the original observations. The complete package includes the report, data, review history and receiving guide.</p>'+
    '<div class="grant-entry-actions">'+link(links.report,'Open the economic report',' class="button primary" target="_blank" rel="noopener noreferrer"')+
    link(links.reportPackage,'Download the complete report package',' class="button" download')+'</div>'+
    '<p>'+link(links.reportGuide,'Read the report opening and receiving guide',external)+'</p>'+
    '<dl class="grant-entry-facts"><div><dt>Inspect</dt><dd>Original units, periods, revisions and missing source values.</dd></div>'+
    '<div><dt>Retain</dt><dd>Full source files, report and machine-readable data in one package.</dd></div>'+
    '<div><dt>Use</dt><dd>The original report and source selection remain available offline.</dd></div></dl></section></div>'+
    '<section class="grant-entry-operate" id="review-operate" aria-labelledby="review-operate-title"><h3 id="review-operate-title">Operate the retained purchase</h3>'+
    '<p>Use the <strong>Grant purchase reviewer</strong> application in the installed merchant workspace. It opens the original source, both quote histories and complete results, then transfers the closed Buyer to another private workspace.</p>'+
    '<div class="grant-entry-grid"><section aria-labelledby="review-applications-title"><h4 id="review-applications-title">Open with Applications</h4><ol class="grant-entry-steps">'+
    '<li>Select <strong>Grant purchase reviewer</strong> and the maintained runtime with Stellar packages, MCP and operator support.</li>'+
    '<li>Choose a private workbench directory under an existing private parent. Leave <strong>Packet</strong> and <strong>SHA-256</strong> empty to select the bundled original purchase. A received packet uses its full file and exact displayed digest.</li>'+
    '<li>Choose <strong>Review → Save → Connect → Start → Open</strong>. Applications opens that workbench’s current private instance.</li></ol>'+
    '<p>'+link(links.runtimeGuide,'Install or inspect the maintained runtime',external)+' · '+link(links.reviewerGuide,'Full reviewer operating guide',external)+'</p></section>'+
    '<section class="grant-entry-terminal" aria-labelledby="review-terminal-title"><h4 id="review-terminal-title">Open from a terminal</h4>'+
    '<p>The installed command starts the same workbench. Choose its private directory and open the exact local instance reported by Applications or its saved connection file.</p>'+
    '<pre class="grant-entry-command" id="grant-entry-command"><code>starforge grant-demo workbench --dir /srv/starforge/state/grant-review --port 0</code></pre>'+
    '<details id="grant-entry-command-options"><summary>Prepare a command for this installation</summary>'+
    '<form id="grant-entry-command-form" autocomplete="off">'+
    '<label>Installation<select name="installation"><option value="installed">Installed starforge command</option><option value="source">Source checkout with Node</option></select></label>'+
    '<label>Private workbench directory<input name="directory" type="text" required spellcheck="false" placeholder="/srv/starforge/state/grant-review" aria-describedby="grant-entry-directory-help"></label>'+
    '<p class="grant-entry-help" id="grant-entry-directory-help">Use an absolute path on the Linux or macOS host, under a private parent you control.</p>'+
    '<label>Purchase source<select name="purchaseSource"><option value="bundled">Bundled original purchase</option><option value="received">Existing exported packet</option></select></label>'+
    '<div id="grant-entry-packet-fields" hidden><label>Complete packet file<input name="packetFile" type="text" spellcheck="false" placeholder="/srv/starforge/received/grant-reviewer-packet.json"></label>'+
    '<label>Packet SHA-256<input name="packetSha256" type="text" spellcheck="false" inputmode="text" minlength="64" maxlength="64" pattern="[a-f0-9]{64}" aria-describedby="grant-entry-digest-help"></label>'+
    '<p class="grant-entry-help" id="grant-entry-digest-help">Use the exact digest displayed with the complete exported packet.</p></div>'+
    '<div class="grant-entry-actions"><button type="submit" class="button">Prepare command</button><button type="button" class="button" id="grant-entry-copy" disabled>Copy command</button><button type="button" class="button" id="grant-entry-download" disabled>Download opening guide</button></div>'+
    '<p class="grant-entry-status" id="grant-entry-status" role="status" aria-live="polite">Prepare the command after selecting the directory.</p></form>'+
    '<noscript><p>Use the original command above and the full operating guide for the selected directory and packet.</p></noscript></details></section></div>'+
    '<section class="grant-entry-journey" aria-labelledby="review-journey-title"><h4 id="review-journey-title">Complete the same review and handover</h4>'+
    '<ol class="grant-entry-steps"><li><strong>Source.</strong> In Packet intake, choose Review bundled purchase. Open Source and query to inspect the exact query, terms and complete source documents.</li>'+
    '<li><strong>Result.</strong> Choose Receive this packet, then Open original Buyer. In Buyer results, select each quote and Read complete saved result. Both original quote outcomes stay visible.</li>'+
    '<li><strong>Handover.</strong> Choose Handover → Close Buyer and export packet. Retain the complete packet and its displayed SHA-256.</li>'+
    '<li><strong>Receiving.</strong> Select that packet and digest in another operator’s private workbench, receive it, and read the same complete original results.</li></ol>'+
    '<details><summary>Use the merchant’s customer-delivery workflow</summary><p>In the installed Merchant operator, open <strong>Customers → Reviewer customer delivery</strong>. Its saved delivery recipe carries fourteen native steps through source review, complete results, closed export and receiving. The six-step receiving recipe starts from the reviewed export. Open the existing recipe editor to review its selected workbench aliases and native contracts before installing that workflow.</p>'+
    '<p>'+link(links.reviewerGuide,'Open the complete customer-delivery instructions',external)+'</p></details></section></section>'+
    '<section class="grant-entry-documents" aria-labelledby="review-documents-title"><h3 id="review-documents-title">Keep the application and delivery plan</h3>'+
    '<div class="grant-entry-actions">'+link(links.application,'Application answer',' download')+link(links.companion,'Product and financing',' download')+link(links.budget,'Six-package budget',' download')+link(links.sourceIndex,'Source and measure index',' download')+
    '<a href="#three-funded-tranches-and-six-priced-deliverables">Read the funded work</a></div></section></section>\n'+END;
}
/** Idempotent page composition. The application prose and all existing-work content remain selected by the original composer. */
export function composeGrantEntry(templateHtml){
  let html=String(templateHtml);
  const films=[...html.matchAll(/<figure class="film">[\s\S]*?<\/figure>/g)];
  need(films.length===1&&films[0][0].includes('<video '),'Retain the one original complete product film.');
  const filmHtml=films[0][0],filmUrl=filmHtml.match(/<source\s+src="([^"]+)"\s+type="video\/mp4"/)?.[1];
  need(filmUrl,'Retain the original product film source.');
  const begin=html.indexOf(START),end=html.indexOf(END);
  need((begin<0)===(end<0),'Retain the complete existing reviewer-entry section.');
  if(begin>=0){
    need(end>begin&&html.indexOf(START,begin+START.length)<0&&html.indexOf(END,end+END.length)<0,'Retain one complete reviewer-entry section.');
    let after=end+END.length;if(html[after]==='\n')after++;
    html=html.slice(0,begin)+html.slice(after);
  }
  const filmLink='<p id="grant-original-film-link"><a href="#review-watch">Watch the original product and team film in the working-product review above.</a></p>';
  if(html.includes(filmHtml))html=html.replace(filmHtml,filmLink);
  else need(html.includes('id="grant-original-film-link"'),'Keep the original film location linked to the same reviewer opening.');
  const links=grantEntryLinks(html,{filmUrl});
  const reading=html.indexOf('<div class="reading-layout shell">');
  need(reading>=0&&html.indexOf('<div class="reading-layout shell">',reading+1)<0,'Use the existing grant cover and application layout.');
  const cover=html.slice(0,reading);
  need(cover.includes('id="grant-title"')&&(cover.includes('aria-label="Download this application"')||cover.includes('aria-label="Review this application"')),'Retain the original grant cover and document downloads.');
  html=html.slice(0,reading)+panel(links,filmHtml)+'\n'+html.slice(reading);
  html=html.replace('aria-label="Download this application"','aria-label="Review this application"');
  const primary='<a class="button primary grant-entry-primary" href="#review-the-product">Explore the working product <span aria-hidden="true">↓</span></a>';
  if(!html.includes('class="button primary grant-entry-primary"')){
    const opening='<div class="downloads" aria-label="Review this application">';
    need(html.includes(opening),'Keep the existing cover download actions.');
    html=html.replace(opening,opening+primary);
    html=html.replace('<a class="button primary" href="./grant-data/application.md" download>','<a class="button" href="./grant-data/application.md" download>');
  }
  html=html.replace('<a href="#open-the-existing-work">Open the product</a>','<a href="#review-the-product">Open the product</a>');
  const contents='<nav aria-label="Application sections"><ol>';
  if(!html.includes('<li><a href="#review-the-product">Review the working product</a></li>')){
    need(html.includes(contents),'Retain the original application section navigation.');
    html=html.replace(contents,contents+'<li><a href="#review-the-product">Review the working product</a></li>');
  }
  if(!html.includes(STYLE)){need(html.includes('</head>'),'Keep the existing page head.');html=html.replace('</head>',STYLE+'\n</head>');}
  if(!html.includes(SCRIPT)){need(html.includes('</body>'),'Keep the existing page body.');html=html.replace('</body>',SCRIPT+'\n</body>');}
  return {html,links,entry:{schema:GRANT_ENTRY_SCHEMA,provider:'grant-reviewer',command:'grant-demo',
    browser:'/grant-entry-browser.mjs',stylesheet:'/grant-entry.css',opening:'#review-the-product',operating:'#review-operate'}};
}
export function declareGrantEntryAssets(manifest){
  need(manifest&&manifest.schema==='stellar-forge.browser-assets.v1'&&Array.isArray(manifest.routes),'Select the original browser asset manifest.');
  const copy=JSON.parse(JSON.stringify(manifest));
  for(const [route,file,type] of [
    ['/grant-entry-browser.mjs','grant-entry-browser.mjs','text/javascript; charset=utf-8'],
    ['/grant-entry.css','grant-entry.css','text/css; charset=utf-8']
  ]){
    const existing=copy.routes.filter(row=>row[0]===route);
    need(existing.length<=1&&(!existing.length||JSON.stringify(existing[0][1])===JSON.stringify([file,type])),'Keep the original '+route+' declaration.');
    if(!existing.length)copy.routes.push([route,[file,type]]);
  }
  return copy;
}
