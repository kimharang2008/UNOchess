import {
  BLACK, WHITE, SYMBOLS, PIECE_NAMES, applyMove, cloneState, colorOf, createState,
  currentSide, inCheck, isCheckmated, isFirstTurnForSide, legalMoves, nameOf, opposite,
  resurrectionSquares, revive, squareName, transform, pseudoMoves,
} from './chess.js';
import { createDeck, drawCard, resolveCard } from './uno.js';

const $ = selector => document.querySelector(selector);
const boardEl = $('#board'), turnBadge = $('#turnBadge'), statusText = $('#statusText');
const actionText = $('#actionText'), cardDisplay = $('#cardDisplay');
const graveCount = $('#graveCount'), graveList = $('#graveList'), drawButton = $('#drawButton');
const newGameButton = $('#newGameButton'), dialog = $('#choiceDialog');
const dialogTitle = $('#dialogTitle'), dialogHelp = $('#dialogHelp'), dialogChoices = $('#dialogChoices');
const cancelChoice = $('#cancelChoice'), closeChoice = $('#closeChoice');
const endDialog = $('#endDialog'), reviewMoves = $('#reviewMoves'), reviewPanel = $('#reviewPanel');
const reviewPosition = $('#reviewPosition'), previousReview = $('#previousReview'), nextReview = $('#nextReview');
const appElement = $('.app'), exitScreen = $('#exitScreen'), sidePanel = $('#sidePanel');
let state = createState(createDeck()), selection = null, selectedMoves = [];
let moveHistory = [], reviewIndex = null, reviewing = false, initialSnapshot = cloneState(state), pendingPromotionCard = null, turnStartSnapshot = null, turnStartHistoryIndex = 0;
let gameStarted=false, gameMode='offline', localPlayerId=null, localPlayerIndex=null, roomCode=null, roomPlayers=[], remoteSeq=0, pollTimer=null, syncTimer=null, lastLocalActor=null, onlineResetPending=false, hostLobby=null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function deserialize(value) {
  return JSON.parse(value, (_key,item)=>item&&Array.isArray(item.__set)?new Set(item.__set):item);
}
function rehydrate(value) { return deserialize(JSON.stringify(value)); }

function onlineCanAct() { return gameMode !== 'online' || roomPlayers.length===2 && localPlayerIndex === state.turnPlayer; }

function scheduleOnlineSync() {
  if(gameMode!=='online'||!localPlayerId||lastLocalActor!==localPlayerIndex)return;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(async()=>{
    try{
      const response=await fetch(`/api/rooms/${roomCode}/state`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId:localPlayerId,state,history:moveHistory,initialSnapshot,actorPlayer:localPlayerIndex,resetRoom:onlineResetPending},(_key,item)=>item instanceof Set?{__set:[...item]}:item)});
      const data=await response.json();if(response.ok){remoteSeq=Math.max(remoteSeq,data.seq);onlineResetPending=false;if(state.turnPlayer!==localPlayerIndex)lastLocalActor=null;}
    }catch(error){console.error('Online sync failed',error);}
  },80);
}

function syncRoomBadge() {
  const badge=$('#onlineRoomBadge');if(gameMode!=='online'){badge.hidden=true;return;}
  badge.hidden=false;
  const roleNames=roomPlayers.map(player=>`${player.nickname}(${sideName(state.playerSides[player.index])})`).join(' vs ');
  badge.textContent=`방 코드 ${roomCode} · ${roleNames||names}${roomPlayers.length<2?' · 참가자를 기다리는 중':''}`;
}

function startLocalGame(mode) {
  clearInterval(pollTimer);hostLobby=null;gameStarted=true;gameMode=mode;localPlayerId=null;localPlayerIndex=null;roomCode=null;roomPlayers=[];remoteSeq=0;
  state=createState(createDeck());selection=null;selectedMoves=[];moveHistory=[];reviewIndex=null;reviewing=false;pendingPromotionCard=null;
  initialSnapshot=cloneState(state);$('#startScreen').hidden=true;appElement.hidden=false;window.scrollTo(0,0);syncRoomBadge();render();
}

function startOnlineGame(room) {
  clearInterval(pollTimer);hostLobby=null;gameStarted=true;gameMode='online';localPlayerId=room.playerId;localPlayerIndex=room.playerIndex;roomCode=room.code;roomPlayers=room.players;remoteSeq=room.seq;
  state=rehydrate(room.state);moveHistory=rehydrate(room.history||[]);initialSnapshot=room.initialSnapshot?rehydrate(room.initialSnapshot):cloneState(state);selection=null;selectedMoves=[];reviewing=false;pendingPromotionCard=null;
  $('#startScreen').hidden=true;appElement.hidden=false;syncRoomBadge();render();
  pollTimer=setInterval(pollRoom,700);
}

function waitInHostLobby(room) {
  clearInterval(pollTimer);
  hostLobby=room;gameMode='online';localPlayerId=room.playerId;localPlayerIndex=room.playerIndex;roomCode=room.code;roomPlayers=room.players;remoteSeq=room.seq;
  $('#startModeButtons').hidden=true;$('#onlineSetup').hidden=true;$('#onlineLobby').hidden=false;
  $('#lobbyRoomCode').textContent=room.code;
  $('#lobbyWaitMessage').textContent='다른 플레이어가 방 코드로 참가하기를 기다리는 중입니다.';
  pollTimer=setInterval(pollHostLobby,700);
}

async function pollHostLobby() {
  if(!hostLobby)return;
  try{
    const waitingRoom=hostLobby;
    const response=await fetch(`/api/rooms/${waitingRoom.code}?playerId=${encodeURIComponent(waitingRoom.playerId)}`);
    const data=await response.json();if(!response.ok)return;
    if(hostLobby!==waitingRoom)return;
    roomPlayers=data.players||[];
    if(roomPlayers.length>=2){
      hostLobby=null;clearInterval(pollTimer);
      startOnlineGame({...data,code:waitingRoom.code,playerId:waitingRoom.playerId,playerIndex:waitingRoom.playerIndex});
    }
  }catch(error){console.error('Room lobby polling failed',error);}
}

