// MIT. Create a new worked example using only the original public operation writer.
// This is a fresh project, not a replacement identity for an archived customer workspace.
import {readFileSync} from 'node:fs';
import {RecordMasteringClient} from './client.mjs';

export function createExampleWorkspace(directory) {
    const client=new RecordMasteringClient({directory,create:true,title:'Customer records — worked example'});
    let operation=0;
    const apply=(action,input={})=>client.invoke(action,{...input,
        expectedRevision:client.workspace.meta().revision,requestId:'worked-example-v1-'+(++operation)});
    const retain=(feedId,file,label)=>apply('source.import',{feedId,label,
        base64:readFileSync(new URL('./example/'+file,import.meta.url)).toString('base64')});
    const activate=edition=>{const plan=client.invoke('refresh',{editionId:edition.editionId,limit:1});
        return apply('source.activate',{editionId:edition.editionId,planSha256:plan.planSha256});};
    try {
        const crm=apply('feed.create',{name:'CRM contacts',keyColumns:['ContactID'],
            mapping:{name:'Name',email:'Email',company:'Company',phone:'Phone',balance:'Balance'}});
        activate(retain(crm.feedId,'crm.csv','October customer export'));
        const billing=apply('feed.create',{name:'Billing customers',keyColumns:['CustomerRef'],
            mapping:{name:'FullName',email:'EmailAddress',company:'Organization',phone:'Phone',balance:'Amount',postal_code:'Postal'}});
        activate(retain(billing.feedId,'billing.csv','October customer export'));
        apply('rules.save',{rules:[{field:'email',normalize:'email'}]});
        const group=client.invoke('groups',{limit:500}).items.find(g=>g.value==='mara@example.test');
        if(!group)throw Error('The original example sources no longer contain the expected matching group.');
        const members=client.invoke('group',{groupId:group.id,limit:500}).items;
        const merged=apply('entity.merge',{entityIds:members.map(e=>e.id),groupId:group.id});
        const selectBilling=field=>{const e=client.invoke('entity',{entityId:merged.entityId});
            const source=e.records.find(record=>record.feedId===billing.feedId&&!record.missing);
            if(!source)throw Error('The original billing observation is missing.');
            return apply('field.choose',{entityId:e.id,field,mode:'source',recordId:source.id});};
        selectBilling('name');selectBilling('phone');selectBilling('balance');
        const columns=['name','email','company','phone','balance','postal_code'];
        apply('delivery.create',{title:'Initial customer dataset',mode:'all',columns});
        activate(retain(billing.feedId,'billing-corrections.csv','October corrections'));
        selectBilling('balance');
        apply('delivery.create',{title:'Corrected customer dataset',mode:'all',columns});
        apply('field.choose',{entityId:merged.entityId,field:'name',mode:'custom',value:'Mara Ellis'});
        apply('entity.annotate',{entityId:merged.entityId,label:'Mara Ellis',
            note:'Reviewed original CRM and billing values. Other candidate groups remain for review.'});
        apply('delivery.create',{title:'Reviewed customer dataset',mode:'all',columns});
        return {directory:client.workspace.directory,...client.invoke('status')};
    } finally {client.close();}
}
