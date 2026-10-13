function renderPhysicalFigures(r) {
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const svg=(w,h,title,desc,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc"><title id="title">${escape(title)}</title><desc id="desc">${escape(desc)}</desc><rect width="${w}" height="${h}" fill="white"/><g font-family="Arial,sans-serif" fill="#202326">${body}</g></svg>\n`;
  let scatter="";
  const stations=["SV-268","SV-374","SV-375","SV-376"];
  stations.forEach((station,i)=>{
    const ox=55+(i%2)*460,oy=60+Math.floor(i/2)*310,w=375,h=210;
    const x=v=>ox+(v-4)/30*w,y=v=>oy+h-(v-4)/10*h;
    const rows=r.activities.filter(a=>a.project==="SWS-2023"&&a.station===station&&a.measurements.temperature&&a.measurements.oxygen);
    const association=r.associations.find(a=>a.station===station&&a.x==="temperature"&&a.y==="oxygen");
    scatter+=`<text x="${ox}" y="${oy-28}" font-size="16" font-weight="bold">${station}</text><text x="${ox+w}" y="${oy-28}" text-anchor="end" font-size="12">n = ${rows.length} · ρ = ${association.spearman_rho.toFixed(3)}</text>`;
    for(const v of[5,10,15,20,25,30])scatter+=`<line x1="${x(v)}" y1="${oy}" x2="${x(v)}" y2="${oy+h}" stroke="#ececec"/><text x="${x(v)}" y="${oy+h+20}" font-size="11" text-anchor="middle">${v}</text>`;
    for(const v of[4,6,8,10,12,14])scatter+=`<line x1="${ox}" y1="${y(v)}" x2="${ox+w}" y2="${y(v)}" stroke="#ececec"/><text x="${ox-12}" y="${y(v)+4}" font-size="11" text-anchor="end">${v}</text>`;
    scatter+=`<path d="M${ox},${oy}V${oy+h}H${ox+w}" stroke="#555" fill="none"/><text x="${ox+w/2}" y="${oy+h+43}" text-anchor="middle" font-size="12">Water temperature (°C)</text><text x="${ox-38}" y="${oy+h/2}" text-anchor="middle" font-size="12" transform="rotate(-90 ${ox-38} ${oy+h/2})">Dissolved oxygen (mg/L)</text>`;
    for(const a of rows){const xx=x(a.measurements.temperature.lower),yy=y(a.measurements.oxygen.lower);scatter+=`<circle cx="${xx.toFixed(2)}" cy="${yy.toFixed(2)}" r="4.5" fill="${a.date==="2023-06-12"?"#111":"white"}" stroke="#222" stroke-width="1.3"><title>${escape(a.date+" "+a.time+" "+a.timezone+" · "+a.activity+" · "+a.measurements.temperature.lower+" °C / "+a.measurements.oxygen.lower+" mg/L")}</title></circle>`}
  });
  scatter+=`<text x="55" y="666" font-size="12">Same ActivityIdentifier only · routine SWS-2023 samples · filled points mark June 12</text>`;
  let paired="", dates=r.pairs.filter(p=>p.station_a==="SV-268"&&p.station_b==="SV-376");
  const panels=[{key:"temperature",title:"Temperature (°C)",min:-7,max:1,ticks:[-6,-4,-2,0]},{key:"oxygen",title:"Dissolved oxygen (mg/L)",min:-1,max:3.2,ticks:[-1,0,1,2,3]},{key:"phosphorus",title:"Phosphorus (mg/L)",min:-.2,max:.65,ticks:[-.2,0,.2,.4,.6]}];
  dates.forEach((d,i)=>{const yy=93+i*28;paired+=`<text x="22" y="${yy+4}" font-size="12">${d.date}</text><text x="147" y="${yy+4}" font-size="11" fill="#555">${d.clock_separation_minutes} min</text>`});
  panels.forEach((p,j)=>{
    const ox=240+j*265,w=225,x=v=>ox+(v-p.min)/(p.max-p.min)*w;
    paired+=`<text x="${ox}" y="28" font-size="14" font-weight="bold">${p.title}</text>`;
    for(const t of p.ticks)paired+=`<line x1="${x(t)}" y1="70" x2="${x(t)}" y2="416" stroke="${t===0?"#777":"#ececec"}" stroke-dasharray="${t===0?"3 3":"none"}"/><text x="${x(t)}" y="53" text-anchor="middle" font-size="11">${t}</text>`;
    dates.forEach((d,i)=>{const v=r.differences.find(v=>v.station_a==="SV-268"&&v.station_b==="SV-376"&&v.date===d.date&&v.analyte===p.key),yy=93+i*28;
      if(!v) return;
      if(v.lower===v.upper)paired+=`<circle cx="${x(v.lower).toFixed(2)}" cy="${yy}" r="4" fill="${d.date==="2023-06-12"?"#111":"white"}" stroke="#222" stroke-width="1.2"/>`;
      else paired+=`<line x1="${x(v.lower).toFixed(2)}" y1="${yy}" x2="${x(v.upper).toFixed(2)}" y2="${yy}" stroke="#222" stroke-width="2"/><circle cx="${x(v.lower).toFixed(2)}" cy="${yy}" r="2.5" fill="${v.lower_open?"white":"#222"}" stroke="#222"/><circle cx="${x(v.upper).toFixed(2)}" cy="${yy}" r="2.5" fill="${v.upper_open?"white":"#222"}" stroke="#222"/>`;
    })
  });
  paired+=`<text x="22" y="454" font-size="12">SV-376 minus SV-268 · SV-376 sampled earlier on all 12 dates · open endpoints preserve reporting limits</text><text x="22" y="478" font-size="12">Filled points mark June 12; all original dates remain in the full comparison.</text>`;
  return {
    "temperature-oxygen.svg":svg(950,690,"Temperature and dissolved oxygen within the same routine sampling activities","Four equal-axis station panels containing 47 original same-activity temperature and dissolved oxygen pairs. June 12 points are filled; the SV-245 singleton and separate PFAS activities are in the accompanying table.",scatter),
    "paired-physical-contrasts.svg":svg(1040,505,"Twelve same-date physical and phosphorus contrasts","SV-376 minus SV-268 for temperature, dissolved oxygen, and phosphorus. Sampling clock separation is shown for each date; SV-376 was sampled earlier on every date.",paired)
  };
}
export { renderPhysicalFigures };
