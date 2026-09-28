// A routing vocabulary, not a source allowlist. Every topic retains open-web queries.
const CHANNELS={
  wechat:{facet:'social',region:'domestic',domains:['mp.weixin.qq.com'],hint:'微信公众号 作者 发布'},
  channels:{facet:'social',region:'domestic',domains:[],hint:'视频号 微信 公开访谈 发布 文字实录'},
  technical_cn:{facet:'community',region:'domestic',domains:['juejin.cn','csdn.net','oschina.net','segmentfault.com'],hint:'技术实践 社区'},
  forum_cn:{facet:'community',region:'domestic',domains:['zhihu.com','v2ex.com'],hint:'专业讨论 作者'},
  open_cn:{facet:'opensource',region:'domestic',domains:['gitee.com','modelscope.cn'],hint:'开源 发布'},
  news_cn:{facet:'news',region:'domestic',domains:['news.cn','people.com.cn','36kr.com'],hint:'新闻 最新进展'},
  research:{facet:'research',region:'global',domains:['arxiv.org','openreview.net','nature.com'],hint:'new research findings'},
  open_global:{facet:'opensource',region:'global',domains:['github.com','huggingface.co'],hint:'release model dataset'},
  forum_global:{facet:'community',region:'global',domains:['reddit.com','news.ycombinator.com','stackoverflow.com'],hint:'expert discussion new results'},
  social_global:{facet:'social',region:'global',domains:['x.com','linkedin.com','bsky.app'],hint:'author announcement'},
  news_global:{facet:'news',region:'global',domains:['reuters.com','apnews.com'],hint:'latest news'}
};
const safeDomain=value=>typeof value==='string'&&/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(value)&&!/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(value)?value.toLowerCase():null;
const isResearchTopic=(topic,expansion={})=>expansion.intent==='research'||/论文|顶刊|顶会|学术|科研|\b(papers?|academic|journal|research)\b/i.test(`${topic.name_zh||''} ${topic.description||''}`);
function resolveRoute(topic,expansion={}) {
  const domestic=topic.region_preference==='domestic';
  const chosen=[...new Set((Array.isArray(expansion.channels)?expansion.channels:[]).filter(id=>CHANNELS[id]))].slice(0,6);
  const base=domestic?['wechat','channels','news_cn','forum_cn']:['news_global','social_global','wechat','channels'];
  const research=isResearchTopic(topic,expansion);
  const ids=[...new Set([...(research?['research','open_global']:[]),...chosen,...base])];
  const domains=[...new Set((Array.isArray(expansion.domains)?expansion.domains:[]).map(safeDomain).filter(Boolean))].slice(0,4);
  return {topicId:topic.id,region:domestic?'domestic':'global',channels:ids,domains,reason:String(expansion.route_reason||'Open-web fallback with public news and social discovery').slice(0,400),aliases:[...new Set((Array.isArray(expansion.aliases)?expansion.aliases:[]).filter(x=>typeof x==='string').map(x=>x.trim().slice(0,80)).filter(Boolean))].slice(0,4)};
}
function routeQueries(topic,expansion,local,english,since,round=0) {
  const route=resolveRoute(topic,expansion);
  const rows=route.channels.map(id=>{
    const channel=CHANNELS[id],domain=channel.domains[(round||0)%Math.max(1,channel.domains.length)];
    return {facet:channel.facet,route:id,query:`${channel.region==='domestic'?local:english} ${domain?'site:'+domain:channel.hint} after:${since}`};
  });
  for(const domain of route.domains)rows.push({facet:'official',route:'model-domain',query:`${route.region==='domestic'?local:english} site:${domain} after:${since}`});
  if(round)for(const alias of route.aliases)rows.push({facet:'overview',route:'semantic-expansion',query:`${alias} ${route.region==='domestic'?'最新研究 进展':'new results developments'} after:${since}`});
  return {route,rows};
}
module.exports={CHANNELS,resolveRoute,routeQueries,isResearchTopic};
