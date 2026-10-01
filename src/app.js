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
const rulesDialog = $('#rulesBookDialog');
let state = createState(createDeck()), selection = null, selectedMoves = [];
let moveHistory = [], reviewIndex = null, reviewing = false, initialSnapshot = cloneState(state), pendingPromotionCard = null, turnStartSnapshot = null, turnStartHistoryIndex = 0;
let pendingPromotionSummonResolver = null;
let gameStarted=false, gameMode='offline', localPlayerId=null, localPlayerIndex=null, roomCode=null, roomPlayers=[], remoteSeq=0, pollTimer=null, syncTimer=null, lastLocalActor=null, onlineResetPending=false, hostLobby=null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const RULE_PAGES = [
  { title: '1. 게임의 목표', text: '두 플레이어가 백과 흑을 맡아 체스판에서 대결합니다.\n상대 킹을 직접 잡으면 승리합니다. 체크나 체크메이트 선언만으로 게임이 끝나지는 않습니다.' },
  { title: '2. 내 턴 시작과 행동', text: '내 차례가 되면 카드를 한 장 뽑습니다. 숫자 카드의 숫자만큼 합법적인 체스 수를 둘 수 있습니다.\n행동 수를 다 쓰거나 둘 수 있는 수가 없으면 턴이 끝납니다. 0 카드는 행동 없이 턴을 넘깁니다.' },
  { title: '3. 체스 기물 이동', text: '기물은 기본 체스 이동 규칙을 따릅니다. 상대 기물이 있는 칸으로 이동하면 그 기물을 잡습니다.\n폰은 상대편 끝줄에 도착하면 퀸·룩·비숍·나이트 중 하나로 승급합니다. 승급 선택지가 나오면 원하는 기물을 고르세요.' },
  { title: '4. 체크와 승리', text: '킹이 공격받으면 체크 상태가 표시됩니다. 체크 상태에서도 플레이를 계속하며, 상대 킹을 직접 잡아야 승리합니다.\n상대 킹을 잡을 수 있는 것은 각 기물의 첫 이동뿐입니다. 한 번이라도 움직인 기물은 이후 상대 킹을 잡을 수 없습니다. 체크메이트 표시는 현재 킹이 위험하고 합법적인 탈출 수가 없다는 뜻입니다.' },
  { title: '5. 부활 카드', text: '+2는 공동묘지에서 최대 2개, +4 와일드는 최대 4개의 기물을 골라 부활시킵니다.\n기물을 고른 뒤 자기 진영의 빈칸을 선택해 배치하세요. +4 와일드는 부활 후 내 기물 승급 선택도 제공합니다.' },
  { title: '6. 특수 카드', text: '금지: 이번 턴을 넘깁니다.\n리버스: 두 플레이어의 진영을 바꾸고 같은 플레이어가 다시 카드를 뽑습니다.\n와일드: 내 기물 하나를 골라 승급시킵니다.\n특수증강 와일드: 제시된 세 가지 증강 중 하나를 고릅니다.' },
  { title: '7. 와일드 리버스', text: '보드 위 기물의 위치를 섞습니다. 섞은 뒤 자기 폰이 상대편 끝줄에 있으면, 그 폰은 다음 자기 턴을 시작할 때 먼저 승급합니다.\n백의 끝줄은 8번째 줄, 흑의 끝줄은 1번째 줄입니다.' },
  { title: '8. 증강: 거신병과 승급', text: '체크메이트의 거신병: 폰 4개·나이트 2개·룩 1개·비숍 1개를 바쳐 체력 3의 거신병을 자기 진영 빈칸에 소환합니다. 거신병은 퀸처럼 미끄러지거나 나이트처럼 뛰어 움직입니다. 공격을 받으면 공격한 쪽의 턴이 끝날 때 주변 8칸의 기물을 제거합니다. 킹과 다른 거신병은 이 효과로 제거되지 않습니다.\n좀비사태!!!!: 최대 3회, 상대 기물을 잡으면 잡은 칸 주변의 움직일 수 있는 상대 기물 하나를 무작위로 아군으로 바꿉니다.\n승급 중독자: 다음 3회의 폰 승급 때마다 승급한 기물과 같은 종류의 기물을 최대 2개, 자기 진영 빈칸에 추가 소환합니다.\n절호의 찬스잖아요~!!: 보드에서 줄 하나를 고르고, 그 줄의 아군 킹을 제외한 기물을 선택한 퀸·룩·비숍·나이트로 한꺼번에 바꿉니다.' },
  { title: '9. 증강: 방어와 방해', text: '복수는 복수를 낳지....: 5번의 자기 턴 동안 내 기물이 잡히면, 가능한 경우 포획한 기물을 내 기물이 자동으로 되잡습니다.\n우리 애는 왕의 DNA가 흘러요!: 내 킹 주변 8칸 안의 아군 기물은 상대에게 잡히지 않습니다. 킹 자신은 이 보호 대상이 아닙니다.\n그대들이 내 방패라네!: 최대 3회, 킹이 아닌 내 기물이 잡힐 때 그 기물을 보존하고 공격자의 킹을 제외한 기물 하나를 무작위로 희생시킵니다.\n알츠하이머: 상대의 다음 3번의 턴 동안 상대가 내 기물을 잡을 수 없습니다.\n함정카드: 킹이 아닌 상대 기물 하나에 함정을 겁니다. 그 기물이 두 번 움직이거나 한 번이라도 기물을 잡으면 발동해 상대의 행동 불가 턴을 3회 부여합니다.\n나만 아니면 돼~: 킹을 제외한 기물 10개를 무작위로 제거합니다. 제거 대상은 상대 기물 쪽을 우선하며, 상대가 없으면 남은 기물 중에서 고릅니다.' },
  { title: '10. 증강: 폰·잔상·시간·검', text: '체스 처음 해봄: 5번의 자기 턴 동안 폰이 뒤로 이동하고 뒤로 잡을 수 있습니다. 폰은 어느 끝줄에 도착해도 승급할 수 있습니다.\n훗 그건 제 잔상입니다만?: 이번 턴에 움직인 기물 중 하나를 고릅니다. 그 기물이 이번 턴에 지나간 모든 칸에 잔상을 남기며, 상대 기물이 그 칸에 들어오면 제거됩니다. 효과는 3번의 자기 턴 동안 지속됩니다.\n시간을 되돌리는 힘!: 바로 쓸 수는 없습니다. 상대의 다음 턴이 끝나고 내 차례가 오면 버튼이 나타납니다. 사용하면 증강 카드를 뽑기 전, 내 턴 시작 상태로 보드와 기물을 되돌립니다.\n미안하오 영감, 이 검은 뽑지 않기로 했는데.....: 아군 킹이 아닌 기물 하나에게 검을 쥐여줍니다. 그 기물이 살아남아 증강을 고른 턴과 다음 자기 턴을 마치면, 세 번째 자기 턴 시작에 가로줄 또는 세로줄을 골라 그 줄의 상대 킹 외 기물을 모두 제거합니다.' },
  { title: '11. 첫 턴 제한', text: '각 진영의 첫 자기 턴에는 체크를 만들 수 없습니다. 수를 둔 뒤 어느 쪽 킹도 체크 상태가 되면 안 됩니다.\n또한 첫 턴에는 상대 진영의 맨 뒷줄로 이동하거나, 그 줄에 있는 기물을 잡을 수 없습니다. 백에게 상대 맨 뒷줄은 8번째 줄, 흑에게는 1번째 줄입니다.' },
  { title: '12. 킹과 상대 킹의 범위', text: '킹은 상대 킹 주변 8칸 안으로 들어갈 수 있습니다. 진입하려면 그 턴에 행동이 2회 이상 남아 있어야 하고, 안전하게 빠져나갈 칸도 있어야 합니다.\n상대 킹의 범위로 들어가는 것만으로는 상대 킹을 잡을 수 없습니다. 들어간 다음 행동에는 반드시 킹을 범위 밖으로 이동해야 합니다. 이미 한 번 움직인 킹은 첫 이동 제한에 따라 상대 킹을 잡을 수도 없습니다.' },
  { title: '13. 카드 비율과 화면 안내', text: '현재 카드 구성은 숫자 카드 65%, 특수 카드 35%로 비율은 13:7입니다. 각 종류 안의 카드 구성 비중은 게임 화면의 카드 확률 안내에서 확인할 수 있습니다.\n화면의 차례 표시와 행동 안내, 강조된 칸을 확인하면 현재 할 일을 알 수 있습니다.' },
];