async function pollRoom() {
  if(gameMode!=='online'||!roomCode)return;
  try{
    const response=await fetch(`/api/rooms/${roomCode}?playerId=${encodeURIComponent(localPlayerId)}`);const data=await response.json();if(!response.ok)return;
    roomPlayers=data.players;syncRoomBadge();
    // Remote busy states are expected while the other player draws or resolves a card.
    // Do not let that replicated flag block the final turn update from arriving.
    if(data.seq>remoteSeq&&lastLocalActor!==localPlayerIndex){
      state=rehydrate(data.state);moveHistory=rehydrate(data.history||[]);initialSnapshot=data.initialSnapshot?rehydrate(data.initialSnapshot):initialSnapshot;remoteSeq=data.seq;selection=null;selectedMoves=[];render();
    }
  }catch(error){console.error('Online polling failed',error);}
}
const AUGMENTS = [
  { name: '체크메이트의 거신병', description: '내 폰 4개, 나이트 2개, 룩과 비숍을 하나씩 바쳐 체력 3의 거신병을 소환합니다.' },
  { name: '좀비사태!!!!', description: '앞으로 3번, 내 기물이 상대 기물을 잡으면 주변의 상대 기물 하나를 내 편으로 만듭니다.' },
  { name: '승급 중독자', description: '앞으로 3번 폰을 승급할 때 같은 기물 2개를 추가로 소환합니다.' },
  { name: '복수는 복수를 낳지....', description: '5턴 동안 내 기물이 잡히면 상대에게 보복 공격을 시도합니다.' },
  { name: '우리 애는 왕의 DNA가 흘러요!', description: '내 킹 주변에 있는 내 기물은 상대에게 잡히지 않습니다.' },
  { name: '그대들이 내 방패라네!', description: '3회 동안 내 기물이 잡힐 때 같은 종류의 아군 기물을 대신 희생해 보호합니다.' },
  { name: 'ㅊ...최악의 ㅈㅣㄹ병 5위 알츠...뭐더라?', description: '상대 기물은 3턴 동안 내 기물을 잡을 수 없습니다.' },
  { name: '시간을 되돌리는 힘!', description: '상대의 다음 턴이 끝난 뒤, 이번 턴 시작 시점으로 되돌릴 수 있습니다.' },
  { name: '함정카드', description: '상대 기물 하나에 함정을 설치합니다. 발동하면 상대의 행동을 3턴 막습니다.' },
  { name: '체스 처음 해봄', description: '5턴 동안 내 폰이 뒤로도 움직일 수 있습니다.' },
  { name: '미안하오 영감, 이 검은 뽑지 않기로 했는데.....', description: '내 기물 하나를 골라 2턴 뒤 같은 줄의 기물들을 모두 베어냅니다.' },
  { name: '나만 아니면 돼~', description: '보드의 기물 10개를 무작위로 제거합니다. 상대 기물이 제거될 확률이 더 높습니다.' },
  { name: '훗 그건 제 잔상입니다만?', description: '3턴 동안 내 기물이 떠난 자리에 잔상을 남겨, 그곳에 들어온 상대 기물을 제거합니다.' },
  { name: '절호의 찬스잖아요~!!', description: '한 줄을 골라 그 줄에 있는 내 기물을 모두 퀸으로 승급시킵니다.' },
];

function chooseRandomAugments(count = 3) {
  const choices = AUGMENTS.slice();
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices.slice(0, count);
}

function putAugmentPiece(piece, pos) {
  const [r,c] = pos; state.board[r][c] = piece; state.ids[r][c] = state.nextId++;
}

function announceAugment(message) {
  const overlay=$('#augmentAnnouncement');overlay.textContent=message;overlay.hidden=false;
  setTimeout(()=>{overlay.hidden=true;},1500);
}

async function activateAugment(name, side) {
  const a = state.augments, enemy = opposite(side);
  if (name === '체크메이트의 거신병') {
    const costs = [['p',4],['n',2],['r',1],['b',1]], removals = [];
    for (const [kind, count] of costs) {
      const found = [];
      for (let r=0;r<8 && found.length<count;r++) for (let c=0;c<8 && found.length<count;c++) if (state.board[r][c] !== '.' && colorOf(state.board[r][c]) === side && state.board[r][c].toLowerCase() === kind) found.push([r,c]);
      if (found.length < count) { state.notice = '거신병 소환에는 폰 4, 나이트 2, 룩 1, 비숍 1개가 필요합니다.'; return false; }
      removals.push(...found);
    }
    if (!resurrectionSquares(state, side).length) { state.notice = '자기 진영에 거신병을 소환할 빈칸이 없습니다.'; return false; }
    for (const [r,c] of removals) {
      const rightBySquare={'7,7':'K','7,0':'Q','0,7':'k','0,0':'q'},right=rightBySquare[`${r},${c}`];if(right)state.castling.delete(right);
      state.graveyard.push(state.board[r][c].toLowerCase()); state.board[r][c]='.'; state.ids[r][c]=null;
    }
    state.pendingGiantSummon = { side, squares: resurrectionSquares(state, side) };
    state.notice = '체크메이트의 거신병 소환! 체력 3';
  } else if (name === '좀비사태!!!!') { a.zombie[side] = 3; state.notice = '좀비사태!!!! 3회 발동 준비!'; }
  else if (name === '승급 중독자') { a.promotionAddict[side] = 3; state.notice = '승급 중독자 효과가 3회 남았습니다.'; }
  else if (name === '복수는 복수를 낳지....') { a.revenge[side] = 5; state.notice = '복수 효과가 5턴 지속됩니다.'; }
  else if (name === '우리 애는 왕의 DNA가 흘러요!') { a.kingDna[side] = true; state.notice = '킹 주변의 내 기물은 잡히지 않습니다.'; }
  else if (name === '그대들이 내 방패라네!') { a.shield[side] = 3; state.notice = '방패 효과가 3회 남았습니다.'; }
  else if (name === 'ㅊ...최악의 ㅈㅣㄹ병 5위 알츠...뭐더라?') { a.alz[side] = 3; state.notice = '상대 기물은 3턴 동안 내 기물을 잡을 수 없습니다.'; }
  else if (name === '시간을 되돌리는 힘!') { a.rewind[side] = { ready: true, player:state.turnPlayer, snapshot: cloneState(turnStartSnapshot || state), historyIndex: turnStartHistoryIndex }; state.notice = '되감기 효과를 다음 상대 턴이 끝난 뒤 사용할 수 있습니다.'; }
  else if (name === '함정카드') {
    const ids=[]; for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(state.board[r][c]!=='.' && colorOf(state.board[r][c])===enemy && state.board[r][c].toLowerCase()!=='k') ids.push(state.ids[r][c]);
    if(ids.length) a.traps[ids[Math.floor(Math.random()*ids.length)]]={owner:side,moves:0};
    state.notice = ids.length ? '함정카드가 상대 기물 하나에 설치되었습니다.' : '설치할 상대 기물이 없습니다.';
  }
  else if (name === '체스 처음 해봄') { a.beginner[side]=5; state.notice='폰이 5턴 동안 뒤로도 움직일 수 있습니다.'; }
  else if (name === '미안하오 영감, 이 검은 뽑지 않기로 했는데.....') {
    const pieces=[]; for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(state.board[r][c]!=='.' && colorOf(state.board[r][c])===side && state.board[r][c].toLowerCase()!=='k') pieces.push({value:`${r},${c}`,label:`${SYMBOLS[state.board[r][c]]} ${nameOf(state.board[r][c])} ${squareName([r,c])}`});
    if (!pieces.length) { state.notice='지정할 기물이 없습니다.'; return false; }
    const picked=await showChoice('검을 지킬 기물 선택','현재 차례와 다음 차례까지 살아남으면 같은 줄의 기물을 베어냅니다.',pieces,false);
    const [sr,sc]=picked.split(',').map(Number); a.sword[side]={id:state.ids[sr][sc],turns:2}; state.notice='울어라 지옥참마도! 생존 조건이 시작되었습니다.';
  }
  else if (name === '나만 아니면 돼~') {
    const pool=[]; for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(state.board[r][c]!=='.' && state.board[r][c].toLowerCase()!=='k') pool.push([r,c]);
    for(let i=0;i<10 && pool.length;i++) {
      const chooseOwn=Math.random()<.2, preferred=pool.filter(([r,c])=>colorOf(state.board[r][c])===(chooseOwn?side:enemy));
      const options=preferred.length?preferred:pool, pos=options[Math.floor(Math.random()*options.length)], [r,c]=pos;
      state.graveyard.push(state.board[r][c].toLowerCase()); state.board[r][c]='.'; state.ids[r][c]=null; pool.splice(pool.findIndex(p=>p[0]===r&&p[1]===c),1);
    }
    state.notice='나만 아니면 돼~! 기물 10개가 무작위로 제거되었습니다.';
  }
  else if (name === '훗 그건 제 잔상입니다만?') { a.afterimage[side]=3; state.notice='잔상이 3턴 동안 남습니다.'; }
  else if (name === '절호의 찬스잖아요~!!') {
    const rank=await showChoice('승급할 줄 선택','선택한 줄의 내 기물을 모두 퀸으로 바꿉니다.',Array.from({length:8},(_,r)=>({value:r,label:`${8-r}번째 줄`})),false);
    let changed=0; for(let c=0;c<8;c++){const p=state.board[rank][c];if(p!=='.'&&colorOf(p)===side&&p.toLowerCase()!=='k'){state.board[rank][c]=side===WHITE?'Q':'q';changed++;}}
    const checks=legalMoves(state,side).filter(move=>{const copy=cloneState(state);applyMove(copy,move,{recordCapture:false});return inCheck(copy,enemy);});
    if(checks.length){const move=checks[Math.floor(Math.random()*checks.length)];applyMove(state,move,{markMoved:true});state.notice=`절호의 찬스! ${changed}개 승급 후 무작위 체크 수를 두었습니다.`;}else state.notice=`${changed}개 승급했지만 체크 수를 찾지 못했습니다.`;
  }
  return true;
}

