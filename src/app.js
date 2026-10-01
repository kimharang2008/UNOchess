import {
  BLACK, WHITE, SYMBOLS, PIECE_NAMES, applyMove, cloneState, colorOf, createState,
  currentSide, inCheck, isCheckmated, legalMoves, nameOf, opposite,
  resurrectionSquares, revive, squareName, transform,
} from './chess.js';
import { createDeck, drawCard, resolveCard } from './uno.js';

const $ = selector => document.querySelector(selector);
const boardEl = $('#board'), turnBadge = $('#turnBadge'), statusText = $('#statusText');
const actionText = $('#actionText'), cardDisplay = $('#cardDisplay'), deckCount = $('#deckCount');
const graveCount = $('#graveCount'), graveList = $('#graveList'), drawButton = $('#drawButton');
const newGameButton = $('#newGameButton'), dialog = $('#choiceDialog');
const dialogTitle = $('#dialogTitle'), dialogHelp = $('#dialogHelp'), dialogChoices = $('#dialogChoices');
const cancelChoice = $('#cancelChoice');
let state = createState(createDeck()), selection = null, selectedMoves = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function showChoice(title, help, options, allowCancel = true) {
  return new Promise(resolve => {
    dialogTitle.textContent = title; dialogHelp.textContent = help; dialogChoices.replaceChildren();
    cancelChoice.hidden = !allowCancel;
    let settled = false;
    const finish = value => { if (!settled) { settled = true; dialog.close(); resolve(value); } };
    options.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'choice-button'; button.textContent = option.label;
      button.disabled = !!option.disabled; button.addEventListener('click', () => finish(option.value));
      dialogChoices.append(button);
    });
    cancelChoice.onclick = event => { event.preventDefault(); finish(null); };
    dialog.oncancel = event => { event.preventDefault(); if (allowCancel) finish(null); };
    dialog.showModal();
  });
}

function sideName(side) { return side === WHITE ? '백' : '흑'; }
function turnLabel(player = state.turnPlayer, side = currentSide(state)) { return `플레이어${player + 1}(${sideName(side)})의 차례`; }
function checkmateSides() { return [WHITE, BLACK].filter(side => isCheckmated(state, side)); }
function rendersAsPiece(piece, checked) {
  if (piece === '.') return '';
  return `<span class="piece ${colorOf(piece) === WHITE ? 'white' : 'black'} ${piece.toLowerCase() === 'k' && checked.includes(colorOf(piece)) ? 'checkmated' : ''}">${SYMBOLS[piece]}</span>`;
}

function renderBoard() {
  const checked = checkmateSides(), moves = selection ? selectedMoves : [];
  boardEl.classList.toggle('board-rotated', !!state.boardRotated);
  boardEl.replaceChildren();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const pos = [r, c], square = document.createElement('button'), piece = state.board[r][c];
    square.type = 'button'; square.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
    square.dataset.square = `${r},${c}`;
    if (selection?.[0] === r && selection?.[1] === c) square.classList.add('selected');
    if (state.lastMove && [state.lastMove.from, state.lastMove.to].some(p => p[0] === r && p[1] === c)) square.classList.add('last-move');
    if (state.pendingTransform && piece !== '.' && colorOf(piece) === currentSide(state) && piece.toLowerCase() !== 'k') square.classList.add('transformable');
    if (state.pendingRevival?.squares.some(target => target[0] === r && target[1] === c)) square.classList.add('revival-target');
    const targetMove = moves.find(move => move.to[0] === r && move.to[1] === c);
    if (targetMove) square.classList.add(piece === '.' ? 'target' : piece.toLowerCase() === 'k' ? 'king-target' : 'capture-target');
    const rank = c === 0 ? `<span class="coord rank">${8-r}</span>` : '';
    const file = r === 7 ? `<span class="coord file">${'abcdefgh'[c]}</span>` : '';
    square.setAttribute('aria-label', `${squareName(pos)}${piece === '.' ? ', 빈칸' : `, ${sideName(colorOf(piece))} ${nameOf(piece)}`}`);
    square.innerHTML = `${rank}${rendersAsPiece(piece, checked)}${file}`;
    square.addEventListener('click', () => onSquareClick(pos)); boardEl.append(square);
  }
}

function render() {
  const side = currentSide(state), mates = checkmateSides();
  turnBadge.textContent = state.winner === null ? turnLabel() : `플레이어${state.winner + 1} 승리`;
  deckCount.textContent = `${state.deck.length}장`;
  graveCount.textContent = `${state.graveyard.length}개`;
  const counts = Object.fromEntries('pnbrqk'.split('').map(kind => [kind, state.graveyard.filter(piece => piece.toLowerCase() === kind).length]));
  graveList.textContent = `폰×${counts.p} · 나이트×${counts.n} · 비숍×${counts.b} · 룩×${counts.r} · 퀸×${counts.q} · 킹×${counts.k}`;
  drawButton.disabled = state.busy || state.winner !== null || state.actionsLeft > 0 || state.pendingTransform || state.pendingRevival;
  newGameButton.disabled = state.busy;
  if (state.winner !== null) statusText.textContent = `플레이어 ${state.winner + 1}이 상대 킹을 직접 잡았습니다.`;
  else if (state.notice) statusText.textContent = state.notice;
  else if (mates.length) statusText.textContent = `${mates.map(sideName).join(' · ')} 체크메이트 상태입니다. 게임은 계속됩니다.`;
  else if (inCheck(state, side)) statusText.textContent = `${sideName(side)} 체크 상태입니다. 킹 이동 또는 공격 경로를 막는 수가 가능합니다.`;
  else statusText.textContent = `${turnLabel()}입니다.`;
  actionText.textContent = state.pendingTransform ? '보드에서 승급할 내 기물을 선택하세요.' : state.pendingRevival ? '보드에서 부활 위치를 선택하세요.' : state.actionsLeft > 0 ? `남은 턴 ${state.actionsLeft}회` : '카드를 뽑아 턴을 시작하세요.';
  cardDisplay.className = `draw-card ${state.card ? (/^\d$/.test(state.card) ? 'uno-number' : 'uno-special') : 'empty-card'} ${state.cardAnimating ? 'dealing' : ''}`;
  cardDisplay.textContent = state.card || '카드를 뽑아 시작하세요';
  renderBoard();
}