let rulePageIndex = 0;
function renderRulePage(index) {
  rulePageIndex = Math.max(0, Math.min(RULE_PAGES.length - 1, index));
  const page = RULE_PAGES[rulePageIndex];
  $('#rulesPageCount').textContent = `${rulePageIndex + 1} / ${RULE_PAGES.length}`;
  $('#rulesPageTitle').textContent = page.title;
  $('#rulesPageText').textContent = page.text;
  $('#previousRulePage').disabled = rulePageIndex === 0;
  $('#nextRulePage').disabled = rulePageIndex === RULE_PAGES.length - 1;
  $('#rulesChapters').replaceChildren(...RULE_PAGES.map((chapter, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'rules-chapter'; button.textContent = chapter.title.split('. ')[1];
    if (index === rulePageIndex) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => renderRulePage(index));
    return button;
  }));
}

function openRulesBook() {
  renderRulePage(0);
  rulesDialog.showModal();
}

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
  { name: '그대들이 내 방패라네!', description: '3회 동안 내 기물이 잡히면 킹을 제외한 상대 기물 하나를 무작위로 희생해 보호합니다.' },
  { name: 'ㅊ...최악의 ㅈㅣㄹ병 5위 알츠...뭐더라?', description: '상대 기물은 3턴 동안 내 기물을 잡을 수 없습니다.' },
  { name: '시간을 되돌리는 힘!', description: '상대의 다음 턴이 끝난 뒤 내 다음 차례에, 이번 턴 시작 시점으로 한 번 되돌립니다.' },
  { name: '함정카드', description: '상대 기물 하나에 함정을 설치합니다. 발동하면 상대의 행동을 3턴 막습니다.' },
  { name: '체스 처음 해봄', description: '5턴 동안 내 폰이 뒤로도 움직일 수 있습니다.' },
  { name: '미안하오 영감, 이 검은 뽑지 않기로 했는데.....', description: '보드에서 기물에 검을 쥐여줍니다. 두 턴 동안 살아남으면 세 번째 내 턴에 발동해, 보드에서 고른 줄의 상대 기물들을 벱니다.' },
  { name: '나만 아니면 돼~', description: '보드의 기물 10개를 무작위로 제거합니다. 상대 기물이 제거될 확률이 더 높습니다.' },
  { name: '훗 그건 제 잔상입니다만?', description: '이번 턴에 움직인 기물 하나를 고르면, 그 기물이 이동한 모든 경로에 잔상을 남깁니다.' },
  { name: '절호의 찬스잖아요~!!', description: '보드에서 줄을 고르고, 그 줄의 내 기물을 선택한 종류로 한꺼번에 승급시킵니다.' },
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