function showChoice(title, help, options, allowCancel = true) {
  return new Promise(resolve => {
    dialogTitle.textContent = title; dialogHelp.textContent = help; dialogChoices.replaceChildren();
    cancelChoice.hidden = !allowCancel;
    closeChoice.hidden = !allowCancel;
    let settled = false;
    const finish = value => { if (!settled) { settled = true; dialog.close(); resolve(value); } };
    const hasDescriptions = options.some(option => option.description);
    dialog.classList.toggle('augment-selection', hasDescriptions);
    options.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `choice-button${option.description ? ' augment-choice' : ''}`;
      if (option.description) {
        const title = document.createElement('strong'); title.textContent = option.label;
        const description = document.createElement('span'); description.textContent = option.description;
        button.append(title, description);
      } else button.textContent = option.label;
      button.disabled = !!option.disabled; button.addEventListener('click', () => finish(option.value));
      dialogChoices.append(button);
    });
    cancelChoice.onclick = event => { event.preventDefault(); finish(null); };
    closeChoice.onclick = event => { event.preventDefault(); finish(null); };
    dialog.oncancel = event => { event.preventDefault(); if (allowCancel) finish(null); };
    dialog.showModal();
  });
}

function sideName(side) { return side === WHITE ? '백' : '흑'; }
function turnLabel(player = state.turnPlayer, side = currentSide(state)) { return `플레이어${player + 1}(${sideName(side)})의 차례`; }
function checkmateSides(game = state) { return [WHITE, BLACK].filter(side => isCheckmated(game, side)); }
function rendersAsPiece(piece, checked, mated) {
  if (piece === '.') return '';
  const side = colorOf(piece);
  const kingClass = piece.toLowerCase() === 'k' ? (mated.includes(side) ? 'checkmated' : checked.includes(side) ? 'in-check' : '') : '';
  if (piece.toLowerCase() === 'a') return '<img class="piece giant-piece ' + (side === WHITE ? 'white' : 'black') + '" src="assets/giant-' + (side === WHITE ? 'white' : 'black') + '.svg" alt="체크메이트의 거신병">';
  return `<span class="piece ${side === WHITE ? 'white' : 'black'} ${kingClass}">${SYMBOLS[piece]}</span>`;
}

function renderBoard() {
  const boardState = !reviewing ? state : reviewIndex < 0 ? initialSnapshot : moveHistory[reviewIndex].snapshot;
  const mated = checkmateSides(boardState), checked = [WHITE, BLACK].filter(side => inCheck(boardState, side));
  const moves = !reviewing && selection ? selectedMoves : [];
  const rotateForPlayer=gameMode==='online'&&localPlayerIndex!==null?state.playerSides[localPlayerIndex]===BLACK:!!boardState.boardRotated;
  boardEl.classList.toggle('board-rotated', rotateForPlayer);
  boardEl.replaceChildren();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const pos = [r, c], square = document.createElement('button'), piece = boardState.board[r][c];
    square.type = 'button'; square.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
    square.dataset.square = `${r},${c}`;
    if (piece.toLowerCase() === 'k' && checked.includes(colorOf(piece))) square.classList.add(mated.includes(colorOf(piece)) ? 'king-in-checkmate' : 'king-in-check');
    if (state.kingEscapeRequired?.pieceId === boardState.ids[r][c]) square.classList.add('king-escape-required');
    if (selection?.[0] === r && selection?.[1] === c) square.classList.add('selected');
    if (boardState.lastMove && [boardState.lastMove.from, boardState.lastMove.to].some(p => p[0] === r && p[1] === c)) square.classList.add('last-move');
    if (!reviewing && state.pendingTransform && piece !== '.' && colorOf(piece) === currentSide(state) && piece.toLowerCase() !== 'k') square.classList.add('transformable');
    if (!reviewing && state.pendingGiantSummon?.squares.some(target => target[0] === r && target[1] === c)) square.classList.add('giant-summon-target', state.pendingGiantSummon.side === WHITE ? 'revival-white' : 'revival-black');
    if (!reviewing && state.pendingRevival?.squares.some(target => target[0] === r && target[1] === c)) {
      square.classList.add('revival-target', currentSide(state) === WHITE ? 'revival-white' : 'revival-black');
    }
    const targetMove = moves.find(move => move.to[0] === r && move.to[1] === c);
    if (targetMove) square.classList.add(piece === '.' ? 'target' : piece.toLowerCase() === 'k' ? 'king-target' : 'capture-target');
    const rank = c === 0 ? `<span class="coord rank">${8-r}</span>` : '';
    const file = r === 7 ? `<span class="coord file">${'abcdefgh'[c]}</span>` : '';
    const kingStatus = piece.toLowerCase() === 'k' && checked.includes(colorOf(piece)) ? (mated.includes(colorOf(piece)) ? ', 체크메이트' : ', 체크') : '';
    square.setAttribute('aria-label', `${squareName(pos)}${piece === '.' ? ', 빈칸' : `, ${sideName(colorOf(piece))} ${nameOf(piece)}${kingStatus}`}`);
    const giantHp=piece.toLowerCase()==='a'?boardState.augments.giantHits?.[boardState.ids[r][c]]:null;
    square.innerHTML = `${rank}${rendersAsPiece(piece, checked, mated)}${giantHp?`<span class="giant-hp">${giantHp}</span>`:''}${file}`;
    square.addEventListener('click', () => onSquareClick(pos)); boardEl.append(square);
  }
}

