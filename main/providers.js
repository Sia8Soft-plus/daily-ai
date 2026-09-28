const PROVIDERS = [
  { id:'glm', name:'智谱 GLM', baseUrl:'https://open.bigmodel.cn/api/coding/paas/v4', models:[], protocol:'openai', plans:[
    { name:'Coding Plan（国内）', baseUrl:'https://open.bigmodel.cn/api/coding/paas/v4' },
    { name:'普通开放平台', baseUrl:'https://open.bigmodel.cn/api/paas/v4' },
    { name:'Z.ai Coding Plan', baseUrl:'https://api.z.ai/api/coding/paas/v4' }
  ] },
  { id:'openai', name:'OpenAI', baseUrl:'https://api.openai.com/v1', models:[], protocol:'openai' },
  { id:'anthropic', name:'Anthropic', baseUrl:'https://api.anthropic.com/v1', models:[], protocol:'anthropic' },
  { id:'gemini', name:'Google Gemini', baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai', models:[], protocol:'openai' },
  { id:'deepseek', name:'DeepSeek', baseUrl:'https://api.deepseek.com', models:[], protocol:'openai' },
  { id:'qwen', name:'通义千问', baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1', models:[], protocol:'openai' },
  { id:'doubao', name:'豆包', baseUrl:'https://ark.cn-beijing.volces.com/api/v3', models:[], protocol:'openai' },
  { id:'custom', name:'OpenAI 兼容接口', baseUrl:'', models:[], protocol:'openai' }
];

function inferProvider(baseUrl) {
  const normalized = String(baseUrl || '').replace(/\/$/,'');
  return PROVIDERS.find(provider => provider.baseUrl && (provider.baseUrl === normalized || provider.plans?.some(plan => plan.baseUrl === normalized))) || null;
}

module.exports = { PROVIDERS, inferProvider };
