/** Deterministic monochrome SVG for the maintained scientific-figure-spec/v1 panels. */
export function renderScientificFigureSvg(figure,d3){
 const e=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const n=value=>{if(!Number.isFinite(value))throw Error("Figure coordinate must be finite");return String(Math.round(value*1000)/1000);};
 const columns=figure.layout?.columns||1,panelW=columns===1?1060:540,panelH=330,W=columns*panelW+40;
 const wrap=(value,chars)=>{const result=[];let row="";for(const word of String(value).split(/\s+/)){if(row&&row.length+word.length+1>chars){result.push(row);row=word;}else row+=(row?" ":"")+word;}if(row)result.push(row);return result;};
 const titleLines=wrap(figure.title,Math.floor((W-80)/12)),captionLines=wrap(figure.caption,Math.floor((W-80)/7.2)),top=46+titleLines.length*27,rows=Math.ceil(figure.panels.length/columns),captionY=top+rows*panelH+18,H=captionY+captionLines.length*20+28;
 const line=(x1,y1,x2,y2,extra="")=>'<line x1="'+n(x1)+'" y1="'+n(y1)+'" x2="'+n(x2)+'" y2="'+n(y2)+'" '+extra+'/>';
 const text=(x,y,value,extra="")=>'<text x="'+n(x)+'" y="'+n(y)+'" '+extra+'>'+e(value)+'</text>';
 const marker=(x,y,kind,open=false,r=3)=>{kind=String(kind||"circle");if(kind.endsWith("-open")){open=true;kind=kind.slice(0,-5);}const attrs='fill="'+(open?'#fff':'#222')+'" stroke="#222" stroke-width="1.2"';
  if(kind==="square"||kind==="rect")return '<rect x="'+n(x-r)+'" y="'+n(y-r)+'" width="'+n(2*r)+'" height="'+n(2*r)+'" '+attrs+'/>';
  if(kind==="diamond"||kind==="diamond-mean")return '<polygon points="'+[[x,y-r*1.3],[x+r,y],[x,y+r*1.3],[x-r,y]].map(p=>p.map(n).join(",")).join(" ")+'" '+(kind==="diamond-mean"?attrs.replace('fill="#222"','fill="#fff"'):attrs)+'/>';
  if(kind==="triangle"||kind==="triangle-up")return '<polygon points="'+[[x,y-r*1.3],[x+r,y+r],[x-r,y+r]].map(p=>p.map(n).join(",")).join(" ")+'" '+attrs+'/>';
  return '<circle cx="'+n(x)+'" cy="'+n(y)+'" r="'+r+'" '+attrs+'/>';
 };
 let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-labelledby="'+e(figure.id)+'-title '+e(figure.id)+'-desc"><title id="'+e(figure.id)+'-title">'+e(figure.title)+'</title><desc id="'+e(figure.id)+'-desc">'+e(figure.caption)+'</desc><style>text{font-family:Arial,Helvetica,sans-serif;fill:#222;font-size:12px}.title{font-size:23px;font-weight:600}.panel-title{font-size:14px;font-weight:600}.axis{stroke:#333;stroke-width:1}.grid{stroke:#ddd;stroke-width:1}.tick{font-size:11px}.caption{font-size:13px;fill:#444}</style><rect width="'+W+'" height="'+H+'" fill="#fff"/>';
 titleLines.forEach((value,i)=>svg+=text(30,34+i*27,value,'class="title"'));
 for(let pi=0;pi<figure.panels.length;pi++){
  const panel=figure.panels[pi],px=20+(pi%columns)*panelW,py=top+Math.floor(pi/columns)*panelH,left=px+80,right=px+panelW-26,bottom=py+245,plotTop=py+40,pw=right-left,ph=bottom-plotTop;
  const [xmin,xmax]=panel.x.domain,[ymin,ymax]=panel.y.domain;if(!Number.isFinite(xmin)||!Number.isFinite(xmax)||xmax<=xmin||!Number.isFinite(ymin)||!Number.isFinite(ymax)||ymax<=ymin)throw Error("Original figure axis needs positive numeric span");
  const X=value=>left+(value-xmin)/(xmax-xmin)*pw,Y=value=>bottom-(value-ymin)/(ymax-ymin)*ph;
  svg+=text(left,py+17,panel.title||"",'class="panel-title"');
  const ylabel=panel.y.label+(panel.y.unit?" ("+panel.y.unit+")":"");
  svg+=text(right,py+33,ylabel,'text-anchor="end" class="tick"');
  for(const tick of panel.y.ticks||[]){if(tick.value<ymin||tick.value>ymax)continue;svg+=line(left,Y(tick.value),right,Y(tick.value),'class="grid"')+text(left-9,Y(tick.value)+4,tick.label??tick.value,'text-anchor="end" class="tick"');}
  for(const tick of panel.x.ticks||[]){if(tick.value<xmin||tick.value>xmax)continue;svg+=line(X(tick.value),bottom,X(tick.value),bottom+5,'class="axis"')+text(X(tick.value),bottom+20,tick.label??tick.value,'text-anchor="middle" class="tick"');}
  svg+=line(left,bottom,right,bottom,'class="axis"')+line(left,bottom,left,plotTop,'class="axis"');
  const xu=panel.x.unit&&panel.x.unit!=="station index"?" ("+panel.x.unit+")":"";
  svg+=text((left+right)/2,bottom+42,panel.x.label+xu,'text-anchor="middle"');
  for(const ref of panel.reference_lines||[]){const axis=ref.axis||"y";if(axis==="y"&&ref.value>=ymin&&ref.value<=ymax)svg+=line(left,Y(ref.value),right,Y(ref.value),'stroke="#555" stroke-dasharray="4 3"');if(axis==="x"&&ref.value>=xmin&&ref.value<=xmax)svg+=line(X(ref.value),bottom,X(ref.value),plotTop,'stroke="#555" stroke-dasharray="4 3"');}
  for(let si=0;si<panel.series.length;si++){const series=panel.series[si],points=series.points||[];
   for(const point of points){const ys=series.geometry==="boxplot"?["minimum","q1","median","q3","maximum"].map(k=>point[k]):point.y===null?[]:[point.y];if(!Number.isFinite(point.x)||point.x<xmin||point.x>xmax||ys.some(y=>!Number.isFinite(y)||y<ymin-1e-9||y>ymax+1e-9))throw Error("Source point is outside original panel bounds");if(series.geometry==="boxplot"&&ys.some((v,i)=>i&&v<ys[i-1]))throw Error("Original boxplot ordering differs");}
   if(series.geometry==="boxplot"){for(const p of points){const x=X(p.x),w=Math.min(32,pw/Math.max(12,points.length*3)),lo=Y(p.minimum),hi=Y(p.maximum),q1=Y(p.q1),q3=Y(p.q3),median=Y(p.median);svg+='<g><title>'+e((p.site||p.season||"")+" · n="+p.n+" · years "+(p.reference_years||p.complete_years||[]).join(", ")+": median "+p.median)+'</title>'+line(x,lo,x,hi,'stroke="#333"')+line(x-w/3,lo,x+w/3,lo,'stroke="#333"')+line(x-w/3,hi,x+w/3,hi,'stroke="#333"')+'<rect x="'+n(x-w/2)+'" y="'+n(q3)+'" width="'+n(w)+'" height="'+n(q1-q3)+'" fill="#f1f1f1" stroke="#333"/>'+line(x-w/2,median,x+w/2,median,'stroke="#111" stroke-width="2"');if(p.mean!==null&&p.mean!==undefined)svg+=marker(x,Y(p.mean),"diamond-mean",true,3);svg+='</g>';}}
   else if(series.geometry==="line"||series.geometry==="scatter"){if(series.geometry==="line"){const path=d3.line().defined(p=>p.y!==null).x(p=>X(p.x)).y(p=>Y(p.y))(points);if(path)svg+='<path d="'+path+'" fill="none" stroke="#222" stroke-width="1.5"'+(si?' stroke-dasharray="5 3"':'')+'/>';}
    for(const p of points)if(p.y!==null&&series.markers!==false)svg+='<g><title>'+e(series.label+": "+p.x+", "+p.y+(p.reference_years?"; reference years "+p.reference_years.join(", "):""))+'</title>'+marker(X(p.x),Y(p.y),series.marker||"circle",Boolean(p.censored||series.open_marker||("filled"in p&&!p.filled)))+'</g>';
   }else throw Error("Unsupported original scientific geometry "+series.geometry);
  }
  let cursor=left;for(let si=0;si<panel.series.length;si++){const series=panel.series[si],y=bottom+66;if(series.geometry==="line")svg+=line(cursor,y,cursor+20,y,'stroke="#222"'+(si?' stroke-dasharray="5 3"':''));svg+=marker(cursor+10,y,series.marker||"circle",false,2.7)+text(cursor+27,y+4,series.label,'class="tick"');cursor+=35+series.label.length*6.2;}
 }
 captionLines.forEach((value,i)=>svg+=text(30,captionY+i*20,value,'class="caption"'));
 return svg+"</svg>\n";
}