function activeAugmentDetails(side) {
  const effects = state.augments || {}, details = [];
  const add = (name, description) => details.push(`${name}: ${description}`);
  if (effects.zombie?.[side] > 0) add('좀비사태', `상대 기물을 아군으로 바꾸는 효과 ${effects.zombie[side]}회 남음`);
  if (effects.promotionAddict?.[side] > 0) add('승급 중독자', `폰 승급 시 같은 기물 2개 추가 소환, ${effects.promotionAddict[side]}회 남음`);
  if (effects.revenge?.[side] > 0) add('복수는 복수를 낳지....', `${effects.revenge[side]}턴 동안 내 기물이 잡히면 보복 공격`);
  if (effects.kingDna?.[side]) add('우리 애는 왕의 DNA가 흘러요!', '킹 주변의 아군 기물이 잡히지 않음');
  if (effects.shield?.[side] > 0) add('그대들이 내 방패라네!', `같은 종류의 아군을 희생해 보호, ${effects.shield[side]}회 남음`);
  if (effects.alz?.[side] > 0) add('알츠하이머', `상대가 내 기물을 잡을 수 없음, ${effects.alz[side]}턴 남음`);
  if (effects.beginner?.[side] > 0) add('체스 처음 해봄', `폰이 뒤로도 이동 가능, ${effects.beginner[side]}턴 남음`);
  if (effects.afterimage?.[side] > 0) add('훗 그건 제 잔상입니다만?', `떠난 칸에 잔상을 남김, ${effects.afterimage[side]}턴 남음`);
  if (effects.rewind?.[side]?.ready) add('시간을 되돌리는 힘!', '상대 턴이 끝난 뒤 이번 턴 시작으로 되돌릴 수 있음');
  if (effects.skipTurns?.[side] > 0) add('함정카드', `행동 불가 효과 ${effects.skipTurns[side]}회 남음`);

  const traps = Object.entries(effects.traps || {}).filter(([, trap]) => trap?.owner === side);
  if (traps.length) add('함정카드', `상대 기물 ${traps.length}개에 함정 설치됨`);
  const sword = effects.sword?.[side];
  if (sword) {
    let position = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (state.ids[r][c] === sword.id) position = squareName([r, c]);
    add('미안하오 영감, 이 검은 뽑지 않기로 했는데.....', `${position ? `${position}의 기물` : '선택한 기물'}이 ${sword.turns}턴 뒤 같은 줄의 기물을 베어냄`);
  }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = state.board[r][c], id = state.ids[r][c];
    if (piece.toLowerCase() === 'a' && colorOf(piece) === side && effects.giantHits?.[id] > 0) {
      add('체크메이트의 거신병', `${squareName([r, c])}에 있음, 체력 ${effects.giantHits[id]}`);
    }
  }
  return details;
}

function render() {
  if(!gameStarted)return;
  const side = currentSide(state), mates = checkmateSides();
  const viewerSide = gameMode === 'online' && localPlayerIndex !== null ? state.playerSides[localPlayerIndex] : side;
  const opponentSide = opposite(viewerSide);
  const opponentDetails = activeAugmentDetails(opponentSide);
  if (state.pendingAugmentChoice && opponentSide === side && gameMode === 'online') opponentDetails.unshift('특수 증강을 선택 중입니다.');
  const opponentAugments = $('#opponentAugments');
  opponentAugments.hidden = opponentDetails.length === 0;
  $('#opponentAugmentTitle').textContent = `상대 증강 발동 중 · ${sideName(opponentSide)}`;
  $('#opponentAugmentList').replaceChildren(...opponentDetails.map(detail => {
    const item = document.createElement('li'); item.textContent = detail; return item;
  }));
  document.body.dataset.turnSide = side === WHITE ? 'white' : 'black';
  const activePlayer=roomPlayers.find(player=>player.index===state.turnPlayer)?.nickname;
  turnBadge.textContent = state.winner === null ? gameMode==='online'&&activePlayer?`${activePlayer}(${sideName(side)})의 차례`:turnLabel() : `플레이어${state.winner + 1} 승리`;
  graveCount.textContent = `${state.graveyard.length}개`;
  const counts = Object.fromEntries('pnbrqka'.split('').map(kind => [kind, state.graveyard.filter(piece => piece.toLowerCase() === kind).length]));
  graveList.textContent = `폰×${counts.p} · 나이트×${counts.n} · 비숍×${counts.b} · 룩×${counts.r} · 퀸×${counts.q} · 킹×${counts.k} · 거신병×${counts.a}`;
  drawButton.disabled = state.busy || state.winner !== null || state.actionsLeft > 0 || state.pendingTransform || state.pendingRevival || !onlineCanAct();
  const rewindSide=state.augments.rewind && Object.keys(state.augments.rewind).find(s=>state.augments.rewind[s]?.ready&&state.augments.rewind[s].player===state.turnPlayer);
  $('#rewindButton').hidden=!rewindSide||state.busy||reviewing;
  newGameButton.disabled = state.busy || gameMode==='online'&&localPlayerIndex!==0;
  $('#newGameFromEnd').disabled=gameMode==='online'&&localPlayerIndex!==0;
  const checked = [WHITE, BLACK].filter(checkedSide => inCheck(state, checkedSide));
  const checkMessage = mates.length
    ? `${mates.map(checkedSide => `플레이어${state.playerSides.indexOf(checkedSide) + 1}(${sideName(checkedSide)})`).join(' · ')} 체크메이트! 킹을 잡아야 승리합니다.`
    : checked.length
      ? `${checked.map(checkedSide => `플레이어${state.playerSides.indexOf(checkedSide) + 1}(${sideName(checkedSide)})`).join(' · ')} 체크!`
      : '';
  if (state.winner !== null) {
    statusText.textContent = `플레이어${state.winner + 1}이 상대 킹을 직접 잡았습니다.`;
    $('#endTitle').textContent = `플레이어${state.winner + 1} 승리`;
    $('#endMessage').textContent = `${turnLabel(state.winner, state.playerSides[state.winner])} — 상대 킹을 잡아 게임이 끝났습니다.`;
  }
  else if(gameMode==='online'&&roomPlayers.length<2)statusText.textContent='상대 플레이어가 방에 참가할 때까지 기다려 주세요.';
  else if(state.pendingAugmentChoice&&gameMode==='online'&&localPlayerIndex!==state.turnPlayer){
    const chooser=roomPlayers.find(player=>player.index===state.turnPlayer)?.nickname||`플레이어${state.turnPlayer+1}`;
    statusText.textContent=`${chooser}님이 특수 증강을 선택 중입니다.`;
  }
  else if (checkMessage) statusText.textContent = state.notice ? `${checkMessage} ${state.notice}` : checkMessage;
  else if (state.notice) statusText.textContent = state.notice;
  else statusText.textContent = `${turnLabel()}입니다.`;
  const active=[];const effects=state.augments;
  if(effects.zombie[side]>0)active.push(`좀비 ${effects.zombie[side]}회`);if(effects.promotionAddict[side]>0)active.push(`승급 중독 ${effects.promotionAddict[side]}회`);
  if(effects.revenge[side]>0)active.push(`복수 ${effects.revenge[side]}턴`);if(effects.kingDna[side])active.push('왕의 DNA');if(effects.shield[side]>0)active.push(`방패 ${effects.shield[side]}회`);
  if(effects.beginner[side]>0)active.push(`후진 폰 ${effects.beginner[side]}턴`);if(effects.afterimage[side]>0)active.push(`잔상 ${effects.afterimage[side]}턴`);if(effects.alz[side]>0)active.push(`알츠하이머 ${effects.alz[side]}턴`);
  actionText.textContent = (state.kingEscapeRequired ? '킹이 적 킹의 범위에 있습니다. 다음 행동에는 범위 밖으로 이동해야 합니다.' : state.pendingTransform ? '보드에서 승급할 내 기물을 선택하세요.' : state.pendingRevival ? '보드에서 부활 위치를 선택하세요.' : state.actionsLeft > 0 ? `남은 턴 ${state.actionsLeft}회` : '카드를 뽑아 턴을 시작하세요.') + (active.length?` · 활성: ${active.join(', ')}`:'');
  cardDisplay.className = `draw-card ${state.card ? (/^\d$/.test(state.card) ? 'uno-number' : 'uno-special') : 'empty-card'} ${state.cardAnimating ? 'dealing' : ''}`;
  cardDisplay.textContent = state.card || '카드를 뽑아 시작하세요';
  renderBoard();
  syncRoomBadge();scheduleOnlineSync();
  if (state.winner !== null && !endDialog.open) endDialog.showModal();
}

