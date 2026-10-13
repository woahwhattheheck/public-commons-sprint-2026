/** Readable native views over the exact completed paired-class matrices. */
const GROUPS = [
  ['water','Water',[11]],['snow_ice','Snow / ice',[12]],
  ['developed','Developed',[21,22,23,24]],['barren','Barren',[31]],
  ['forest','Forest',[41,42,43]],['shrub','Shrub',[52]],
  ['grass','Grass',[71]],['agriculture','Agriculture',[81,82]],
  ['wetland','Wetland',[90,95]]
];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>value===null?'Not available':Number(value).toLocaleString(undefined,{maximumFractionDigits:3});
const pct=(n,d)=>d?100*n/d:null;
const requireValue=(condition,message)=>{if(!condition)throw Error(message);};

export function originalLandcoverGroups(view,cellAreaM2){
  requireValue(Number.isFinite(cellAreaM2)&&cellAreaM2>0,'The original native cell area is unavailable.');
  requireValue(Number.isSafeInteger(view?.paired_valid_cells)&&view.paired_valid_cells>=0,
    'The original paired support is unavailable.');
  const groups=GROUPS.map(([id,label,codes])=>({id,label,codes:[...codes],before_cells:0,after_cells:0,
    retained_within_group_cells:0,internal_class_change_cells:0,gross_loss_cells:0,gross_gain_cells:0}));
  const byClass=new Map(groups.flatMap(group=>group.codes.map(code=>[code,group])));
  const seen=new Set();let paired=0,changed=0,changedGroup=0;
  requireValue(Array.isArray(view.transitions),'The complete original directional matrix is unavailable.');
  for(const row of view.transitions){
    const before=byClass.get(row.before_class),after=byClass.get(row.after_class),key=row.before_class+'|'+row.after_class;
    requireValue(before&&after&&!seen.has(key)&&Number.isSafeInteger(row.cells)&&row.cells>=0,
      'The original directional matrix has an invalid or repeated class pair.');
    const expected=row.cells*cellAreaM2/10000;
    requireValue(Number.isFinite(row.area_ha)&&Math.abs(row.area_ha-expected)<=Math.max(1e-9,Math.abs(expected)*1e-10),
      'A directional area differs from its original native cell support.');
    seen.add(key);paired+=row.cells;before.before_cells+=row.cells;after.after_cells+=row.cells;
    if(row.before_class!==row.after_class)changed+=row.cells;
    if(before===after){
      before.retained_within_group_cells+=row.cells;
      if(row.before_class!==row.after_class)before.internal_class_change_cells+=row.cells;
    }else{before.gross_loss_cells+=row.cells;after.gross_gain_cells+=row.cells;changedGroup+=row.cells;}
  }
  requireValue(seen.size===byClass.size**2&&paired===view.paired_valid_cells&&changed===view.changed_class_cells,
    'The full matrix differs from the original retained support.');
  const area=cells=>cells*cellAreaM2/10000;
  return {paired_valid_cells:paired,changed_class_cells:changed,changed_group_cells:changedGroup,
    within_group_class_change_cells:changed-changedGroup,rows:groups.map(group=>{
      const net=group.after_cells-group.before_cells;
      return {...group,net_cells:net,gross_turnover_cells:group.gross_gain_cells+group.gross_loss_cells,
        before_area_ha:area(group.before_cells),after_area_ha:area(group.after_cells),
        gross_gain_area_ha:area(group.gross_gain_cells),gross_loss_area_ha:area(group.gross_loss_cells),
        net_area_ha:area(net),retained_area_ha:area(group.retained_within_group_cells),
        internal_class_change_area_ha:area(group.internal_class_change_cells),
        loss_percent_of_before_group:pct(group.gross_loss_cells,group.before_cells),
        gain_percent_of_after_group:pct(group.gross_gain_cells,group.after_cells),
        net_percent_of_paired_valid:pct(net,paired)};
    })};
}

