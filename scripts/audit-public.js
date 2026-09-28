const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
for(const p of ['dsa/server','installer','deploy','Dockerfile','docs/maintainers'])assert.equal(fs.existsSync(p),false,'Private path: '+p);
const roots=['main','renderer','shared','dsa','scripts','tests'];function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);}
let checked=0;for(const file of roots.flatMap(walk).filter(p=>p.endsWith('.js'))){const s=fs.readFileSync(file,'utf8');for(const m of s.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){const p=path.resolve(path.dirname(file),m[1]);assert.ok([p,p+'.js',p+'.json',path.join(p,'index.js')].some(fs.existsSync),file+': missing '+m[1]);}checked++;}
console.log(JSON.stringify({privatePathsAbsent:true,relativeImportsChecked:checked}));

const metadata=require('../package.json'),lock=require('../package-lock.json');for(const [name,value] of Object.entries({...metadata.dependencies,...metadata.devDependencies}))assert.ok(!/^(file:|link:|workspace:)/.test(value),'Local dependency forbidden: '+name);for(const [name,value] of Object.entries(lock.packages||{}))assert.ok(!value.link&&!/^(file:|link:)/.test(value.resolved||''),'Local lock dependency forbidden: '+name);
