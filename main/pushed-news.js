const crypto=require('node:crypto');
const WEEK=7*86400000,MAX_KEYS=50000;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function canonicalUrl(value){
  try{const u=new URL(value);u.hash='';u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');u.protocol='https:';
    for(const key of [...u.searchParams.keys()])if(/^(utm_|fbclid|gclid|ref$)/i.test(key))u.searchParams.delete(key);
    u.searchParams.sort();u.pathname=u.pathname.replace(/\/$/,'');
    if(/arxiv\.org$/.test(u.hostname))return 'arxiv:'+u.pathname.replace(/^\/(abs|pdf)\//,'').replace(/\.pdf$/,'').replace(/v\d+$/,'');
    return u.toString();
  }catch{return '';}
}
function keysFor(item,sources=[]){
  const keys=[];for(const s of sources){const url=canonicalUrl(s.url);if(url)keys.push(hash('url:'+url));}
  for(const title of [item?.headline,item?.title,...sources.map(s=>s.title)]){
    const text=String(title||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
    if(text.length>=12)keys.push(hash('title:'+text));
  }
  return [...new Set(keys)];
}
class PushedNews {
  constructor(database){this.database=database;this.db=database.db;
    this.db.exec('CREATE TABLE IF NOT EXISTS pushed_news (key TEXT PRIMARY KEY, pushed_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS pushed_news_time ON pushed_news(pushed_at);');
    this.prune();
  }
  prune(now=Date.now()){
    this.db.prepare('DELETE FROM pushed_news WHERE pushed_at<?').run(now-WEEK);
    this.db.exec(`DELETE FROM pushed_news WHERE key IN (SELECT key FROM pushed_news ORDER BY pushed_at DESC,key LIMIT -1 OFFSET ${MAX_KEYS})`);
  }
  load(now=Date.now()){this.prune(now);return new Set(this.db.prepare('SELECT key FROM pushed_news WHERE pushed_at>=?').all(now-WEEK).map(r=>r.key));}
  record(snapshot,at=Date.now()){
    if(at<Date.now()-WEEK)return;
    const sources=new Map((snapshot.sources||[]).map(s=>[s.id,s]));
    const keys=new Set();for(const report of [snapshot.zh,snapshot.en])for(const section of report?.sections||[])for(const item of section.items||[])for(const key of keysFor(item,(item.source_ids||[]).map(id=>sources.get(id)).filter(Boolean)))keys.add(key);
    const insert=this.db.prepare('INSERT OR IGNORE INTO pushed_news(key,pushed_at) VALUES(?,?)');
    this.db.exec('BEGIN IMMEDIATE');try{for(const key of [...keys].slice(0,MAX_KEYS))insert.run(key,at);this.prune();this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  recordReport(report,dataDir){if(report.report_type!=='daily')return;try{const snapshot=require('./report-snapshot').loadArchiveSnapshot(dataDir,report);if(snapshot)this.record(snapshot,Date.parse(report.notified_at||new Date().toISOString()));}catch(e){console.warn('[pushed-news]',e.message);}}
  backfill(dataDir){if(this.database.getSetting('pushed_news_initialized',false))return;
    const rows=this.db.prepare("SELECT * FROM reports WHERE report_type='daily' AND notified_at>=? ORDER BY notified_at DESC LIMIT 500").all(new Date(Date.now()-WEEK).toISOString());
    for(const row of rows)this.recordReport(row,dataDir);this.database.setSetting('pushed_news_initialized',true);
  }
}
module.exports={PushedNews,keysFor,canonicalUrl,WEEK,MAX_KEYS};