async function choosePromotionSummons(side, pieceKind, count) {
  const total = Math.min(count, resurrectionSquares(state, side).length);
  if (!total) return 0;
  state.pendingPromotionSummon = { side, pieceKind, total, remaining: total };
  state.notice = '승급 중독자 효과: 자기 진영의 빛나는 빈칸을 골라 기물을 소환하세요.';
  render();
  await new Promise(resolve => { pendingPromotionSummonResolver = resolve; });
  return total;
}

function enemyCampPawns(side) {
  const pawn = side === WHITE ? 'P' : 'p';
  const rows = [side === WHITE ? 0 : 7];
  const positions = [];
  for (const r of rows) for (let c=0;c<8;c++) if (state.board[r][c] === pawn) positions.push([r,c]);
  return positions;
}

async function promoteShuffledPawns(side, player) {
  const positions = enemyCampPawns(side);
  if (!positions.length) { state.pendingCampPromotions = (state.pendingCampPromotions || []).filter(pendingSide => pendingSide !== side); return; }
  state.busy = true;
  state.notice = '적 진영에 있는 내 폰을 먼저 승급하세요.';
  render();
  for (const pos of positions) {
    const [r,c] = pos, pawn = side === WHITE ? 'P' : 'p';
    if (state.board[r][c] !== pawn) continue;
    const choices = ['q','r','b','n'].map(kind => ({
      value: kind,
      label: `${SYMBOLS[side === WHITE ? kind.toUpperCase() : kind]} ${nameOf(kind)}`,
    }));
    const kind = await showChoice('적 진영 폰 승급', `${squareName(pos)}의 폰을 승급한 뒤 턴을 시작합니다.`, choices, false);
    state.board[r][c] = side === WHITE ? kind.toUpperCase() : kind;
    state.notice = `${squareName(pos)}의 폰을 ${nameOf(kind)}으로 승급했습니다.`;
    moveHistory.push({
      kind: 'promotion', description: state.notice, notation: `${squareName(pos)}=${kind.toUpperCase()}`,
      player, side, from: squareName(pos), to: squareName(pos), snapshot: cloneState(state),
    });
    render();
  }
  state.pendingCampPromotions = (state.pendingCampPromotions || []).filter(pendingSide => pendingSide !== side);
  state.busy = false;
  render();
}

function announceAugment(message, effectClass = '') {
  const overlay=$('#augmentAnnouncement');
  overlay.classList.remove('sword-announce');
  void overlay.offsetWidth;
  overlay.textContent=message;
  if(effectClass)overlay.classList.add(effectClass);
  overlay.hidden=false;
  setTimeout(()=>{overlay.hidden=true;overlay.classList.remove('sword-announce');},1500);
}

