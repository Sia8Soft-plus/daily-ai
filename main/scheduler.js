const LEAD_MINUTES=10;
const pad=value=>String(value).padStart(2,'0');
const localDate=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;

function occurrenceForDate(settings,date) {
  const match=/^(\d{1,2}):(\d{2})$/.exec(String(settings.time || '09:00'));
  if(!match) return null;
  const hour=Number(match[1]),minute=Number(match[2]);
  if(hour>23 || minute>59) return null;
  const day=date.getDay() || 7;
  if(settings.frequency==='weekdays' && day>5) return null;
  if(settings.frequency==='weekly' && !(settings.weekdays || []).map(value=>Number(value) || 7).includes(day)) return null;
  const dueAt=new Date(date.getFullYear(),date.getMonth(),date.getDate(),hour,minute);
  const startAt=new Date(dueAt.getTime()-LEAD_MINUTES*60000);
  return {date:localDate(dueAt),key:`${localDate(dueAt)} ${pad(hour)}:${pad(minute)}`,dueAt:dueAt.getTime(),startAt:startAt.getTime(),leadMinutes:LEAD_MINUTES};
}

function nextOccurrence(settings,now=new Date(),skipKey=null) {
  if(settings?.scheduleEnabled===false) return null;
  for(let offset=0;offset<15;offset++) {
    const day=new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset);
    const occurrence=occurrenceForDate(settings,day);
    if(!occurrence || occurrence.key===skipKey) continue;
    return occurrence;
  }
  return null;
}

module.exports={LEAD_MINUTES,occurrenceForDate,nextOccurrence};
