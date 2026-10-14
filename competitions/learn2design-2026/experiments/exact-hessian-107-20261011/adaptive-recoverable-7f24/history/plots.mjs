// MIT — Complete original native history figures, exact logged points and step incumbents.
export function historySvg(cell,{cutoff=cell.seconds,width=1080,height=500}={}) {
 const e=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const all=cell.points.filter(p=>p.loss!==null),p=all.filter(p=>p.time_s<=cutoff);
 let low=Infinity,high=-Infinity;for(const q of all){low=Math.min(low,q.loss);high=Math.max(high,q.loss);}if(!all.length){low=0;high=1;}
 const span=high-low||1;low-=span*.06;high+=span*.06;
 const left=70,right=width-26,top=48,bottom=height-84;
 const X=t=>left+(right-left)*t/cell.seconds,Y=v=>bottom-(bottom-top)*(v-low)/(high-low),f=x=>Number(x).toFixed(3);
 const parts=['<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title description" viewBox="0 0 '+width+' '+height+'"><title id="title">T'+e(cell.topology_seed)+' — '+e(cell.arm)+' logged Objective history</title><desc id="description">Every finite logged loss through the selected elapsed cutoff. Filled black circles are feasible, grey hollow circles are infeasible or unknown. Black step line is best logged feasible loss. The lower rug marks feasible calls. Full data are provided in CSV and original JSON.</desc><rect width="100%" height="100%" fill="white"/><g font-family="system-ui,sans-serif" font-size="13" fill="#222"><text x="70" y="25">T'+e(cell.topology_seed)+' · '+e(cell.arm)+' · seed '+e(cell.algorithm_seed)+' · '+e(cell.seconds)+' s</text>'];
 for(let i=0;i<=5;i++){const t=cell.seconds*i/5,x=X(t);parts.push('<path d="M'+f(x)+' '+top+'V'+bottom+'" stroke="#ddd"/><text x="'+f(x)+'" y="'+(bottom+24)+'" text-anchor="middle">'+e(t.toFixed(0))+'</text>');const v=low+(high-low)*i/5,y=Y(v);parts.push('<path d="M'+left+' '+f(y)+'H'+right+'" stroke="#ddd"/><text x="'+(left-8)+'" y="'+f(y+4)+'" text-anchor="end">'+e(v.toFixed(2))+'</text>');}
 let d="",prior=null;for(const q of p){if(q.best_feasible!==null){if(prior===null)d+="M"+f(X(q.time_s))+" "+f(Y(q.best_feasible));else d+="H"+f(X(q.time_s))+"V"+f(Y(q.best_feasible));prior=q;}}
 if(prior)d+="H"+f(X(Math.min(cutoff,cell.seconds)));parts.push('<path d="'+d+'" fill="none" stroke="#111" stroke-width="2"/>');
 for(const q of p){parts.push('<circle cx="'+f(X(q.time_s))+'" cy="'+f(Y(q.loss))+'" r="'+(q.feasible?2.6:2)+'" fill="'+(q.feasible?"#111":"white")+'" stroke="'+(q.feasible?"#111":"#888")+'"><title>Point '+q.point+'; call '+q.call+'; '+q.time_s+' s; loss '+q.loss+'; '+(q.known?(q.feasible?"feasible":"infeasible"):"unknown feasibility")+'</title></circle>');if(q.feasible)parts.push('<path d="M'+f(X(q.time_s))+' '+(bottom+34)+'v10" stroke="#111"/>');}
 if(cutoff<cell.seconds)parts.push('<path d="M'+f(X(cutoff))+' '+top+'V'+(bottom+45)+'" stroke="#333" stroke-dasharray="4 4"/>');
 parts.push('<text x="'+((left+right)/2)+'" y="'+(height-12)+'" text-anchor="middle">Actual logged elapsed seconds · filled circles: feasible · line: best feasible</text><text transform="translate(18 '+((top+bottom)/2)+') rotate(-90)" text-anchor="middle">Objective loss (lower is better)</text></g></svg>');return parts.join("");
}