async function finishTransform(pos) {
  const side = currentSide(state), oldPiece = state.board[pos[0]][pos[1]];
  const kinds = ['q', 'r', 'b', 'n', 'p'].filter(kind => {
    const trial = cloneState(state); trial.board[pos[0]][pos[1]] = side === WHITE ? kind.toUpperCase() : kind;
    return !isFirstTurnForSide(state, side) || (!inCheck(trial, WHITE) && !inCheck(trial, BLACK));
  });
  if (!kinds.length) { state.notice = '규칙에 맞게 바꿀 수 있는 기물이 없습니다.'; render(); return; }
  const target = await showChoice('승급할 기물 선택', `${squareName(pos)}의 ${nameOf(oldPiece)}을(를) 무엇으로 바꿀까요?`, kinds.map(kind => ({ value: kind, label: `${SYMBOLS[side === WHITE ? kind.toUpperCase() : kind]} ${nameOf(kind)}` })));
  if (target === null) return;
  if (!transform(state, pos, target)) { state.notice = '기물 승급을 완료할 수 없습니다.'; render(); return; }
  if (pendingPromotionCard) {
    pendingPromotionCard.snapshot = cloneState(state);
    pendingPromotionCard.description += ` · ${SYMBOLS[side === WHITE ? target.toUpperCase() : target]} ${nameOf(target)}로 승급`;
    pendingPromotionCard.notation += `→${target.toUpperCase()}`;
    pendingPromotionCard = null;
  }
  state.pendingTransform = false; state.notice = `${nameOf(oldPiece)}을(를) ${nameOf(target)}(으)로 승급했습니다.`;
  selection = null; selectedMoves = []; render();
}

async function onSquareClick(pos) {
  if (state.winner !== null || reviewing || !onlineCanAct()) return;
  if (state.pendingGiantSummon) {
    const pending = state.pendingGiantSummon;
    if (pending.squares.some(target => target[0] === pos[0] && target[1] === pos[1]) && state.board[pos[0]][pos[1]] === '.') {
      const giant = pending.side === WHITE ? 'A' : 'a';
      putAugmentPiece(giant, pos);
      state.augments.giantHits[state.ids[pos[0]][pos[1]]] = 3;
      state.pendingGiantSummon = null;
      state.notice = '체크메이트의 거신병을 ' + squareName(pos) + '에 소환했습니다. 체력 3';
      render();
    }
    return;
  }
  if (state.pendingRevival) {
    if (state.pendingRevival.squares.some(target => target[0] === pos[0] && target[1] === pos[1])) {
      const { graveIndex, squareResolver } = state.pendingRevival;
      const revived = revive(state, graveIndex, pos);
      state.pendingRevival = null; state.notice = '';
      render(); squareResolver(revived);
    }
    return;
  }
  if (state.busy) return;
  if (state.pendingTransform) {
    const piece = state.board[pos[0]][pos[1]];
    if (piece !== '.' && colorOf(piece) === currentSide(state) && piece.toLowerCase() !== 'k') await finishTransform(pos);
    return;
  }
  if (state.actionsLeft <= 0) return;
  const side = currentSide(state), piece = state.board[pos[0]][pos[1]];
  if (selection) {
    const move = selectedMoves.find(item => item.to[0] === pos[0] && item.to[1] === pos[1]);
    if (move) { await playMove(move); return; }
  }
  if (piece !== '.' && colorOf(piece) === side) {
    selection = pos; selectedMoves = legalMoves(state, side).filter(move => move.from[0] === pos[0] && move.from[1] === pos[1]);
  } else { selection = null; selectedMoves = []; }
  render();
}

function prepareRecruitedPiece(game, pos, side) {
  const [r, c] = pos, piece = game.board[r][c], kind = piece.toLowerCase(), id = game.ids[r][c];
  game.board[r][c] = side === WHITE ? piece.toUpperCase() : piece.toLowerCase();
  if (id !== null && id !== undefined) game.moved.delete(id);
  if (kind === 'p') {
    game.enPassant = null;
    if ((side === WHITE && r === 0) || (side === BLACK && r === 7)) game.board[r][c] = side === WHITE ? 'Q' : 'q';
  }
}

function canUseRecruitedPiece(pos, side) {
  const game = cloneState(state), [r, c] = pos, id = game.ids[r][c];
  prepareRecruitedPiece(game, pos, side);
  return legalMoves(game, side).some(move => move.from[0] === r && move.from[1] === c && game.ids[move.from[0]][move.from[1]] === id);
}

