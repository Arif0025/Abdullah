import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const root=resolve('public'),editorRoot=resolve('private-editor');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
const sessionSecret=randomBytes(32),localSessions=new Map(),localAuthenticators=new Map(),localPendingAuthenticators=new Map();
const json=(res,status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(body))};
const hash=value=>createHmac('sha256',sessionSecret).update(value).digest('hex');
function safeEqualText(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)}
function base32(buffer){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,out='';for(const byte of buffer){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out}
function base32Buffer(input){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,out=[];for(const c of input){const n=alphabet.indexOf(c);if(n<0)throw Error('Invalid authenticator key.');value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8}}return Buffer.from(out)}
function totp(secret,time=Date.now()){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const h=createHmac('sha1',base32Buffer(secret)).update(counter).digest(),offset=h[h.length-1]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')}
function validTotp(secret,code){if(!/^\d{6}$/.test(String(code)))return false;for(const offset of [-30000,0,30000])if(safeEqualText(totp(secret,Date.now()+offset),code))return true;return false}
function demoEditorAuthorized(req){const expectedUser=process.env.EDITOR_DEMO_USER,expectedPassword=process.env.EDITOR_DEMO_PASSWORD;if(!expectedUser||!expectedPassword)return false;const header=req.headers.authorization||'';if(!header.startsWith('Basic '))return false;let credentials;try{credentials=Buffer.from(header.slice(6),'base64').toString('utf8')}catch{return false}const colon=credentials.indexOf(':');if(colon<0)return false;return safeEqualText(credentials.slice(0,colon),expectedUser)&&safeEqualText(credentials.slice(colon+1),expectedPassword)}
function requireDemoEditorAuth(req,res){if(!process.env.EDITOR_DEMO_USER||!process.env.EDITOR_DEMO_PASSWORD){res.writeHead(404,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end('Not found');return false}if(!demoEditorAuthorized(req)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Profile editor demo", charset="UTF-8"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end('Demo credentials required');return false}return true}
function localSession(req){const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('profile_editor_session='))?.slice('profile_editor_session='.length);if(!token)return false;const [id,sig]=token.split('.');if(!id||!sig||!localSessions.has(id))return false;if(localSessions.get(id)<Date.now()){localSessions.delete(id);return false}const a=Buffer.from(hash(id),'hex'),b=Buffer.from(sig,'hex');return a.length===b.length&&timingSafeEqual(a,b)}
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:4173');
    const requestHost=new URL(`http://${req.headers.host||'127.0.0.1'}`).hostname;
    const localHost=['localhost','127.0.0.1','::1'].includes(requestHost);
    const ip=req.socket.remoteAddress||'local';
    if(url.pathname.startsWith('/api/editor/')){
      if(!localHost&&!requireDemoEditorAuth(req,res))return;
      if(req.method==='GET'&&url.pathname==='/api/editor/session'){json(res,200,{authenticated:localSession(req)});return}
      if(req.method==='POST'&&url.pathname==='/api/editor/verify-password'){
        if(localHost){json(res,200,{ok:true,totpEnabled:localAuthenticators.has(ip),message:'Local development checks the editor password through its local-only sign-in flow.'});return}
        let body='';for await(const chunk of req)body+=chunk;let input;try{input=JSON.parse(body)}catch{json(res,400,{error:'Invalid request.'});return}
        if(!safeEqualText(input.password||'',process.env.EDITOR_DEMO_PASSWORD||'')){json(res,401,{error:'The editor password is incorrect.'});return}
        json(res,200,{ok:true,totpEnabled:localAuthenticators.has(ip)});return
      }
      if(req.method==='POST'&&url.pathname==='/api/editor/totp-setup'){
        if(localAuthenticators.has(ip)){json(res,409,{error:'An authenticator is already enrolled.'});return}
        const secret=base32(randomBytes(20));localPendingAuthenticators.set(ip,{secret,expires:Date.now()+10*60_000,attempts:0});
        const account='profile-owner';json(res,200,{secret,uri:`otpauth://totp/${encodeURIComponent(`Profile Editor:${account}`)}?secret=${secret}&issuer=Profile%20Editor&algorithm=SHA1&digits=6&period=30`});return
      }
      if(req.method==='POST'&&url.pathname==='/api/editor/totp-enroll'){
        let body='';for await(const chunk of req)body+=chunk;let input;try{input=JSON.parse(body)}catch{json(res,400,{error:'Invalid request.'});return}
        const pending=localPendingAuthenticators.get(ip);if(!pending||pending.expires<Date.now()||pending.attempts>=5){localPendingAuthenticators.delete(ip);json(res,401,{error:'Authenticator setup expired. Start again.'});return}
        if(!validTotp(pending.secret,input.code)){pending.attempts++;json(res,401,{error:'That authenticator code is invalid.'});return}
        const codes=Array.from({length:8},()=>`${base32(randomBytes(5)).slice(0,5)}-${base32(randomBytes(5)).slice(0,5)}`);localAuthenticators.set(ip,{secret:pending.secret,codes});localPendingAuthenticators.delete(ip);const id=randomBytes(24).toString('base64url');localSessions.set(id,Date.now()+8*60*60_000);json(res,200,{ok:true,recoveryCodes:codes},{'Set-Cookie':`profile_editor_session=${id}.${hash(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`});return
      }
      if(req.method==='POST'&&url.pathname==='/api/editor/verify-totp'){
        let body='';for await(const chunk of req)body+=chunk;let input;try{input=JSON.parse(body)}catch{json(res,400,{error:'Invalid request.'});return}
        const enrolled=localAuthenticators.get(ip),code=String(input.code||'').trim();if(!enrolled){json(res,401,{error:'No authenticator is enrolled.'});return}
        if(validTotp(enrolled.secret,code)){const id=randomBytes(24).toString('base64url');localSessions.set(id,Date.now()+8*60*60_000);json(res,200,{ok:true},{'Set-Cookie':`profile_editor_session=${id}.${hash(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`});return}
        const index=enrolled.codes.indexOf(code.toUpperCase());if(index>=0){enrolled.codes.splice(index,1);localAuthenticators.delete(ip);json(res,200,{ok:true,recoveryUsed:true,remainingRecoveryCodes:enrolled.codes.length});return}
        json(res,401,{error:'That authenticator or recovery code is invalid.'});return
      }
      if(req.method==='POST'&&url.pathname==='/api/editor/logout'){localSessions.clear();json(res,200,{ok:true},{'Set-Cookie':'profile_editor_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});return}
      if(req.method==='POST'&&url.pathname==='/api/editor/publish'){
        if(!localSession(req)){json(res,401,{error:'Your editor session has expired. Sign in again.'});return}
        json(res,503,{error:'Local sign-in is working. Publishing runs through Netlify Functions; configure Netlify environment variables and use `netlify dev` to exercise the GitHub publish step.'});return
      }
      json(res,404,{error:'Not found.'});return
    }
    const editor=url.pathname==='/editor'||url.pathname.startsWith('/editor/');
    if(editor&&!localHost&&!requireDemoEditorAuth(req,res))return;
    if(url.pathname==='/editor'){res.writeHead(308,{Location:'/editor/', 'Cache-Control':'no-store'}).end();return;}
    const requestPath=editor?url.pathname.replace(/^\/editor\/?/,'/'):url.pathname.replace(/^\/public(?=\/|$)/,'')||'/';
    const pathname=decodeURIComponent(requestPath==='/'?(editor?'/admin.html':'/index.html'):requestPath);
    const base=editor?editorRoot:root;
    const file=resolve(base,'.'+pathname);
    if(file!==base&&!file.startsWith(base+sep)){res.writeHead(404).end();return;}
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(editor?{'X-Robots-Tag':'noindex, nofollow'}:{})}).end(body);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Not found');}
});
server.on('error',error=>{
  if(error.code==='EADDRINUSE'&&!process.env.PORT){
    port++;
    console.warn(`Port ${port-1} is already in use; trying ${port}.`);
    server.listen(port,'127.0.0.1');
    return;
  }
  if(error.code==='EADDRINUSE')console.error(`Port ${port} is already in use. Start with a different PORT value, for example PORT=${port+1}.`);
  else console.error('Local site server failed to start:',error.message);
  process.exitCode=1;
});
let port=Number(process.env.PORT)||4173;
server.on('listening',()=>console.log(`Local site is ready at http://127.0.0.1:${port}/ (editor: /editor/) · press Ctrl+C to stop.`));
server.listen(port,'127.0.0.1');
