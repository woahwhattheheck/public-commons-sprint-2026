// Human-editable controls for every original engine input: 24 rates and 1–5 loads.
export function createExactInputs({onChange,isBusy}){
  const $=id=>document.getElementById(id);
  const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  let source=null;
  function value(id){const text=$(id).value;if(!text.trim()||!Number.isFinite(Number(text)))throw Error('Complete every hourly rate and enabled load value.');return Number(text);}
  function field(parent,id,title,initial,{min=0,max=50,step='any',type='number'}={}){
    const label=make('label',title),input=make('input');label.htmlFor=id;input.id=id;input.type=type;input.value=initial;input.required=true;
    if(type==='number'){input.min=String(min);input.max=String(max);input.step=String(step);}else input.maxLength=80;
    label.append(input);parent.append(label);return input;
  }
  function read(){
    if(!source)throw Error('Open household inputs first.');
    return {prices:Array.from({length:24},(_,h)=>value('hourly-rate-'+h)),maxKw:value('custom-max-kw'),
      tasks:source.tasks.map((task,index)=>({...task,label:$('custom-'+index+'-label').value,
        kw:value('custom-'+index+'-kw'),hours:value('custom-'+index+'-hours'),earliest:value('custom-'+index+'-earliest'),deadline:value('custom-'+index+'-deadline'),quiet:$('custom-'+index+'-quiet').checked}))};
  }
  function fill(scenario){
    source=structuredClone(scenario);$('custom-max-kw').value=scenario.maxKw;
    const rates=$('hourly-rates');rates.replaceChildren();
    for(let h=0;h<24;h++)field(rates,'hourly-rate-'+h,String(h).padStart(2,'0')+':00',scenario.prices[h],{max:10});
    const tasks=$('custom-loads');tasks.replaceChildren();
    for(const [index,task]of scenario.tasks.entries()){
      const card=make('article');card.className='load-card';card.dataset.customTask=task.id;
      const heading=make('div');heading.className='custom-load-heading';
      field(heading,'custom-'+index+'-label','Load name',task.label,{type:'text'});
      const remove=make('button','Remove load');remove.type='button';remove.className='secondary';remove.dataset.removeLoad='true';
      remove.onclick=()=>{
        if(isBusy()||source.tasks.length<=1)return;
        try{const edited=read();edited.tasks.splice(index,1);fill(edited);onChange();}catch(error){$('error').textContent=error.message;}
      };
      heading.append(remove);card.append(heading);
      const grid=make('div');grid.className='scenario-grid';
      field(grid,'custom-'+index+'-kw','Power (kW)',task.kw);
      field(grid,'custom-'+index+'-hours','Run time (hours)',task.hours,{min:1,max:6,step:1});
      field(grid,'custom-'+index+'-earliest','Earliest start',task.earliest,{min:0,max:23,step:1});
      field(grid,'custom-'+index+'-deadline','Finish by',task.deadline,{min:1,max:24,step:1});card.append(grid);
      const quiet=make('label');quiet.className='check quiet-choice';quiet.htmlFor='custom-'+index+'-quiet';
      const checkbox=make('input');checkbox.type='checkbox';checkbox.id=quiet.htmlFor;checkbox.checked=task.quiet;
      quiet.append(checkbox,document.createTextNode('Keep this load outside quiet hours (22:00–07:00)'));card.append(quiet);tasks.append(card);
    }
    refresh();
  }
  function refresh(disabled=isBusy()){
    $('custom-fields').disabled=disabled;
    $('add-custom-load').disabled=disabled||!source||source.tasks.length>=5;
    for(const button of $('custom-loads').querySelectorAll('[data-remove-load]'))button.disabled=disabled||source.tasks.length<=1;
    $('custom-load-count').textContent=(source?.tasks.length??0)+' of 5 loads';
  }
  $('add-custom-load').onclick=()=>{
    if(isBusy()||!source||source.tasks.length>=5)return;
    try{
      const edited=read();edited.tasks.push({id:'load-'+crypto.randomUUID().replaceAll('-','').slice(0,24),label:'Flexible load '+(edited.tasks.length+1),kw:1,hours:1,earliest:7,deadline:22,quiet:true});
      fill(edited);onChange();$('custom-'+(edited.tasks.length-1)+'-label').focus();
    }catch(error){$('error').textContent=error.message;}
  };
  return Object.freeze({fill,read,refresh});
}
