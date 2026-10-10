import {demoArchiveEntries,filterDemoArchives,humanDate} from './data.mjs';
const form=document.getElementById('archive-search');
const query=document.getElementById('search');
const category=document.getElementById('category');
const date=document.getElementById('date');
const results=document.getElementById('archive-results');
const count=document.getElementById('archive-count');
const menu=document.getElementById('menu-toggle');
const nav=document.getElementById('primary-nav');

// Construct cards using DOM APIs and textContent: example strings never
// become executable HTML. Every audio handoff stays on the existing provider.
function renderEntry(entry){
  const article=document.createElement('article');article.className='archive-card';
  const art=document.createElement('div');art.className=`archive-art ${entry.category}`;
  const artCat=document.createElement('strong');artCat.textContent='ILLUSTRATIVE PROGRAM';
  const artNum=document.createElement('span');artNum.textContent='90.1 FM';
  art.append(artCat,artNum);
  const body=document.createElement('div');body.className='archive-body';
  const heading=document.createElement('h3');heading.textContent=entry.title;
  const dateLabel=document.createElement('p');dateLabel.className='archive-date';dateLabel.textContent=`${entry.label} · ${humanDate(entry.date)}`;
  const description=document.createElement('p');description.textContent=entry.summary;
  const link=document.createElement('a');link.href='https://kzfr.studio.creek.org/archives/';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Browse real Creek archives ↗';
  link.setAttribute('aria-label',`${entry.title} is example content. Browse real KZFR archives on Creek Studio (opens in a new tab)`);
  body.append(heading,dateLabel,description,link);
  article.append(art,body);return article;
}
function render(){
  const filtered=filterDemoArchives(demoArchiveEntries,{query:query.value,category:category.value,date:date.value,now:new Date()});
  results.replaceChildren(...filtered.map(renderEntry));
  count.textContent=`${filtered.length} illustrative ${filtered.length===1?'result':'results'} · try the controls below`; 
  if(!filtered.length){const message=document.createElement('div');message.className='empty-result';message.textContent='No demo entries match. Reset the filters or choose another category. Real recordings are available at KZFR’s Creek archive.';results.append(message)}
}
form.addEventListener('submit',event=>{event.preventDefault();render()});
form.addEventListener('input',render);
form.addEventListener('change',render);
form.addEventListener('reset',()=>queueMicrotask(render));
render();

function closeMenu(){nav.classList.remove('is-open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open navigation')}
menu.addEventListener('click',()=>{const open=!nav.classList.contains('is-open');nav.classList.toggle('is-open',open);menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close navigation':'Open navigation')});
nav.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu()});
for(const card of document.querySelectorAll('[data-category-target]')){
  card.addEventListener('click',()=>{category.value=card.dataset.categoryTarget;query.value='';date.value='any';render()});
}
