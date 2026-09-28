const {createServer}=require('./rpc');
const crypto=require('node:crypto');
let server;
process.once('message',async config=>{
 const secret=config.secret;if(typeof secret!=='string'||secret.length<32)process.exit(2);
 server=createServer({authorize:async req=>{const token=req.headers.authorization?.replace(/^Bearer /,'')||'';const a=Buffer.from(token),b=Buffer.from(secret);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw Object.assign(new Error('Unauthorized'),{code:'AUTH'});return {id:'local'};}});
 server.listen(config.port||0,'127.0.0.1',()=>process.send?.({type:'ready',port:server.address().port}));
});
process.on('disconnect',()=>{if(server)server.stop().finally(()=>process.exit());else process.exit();});
process.on('SIGTERM',()=>{if(server)server.stop().finally(()=>process.exit());else process.exit();});