function handleMoveAugments(movingSide, movingPiece, movingId, from, to, captured) {
  const a=state.augments, [tr,tc]=to, [fr,fc]=from;
  const kind=captured&&captured!=='.'?captured.toLowerCase():null;
  if (captured && captured !== '.') {
    const targetSide=opposite(movingSide);
    if (a.shield[targetSide]>0 && kind!=='k') {
      let sacrifice=null;
      for(let r=0;r<8&&!sacrifice;r++)for(let c=0;c<8&&!sacrifice;c++)if(state.board[r][c]!=='.'&&colorOf(state.board[r][c])===movingSide&&state.board[r][c].toLowerCase()===kind&&state.ids[r][c]!==movingId)sacrifice=[r,c];
      if(sacrifice){
        const [sr,sc]=sacrifice;state.graveyard.pop();state.graveyard.push(state.board[sr][sc].toLowerCase());state.board[sr][sc]='.';state.ids[sr][sc]=null;
        state.board[tr][tc]=captured;state.ids[tr][tc]=state.nextId++;state.board[fr][fc]=movingPiece;state.ids[fr][fc]=movingId;
        a.shield[targetSide]--;state.notice='그대들이 내 방패라네! 같은 기물을 희생해 기물을 지켰습니다.';return {saved:true};
      }
    }
    if(a.zombie[movingSide]>0){
      const nearby=[];for(let r=Math.max(0,tr-1);r<=Math.min(7,tr+1);r++)for(let c=Math.max(0,tc-1);c<=Math.min(7,tc+1);c++)if(state.board[r][c]!=='.'&&colorOf(state.board[r][c])===targetSide&&state.board[r][c].toLowerCase()!=='k'&&canUseRecruitedPiece([r,c],movingSide))nearby.push([r,c]);
      if(nearby.length){const [r,c]=nearby[Math.floor(Math.random()*nearby.length)];prepareRecruitedPiece(state,[r,c],movingSide);a.zombie[movingSide]--;state.notice='좀비사태!!!! 상대 기물이 아군이 되었습니다. 이제 해당 기물을 사용할 수 있습니다.';}
    }
  }
  const trap=a.traps[movingId];
  if(trap){trap.moves++;if(trap.moves>=2||(captured&&captured!=='.')){const victimSide=opposite(trap.owner);a.skipTurns[victimSide]=(a.skipTurns[victimSide]||0)+3;delete a.traps[movingId];state.notice='함정카드 발동! 상대는 3턴 동안 행동할 수 없습니다.';announceAugment('함정카드 발동!');}}
  if(a.afterimage[movingSide]>0)a.ghosts.push({r:fr,c:fc,owner:movingSide});
  const ghostIndex=a.ghosts.findIndex(ghost=>ghost.r===tr&&ghost.c===tc&&ghost.owner!==movingSide);
  if(ghostIndex>=0){state.graveyard.push(movingPiece.toLowerCase());state.board[tr][tc]='.';state.ids[tr][tc]=null;a.ghosts.splice(ghostIndex,1);state.notice='훗 그건 제 잔상입니다만? 기물이 잔상에 걸려 사라졌습니다.';}
  if(captured&&captured!=='.'&&a.revenge[opposite(movingSide)]>0&&kind!=='k'){
    const targetSide=opposite(movingSide);
    const retaliation=legalMoves(state,targetSide).find(move=>move.to[0]===tr&&move.to[1]===tc&&state.board[move.to[0]][move.to[1]].toLowerCase()!=='k');
    if(retaliation){applyMove(state,retaliation,{markMoved:true});state.notice='복수는 복수를 낳지.... 즉시 반격했습니다.';}
  }
  return {saved:false};
}

function resolveGiantAuras() {
  for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(state.board[r][c].toLowerCase()==='a'){
    for(let rr=Math.max(0,r-1);rr<=Math.min(7,r+1);rr++)for(let cc=Math.max(0,c-1);cc<=Math.min(7,c+1);cc++){
      const piece=state.board[rr][cc];if(piece==='.'||piece.toLowerCase()==='a')continue;
      if(piece.toLowerCase()==='k'){
        const kingId=state.ids[rr][cc],previous=state.augments.kingPrevious[kingId];
        if(previous){
          const displaced=state.board[previous[0]][previous[1]];
          if(displaced!=='.'&&displaced.toLowerCase()!=='k'){state.graveyard.push(displaced.toLowerCase());state.board[previous[0]][previous[1]]='.';state.ids[previous[0]][previous[1]]=null;}
          if(state.board[previous[0]][previous[1]]==='.'){
            state.board[rr][cc]='.';state.ids[rr][cc]=null;state.board[previous[0]][previous[1]]=piece;state.ids[previous[0]][previous[1]]=kingId;
          }
        }
      }else{state.graveyard.push(piece.toLowerCase());state.board[rr][cc]='.';state.ids[rr][cc]=null;}
    }
  }
}

async function playMove(move) {
  const player = state.turnPlayer, side = currentSide(state);
  if(gameMode==='online'&&player===localPlayerIndex)lastLocalActor=localPlayerIndex;
  const piece = state.board[move.from[0]][move.from[1]];
  const promotionRank=side===WHITE?0:7;
  if (piece.toLowerCase() === 'p' && (move.to[0]===promotionRank || state.augments.beginner[side]>0&&[0,7].includes(move.to[0]))) {
    const choice = await showChoice('폰 승급', '승급할 기물을 선택하세요.', ['q','r','b','n'].map(kind => ({ value: kind, label: `${SYMBOLS[side === WHITE ? kind.toUpperCase() : kind]} ${nameOf(kind)}` })));
    if (!choice) return; move.promotion = choice;
  }
  const movingId=state.ids[move.from[0]][move.from[1]], from=move.from.slice(), to=move.to.slice();
  const { captured, giantHit } = applyMove(state, move, { markMoved: true });
  const augmentResult=giantHit?{saved:false}:handleMoveAugments(side,piece,movingId,from,to,captured);
  selection = null; selectedMoves = [];
  if(move.promotion&&state.augments.promotionAddict[side]>0){
    const kind=state.board[to[0]][to[1]].toLowerCase();let made=0;
    for(let r=Math.max(0,to[0]-1);r<=Math.min(7,to[0]+1)&&made<2;r++)for(let c=Math.max(0,to[1]-1);c<=Math.min(7,to[1]+1)&&made<2;c++)if(state.board[r][c]==='.'&&(r!==to[0]||c!==to[1])){putAugmentPiece(side===WHITE?kind.toUpperCase():kind,[r,c]);made++;}
    state.augments.promotionAddict[side]--;state.notice=`승급 중독자! 같은 기물 ${made}개를 추가 소환했습니다.`;
  }
  const promotionNote = move.promotion ? ` → ${nameOf(move.promotion)}` : '';
  const captureNote = captured && captured !== '.' ? ` × ${nameOf(captured)}` : '';
  const description = `플레이어${player + 1}(${sideName(side)}) ${nameOf(piece)} ${squareName(move.from)} → ${squareName(move.to)}${promotionNote}${captureNote}`;
  moveHistory.push({ description, notation: `${squareName(move.from)}${captured && captured !== '.' ? '×' : '–'}${squareName(move.to)}${move.promotion ? `=${move.promotion.toUpperCase()}` : ''}`, player, side, from: squareName(move.from), to: squareName(move.to), snapshot: cloneState(state) });
  if (captured?.toLowerCase() === 'k' && !giantHit) { state.winner = player; state.actionsLeft = 0; state.notice = ''; render(); return; }
  if (giantHit && piece.toLowerCase()==='k') { state.winner=1-player;state.actionsLeft=0;state.notice='거신병이 공격한 킹을 쓰러뜨렸습니다.';render();return; }
  state.actionsLeft--; state.notice = ''; render();
  if (state.actionsLeft <= 0 || legalMoves(state, currentSide(state)).length === 0) finishTurn(player, side);
}

