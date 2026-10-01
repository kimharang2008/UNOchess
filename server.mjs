import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createState } from './src/chess.js';
import { createDeck } from './src/uno.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const rooms = new Map();
const roomCode = () => {
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from(randomBytes(6),byte=>chars[byte%chars.length]).join('');
};
function encode(value) { return JSON.stringify(value, (_key,item) => item instanceof Set ? { __set: [...item] } : item); }
function decode(value) { return JSON.parse(value, (_key,item) => item && Array.isArray(item.__set) ? new Set(item.__set) : item); }
async function readJson(request) {
  let body=''; for await (const part of request) { body+=part; if(body.length>20_000_000) throw new Error('요청이 너무 큽니다.'); }
  return body ? JSON.parse(body) : {};
}
function sendJson(response,status,payload) { response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(encode(payload)); }

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) {
      if (request.method === 'POST' && pathname === '/api/rooms') {
        const body=await readJson(request), nickname=String(body.nickname||'').trim().slice(0,16);
        if(!nickname)return sendJson(response,400,{error:'닉네임을 입력하세요.'});
        let code;do{code=roomCode();}while(rooms.has(code));
        const playerId=randomUUID(),gameState=createState(createDeck());
        if(randomBytes(1)[0]%2){gameState.playerSides=['b','w'];gameState.turnPlayer=1;}
        const room={code,players:[{id:playerId,nickname,index:0}],state:gameState,history:[],initialSnapshot:null,seq:1};
        room.initialSnapshot=room.state;rooms.set(code,room);
        return sendJson(response,200,{code,playerId,playerIndex:0,side:room.state.playerSides[0],nickname,state:room.state,history:room.history,initialSnapshot:room.initialSnapshot,seq:room.seq,players:room.players});
      }
      const route=/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(state))?$/.exec(pathname);
      if(route){
        const room=rooms.get(route[1]);if(!room)return sendJson(response,404,{error:'방 코드를 찾을 수 없습니다.'});
        if(request.method==='POST'&&!route[2]){
          const body=await readJson(request),nickname=String(body.nickname||'').trim().slice(0,16);
          if(!nickname)return sendJson(response,400,{error:'닉네임을 입력하세요.'});
          if(room.players.length>=2)return sendJson(response,409,{error:'방이 이미 가득 찼습니다.'});
          if(room.players.some(player=>player.nickname.toLowerCase()===nickname.toLowerCase()))return sendJson(response,409,{error:'이미 사용 중인 닉네임입니다.'});
          const playerId=randomUUID(),player={id:playerId,nickname,index:1};room.players.push(player);room.seq++;
          return sendJson(response,200,{code:room.code,playerId,playerIndex:1,side:room.state.playerSides[1],nickname,state:room.state,history:room.history,initialSnapshot:room.initialSnapshot,seq:room.seq,players:room.players});
        }
        if(request.method==='GET'){
          const playerId=new URL(request.url,'http://localhost').searchParams.get('playerId');
          if(!room.players.some(player=>player.id===playerId))return sendJson(response,403,{error:'이 방의 참가자가 아닙니다.'});
          return sendJson(response,200,{state:room.state,history:room.history,initialSnapshot:room.initialSnapshot,seq:room.seq,players:room.players});
        }
        if(request.method==='POST'&&route[2]){
          const body=await readJson(request),player=room.players.find(item=>item.id===body.playerId);
          if(!player)return sendJson(response,403,{error:'이 방의 참가자가 아닙니다.'});
          if(!body.resetRoom&&room.state.turnPlayer!==player.index)return sendJson(response,409,{error:'상대의 차례입니다.'});
          if(body.resetRoom&&player.index!==0)return sendJson(response,403,{error:'방 호스트만 새 게임을 시작할 수 있습니다.'});
          room.state=body.state;room.history=body.history||room.history;room.initialSnapshot=body.initialSnapshot||room.initialSnapshot;room.seq++;
          return sendJson(response,200,{seq:room.seq});
        }
      }
      return sendJson(response,404,{error:'알 수 없는 API 요청입니다.'});
    }
    const requested = pathname === '/' ? '/index.html' : pathname;
    const filename = path.resolve(root, `.${requested}`);
    if (!filename.startsWith(`${root}${path.sep}`) && filename !== path.join(root, 'index.html')) {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    const content = await readFile(filename);
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

const port=Number(process.env.PORT)||4173;
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other server with Ctrl+C, or run with PORT=4174.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
server.listen(port, '127.0.0.1', () => console.log(`Uno Chess is running at http://127.0.0.1:${port}`));
