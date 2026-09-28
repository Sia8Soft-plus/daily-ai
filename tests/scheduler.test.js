const test=require('node:test');
const assert=require('node:assert/strict');
const {nextOccurrence}=require('../main/scheduler');

test('12:35 delivery starts preparation at 12:25 and catches up after wake',()=>{
  const settings={frequency:'daily',time:'12:35',scheduleEnabled:true};
  const before=nextOccurrence(settings,new Date(2026,8,25,12,0));
  assert.equal(new Date(before.startAt).getHours(),12);
  assert.equal(new Date(before.startAt).getMinutes(),25);
  assert.equal(new Date(before.dueAt).getMinutes(),35);
  assert.equal(nextOccurrence(settings,new Date(2026,8,25,12,38)).key,before.key);
  assert.notEqual(nextOccurrence(settings,new Date(2026,8,25,12,38),before.key).key,before.key);
});

test('weekly days and cross-midnight preparation use the delivery date',()=>{
  const friday=new Date(2026,8,25,23,50);
  const weekly=nextOccurrence({frequency:'weekly',weekdays:[6],time:'00:05'},friday);
  assert.equal(weekly.date,'2026-09-26');
  assert.equal(new Date(weekly.startAt).getDate(),25);
  assert.equal(new Date(weekly.startAt).getHours(),23);
  assert.equal(new Date(weekly.startAt).getMinutes(),55);
});

test('disabled and invalid plans do not run',()=>{
  assert.equal(nextOccurrence({scheduleEnabled:false,time:'12:35'}),null);
  assert.equal(nextOccurrence({time:'25:35'}),null);
  assert.equal(nextOccurrence({frequency:'weekly',weekdays:[],time:'12:35'}),null);
});