function finishTurn(player, actingSide) {
  state.actionsLeft = 0; state.pendingTransform = false; state.firstTurn = false; state.firstTurns?.delete(actingSide);
  const a=state.augments;
  resolveGiantAuras();
  if(a.beginner[actingSide]>0 && --a.beginner[actingSide]===0) delete a.beginner[actingSide];
  if(a.revenge[actingSide]>0 && --a.revenge[actingSide]===0) delete a.revenge[actingSide];
  if(a.afterimage[actingSide]>0 && --a.afterimage[actingSide]===0) { delete a.afterimage[actingSide]; a.ghosts=a.ghosts.filter(ghost=>ghost.owner!==actingSide); }
  const alzSide=opposite(actingSide);if(a.alz[alzSide]>0 && --a.alz[alzSide]===0) delete a.alz[alzSide];
  const sword=a.sword[actingSide];
  if(sword){
    const found=state.ids.some(row=>row.includes(sword.id));
    if(!found) delete a.sword[actingSide];
    else if(--sword.turns<=0){
      let origin=null;for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(state.ids[r][c]===sword.id)origin=[r,c];
      if(origin)for(let r=0;r<8;r++)for(let c=0;c<8;c++)if((r===origin[0]||c===origin[1])&&state.board[r][c]!=='.'&&state.board[r][c].toLowerCase()!=='k'){state.graveyard.push(state.board[r][c].toLowerCase());state.board[r][c]='.';state.ids[r][c]=null;}
      delete a.sword[actingSide];state.notice='울어라 지옥참마도!!! 같은 줄의 기물들이 쓰러졌습니다.';
    }
  }
  const nextSide = opposite(currentSide(state));
  if (isCheckmated(state, nextSide)) state.status = 'checkmate'; else if (inCheck(state, nextSide)) state.status = 'check';
  state.turnPlayer = 1 - player; state.turnNumber++;
  if(gameMode==='offline')state.boardRotated=!state.boardRotated;
  const nextTurnMessage = `${turnLabel()}입니다.`;
  state.notice = state.notice ? `${state.notice} ${nextTurnMessage}` : nextTurnMessage;
  selection = null; selectedMoves = []; render();
}

function validRevivalSquares(piece) {
  const side = currentSide(state);
  return resurrectionSquares(state, side).filter(([r,c]) => {
    const trial = cloneState(state); trial.board[r][c] = side === WHITE ? piece.toUpperCase() : piece;
    return !isFirstTurnForSide(state, side) || (!inCheck(trial, WHITE) && !inCheck(trial, BLACK));
  });
}

async function chooseResurrections(_game, count) {
  let revived = 0;
  while (revived < count && state.graveyard.length) {
    state.notice = `기물 ${revived}/${count}명을 부활시킬 수 있습니다.`; render();
    const choices = state.graveyard.map((piece, index) => {
      const shownPiece = currentSide(state) === WHITE ? piece.toUpperCase() : piece.toLowerCase();
      return { value: index, label: `${SYMBOLS[shownPiece]}  ${index + 1}. ${nameOf(piece)}`, disabled: validRevivalSquares(piece).length === 0 };
    });
    if (choices.every(choice => choice.disabled)) break;
    const index = await showChoice(`부활 기물 선택 (${revived + 1}/${count})`, '공동묘지에서 기물을 고르세요.', choices, false);
    const squares = validRevivalSquares(state.graveyard[index]);
    state.notice = `기물 ${revived}/${count}명 부활 중: 내 진영의 빈칸을 보드에서 선택하세요.`;
    render();
    const didRevive = await new Promise(resolve => {
      state.pendingRevival = { graveIndex: index, squares, squareResolver: resolve };
      render();
    });
    if (didRevive) revived++;
  }
  state.notice = `기물 ${revived}/${count}명을 부활시킬 수 있습니다.`; render();
  return revived;
}

function playEffect(card) {
  const effects = ['dealing', 'effect-skip', 'effect-revive', 'effect-reverse', 'effect-wild', 'effect-plus-four', 'effect-augment', 'effect-wild-reverse'];
  cardDisplay.classList.remove(...effects); void cardDisplay.offsetWidth;
  const effect = ({ '금지':'effect-skip', '+2':'effect-revive', '리버스':'effect-reverse', '와일드':'effect-wild', '+4 와일드':'effect-plus-four', '특수증강 와일드':'effect-augment', '와일드 리버스':'effect-wild-reverse' })[card];
  if (effect) cardDisplay.classList.add(effect);
  if (card === '와일드 리버스') { boardEl.classList.remove('vortex'); void boardEl.offsetWidth; boardEl.classList.add('vortex'); setTimeout(() => boardEl.classList.remove('vortex'), 950); }
}

async function drawAndResolve() {
  if (drawButton.disabled || !onlineCanAct()) return;
  if(gameMode==='online')lastLocalActor=localPlayerIndex;
  if(state.augments.skipTurns?.[currentSide(state)]>0){
    const player=state.turnPlayer,side=currentSide(state);state.augments.skipTurns[side]--;state.notice='함정카드 발동! 행동 불가 턴입니다.';render();await wait(1100);finishTurn(player,side);return;
  }
  turnStartSnapshot=cloneState(state);turnStartSnapshot.busy=false;turnStartSnapshot.moved.clear();turnStartSnapshot.notice='';turnStartHistoryIndex=moveHistory.length;
  state.busy = true; state.moved.clear(); state.notice = '카드를 뽑는 중입니다…';
  const player = state.turnPlayer, side = currentSide(state);
  state.card = drawCard(state); state.cardAnimating = true; render(); await wait(550);
  state.cardAnimating = false; playEffect(state.card); render(); await wait(450);
  const result = await resolveCard(state, state.card, { chooseResurrections, playEffect });
  state.busy = false; state.notice = result.messages.at(-1) || '';
  let cardEntry = null;
  if (!/^\d$/.test(state.card)) {
    cardEntry = {
      kind: 'card', description: `${state.card} 발동`, notation: state.card,
      player, side, from: null, to: null, snapshot: cloneState(state),
    };
    moveHistory.push(cardEntry);
  }
  if (result.repeatDraw) { render(); return; }
  if (result.pendingTransform) {
    pendingPromotionCard = cardEntry;
    state.pendingTransform = true; state.actionsLeft = result.actions ?? 1; selection = null; selectedMoves = []; render();
    const available = state.board.some(row => row.some(piece => piece !== '.' && colorOf(piece) === currentSide(state) && piece.toLowerCase() !== 'k'));
    if (!available) { state.pendingTransform = false; state.notice = '승급할 수 있는 내 기물이 없어 턴을 마칩니다.'; finishTurn(player, side); }
    return;
  }
  if(result.pendingAugment){
    state.pendingAugmentChoice=true;
    state.notice='특수 증강 3가지 중 하나를 선택하세요.';
    render();
    const choices=chooseRandomAugments();
    const picked=await showChoice('특수 증강 선택','세 가지 증강 중 하나를 선택하세요. 선택 후 기물을 한 번 움직일 수 있습니다.',choices.map(augment=>({value:augment.name,label:augment.name,description:augment.description})),false);
    const activated=await activateAugment(picked,side);
    state.pendingAugmentChoice=false;
    if(cardEntry){cardEntry.description+=` · ${picked} 발동`;cardEntry.notation=picked;cardEntry.snapshot=cloneState(state);}
    if(!activated){state.actionsLeft=0;finishTurn(player,side);return;}
    state.actionsLeft=1;selection=null;selectedMoves=[];render();
    if(legalMoves(state,currentSide(state)).length===0){state.notice+=' 움직일 수가 없어 턴을 넘깁니다.';render();await wait(700);finishTurn(player,side);}
    return;
  }
  if (result.actions === null || result.actions === 0) {
    if (result.actions === 0) state.notice = '0 카드라 행동 횟수가 없습니다. 턴을 넘깁니다.';
    state.busy = true;
    render();
    await wait(1000);
    state.busy = false;
    finishTurn(player, side);
    return;
  }
  state.actionsLeft = result.actions; selection = null; selectedMoves = []; render();
  if (legalMoves(state, currentSide(state)).length === 0) {
    state.notice = '움직일 수 있는 합법 수가 없어 턴을 넘깁니다.';
    render(); await wait(1000); finishTurn(player, side);
  }
}

