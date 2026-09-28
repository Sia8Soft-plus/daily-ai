// Synthetic client contract data only; this is not server billing code.
const label=(zh,en)=>({zh,en});
const defaults=['month','year','monthly','yearly'].map((id,i)=>({id,name:label('Daily AI 标准版','Daily AI Standard'),billingName:label(['按月购买','按年购买','连续包月','连续包年'][i],['Monthly pass','Annual pass','Monthly auto-renew','Annual auto-renew'][i]),months:i%2?12:1,amountMinor:0,currency:'CNY',recurring:i>1,priceVersion:1,recommended:i===0,active:true,features:[label('示例权益','Example benefit')]}));
function publicPlan(p){return {...p,billingPeriod:'month:'+p.months,durationLabel:label(p.months===12?'一年':'一个月',p.months===12?'One year':'One month')};}
function presentation(plans){const ids=[...new Set(plans.map(p=>p.billingPeriod))];return {billingPeriods:ids.map(id=>({id,label:label(id==='month:12'?'按年':'按月',id==='month:12'?'Yearly':'Monthly')})),defaultBillingPeriod:ids[0]??null,recommendedPlanId:plans.find(p=>p.recommended)?.id??null};}
function addMonths(value,months){const d=new Date(value);d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString();}
module.exports={defaults,publicPlan,presentation,addMonths};
