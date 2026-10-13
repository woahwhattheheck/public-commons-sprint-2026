"""Portable, support-aware native comparison plots for the study report."""

MARKUP = r"""<div class="study-comparison-explorer">
<h3>Model reductions by source profile</h3>
<p class="definition">The filters above apply to these plots and the comparison table below. Each marker compares an alternative with its own source-profile baseline. Positive reductions mean lower modeled export. Each plot keeps one pollutant, unit and identical set of valid cells; axes are local to that plot. Profile markers stay in the order shown in its legend. Hover or focus a marker for its exact values.</p>
<label class="study-comparison-measure" for="study-comparison-measure">Plot measure
<select id="study-comparison-measure"><option value="absolute">Annual export reduction</option><option value="percent">Reduction from baseline (%)</option></select></label>
<p id="study-comparison-status" role="status" aria-live="polite" class="definition"></p>
<div id="study-comparison-plots"></div>
</div>"""

STYLES = r""".study-comparison-explorer{margin:20px 0 28px}
.study-comparison-explorer h3{font-size:16px;margin:0 0 10px}
.study-comparison-measure{display:grid;gap:5px;font-size:12px;max-width:330px}
.study-comparison-card{padding:20px 0;border-top:1px solid #ddd;break-inside:avoid}
.study-comparison-card h3{font-size:15px}
.study-comparison-card .definition{overflow-wrap:anywhere}
.study-comparison-svg{overflow:auto;margin:12px 0}
.study-comparison-svg>svg{display:block;min-width:820px;width:100%;height:auto}
.study-comparison-svg g:focus{outline:2px solid #555;outline-offset:3px}
@media print{.study-comparison-measure,.study-comparison-card button{display:none}.study-comparison-svg{overflow:visible}.study-comparison-svg>svg{min-width:0}}
"""