function showReviewPosition(index) {
  reviewIndex = index;
  reviewPosition.textContent = index < 0 ? '시작 위치' : `${index + 1}수 / ${moveHistory.length}수`;
  previousReview.disabled = index <= -1;
  nextReview.disabled = index >= moveHistory.length - 1;
  reviewMoves.querySelectorAll('[data-move-index]').forEach(button => button.classList.toggle('active', Number(button.dataset.moveIndex) === index));
  $('#reviewNotation').textContent = index < 0 ? '시작' : moveHistory[index].notation;
  $('#reviewMoveInfo').textContent = index < 0 ? '초기 배치' : moveHistory[index].kind === 'card'
    ? `특수 카드 · 플레이어${moveHistory[index].player + 1}(${sideName(moveHistory[index].side)}) · ${moveHistory[index].description}`
    : `플레이어${moveHistory[index].player + 1}(${sideName(moveHistory[index].side)})`;
  renderBoard();
}

function openMoveReview() {
  endDialog.close();
  reviewing = true; sidePanel.classList.add('review-mode'); reviewPanel.hidden = false;
  reviewMoves.replaceChildren();
  const start = document.createElement('button');
  start.type = 'button'; start.className = 'review-move review-start'; start.dataset.moveIndex = '-1';
  start.innerHTML = '<span class="review-turn">⌂</span><span class="review-coordinates">시작 배치</span><span class="review-notation-chip">초기</span>';
  start.addEventListener('click', () => showReviewPosition(-1)); reviewMoves.append(start);
  moveHistory.forEach((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'review-move'; button.dataset.moveIndex = String(index);
    if (entry.kind === 'card') {
      button.classList.add('review-special');
      button.innerHTML = `<span class="review-turn">${index + 1}</span><span class="review-coordinates">${entry.description}</span><span class="review-notation-chip">${entry.notation}</span>`;
    } else {
      button.innerHTML = `<span class="review-turn">${index + 1}</span><span class="review-coordinates">${entry.from}<i>→</i>${entry.to}</span><span class="review-notation-chip">${entry.notation}</span>`;
    }
    button.addEventListener('click', () => showReviewPosition(index)); reviewMoves.append(button);
  });
  showReviewPosition(moveHistory.length - 1);
}

function closeMoveReview() {
  reviewing = false; reviewIndex = null; reviewPanel.hidden = true; sidePanel.classList.remove('review-mode');
  renderBoard();
  if (state.winner !== null && !endDialog.open) endDialog.showModal();
}

function newGame() {
  if(gameMode==='online'&&localPlayerIndex!==0){if(endDialog.open)endDialog.close();state.notice='새 게임은 방 호스트가 시작할 수 있습니다.';render();return;}
  if (endDialog.open) endDialog.close();
  appElement.hidden = false; exitScreen.hidden = true;
  state = createState(createDeck()); selection = null; selectedMoves = [];
  if(gameMode==='online'&&Math.random()<.5){state.playerSides=['b','w'];state.turnPlayer=1;}
  moveHistory = []; reviewIndex = null; reviewing = false; pendingPromotionCard = null; turnStartSnapshot=null; turnStartHistoryIndex=0; reviewPanel.hidden = true; sidePanel.classList.remove('review-mode'); initialSnapshot = cloneState(state);
  if(gameMode==='online'){lastLocalActor=localPlayerIndex;onlineResetPending=true;}render();
}

$('#newGameFromEnd').addEventListener('click', newGame);
$('#reviewGame').addEventListener('click', openMoveReview);
$('#exitGame').addEventListener('click', () => {
  endDialog.close(); appElement.hidden = true; exitScreen.hidden = false;
});
$('#closeReview').addEventListener('click', closeMoveReview);
previousReview.addEventListener('click', () => showReviewPosition(Math.max(-1, reviewIndex - 1)));
nextReview.addEventListener('click', () => showReviewPosition(Math.min(moveHistory.length - 1, reviewIndex + 1)));
drawButton.addEventListener('click', drawAndResolve); newGameButton.addEventListener('click', newGame); render();
$('#rewindButton').addEventListener('click', () => {
  const effect=Object.values(state.augments.rewind).find(item=>item?.ready&&item.player===state.turnPlayer);if(!effect)return;
  moveHistory=moveHistory.slice(0,effect.historyIndex);state=cloneState(effect.snapshot);selection=null;selectedMoves=[];state.notice='시간을 되돌렸습니다. 이 시점부터 다시 진행합니다.';render();
});

$('#offlineMode').addEventListener('click',()=>startLocalGame('offline'));
$('#onlineMode').addEventListener('click',()=>{$('#onlineSetup').hidden=false;$('#nicknameInput').focus();});
$('#roomCodeInput').addEventListener('input',event=>{event.target.value=event.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);});
$('#hostRoom').addEventListener('click',async()=>{
  const nickname=$('#nicknameInput').value.trim(),message=$('#setupMessage');if(!nickname){message.textContent='닉네임을 입력하세요.';return;}
  message.textContent='방을 만들고 있습니다…';
  try{const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname})});const data=await response.json();if(!response.ok)throw new Error(data.error);waitInHostLobby(data);}
  catch(error){message.textContent=error.message||'방을 만들지 못했습니다. 서버 연결을 확인하세요.';}
});
$('#joinRoom').addEventListener('click',async()=>{
  const nickname=$('#nicknameInput').value.trim(),code=$('#roomCodeInput').value.trim(),message=$('#setupMessage');
  if(!nickname){message.textContent='닉네임을 입력하세요.';return;}if(!/^[A-Z0-9]{6}$/.test(code)){message.textContent='방 코드는 영문 대문자와 숫자 6자리입니다.';return;}
  message.textContent='방에 참가하고 있습니다…';
  try{const response=await fetch(`/api/rooms/${code}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname})});const data=await response.json();if(!response.ok)throw new Error(data.error);startOnlineGame(data);}
  catch(error){message.textContent=error.message||'방에 참가하지 못했습니다.';}
});
