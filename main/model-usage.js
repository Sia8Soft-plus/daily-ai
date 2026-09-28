function nonNegativeInteger(value){
  if(value===undefined||value===null||value==='')return null;
  const number=Number(value);return Number.isSafeInteger(number)&&number>=0?number:null;
}
function normalizeUsage(usage){
  if(!usage||typeof usage!=='object')return {inputTokens:null,outputTokens:null,totalTokens:null};
  const inputTokens=nonNegativeInteger(usage.prompt_tokens??usage.input_tokens??usage.promptTokens??usage.inputTokens);
  const outputTokens=nonNegativeInteger(usage.completion_tokens??usage.output_tokens??usage.completionTokens??usage.outputTokens);
  const totalTokens=nonNegativeInteger(usage.total_tokens??usage.totalTokens)??(inputTokens!==null&&outputTokens!==null?inputTokens+outputTokens:null);
  return {inputTokens,outputTokens,totalTokens};
}
module.exports={normalizeUsage};