function groupChart(groups,label){
  const maximum=Math.max(...groups.rows.flatMap(row=>[row.gross_loss_area_ha,row.gross_gain_area_ha,Math.abs(row.net_area_ha)]));
  const extent=maximum||1,origin=460,half=245,scale=value=>half*value/extent;
  const ticks=maximum?[-1,-.5,0,.5,1]:[0];
  const grid=ticks.map(value=>{
    const x=origin+half*value;
    return '<line x1="'+x+'" y1="45" x2="'+x+'" y2="383" stroke="'+(value===0?'#333':'#d8d8d8')+'"/>'+
      '<text x="'+x+'" y="405" text-anchor="middle">'+esc(number(value*maximum))+'</text>';
  }).join('');
  const marks=groups.rows.map((row,index)=>{
    const y=68+index*37,gain=scale(row.gross_gain_area_ha),loss=scale(row.gross_loss_area_ha),net=origin+scale(row.net_area_ha);
    return '<g><title>'+esc(row.label+': gained '+number(row.gross_gain_area_ha)+' ha; lost '+number(row.gross_loss_area_ha)+
      ' ha; net '+number(row.net_area_ha)+' ha')+'</title><text x="12" y="'+(y+4)+'">'+esc(row.label)+'</text>'+
      '<rect x="'+(origin-loss)+'" y="'+(y-10)+'" width="'+loss+'" height="12" fill="#ddd" stroke="#555"/>'+
      '<rect x="'+origin+'" y="'+(y-10)+'" width="'+gain+'" height="12" fill="#555"/>'+
      '<path d="M '+net+' '+(y+6)+' l 5 5 l -5 5 l -5 -5 Z" fill="#111"/></g>';
  }).join('');
  return '<div class="olc-scroll olc-group-chart" tabindex="0" role="region" aria-label="Land-cover group chart, scroll horizontally">'+
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 445" width="760" height="445" role="img" aria-label="'+
    esc(label+'; gross group losses left, gains right, net change diamonds. Complete values in the following table.')+'">'+
    '<rect width="760" height="445" fill="#fff"/><g font-family="Arial,sans-serif" font-size="14" fill="#222">'+
    '<text x="215" y="25">Gross loss ←</text><text x="705" y="25" text-anchor="end">→ Gross gain</text>'+grid+marks+
    '<text x="460" y="435" text-anchor="middle">Hectares · diamond = net change (gain − loss)</text></g></svg></div>';
}

export function renderOriginalLandcoverGroups(view,cellAreaM2,{label='Original selected watershed group changes',before,after}={}){
  const groups=originalLandcoverGroups(view,cellAreaM2);
  const columns=['Land-cover group',String(before)+' paired ha',String(after)+' paired ha','Gross gain ha','Gross loss ha',
    'Net change ha','Loss / earlier group %','Gain / later group %','Within-group class-change ha'];
  const fields=['before_area_ha','after_area_ha','gross_gain_area_ha','gross_loss_area_ha','net_area_ha',
    'loss_percent_of_before_group','gain_percent_of_after_group','internal_class_change_area_ha'];
  const table='<div class="olc-scroll" tabindex="0" role="region" aria-label="Complete original land-cover group values, scroll horizontally">'+
    '<table><caption>Original paired support: '+esc(number(groups.paired_valid_cells))+' cells</caption><thead><tr>'+
    columns.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+
    groups.rows.map(row=>'<tr><th scope="row">'+esc(row.label)+'<small class="olc-group-codes">'+esc(row.codes.join(', '))+'</small></th>'+
      fields.map(field=>'<td title="'+esc(row[field]===null?'Not available':row[field])+'">'+esc(number(row[field]))+'</td>').join('')+
      '</tr>').join('')+'</tbody></table></div>';
  return '<section class="olc-group-summary"><h3>Land-cover groups · gross gains, losses and net change</h3>'+
    '<p>Gross gain and loss count cells crossing a group boundary. A switch between two forest classes remains within forest; developed classes follow the same rule. All nine groups use the same hectare scale for this reporting area.</p>'+
    '<p>'+esc(number(groups.changed_group_cells))+' cells changed group; '+esc(number(groups.within_group_class_change_cells))+
    ' more changed class within their group. Together they equal the original '+esc(number(groups.changed_class_cells))+' changed-class cells.</p>'+
    groupChart(groups,label)+table+'<p class="olc-note">Loss percentages use the earlier group; gain percentages use the later group. A zero group denominator is Not available. These summaries use the original paired-valid support. Independent annual inventories and each directional class change follow below.</p></section>';
}
