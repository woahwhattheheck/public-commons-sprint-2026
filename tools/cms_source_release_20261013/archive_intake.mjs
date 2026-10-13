/** Browser publisher archive receiving. Uses the same original CSV intake and source comparison. */
export function attachPublisherArchive({root,services,csvIntake,onReceive,download}){
  const find=id=>root.querySelector("#"+id),status=find("archive-status");
  let archive=null,selected=null,packet=null,generation=0;
  const say=message=>{status.textContent=message;};
  const clear=()=>{archive=null;selected=null;packet=null;find("archive-members").replaceChildren();find("archive-member").replaceChildren();find("archive-select").disabled=true;find("archive-original-download").disabled=true;find("archive-intake-download").disabled=true;};
  const metadata=()=>({origin:"official-original",source_url:find("archive-source-url").value,archive_url:find("archive-source-url").value,archive_member:selected?.path||""});
  const describe=original=>{
    archive=original;find("archive-member").replaceChildren();find("archive-members").replaceChildren();
    for(const entry of original.inventory){
      const row=document.createElement("tr");
      for(const value of [entry.path,String(entry.bytes),entry.sha256]){const cell=document.createElement("td");cell.textContent=value;row.append(cell);}
      find("archive-members").append(row);
      if(!entry.directory&&/\.csv$/i.test(entry.path)){const option=document.createElement("option");option.value=entry.path;option.textContent=entry.path+" · "+entry.bytes+" bytes";find("archive-member").append(option);}
    }
    find("archive-select").disabled=!find("archive-member").options.length;find("archive-original-download").disabled=false;
    say(original.filename+" · "+original.bytes.length+" original bytes · "+original.inventory.length+" verified members · SHA-256 "+original.sha256+". Choose the original table, then complete its source metadata and mapping below.");
  };
  find("archive-file").addEventListener("change",async event=>{
    const file=event.target.files?.[0],mine=++generation;clear();csvIntake.clear();if(!file){say("");return;}
    say("Reading and verifying every original ZIP member…");
    try{const bytes=new Uint8Array(await file.arrayBuffer());const result=await services.verifyPublisherArchive(bytes,file.name,services);if(mine!==generation)return;describe(result);}
    catch(error){if(mine===generation)say("Publisher archive could not be received: "+error.message);}
  });
  find("archive-select").addEventListener("click",async()=>{
    if(!archive)return;const original=archive,member=find("archive-member").value,mine=++generation;selected=null;packet=null;csvIntake.clear();const sourceVersion=csvIntake.revision();find("archive-intake-download").disabled=true;
    try{
      const entry=original.zip.entries.find(e=>e.path===member&&!e.directory);if(!entry)throw Error("Select a complete original CSV member.");
      const bytes=await services.readPublisherMember(original.zip,entry,services.inflateRaw);if(mine!==generation||original!==archive)return;if(sourceVersion!==csvIntake.revision()){say("The CSV selection changed while this archive member was being read. Choose the archive member again when ready.");return;}
      const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
      if(services.hash(text)!==services.hashBytes(bytes))throw Error("Original UTF-8 bytes changed during decoding.");
      selected=entry;csvIntake.loadOriginal(text,member.split("/").at(-1),metadata());
      root.querySelector("#csv-original-intake").open=true;find("archive-intake-download").disabled=false;
      say("Original "+member+" is in the field mapper. Confirm its actual edition and mappings, receive the CSV, then download the complete archive intake.");
    }catch(error){if(mine===generation)say("Original member could not enter the mapper: "+error.message);}
  });
  find("archive-source-url").addEventListener("input",()=>{
    generation++;packet=null;selected=null;csvIntake.clear();find("archive-intake-download").disabled=true;
    say("Archive URL changed. Choose its original CSV again to bind the current source URL before mapping.");
  });
  find("archive-member").addEventListener("change",()=>{generation++;selected=null;packet=null;csvIntake.clear();find("archive-intake-download").disabled=true;say("Choose Open original table to load this selected member into the mapper.");});
  find("archive-placement").addEventListener("change",()=>{generation++;find("archive-receive-file").value="";say("Received-edition order changed. Choose the complete archive intake to receive it in this order.");});
  find("archive-original-download").addEventListener("click",()=>{if(archive)download(archive.filename,archive.bytes,"application/zip");});
  find("archive-intake-download").addEventListener("click",async()=>{
    const prepared=csvIntake.current(),original=archive,member=selected?.path,mine=generation;
    if(!prepared||!original||!member){say("Complete the source metadata and mapping, then receive the original CSV before exporting the archive intake.");return;}
    say("Rebuilding the complete archive intake from its original member…");
    try{
      const result=await services.buildArchiveIntake(original,member,prepared.request,services);if(mine!==generation||prepared!==csvIntake.current()||archive!==original)return;
      if(result.release.manifest.release_id!==prepared.release.manifest.release_id)throw Error("The mapped release belongs to a different original CSV.");
      packet=result.packet;download("cms-original-archive-intake.json",JSON.stringify(packet)+"\n");
      say("Complete archive intake exported: untouched ZIP, full verified inventory, selected original CSV, exact mapping and complete release. The same file can be independently received below or by the local CLI.");
    }catch(error){if(mine===generation)say("Archive intake export stopped: "+error.message);}
  });
  find("archive-receive-file").addEventListener("change",async event=>{
    const file=event.target.files?.[0],mine=++generation;clear();csvIntake.clear();const sourceVersion=csvIntake.revision(),placement=find("archive-placement").value;if(!file)return;
    say("Receiving the complete original archive and reconstructing its selected release…");
    try{
      const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer()));
      const result=await services.receiveArchiveIntake(value,services);if(mine!==generation)return;if(sourceVersion!==csvIntake.revision()){say("The CSV selection changed while this archive intake was being received. Select the complete intake again when ready.");return;}
      describe(result.archive);packet=result.packet;selected=result.archive.zip.entries.find(e=>e.path===packet.selected_member);
      find("archive-source-url").value=packet.request.metadata.archive_url;find("archive-member").value=packet.selected_member;
      onReceive(packet.release,placement);
      say("Original archive and all "+archive.inventory.length+" members received. Rebuilt "+result.release.records.length+" California records; complete comparison opened with this edition "+placement+". The original ZIP is available to download.");
    }catch(error){if(mine===generation)say("Archive intake receiving stopped: "+error.message);}
  });
  clear();return {current(){return packet;},clear(){generation++;clear();csvIntake.clear();}};
}
