const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key='upstate-operator-capability';
let capability=sessionStorage.getItem(key),team=null,identity=null,editing=null,busy=false;
const when=v=>v?new Date(v).toLocaleString():'—';
function message(value){$('#message').textContent=value;$('#message').hidden=!value;}
async function api(path,body){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+capability,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});
 let value;try{value=await response.json();}catch{throw Error('The installation returned an unreadable response.');}
 if(!response.ok){const error=Error(value.error?.message||'HTTP '+response.status);error.status=response.status;throw error;}return value;
}
function title(id){return team?.workspaces.find(x=>x.id===id)?.title||id;}
function render(){
 $('#people').innerHTML=team.staff.map(row=>{
 const access=row.administrator?'Installation administrator':Object.entries(row.projects).map(([id,role])=>esc(title(id))+' · '+esc(role)).join('<br>');
 const self=row.id===identity.id;
 return '<tr><td>'+esc(row.display_name)+'</td><td>'+access+'</td><td>'+(row.active?'Active':'Disabled')+'</td><td>'+esc(when(row.updated_at))+'</td><td><button data-edit="'+row.id+'">Edit access</button><button data-rotate="'+row.id+'" '+(self?'disabled':'')+'>'+(row.active?'Replace link':'Reactivate with new link')+'</button>'+(row.active?'<button data-disable="'+row.id+'" '+(self?'disabled':'')+'>Disable</button>':'')+'</td></tr>';
 }).join('')||'<tr><td colspan="5">No named team members yet. Add the first person with their project access.</td></tr>';
 $('#activity').innerHTML=team.activity.map(row=>'<tr><td>'+esc(when(row.at))+'</td><td>'+esc(row.actor?.display_name||'Original operator')+'</td><td>'+esc(row.event)+'</td><td>'+esc(row.workspace?title(row.workspace):(team.staff.find(x=>x.id===row.detail?.staff_id)?.display_name||row.detail?.staff_id||''))+'</td></tr>').join('')||'<tr><td colspan="4">No team activity yet.</td></tr>';
}
async function refresh(){team=await api('/api/team');render();}
function openPerson(id=null){
 editing=id?team.staff.find(x=>x.id===id):null;
 $('#form-title').textContent=editing?'Edit '+editing.display_name:'Add person';
 $('#display-name').value=editing?.display_name||'';
 $('#administrator').checked=editing?.administrator||false;
 $('#project-roles').innerHTML=team.workspaces.map((row,i)=>'<div class="project-role"><label for="role-'+i+'">'+esc(row.title)+(row.available?'':' · unavailable')+'</label><select id="role-'+i+'" data-project="'+row.id+'">'+[['','No access'],['viewer','Viewer'],['analyst','Analyst']].map(([value,label])=>'<option value="'+value+'" '+((editing?.projects[row.id]||'')===value?'selected':'')+'>'+label+'</option>').join('')+'</select></div>').join('');
 $('#form-error').hidden=true;$('#person-dialog').showModal();$('#display-name').focus();
}
function showLink(url){if(!url)return;$('#private-link').value=url;$('#access-link').hidden=false;$('#access-link').scrollIntoView({behavior:'smooth',block:'nearest'});}
async function change(body){
 if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{const result=await api('/api/team',{...body,expected_revision:team.revision});showLink(result.access_url);await refresh();return result;}
 finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(team)render();}
}
$('#person-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!event.currentTarget.reportValidity())return;
 const projects=Object.fromEntries([...document.querySelectorAll('[data-project]')].filter(x=>x.value).map(x=>[x.dataset.project,x.value]));
 try{await change({operation:editing?'update':'create',...(editing?{id:editing.id}:{}),display_name:$('#display-name').value,administrator:$('#administrator').checked,projects});$('#person-dialog').close();message('Team access saved.');}
 catch(error){$('#form-error').textContent=error.message;$('#form-error').hidden=false;if(error.status===409)await refresh().catch(()=>{});}
});
$('#new-person').addEventListener('click',()=>openPerson());
$('#close-person').addEventListener('click',()=>{if(!busy)$('#person-dialog').close();});
$('#person-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('#people').addEventListener('click',async event=>{
 const edit=event.target.closest('[data-edit]');if(edit)return openPerson(edit.dataset.edit);
 const selected=event.target.closest('[data-rotate],[data-disable]');if(!selected||busy)return;
 const operation=selected.hasAttribute('data-rotate')?'rotate':'disable',id=selected.dataset[operation],person=team.staff.find(x=>x.id===id);
 if(!confirm((operation==='rotate'?'Replace the access link for ':'Disable access for ')+person.display_name+'? Existing file sessions will end.'))return;
 try{await change({operation,id});message(operation==='rotate'?'A new private access link is ready.':'Access disabled.');}
 catch(error){message(error.message);if(error.status===409)await refresh().catch(()=>{});}
});
$('#clear-link').addEventListener('click',()=>{$('#private-link').value='';$('#access-link').hidden=true;});
$('#copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#private-link').value);message('Private link copied.');}catch{$('#private-link').focus();$('#private-link').select();message('Select and copy the private link.');}});
$('#sign-out').addEventListener('click',async()=>{if(busy)return;try{await api('/api/logout',{});}finally{sessionStorage.removeItem(key);sessionStorage.removeItem('upstate-selected-workspace');location.replace('/');}});
try{
 if(!capability)throw Error('Open your current access link to connect.');
 const session=await api('/api/session',{});identity=session.person;$('#identity').textContent=identity.display_name;
 if(!identity.administrator)throw Error('Your project access is available in the workbench. An installation administrator manages team access.');
 await refresh();$('#administration').hidden=false;
}catch(error){message(error.message);$('#connect').hidden=false;$('#identity').textContent='Team administration';}
