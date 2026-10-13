// Deterministic SVG plots from original activity measurements.
export function renderSV833Figures(result) {
 const e=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const start=Date.parse("2021-01-01"),end=Date.parse("2026-10-13"),dateX=date=>85+(Date.parse(date)-start)/(end-start)*860;
 const svg=(id,w,h,title,desc,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${e(title)}</title><desc id="${id}-desc">${e(desc)}</desc><rect width="${w}" height="${h}" fill="white"/><g font-family="Arial,sans-serif" fill="#202326">${body}</g></svg>\n`;
 const point=(x,y,m,tooltip)=>{
  let s=`<g><title>${e(tooltip)}</title>`;
  if(m.upper===null){s+=`<path d="M${x},${y(m.lower)}V${y(m.lower)-20}m-4,6l4,-6l4,6" fill="none" stroke="#222" stroke-width="1.4"/><circle cx="${x}" cy="${y(m.lower)}" r="3" fill="white" stroke="#222"/>`}
  else if(m.lower!==m.upper){s+=`<line x1="${x}" x2="${x}" y1="${y(m.lower)}" y2="${y(m.upper)}" stroke="#555" stroke-width="1.2"/><circle cx="${x}" cy="${y(m.lower)}" r="2.5" fill="${m.lower_open?"white":"#444"}" stroke="#444"/><circle cx="${x}" cy="${y(m.upper)}" r="2.5" fill="${m.upper_open?"white":"#444"}" stroke="#444"/>`}
  else s+=`<circle cx="${x}" cy="${y(m.lower)}" r="3.2" fill="#fff" stroke="#222" stroke-width="1.2"/>`;
  return s+"</g>";
 };
 let time="";
 const panels=[{k:"turbidity",title:"Turbidity (NTU)",min:0,max:200,ticks:[0,50,100,150,200],log:false},{k:"ecoli",title:"E. coli (MPN/100mL) · logarithmic axis",min:100,max:10000,ticks:[100,1000,10000],log:true},{k:"phosphorus",title:"Phosphorus (mg/L as P)",min:0,max:.18,ticks:[0,.05,.1,.15],log:false}];
 panels.forEach((p,i)=>{
  const top=52+i*230,h=170,scale=v=>p.log?(Math.log10(v)-Math.log10(p.min))/(Math.log10(p.max)-Math.log10(p.min)):(v-p.min)/(p.max-p.min),y=v=>Number((top+h-scale(v)*h).toFixed(2));
  time+=`<text x="85" y="${top-20}" font-size="15" font-weight="bold">${p.title}</text>`;
  for(const tick of p.ticks)time+=`<line x1="85" x2="945" y1="${y(tick)}" y2="${y(tick)}" stroke="#e4e6e7"/><text x="70" y="${y(tick)+4}" text-anchor="end" font-size="11">${tick}</text>`;
  for(let yr=2021;yr<=2026;yr++){const x=dateX(yr+"-01-01").toFixed(2);time+=`<line x1="${x}" x2="${x}" y1="${top}" y2="${top+h}" stroke="#e4e6e7"/><text x="${x}" y="${top+h+20}" text-anchor="middle" font-size="11">${yr}</text>`}
  time+=`<path d="M85,${top}V${top+h}H945" stroke="#555" fill="none"/>`;
  for(const a of result.activities){const m=a.measurements[p.k];if(!m)continue;time+=point(dateX(a.date).toFixed(2),y,m,a.date+" "+a.time+" "+a.timezone+" · "+a.activity+" · "+m.result_ids)}
 });
 time+=`<text x="85" y="747" font-size="12">One value per original activity · arrows indicate above-quantitation lower bounds</text><text x="85" y="769" font-size="12">Vertical intervals preserve below-quantitation phosphorus · query window ends October 13, 2026</text>`;
 let scatter="";
 const scatterPanels=[{x:"turbidity",y:"ecoli",xLabel:"Turbidity (NTU)",yLabel:"E. coli (MPN/100mL)",xmin:0,xmax:200,ymin:100,ymax:10000,xticks:[0,50,100,150,200],yticks:[100,1000,10000],log:true},{x:"turbidity",y:"phosphorus",xLabel:"Turbidity (NTU)",yLabel:"Phosphorus (mg/L as P)",xmin:0,xmax:200,ymin:0,ymax:.18,xticks:[0,50,100,150,200],yticks:[0,.05,.1,.15],log:false},{x:"temperature",y:"oxygen",xLabel:"Temperature (°C)",yLabel:"Dissolved oxygen (mg/L)",xmin:0,xmax:30,ymin:5,ymax:15,xticks:[0,10,20,30],yticks:[5,7.5,10,12.5,15],log:false}];
 scatterPanels.forEach((p,i)=>{
  const ox=70+i*350,oy=62,w=265,h=270,x=v=>Number((ox+(v-p.xmin)/(p.xmax-p.xmin)*w).toFixed(2)),scale=v=>p.log?(Math.log10(v)-Math.log10(p.ymin))/(Math.log10(p.ymax)-Math.log10(p.ymin)):(v-p.ymin)/(p.ymax-p.ymin),y=v=>Number((oy+h-scale(v)*h).toFixed(2));
  const co=result.associations.find(a=>a.x===p.x&&a.y===p.y);
  scatter+=`<text x="${ox}" y="23" font-size="14" font-weight="bold">${p.yLabel}</text><text x="${ox}" y="43" font-size="11">ρ = ${co.spearman_rho.toFixed(3)} · exact ${co.exact_pairs}/${co.available} pairs</text>`;
  for(const t of p.xticks)scatter+=`<line x1="${x(t)}" x2="${x(t)}" y1="${oy}" y2="${oy+h}" stroke="#e4e6e7"/><text x="${x(t)}" y="${oy+h+20}" text-anchor="middle" font-size="11">${t}</text>`;
  for(const t of p.yticks)scatter+=`<line x1="${ox}" x2="${ox+w}" y1="${y(t)}" y2="${y(t)}" stroke="#e4e6e7"/><text x="${ox-10}" y="${y(t)+4}" text-anchor="end" font-size="10">${t}</text>`;
  scatter+=`<path d="M${ox},${oy}V${oy+h}H${ox+w}" stroke="#555" fill="none"/><text x="${ox+w/2}" y="${oy+h+45}" font-size="12" text-anchor="middle">${p.xLabel}</text>`;
  for(const a of result.activities){const xx=a.measurements[p.x],yy=a.measurements[p.y];if(!xx||!yy)continue;scatter+=point(x(xx.lower),y,yy,a.date+" · "+a.activity+" · "+xx.lower+" "+xx.unit+" / "+(yy.upper===null?">":"")+yy.lower+" "+yy.unit)}
 });
 scatter+=`<text x="70" y="410" font-size="12">Plots include reporting intervals; Spearman coefficients use exact numerical pairs only.</text><text x="70" y="432" font-size="12">Each pair shares the exact original ActivityIdentifier. No interpolation or fitted causal model.</text>`;
 return{"sv833-observation-timeline.svg":svg("timeline",1000,795,"SV-833 turbidity, bacteria, and phosphorus observations","Three aligned time panels show every original activity from 2021 through the captured 2026 observations. E. coli uses a logarithmic axis and arrows for above-quantitation values; phosphorus reporting intervals are retained.",time),"sv833-activity-associations.svg":svg("associations",1100,450,"SV-833 same-activity associations","Three panels show turbidity versus bacteria, turbidity versus phosphorus, and temperature versus oxygen. Original censored intervals are plotted, and exact-pair correlation coverage is stated.",scatter)};
}
