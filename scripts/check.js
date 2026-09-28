const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const f of ['preload.js',...['main','renderer','shared','dsa','scripts','tests'].flatMap(walk)].filter(f=>f.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',f],{stdio:'inherit'});if(r.status)process.exit(r.status||1);}console.log('JavaScript syntax checks passed');
