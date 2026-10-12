// MIT. Calendar-day allocations over explicitly declared firm capacity.
const DAY=86_400_000;
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'PORTFOLIO_CALENDAR_INPUT',status:400,applied:false});};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const key=(value,label)=>{need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value),'Use a stable identifier for '+label+'.');return value;};
const text=(value,label,max=160)=>{need(typeof value==='string'&&value.trim()&&value.length<=max&&!value.includes('\0'),'Describe '+label+'.');return value.trim();};
const minutes=(value,label)=>{need(Number.isSafeInteger(value)&&value>=0&&value<=1_000_000,'Use whole nonnegative planned minutes for '+label+'.');return value;};
export function portfolioDate(value){
  const parsed=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?Date.parse(value+'T00:00:00.000Z'):NaN;
  need(Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value,'Use a real ISO calendar date.');
  return value;
}
const stamp=value=>Date.parse(portfolioDate(value)+'T00:00:00.000Z');
const dayString=value=>new Date(value).toISOString().slice(0,10);
export function portfolioDates(start,end){
  const first=stamp(start),last=stamp(end);
  need(first<=last&&(last-first)/DAY<=365,'Use a calendar horizon of at most 366 days, in date order.');
  const result=[];for(let value=first;value<=last;value+=DAY)result.push(dayString(value));return result;
}
export function normalizePortfolioStaff(rows){
  need(Array.isArray(rows)&&rows.length>0&&rows.length<=100,'Declare one to 100 named people.');
  const result=rows.map(row=>{
    need(plain(row),'Describe each person.');
    const workingDays=row.workingDays??[1,2,3,4,5];
    need(Array.isArray(workingDays)&&workingDays.length<=7&&workingDays.every(day=>Number.isInteger(day)&&day>=0&&day<=6)&&new Set(workingDays).size===workingDays.length,'Use distinct weekday numbers from Sunday 0 to Saturday 6.');
    const holidays=row.holidays??[],timeOff=row.timeOff??[];
    need(Array.isArray(holidays)&&holidays.length<=400&&new Set(holidays).size===holidays.length,'Use distinct holiday dates.');
    holidays.forEach(portfolioDate);
    need(Array.isArray(timeOff)&&timeOff.length<=100,'Use up to 100 explicit time-off intervals.');
    const away=timeOff.map(interval=>{
      need(plain(interval),'Describe each time-off interval.');
      const from=portfolioDate(interval.from),to=portfolioDate(interval.to);
      need(from<=to,'Keep time-off dates in order.');
      const note=interval.note??'';need(typeof note==='string'&&note.length<=1000&&!note.includes('\0'),'Keep complete time-off notes within 1000 characters.');
      return {from,to,note};
    });
    const capacity=minutes(row.minutesPerDay,'daily capacity');
    need(capacity<=1440,'Daily capacity cannot exceed 1440 minutes.');
    return {id:key(row.id,'person'),name:text(row.name,'person name'),minutesPerDay:capacity,
      workingDays:[...workingDays].sort(),holidays:[...holidays].sort(),timeOff:away};
  });
  need(new Set(result.map(row=>row.id)).size===result.length,'Give each person one distinct identifier.');
  return result;
}
export function portfolioCapacity(person,date){
  portfolioDate(date);
  return person.workingDays.includes(new Date(date+'T00:00:00.000Z').getUTCDay())&&!person.holidays.includes(date)&&!person.timeOff.some(row=>row.from<=date&&date<=row.to)?person.minutesPerDay:0;
}
export function allocatePortfolioCalendar({staff,rows,startDate,endDate,booked=[]}){
  staff=normalizePortfolioStaff(staff);
  const dates=portfolioDates(startDate,endDate),people=new Map(staff.map(row=>[row.id,row]));
  need(Array.isArray(rows)&&rows.length>0&&rows.length<=200,'Schedule one to 200 client periods.');
  need(Array.isArray(booked)&&booked.length<=100_000,'Use the complete retained capacity bookings.');
  const prepared=rows.map(row=>{
    need(plain(row),'Describe every client period.');
    const id=key(row.id,'plan row'),clientId=text(row.clientId,'client identity',240);
    const preparerId=key(row.preparerId,'preparer'),backupId=key(row.backupId,'backup'),reviewerId=key(row.reviewerId,'reviewer');
    need([preparerId,backupId,reviewerId].every(id=>people.has(id)),'Choose named people from this firm edition.');
    need(preparerId!==backupId,'Choose a backup person who can take over from the preparer.');
    const closeDate=portfolioDate(row.closeDate),reviewDate=portfolioDate(row.reviewDate??row.closeDate);
    need(startDate<=closeDate&&closeDate<=reviewDate&&reviewDate<=endDate,'Keep close and review dates inside the calendar horizon.');
    return {id,clientId,preparerId,backupId,reviewerId,closeDate,reviewDate,
      preparationMinutes:minutes(row.preparationMinutes,'preparation'),
      reviewMinutes:minutes(row.reviewMinutes,'review'),backupMinutes:minutes(row.backupMinutes??0,'backup reserve')};
  });
  need(new Set(prepared.map(row=>row.id)).size===prepared.length,'Use a distinct identifier for every plan row.');
  const cells=new Map(),allocations=[],conflicts=[];
  const cell=(staffId,date)=>{
    const id=staffId+'/'+date;
    if(!cells.has(id))cells.set(id,{staffId,date,capacityMinutes:people.has(staffId)?portfolioCapacity(people.get(staffId),date):0,
      bookedMinutes:0,plannedMinutes:0,preparationMinutes:0,reviewMinutes:0,backupMinutes:0});
    return cells.get(id);
  };
  for(const entry of booked){
    need(plain(entry),'Describe retained allocations.');
    key(entry.staffId,'retained person');portfolioDate(entry.date);minutes(entry.minutes,'retained booking');
    if(entry.date<startDate||entry.date>endDate)continue;
    cell(entry.staffId,entry.date).bookedMinutes+=entry.minutes;
  }
  const jobs=[];
  for(const row of prepared){
    jobs.push({rowId:row.id,clientId:row.clientId,role:'preparation',staffId:row.preparerId,from:startDate,to:row.closeDate,minutes:row.preparationMinutes});
    jobs.push({rowId:row.id,clientId:row.clientId,role:'review',staffId:row.reviewerId,from:row.closeDate,to:row.reviewDate,minutes:row.reviewMinutes});
    jobs.push({rowId:row.id,clientId:row.clientId,role:'backup',staffId:row.backupId,from:startDate,to:row.closeDate,minutes:row.backupMinutes});
  }
  // Review has the tighter start constraint; keep actual work ahead of reserve.
  const rank={review:0,preparation:1,backup:2};
  jobs.sort((a,b)=>(a.role==='backup')-(b.role==='backup')||a.to.localeCompare(b.to)||b.from.localeCompare(a.from)||rank[a.role]-rank[b.role]||a.rowId.localeCompare(b.rowId));
  for(const job of jobs){
    let remaining=job.minutes;
    for(let index=dates.length-1;index>=0&&remaining>0;index--){
      const date=dates[index];if(date>job.to||date<job.from)continue;
      const current=cell(job.staffId,date),available=Math.max(0,current.capacityMinutes-current.bookedMinutes-current.plannedMinutes);
      const assigned=Math.min(available,remaining);
      if(!assigned)continue;
      const allocation={rowId:job.rowId,clientId:job.clientId,role:job.role,staffId:job.staffId,date,minutes:assigned};
      allocations.push(allocation);current.plannedMinutes+=assigned;current[job.role==='preparation'?'preparationMinutes':job.role==='review'?'reviewMinutes':'backupMinutes']+=assigned;remaining-=assigned;
    }
    if(remaining)conflicts.push({id:'unallocated/'+job.rowId+'/'+job.role,kind:'UNALLOCATED',rowId:job.rowId,clientId:job.clientId,role:job.role,staffId:job.staffId,
      from:job.from,to:job.to,requestedMinutes:job.minutes,unallocatedMinutes:remaining});
  }
  for(const person of staff)for(const date of dates)cell(person.id,date);
  const days=[...cells.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.staffId.localeCompare(b.staffId)).map(row=>({...row,
    totalMinutes:row.bookedMinutes+row.plannedMinutes,availableMinutes:Math.max(0,row.capacityMinutes-row.bookedMinutes-row.plannedMinutes),
    overloadMinutes:Math.max(0,row.bookedMinutes+row.plannedMinutes-row.capacityMinutes)}));
  for(const day of days)if(day.overloadMinutes)conflicts.push({id:'overload/'+day.staffId+'/'+day.date,kind:'EXISTING_OVERLOAD',staffId:day.staffId,date:day.date,overloadMinutes:day.overloadMinutes});
  allocations.sort((a,b)=>a.date.localeCompare(b.date)||a.staffId.localeCompare(b.staffId)||a.rowId.localeCompare(b.rowId)||a.role.localeCompare(b.role));
  conflicts.sort((a,b)=>a.id.localeCompare(b.id));
  return {schema:'stellar-forge.accounting-portfolio-calendar.v1',method:'deadline-first-backward-allocation',startDate,endDate,
    rows:prepared,staff,allocations,days,conflicts,totals:{requestedMinutes:jobs.reduce((sum,row)=>sum+row.minutes,0),
      allocatedMinutes:allocations.reduce((sum,row)=>sum+row.minutes,0),unallocatedMinutes:conflicts.reduce((sum,row)=>sum+(row.unallocatedMinutes??0),0),
      existingOverloadMinutes:conflicts.reduce((sum,row)=>sum+(row.overloadMinutes??0),0)}};
}