function moveIsKingCapture(move) { return state.board[move.to[0]][move.to[1]].toLowerCase() === 'k'; }

async function finishTransform(pos) {
  const side = currentSide(state), oldPiece = state.board[pos[0]][pos[1]];
  const kinds = ['q', 'r', 'b', 'n', 'p'].filter(kind => {
    const trial = cloneState(state); trial.board[pos[0]][pos[1]] = side === WHITE ? kind.toUpperCase() : kind;
    return !state.firstTurn || (!inCheck(trial, WHITE) && !inCheck(trial, BLACK));
  });
  if (!kinds.length) { state.notice = '규칙에 맞게 바꿀 수 있는 기물이 없습니다.'; render(); return; }
  const target = await showChoice('승급할 기물 선택', `${squareName(pos)}의 ${nameOf(oldPiece)}을(를) 무엇으로 바꿀까요?`, kinds.map(kind => ({ value: kind, label: nameOf(kind) })), false);
  if (!transform(state, pos, target)) { state.notice = '기물 승급을 완료할 수 없습니다.'; render(); return; }
  state.pendingTransform = false; state.notice = `${nameOf(oldPiece)}을(를) ${nameOf(target)}(으)로 승급했습니다.`;
  selection = null; selectedMoves = []; render();
}

async function onSquareClick(pos) {
  if (state.winner !== null) return;
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

async function playMove(move) {
  const piece = state.board[move.from[0]][move.from[1]];
  if (piece.toLowerCase() === 'p' && [0, 7].includes(move.to[0])) {
    const choice = await showChoice('폰 승급', '승급할 기물을 선택하세요.', ['q','r','b','n'].map(kind => ({ value: kind, label: nameOf(kind) })));
    if (!choice) return; move.promotion = choice;
  }
  const player = state.turnPlayer, side = currentSide(state), capturesKing = moveIsKingCapture(move);
  applyMove(state, move, { markMoved: true }); selection = null; selectedMoves = [];
  if (capturesKing) { state.winner = player; state.actionsLeft = 0; render(); return; }
  state.actionsLeft--; state.notice = ''; render();
  if (state.actionsLeft <= 0 || legalMoves(state, currentSide(state)).length === 0) finishTurn(player, side);
}

function finishTurn(player, actingSide) {
  state.actionsLeft = 0; state.pendingTransform = false; state.firstTurn = false;
  const nextSide = opposite(currentSide(state));
  if (isCheckmated(state, nextSide)) state.status = 'checkmate'; else if (inCheck(state, nextSide)) state.status = 'check';
  state.turnPlayer = 1 - player; state.turnNumber++;
  const nextTurnMessage = `${turnLabel()}입니다.`;
  state.notice = state.notice ? `${state.notice} ${nextTurnMessage}` : nextTurnMessage;
  selection = null; selectedMoves = []; render();
}

function validRevivalSquares(piece) {
  const side = currentSide(state);
  return resurrectionSquares(state, side).filter(([r,c]) => {
    const trial = cloneState(state); trial.board[r][c] = side === WHITE ? piece.toUpperCase() : piece;
    return !state.firstTurn || (!inCheck(trial, WHITE) && !inCheck(trial, BLACK));
  });
}

async function chooseResurrections(_game, count) {
  let revived = 0;
  while (revived < count && state.graveyard.length) {
    state.notice = `기물 ${revived}/${count}명을 부활시킬 수 있습니다.`; render();
    const choices = state.graveyard.map((piece, index) => ({ value: index, label: `${index + 1}. ${nameOf(piece)}`, disabled: validRevivalSquares(piece).length === 0 }));
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
  if (drawButton.disabled) return;
  state.busy = true; state.moved.clear(); state.notice = '카드를 뽑는 중입니다…';
  const player = state.turnPlayer, side = currentSide(state);
  state.card = drawCard(state); state.cardAnimating = true; render(); await wait(550);
  state.cardAnimating = false; playEffect(state.card); render(); await wait(450);
  const result = await resolveCard(state, state.card, { chooseResurrections, playEffect });
  state.busy = false; state.notice = result.messages.at(-1) || '';
  if (result.repeatDraw) { render(); return; }
  if (result.pendingTransform) {
    state.pendingTransform = true; state.actionsLeft = result.actions ?? 1; selection = null; selectedMoves = []; render();
    const available = state.board.some(row => row.some(piece => piece !== '.' && colorOf(piece) === currentSide(state) && piece.toLowerCase() !== 'k'));
    if (!available) { state.pendingTransform = false; state.notice = '승급할 수 있는 내 기물이 없어 턴을 마칩니다.'; finishTurn(player, side); }
    return;
  }
  if (result.actions === null || result.actions === 0) { render(); finishTurn(player, side); return; }
  state.actionsLeft = result.actions; selection = null; selectedMoves = []; render();
  if (legalMoves(state, currentSide(state)).length === 0) finishTurn(player, side);
}

function newGame() { state = createState(createDeck()); selection = null; selectedMoves = []; render(); }
drawButton.addEventListener('click', drawAndResolve); newGameButton.addEventListener('click', newGame); render();