function playSwordSlash() {
  setTimeout(() => {
    document.body.classList.remove('sword-slashed');
    void document.body.offsetWidth;
    document.body.classList.add('sword-slashed');
    setTimeout(() => document.body.classList.remove('sword-slashed'), 950);
  }, 350);
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
  else if (name === '시간을 되돌리는 힘!') {
    if (a.rewindUsed?.[side] === state.turnNumber) { state.notice = '이번 턴에는 이미 시간을 되돌렸습니다.'; return false; }
    a.rewind[side] = { ready: true, player:state.turnPlayer, availableOnTurn:state.turnNumber + 2, snapshot: cloneState(turnStartSnapshot || state), historyIndex: turnStartHistoryIndex };
    state.notice = '상대의 다음 턴이 끝난 뒤, 내 다음 차례에 시간을 되돌릴 수 있습니다.';
  }
  else if (name === '함정카드') {
    const ids=[]; for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(state.board[r][c]!=='.' && colorOf(state.board[r][c])===enemy && state.board[r][c].toLowerCase()!=='k') ids.push(state.ids[r][c]);
    if(ids.length){
      const id=ids[Math.floor(Math.random()*ids.length)];a.traps[id]={owner:side,moves:0};
      let location='',trappedPiece='.';for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(state.ids[r][c]===id){location=squareName([r,c]);trappedPiece=state.board[r][c];}
      state.notice=`함정카드가 상대 ${location}의 ${nameOf(trappedPiece)}에 설치되었습니다.`;
    }else state.notice='설치할 상대 기물이 없습니다.';
  }
  else if (name === '체스 처음 해봄') { a.beginner[side]=5; state.notice='폰이 5턴 동안 뒤로도 움직일 수 있습니다.'; }
  else if (name === '미안하오 영감, 이 검은 뽑지 않기로 했는데.....') {
    if (!state.board.some(row => row.some(piece => piece !== '.' && colorOf(piece) === side && piece.toLowerCase() !== 'k'))) { state.notice='지정할 기물이 없습니다.'; return false; }
    state.pendingSwordSelection = { side };
    state.notice = '보드에서 검을 쥐여줄 아군 기물을 선택하세요.';
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
  else if (name === '훗 그건 제 잔상입니다만?') {
    a.afterimage[side] = { turns: 3, collecting: true, turnNumber: state.turnNumber, paths: {} };
    state.notice = '이번 턴 동안 움직인 기물의 경로를 기록합니다. 턴이 끝날 때 잔상을 남길 기물을 고르세요.';
  }
  else if (name === '절호의 찬스잖아요~!!') {
    state.pendingMassPromotion = { side };
    state.notice = '보드에서 승급할 아군 기물이 있는 줄을 선택하세요.';
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
    if (!reviewing && state.pendingPromotionSummon && resurrectionSquares(state, state.pendingPromotionSummon.side).some(target => target[0] === r && target[1] === c)) square.classList.add('promotion-summon-target', state.pendingPromotionSummon.side === WHITE ? 'revival-white' : 'revival-black');
    if (!reviewing && state.pendingMassPromotion && state.board[r].some(item => item !== '.' && colorOf(item) === state.pendingMassPromotion.side && item.toLowerCase() !== 'k')) square.classList.add('mass-promotion-target');
    if (!reviewing && state.pendingSwordStrike) square.classList.add('sword-strike-target');
    if (!reviewing && state.pendingSwordSelection && piece !== '.' && colorOf(piece) === state.pendingSwordSelection.side && piece.toLowerCase() !== 'k') square.classList.add('sword-selection-target');
    if (!reviewing && state.pendingAfterimageSelection && Object.hasOwn(state.pendingAfterimageSelection.paths, String(boardState.ids[r][c]))) square.classList.add('afterimage-selection-target');
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
  if (effects.shield?.[side] > 0) add('그대들이 내 방패라네!', `킹을 제외한 상대 기물 하나를 무작위로 희생해 보호, ${effects.shield[side]}회 남음`);
  if (effects.alz?.[side] > 0) add('알츠하이머', `상대가 내 기물을 잡을 수 없음, ${effects.alz[side]}턴 남음`);
  if (effects.beginner?.[side] > 0) add('체스 처음 해봄', `폰이 뒤로도 이동 가능, ${effects.beginner[side]}턴 남음`);
  if (effects.afterimage?.[side]) {
    const afterimage=effects.afterimage[side],turns=typeof afterimage==='number'?afterimage:afterimage.turns;
    add('훗 그건 제 잔상입니다만?', `선택한 기물의 이동 경로에 잔상을 남김, ${turns}턴 남음`);
  }
  if (effects.rewind?.[side]?.ready) add('시간을 되돌리는 힘!', '상대 턴이 끝난 뒤 이번 턴 시작으로 되돌릴 수 있음');
  if (effects.skipTurns?.[side] > 0) add('함정카드', `행동 불가 효과 ${effects.skipTurns[side]}회 남음`);

  const traps = Object.entries(effects.traps || {}).filter(([, trap]) => trap?.owner === side);
  if (traps.length) add('함정카드', `상대 기물 ${traps.length}개에 함정 설치됨`);
  const sword = effects.sword?.[side];
  if (sword) {
    let position = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (state.ids[r][c] === sword.id) position = squareName([r, c]);
    add('미안하오 영감, 이 검은 뽑지 않기로 했는데.....', `${position ? `${position}의 기물` : '선택한 기물'}이 검을 쥠, ${sword.turns}턴 뒤 보드에서 상대를 벨 줄 선택`);
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
  drawButton.disabled = state.busy || state.winner !== null || state.actionsLeft > 0 || state.pendingTransform || state.pendingRevival || state.pendingPromotionSummon || state.pendingGiantSummon || state.pendingMassPromotion || state.pendingAfterimageSelection || state.pendingSwordSelection || state.pendingSwordStrike || !onlineCanAct();
  const rewindSide=state.augments.rewind && Object.keys(state.augments.rewind).find(s=>state.augments.rewind[s]?.ready&&state.augments.rewind[s].player===state.turnPlayer&&state.turnNumber>=state.augments.rewind[s].availableOnTurn);
  $('#rewindButton').hidden=!rewindSide||state.busy||reviewing;
  $('#swordAxisButton').hidden=!state.pendingSwordStrike;
  if(state.pendingSwordStrike)$('#swordAxisButton').textContent=state.pendingSwordStrike.axis==='rank'?'세로 줄 선택':'가로 줄 선택';
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
  if(effects.beginner[side]>0)active.push(`후진 폰 ${effects.beginner[side]}턴`);if(effects.afterimage[side])active.push(`잔상 ${typeof effects.afterimage[side]==='number'?effects.afterimage[side]:effects.afterimage[side].turns}턴`);if(effects.alz[side]>0)active.push(`알츠하이머 ${effects.alz[side]}턴`);
  actionText.textContent = (state.pendingPromotionSummon ? `승급 중독자: 내 진영 빈칸에 기물 ${state.pendingPromotionSummon.remaining}개를 소환하세요.` : state.pendingCampPromotions?.includes(side) ? '와일드 리버스: 적 진영에 있는 폰을 먼저 승급하세요.' : state.pendingMassPromotion ? '체스판에서 줄을 고르세요. 그 줄의 내 기물을 선택한 종류로 일괄 승급합니다.' : state.pendingSwordStrike ? '체스판에서 공격할 줄을 선택하세요. 상대 기물만 제거됩니다.' : state.pendingSwordSelection ? '체스판에서 검을 쥐여줄 아군 기물을 선택하세요.' : state.pendingAfterimageSelection ? '이번 턴 움직인 기물 중 하나를 골라 모든 이동 경로에 잔상을 남기세요.' : state.kingEscapeRequired ? '킹이 적 킹의 범위에 있습니다. 다음 행동에는 범위 밖으로 이동해야 합니다.' : state.pendingTransform ? '보드에서 승급할 내 기물을 선택하세요.' : state.pendingRevival ? '보드에서 부활 위치를 선택하세요.' : state.actionsLeft > 0 ? `남은 턴 ${state.actionsLeft}회` : '카드를 뽑아 턴을 시작하세요.') + (active.length?` · 활성: ${active.join(', ')}`:'');
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

function finishTurnIfNoLegalMoves(side) {
  if(state.actionsLeft>0&&legalMoves(state,side).length===0){
    const player=state.turnPlayer;state.actionsLeft=0;
    state.notice='움직일 수 있는 합법 수가 없어 턴을 넘깁니다.';
    finishTurn(player,side);
  }
}

async function onSquareClick(pos) {
  if (state.winner !== null || reviewing || !onlineCanAct()) return;
  if (state.pendingAfterimageSelection) {
    const pending=state.pendingAfterimageSelection,id=state.ids[pos[0]][pos[1]],path=pending.paths[id];
    if(path){
      for(const [r,c] of path)if(!state.augments.ghosts.some(ghost=>ghost.r===r&&ghost.c===c&&ghost.owner===pending.side))state.augments.ghosts.push({r,c,owner:pending.side});
      state.augments.afterimage[pending.side]={turns:3,collecting:false,turnNumber:state.turnNumber,paths:{}};
      state.pendingAfterimageSelection=null;
      state.notice=`${squareName(pos)}에서 움직인 모든 경로에 잔상을 남겼습니다.`;
      if(!state.pendingSwordStrike)completeTurnTransition(pending.player,pending.actingSide);else render();
    }
    return;
  }
  if (state.pendingSwordStrike) {
    const { side, axis } = state.pendingSwordStrike;
    let removed = 0;
    const line=Array.from({length:8},(_,index)=>axis==='rank'?[pos[0],index]:[index,pos[1]]);
    for (const [r,c] of line) {
      const piece=state.board[r][c];
      if(piece!=='.'&&colorOf(piece)===opposite(side)&&piece.toLowerCase()!=='k'){
        state.graveyard.push(piece.toLowerCase());state.board[r][c]='.';state.ids[r][c]=null;removed++;
      }
    }
    state.pendingSwordStrike=null;
    state.notice=`울어라 지옥참마도! ${axis==='rank'?`${8-pos[0]}번째 가로 줄`:`${'abcdefgh'[pos[1]]} 세로 줄`}의 상대 기물 ${removed}개를 베었습니다.`;
    announceAugment('울어라! 지옥참마도!!!','sword-announce');
    playSwordSlash();
    render();
    return;
  }
  if (state.pendingSwordSelection) {
    const pending=state.pendingSwordSelection,piece=state.board[pos[0]][pos[1]];
    if(piece!=='.'&&colorOf(piece)===pending.side&&piece.toLowerCase()!=='k'){
      state.augments.sword[pending.side]={id:state.ids[pos[0]][pos[1]],turns:2};
      state.pendingSwordSelection=null;state.notice=`${squareName(pos)}의 ${nameOf(piece)}에게 검을 쥐여줬습니다.`;render();finishTurnIfNoLegalMoves(pending.side);
    }
    return;
  }
  if (state.pendingMassPromotion) {
    const side=state.pendingMassPromotion.side,row=pos[0];
    if(!state.board[row].some(piece=>piece!=='.'&&colorOf(piece)===side&&piece.toLowerCase()!=='k'))return;
    state.pendingMassPromotion=null;state.busy=true;render();
    const target=await showChoice('일괄 승급할 기물 선택',`${8-row}번째 줄의 아군 기물을 무엇으로 바꿀까요?`,['q','r','b','n'].map(kind=>({value:kind,label:`${SYMBOLS[side===WHITE?kind.toUpperCase():kind]} ${nameOf(kind)}`})),false);
    let changed=0;
    for(let c=0;c<8;c++){const piece=state.board[row][c];if(piece!=='.'&&colorOf(piece)===side&&piece.toLowerCase()!=='k'){state.board[row][c]=side===WHITE?target.toUpperCase():target;changed++;}}
    state.busy=false;state.notice=`절호의 찬스! ${8-row}번째 줄의 기물 ${changed}개를 ${nameOf(target)}(으)로 일괄 승급했습니다.`;render();finishTurnIfNoLegalMoves(side);
    return;
  }
  if (state.pendingPromotionSummon) {
    const pending = state.pendingPromotionSummon;
    if (resurrectionSquares(state, pending.side).some(target => target[0] === pos[0] && target[1] === pos[1])) {
      const piece = pending.side === WHITE ? pending.pieceKind.toUpperCase() : pending.pieceKind.toLowerCase();
      putAugmentPiece(piece, pos);
      pending.remaining--;
      state.notice = `승급 중독자: 기물 ${pending.total - pending.remaining}/${pending.total}개를 소환했습니다.`;
      if (pending.remaining === 0) {
        state.pendingPromotionSummon = null;
        const resolve = pendingPromotionSummonResolver;
        pendingPromotionSummonResolver = null;
        render();
        resolve?.();
      } else render();
    }
    return;
  }
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
      const candidates=[];
      for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(state.board[r][c]!=='.'&&colorOf(state.board[r][c])===movingSide&&state.board[r][c].toLowerCase()!=='k')candidates.push([r,c]);
      if(candidates.length){
        const [sr,sc]=candidates[Math.floor(Math.random()*candidates.length)];
        const sacrifice=state.board[sr][sc],sacrificeId=state.ids[sr][sc];
        state.graveyard.pop();
        state.graveyard.push(sacrifice.toLowerCase());
        state.board[sr][sc]='.';state.ids[sr][sc]=null;
        if(sacrificeId===movingId)state.moved.delete(movingId);
        else{state.board[fr][fc]=movingPiece;state.ids[fr][fc]=movingId;}
        state.board[tr][tc]=captured;state.ids[tr][tc]=state.nextId++;
        a.shield[targetSide]--;state.notice=`그대들이 내 방패라네! 상대의 ${nameOf(sacrifice)}을(를) 대신 희생해 기물을 지켰습니다.`;return {saved:true};
      }
    }
    if(a.zombie[movingSide]>0){
      const nearby=[];for(let r=Math.max(0,tr-1);r<=Math.min(7,tr+1);r++)for(let c=Math.max(0,tc-1);c<=Math.min(7,tc+1);c++)if(state.board[r][c]!=='.'&&colorOf(state.board[r][c])===targetSide&&state.board[r][c].toLowerCase()!=='k'&&canUseRecruitedPiece([r,c],movingSide))nearby.push([r,c]);
      if(nearby.length){const [r,c]=nearby[Math.floor(Math.random()*nearby.length)];prepareRecruitedPiece(state,[r,c],movingSide);a.zombie[movingSide]--;state.notice='좀비사태!!!! 상대 기물이 아군이 되었습니다. 이제 해당 기물을 사용할 수 있습니다.';}
    }
  }
  const trap=a.traps[movingId];
  if(trap){trap.moves++;if(trap.moves>=2||(captured&&captured!=='.')){const victimSide=opposite(trap.owner);a.skipTurns[victimSide]=(a.skipTurns[victimSide]||0)+3;delete a.traps[movingId];state.notice='함정카드 발동! 상대는 3턴 동안 행동할 수 없습니다.';announceAugment('함정카드 발동!');}}
  const afterimage=a.afterimage[movingSide];
  if(afterimage?.collecting&&afterimage.turnNumber===state.turnNumber){
    const dr=tr-fr,dc=tc-fc,aligned=dr===0||dc===0||Math.abs(dr)===Math.abs(dc);
    const steps=aligned?Math.max(Math.abs(dr),Math.abs(dc)):0;
    const route=[];
    for(let step=0;step<Math.max(1,steps);step++){
      const r=steps?fr+Math.sign(dr)*step:fr,c=steps?fc+Math.sign(dc)*step:fc;
      if(!route.some(square=>square[0]===r&&square[1]===c))route.push([r,c]);
    }
    const previous=afterimage.paths[movingId]||[];
    for(const [r,c] of route)if(!previous.some(square=>square[0]===r&&square[1]===c))previous.push([r,c]);
    afterimage.paths[movingId]=previous;
  }
  const ghostIndex=a.ghosts.findIndex(ghost=>ghost.r===tr&&ghost.c===tc&&ghost.owner!==movingSide);
  if(ghostIndex>=0){state.graveyard.push(movingPiece.toLowerCase());state.board[tr][tc]='.';state.ids[tr][tc]=null;a.ghosts.splice(ghostIndex,1);state.notice='훗 그건 제 잔상입니다만? 기물이 잔상에 걸려 사라졌습니다.';}
  if(captured&&captured!=='.'&&a.revenge[opposite(movingSide)]>0&&kind!=='k'){
    const targetSide=opposite(movingSide);
    const retaliation=legalMoves(state,targetSide).find(move=>move.to[0]===tr&&move.to[1]===tc&&state.board[move.to[0]][move.to[1]].toLowerCase()!=='k');
    if(retaliation){applyMove(state,retaliation,{markMoved:true});state.notice='복수는 복수를 낳지.... 즉시 반격했습니다.';}
  }
  return {saved:false};
}

function resolveGiantAuras(actingSide) {
  for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(state.board[r][c].toLowerCase()==='a'){
    const giantId=state.ids[r][c];
    if(state.augments.giantAttacked?.[giantId]!==actingSide)continue;
    delete state.augments.giantAttacked[giantId];
    for(let rr=Math.max(0,r-1);rr<=Math.min(7,r+1);rr++)for(let cc=Math.max(0,c-1);cc<=Math.min(7,c+1);cc++){
      const piece=state.board[rr][cc];if(piece==='.'||piece.toLowerCase()==='a')continue;
      if(piece.toLowerCase()==='k')continue;
      state.graveyard.push(piece.toLowerCase());state.board[rr][cc]='.';state.ids[rr][cc]=null;
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
    const kind=move.promotion.toLowerCase();
    const made=await choosePromotionSummons(side,kind,2);
    state.augments.promotionAddict[side]--;state.notice=`승급 중독자! 같은 기물 ${made}개를 추가 소환했습니다.`;
  }
  const promotionNote = move.promotion ? ` → ${nameOf(move.promotion)}` : '';
  const captureNote = captured && captured !== '.' ? ` × ${nameOf(captured)}` : '';
  const description = `플레이어${player + 1}(${sideName(side)}) ${nameOf(piece)} ${squareName(move.from)} → ${squareName(move.to)}${promotionNote}${captureNote}`;
  moveHistory.push({ description, notation: `${squareName(move.from)}${captured && captured !== '.' ? '×' : '–'}${squareName(move.to)}${move.promotion ? `=${move.promotion.toUpperCase()}` : ''}`, player, side, from: squareName(move.from), to: squareName(move.to), snapshot: cloneState(state) });
  if (captured?.toLowerCase() === 'k' && !giantHit) { state.winner = player; state.actionsLeft = 0; state.notice = ''; render(); return; }
  state.actionsLeft--;
  state.notice = giantHit ? piece.toLowerCase()==='k' ? '킹은 거신병의 반격에 면역입니다.' : '거신병이 공격받았습니다. 공격한 쪽의 턴이 끝나면 주변 기물을 공격합니다.' : '';
  render();
  if (state.actionsLeft <= 0 || legalMoves(state, currentSide(state)).length === 0) finishTurn(player, side);
}

function finishTurn(player, actingSide) {
  state.actionsLeft = 0; state.pendingTransform = false; state.firstTurn = false; state.firstTurns?.delete(actingSide);
  const a=state.augments;
  resolveGiantAuras(actingSide);
  if(a.beginner[actingSide]>0 && --a.beginner[actingSide]===0) delete a.beginner[actingSide];
  if(a.revenge[actingSide]>0 && --a.revenge[actingSide]===0) delete a.revenge[actingSide];
  const afterimage=a.afterimage[actingSide];
  if(afterimage){
    if(afterimage.collecting&&afterimage.turnNumber===state.turnNumber){
      const paths=Object.fromEntries(Object.entries(afterimage.paths||{}).filter(([id,path])=>path.length&&state.ids.some(row=>row.includes(Number(id)))));
      if(Object.keys(paths).length){
        afterimage.collecting=false;
        state.pendingAfterimageSelection={side:actingSide,player,actingSide,paths};
        state.notice='이번 턴에 움직인 기물의 경로를 기록했습니다. 보드에서 잔상을 남길 기물을 선택하세요.';
      }else delete a.afterimage[actingSide];
    }else if(typeof afterimage==='number'){
      if(afterimage<=1){delete a.afterimage[actingSide];a.ghosts=a.ghosts.filter(ghost=>ghost.owner!==actingSide);}
      else a.afterimage[actingSide]=afterimage-1;
    }else if(afterimage.turns<=1){
      delete a.afterimage[actingSide];a.ghosts=a.ghosts.filter(ghost=>ghost.owner!==actingSide);
    }else a.afterimage[actingSide]={...afterimage,turns:afterimage.turns-1};
  }
  const alzSide=opposite(actingSide);if(a.alz[alzSide]>0 && --a.alz[alzSide]===0) delete a.alz[alzSide];
  for(const swordSide of [WHITE,BLACK]){
    const sword=a.sword[swordSide];
    if(!sword)continue;
    const found=state.ids.some(row=>row.includes(sword.id));
    if(!found)delete a.sword[swordSide];
    else if(swordSide===actingSide&&sword.turns>0)sword.turns--;
  }
  if(state.pendingAfterimageSelection){selection=null;selectedMoves=[];render();return;}
  completeTurnTransition(player,actingSide);
}

function completeTurnTransition(player, actingSide) {
  const nextSide = opposite(currentSide(state));
  if (isCheckmated(state, nextSide)) state.status = 'checkmate'; else if (inCheck(state, nextSide)) state.status = 'check';
  state.turnPlayer = 1 - player; state.turnNumber++;
  if(gameMode==='offline')state.boardRotated=!state.boardRotated;
  const nextTurnMessage = `${turnLabel()}입니다.`;
  state.notice = state.notice ? `${state.notice} ${nextTurnMessage}` : nextTurnMessage;
  const swordSide=currentSide(state),sword=state.augments.sword[swordSide];
  if(sword&&sword.turns<=0){
    const bearerExists=state.ids.some(row=>row.includes(sword.id));
    delete state.augments.sword[swordSide];
    if(bearerExists){state.pendingSwordStrike={side:swordSide,axis:'rank'};state.notice='울어라 지옥참마도! 체스판에서 제거할 상대 기물이 있는 줄을 선택하세요.';}
  }
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
  const player = state.turnPlayer, side = currentSide(state);
  if (state.pendingCampPromotions?.includes(side)) await promoteShuffledPawns(side, player);
  turnStartSnapshot=cloneState(state);turnStartSnapshot.busy=false;turnStartSnapshot.moved.clear();turnStartSnapshot.notice='';turnStartHistoryIndex=moveHistory.length;
  state.busy = true; state.moved.clear(); state.notice = '카드를 뽑는 중입니다…';
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
    const pendingBoardChoice=state.pendingGiantSummon||state.pendingMassPromotion||state.pendingAfterimageSelection||state.pendingSwordSelection;
    if(!pendingBoardChoice&&legalMoves(state,currentSide(state)).length===0){state.notice+=' 움직일 수가 없어 턴을 넘깁니다.';render();await wait(700);finishTurn(player,side);}
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
renderRulePage(0);
$('#startRulesButton').addEventListener('click', openRulesBook);
$('#gameRulesButton').addEventListener('click', openRulesBook);
$('#closeRulesBook').addEventListener('click', () => rulesDialog.close());
$('#previousRulePage').addEventListener('click', () => renderRulePage(rulePageIndex - 1));
$('#nextRulePage').addEventListener('click', () => renderRulePage(rulePageIndex + 1));
$('#rewindButton').addEventListener('click', () => {
  const side=currentSide(state),effect=state.augments.rewind?.[side];
  if(!effect?.ready||effect.player!==state.turnPlayer||state.turnNumber<effect.availableOnTurn||state.busy)return;
  const used={...(state.augments.rewindUsed||{}),[side]:effect.snapshot.turnNumber};
  moveHistory=moveHistory.slice(0,effect.historyIndex);state=cloneState(effect.snapshot);
  state.augments.rewindUsed={...(state.augments.rewindUsed||{}),...used};
  selection=null;selectedMoves=[];state.pendingAugmentChoice=false;state.busy=false;
  state.notice='시간을 되돌렸습니다. 기물과 묘지를 당시 상태로 복구했습니다.';
  if(gameMode==='online')lastLocalActor=localPlayerIndex;
  render();
});
$('#swordAxisButton').addEventListener('click', () => {
  if(!state.pendingSwordStrike)return;
  state.pendingSwordStrike.axis=state.pendingSwordStrike.axis==='rank'?'file':'rank';
  state.notice=state.pendingSwordStrike.axis==='rank'?'가로 줄을 선택해 상대 기물을 베세요.':'세로 줄을 선택해 상대 기물을 베세요.';
  render();
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