SCRIPT = r"""<script>

"use strict";
function studyComparisonEscape(value){
 return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function studyComparisonNumber(value){
 if(!Number.isFinite(value))return "—";
 if(value===0)return "0";
 const absolute=Math.abs(value);
 return absolute>=1e6||absolute<0.01?value.toExponential(2):value.toLocaleString(undefined,{maximumSignificantDigits:5});
}
function studyComparisonGroups(rows,measure){
 const groups=new Map();
 let omitted=0,baselines=0;
 for(const row of rows){
  if(row.kind==="baseline"){baselines++;continue;}
  const value=measure==="percent"?(typeof row.relative_change_pct==="number"?-row.relative_change_pct:NaN):row.reduction;
  if(typeof value!=="number"||!Number.isFinite(value)){omitted++;continue;}
  if(typeof row.support_sha256!=="string"||!row.support_sha256||typeof row.units!=="string"
     ||!Number.isFinite(row.paired_cells)||row.paired_cells<=0){omitted++;continue;}
  const key=JSON.stringify([row.pollutant,row.units,row.support_sha256,row.paired_cells,row.paired_area_ha,row.reporting_cells]);
  if(!groups.has(key))groups.set(key,{key,pollutant:row.pollutant,sourceUnits:row.units,
   units:measure==="percent"?"% reduction":row.units,support:row.support_sha256,
   pairedCells:row.paired_cells,pairedArea:row.paired_area_ha,reportingCells:row.reporting_cells,points:[]});
  groups.get(key).points.push({row,value});
 }
 const ordered=[...groups.values()].sort((a,b)=>String(a.pollutant).localeCompare(String(b.pollutant))||a.key.localeCompare(b.key));
 return {groups:ordered,omitted,baselines};
}
function studyComparisonMarker(index,x,y){
 const stroke=' fill="white" stroke="#171717" stroke-width="1.5"';
 if(index>=6)return '<circle cx="'+x+'" cy="'+y+'" r="6" fill="white" stroke="#171717"/><text x="'+x+'" y="'+(y+2.8)+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" fill="#171717">'+(index+1)+'</text>';
 switch(index%6){
  case 0:return '<circle cx="'+x+'" cy="'+y+'" r="3.6"'+stroke+'/>';
  case 1:return '<rect x="'+(x-3.5)+'" y="'+(y-3.5)+'" width="7" height="7"'+stroke+'/>';
  case 2:return '<path d="M'+x+','+(y-4.5)+' l4.5,4.5 -4.5,4.5 -4.5,-4.5 Z"'+stroke+'/>';
  case 3:return '<path d="M'+x+','+(y-4.3)+' l4.4,7.6 -8.8,0 Z"'+stroke+'/>';
  case 4:return '<path d="M'+(x-4)+','+y+' h8 M'+x+','+(y-4)+' v8" fill="none" stroke="#171717" stroke-width="1.6"/>';
  default:return '<path d="M'+(x-3.6)+','+(y-3.6)+' l7.2,7.2 M'+(x-3.6)+','+(y+3.6)+' l7.2,-7.2" fill="none" stroke="#171717" stroke-width="1.6"/>';
 }
}
function studyComparisonWrap(value,limit){
 const words=String(value).split(/\s+/),lines=[];
 let line="";
 for(const word of words){
  if(line&&line.length+word.length+1>limit){lines.push(line);line=word;}
  else line+=(line?" ":"")+word;
 }
 if(line)lines.push(line);
 return lines;
}
function studyComparisonSvg(group,index,labels){
 const escape=studyComparisonEscape,number=studyComparisonNumber;
 const exact=value=>typeof value==="number"&&Number.isFinite(value)?String(value):"—";
 const profiles=new Map(),scenarios=new Map();
 for(const point of group.points){profiles.set(point.row.profile_id,point.row.profile);scenarios.set(point.row.scenario_id,point.row.scenario);}
 const profileEntries=[...profiles].sort((a,b)=>String(a[1]).localeCompare(String(b[1]))||a[0].localeCompare(b[0]));
 const scenarioEntries=[...scenarios].sort((a,b)=>String(a[1]).localeCompare(String(b[1]))||a[0].localeCompare(b[0]));
 const profileIndex=new Map(profileEntries.map(([id],i)=>[id,i]));
 let lower=0,upper=0;
 for(const point of group.points){lower=Math.min(lower,point.value);upper=Math.max(upper,point.value);}
 if(lower===upper){lower=-1;upper=1;}
 else {const pad=(upper-lower)*0.05;if(lower<0)lower-=pad;if(upper>0)upper+=pad;}
 const width=1120,left=345,right=1065,top=54,rowHeight=Math.max(50,20+profileEntries.length*14);
 const rowLayouts=[];
 let cursor=top;
 for(const [id,name] of scenarioEntries){
  const lines=studyComparisonWrap(name,45);
  const height=Math.max(rowHeight,lines.length*14+18);
  rowLayouts.push({id,name,lines,y:cursor,height});
  cursor+=height;
 }
 const bottom=cursor,span=upper-lower;
 const legendEntries=profileEntries.map(([id,name],i)=>({id,name,index:i,lines:studyComparisonWrap(name,135)}));
 const height=bottom+108+legendEntries.reduce((size,entry)=>size+entry.lines.length*14+8,0);
 const position=value=>left+(value-lower)/span*(right-left);
 const label=labels[group.pollutant]||group.pollutant,title=label+" — "+group.units;
 const accessible="Each marker is an alternative compared with its own source-profile baseline. Positive values mean lower modeled export. All points share "+group.pairedCells+" valid cells and support "+group.support+".";
 let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="study-plot-title-'+index+' study-plot-desc-'+index+'" style="font-family:Arial,Helvetica,sans-serif;background:white;color:#171717">';
 svg+='<title id="study-plot-title-'+index+'">'+escape(title)+'</title><desc id="study-plot-desc-'+index+'">'+escape(accessible)+'</desc>';
 svg+='<text x="12" y="22" font-size="15" font-weight="bold" fill="#171717">'+escape(title)+'</text>';
 svg+='<text x="'+left+'" y="40" font-size="11" fill="#555">Higher export</text><text x="'+right+'" y="40" text-anchor="end" font-size="11" fill="#555">Lower export</text>';
 const ticks=Array.from({length:5},(_,i)=>lower+span*i/4);
 if(!ticks.some(value=>Math.abs(value)<=span*1e-10))ticks.push(0);
 ticks.sort((a,b)=>a-b);
 for(const tick of ticks){
  const x=position(tick),zero=Math.abs(tick)<=span*1e-10;
  svg+='<line x1="'+x+'" x2="'+x+'" y1="'+top+'" y2="'+bottom+'" stroke="'+(zero?"#555":"#ddd")+'" stroke-width="'+(zero?1.4:1)+'"/>';
  if(zero||Math.abs(position(0)-x)>50){
   svg+='<text x="'+x+'" y="'+(bottom+22)+'" text-anchor="middle" font-size="11" fill="#333">'+escape(number(zero?0:tick))+'</text>';
  }
 }
 for(const entry of rowLayouts){
  svg+='<line x1="12" x2="'+right+'" y1="'+(entry.y+entry.height)+'" y2="'+(entry.y+entry.height)+'" stroke="#e5e5e5"/>';
  const labelTop=entry.y+(entry.height-entry.lines.length*14)/2+11;
  entry.lines.forEach((line,lineIndex)=>{svg+='<text x="12" y="'+(labelTop+lineIndex*14)+'" font-size="12" fill="#222">'+escape(line)+'</text>';});
  for(const point of group.points.filter(value=>value.row.scenario_id===entry.id)){
   const row=point.row,p=profileIndex.get(row.profile_id),x=position(point.value);
   const y=entry.y+entry.height/2+(p-(profileEntries.length-1)/2)*14;
   const detail=row.profile+" · "+row.scenario+": "+exact(point.value)+" "+group.units+
    "; baseline "+exact(row.baseline_total)+" "+row.units+"; alternative "+exact(row.alternative_total)+" "+row.units+
    "; paired "+row.paired_cells+" / "+row.reporting_cells+" cells"+
    "; profile "+row.profile_id+"; scenario "+row.scenario_id+
    "; baseline run "+row.baseline_run_id+"; alternative run "+row.run_id;
   svg+='<g tabindex="0" role="img" aria-label="'+escape(detail)+'"><title>'+escape(detail)+'</title>'+studyComparisonMarker(p,x,y)+'</g>';
  }
 }
 svg+='<text x="'+((left+right)/2)+'" y="'+(bottom+46)+'" text-anchor="middle" font-size="12" fill="#333">Reduction from the same-profile baseline ('+escape(group.units)+')</text>';
 svg+='<text x="12" y="'+(bottom+72)+'" font-size="11" fill="#555">'+escape(group.pairedCells.toLocaleString()+" paired valid cells"+(Number.isFinite(group.pairedArea)?" · "+number(group.pairedArea)+" ha":""))+'</text>';
 svg+='<text x="12" y="'+(bottom+89)+'" font-size="10" fill="#555">Exact cell support: '+escape(group.support)+'</text>';
 let legendY=bottom+110;
 for(const entry of legendEntries){
  svg+=studyComparisonMarker(entry.index,20,legendY-4);
  entry.lines.forEach((line,lineIndex)=>{svg+='<text x="36" y="'+(legendY+lineIndex*14)+'" font-size="12" fill="#222">'+escape(line)+'</text>';});
  legendY+=entry.lines.length*14+8;
 }
 svg+='</svg>';
 return {svg,profiles:profileEntries,label};
}
function renderStudyComparison(rows,labels){
 const target=document.getElementById("study-comparison-plots");
 if(!target)return;
 const measure=document.getElementById("study-comparison-measure").value;
 const result=studyComparisonGroups(rows,measure);
 target.replaceChildren();
 const summary=document.getElementById("study-comparison-status");
 summary.textContent=result.groups.length+" exact-support plot"+(result.groups.length===1?"":"s")+
  (result.omitted?"; "+result.omitted+" comparison"+(result.omitted===1?"":"s")+" without a finite selected measure or valid support.":"")+
  (measure==="percent"?" Percentage reduction is undefined when the source baseline is zero.":"");
 if(!result.groups.length){
  const message=document.createElement("p");
  message.textContent="Select completed land-cover alternatives to compare their modeled reductions.";
  target.append(message);return;
 }
 result.groups.forEach((group,index)=>{
  const plot=studyComparisonSvg(group,index,labels),article=document.createElement("article");
  article.className="study-comparison-card";
  const heading=document.createElement("h3");
  heading.textContent=plot.label+" · "+group.units;article.append(heading);
  const context=document.createElement("p");
  context.className="definition";
  context.textContent=group.pairedCells.toLocaleString()+" paired valid cells"+
   (Number.isFinite(group.pairedArea)?" · "+studyComparisonNumber(group.pairedArea)+" ha":"")+
   " · support "+group.support;article.append(context);
  const canvas=document.createElement("div");canvas.className="study-comparison-svg";
  canvas.innerHTML=plot.svg;article.append(canvas);
  const button=document.createElement("button");button.type="button";button.textContent="Download this plot (SVG)";
  button.addEventListener("click",()=>{
   const url=URL.createObjectURL(new Blob([plot.svg],{type:"image/svg+xml;charset=utf-8"}));
   const link=document.createElement("a");link.href=url;link.download="study-comparison-"+group.pollutant.replace(/[^a-z0-9_-]/gi,"-")+"-"+(index+1)+".svg";
   document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });article.append(button);target.append(article);
 });
}

</script>
"""
