import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve('public'),editorRoot=resolve('private-editor');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:4173');
    const editor=url.pathname==='/editor'||url.pathname.startsWith('/editor/');
    const requestPath=editor?url.pathname.replace(/^\/editor\/?/,'/'):url.pathname;
    const pathname=decodeURIComponent(requestPath==='/'?(editor?'/admin.html':'/index.html'):requestPath);
    const base=editor?editorRoot:root;
    const file=resolve(base,'.'+pathname);
    if(file!==base&&!file.startsWith(base+sep)){res.writeHead(404).end();return;}
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}).end(body);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Not found');}
});
server.on('error',error=>{
  if(error.code==='EADDRINUSE')console.error('Port 4173 is already in use. Close the other site preview server or change the port in server.mjs.');
  else console.error('Local site server failed to start:',error.message);
  process.exitCode=1;
});
server.listen(4173,'127.0.0.1',()=>console.log('Local site is ready at http://127.0.0.1:4173/ (editor: /editor/) · press Ctrl+C to stop.'));
