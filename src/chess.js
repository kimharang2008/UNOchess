export const WHITE = 'w';
export const BLACK = 'b';
export const FILES = 'abcdefgh';
export const PIECE_NAMES = { p: '폰', n: '나이트', b: '비숍', r: '룩', q: '퀸', k: '킹', a: '체크메이트의 거신병' };
export const SYMBOLS = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', A: '⚔', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟', a: '⚔' };
export const opposite = side => side === WHITE ? BLACK : WHITE;
export const colorOf = piece => piece === '.' ? null : (piece === piece.toUpperCase() ? WHITE : BLACK);
export const nameOf = piece => PIECE_NAMES[piece.toLowerCase()] || piece;
export const squareName = ([r, c]) => `${FILES[c]}${8 - r}`;
export function parseSquare(value) {
  const match = /^([a-h])([1-8])$/i.exec(String(value).trim());
  return match ? [8 - Number(match[2]), FILES.indexOf(match[1].toLowerCase())] : null;
}

export function createBoard() {
  return [Array.from('rnbqkbnr'), Array(8).fill('p'), ...Array.from({ length: 4 }, () => Array(8).fill('.')), Array(8).fill('P'), Array.from('RNBQKBNR')];
}

export function createState(deck) {
  const board = createBoard();
  const ids = board.map(row => row.map(() => null));
  let nextId = 1;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] !== '.') ids[r][c] = nextId++;
  return {
    board, ids, nextId, moved: new Set(), graveyard: [], turnPlayer: 0,
    playerSides: [WHITE, BLACK], castling: new Set(['K', 'Q', 'k', 'q']),
    enPassant: null, firstTurn: true, firstTurns: new Set([WHITE, BLACK]), turnNumber: 1, deck, lastMove: null,
    winner: null, card: null, actionsLeft: 0, busy: false, pendingAugmentChoice: false, kingEscapeRequired: null,
    augments: {
      giantHits: {}, giantPrevious: {}, kingPrevious: {}, zombie: {}, promotionAddict: {}, revenge: {}, kingDna: {}, shield: {},
      alz: {}, traps: {}, beginner: {}, sword: {}, ghosts: [], afterimage: {}, rewind: {}, skipTurns: {},
    },
  };
}

export function cloneState(state) {
  return {
    ...state, board: state.board.map(row => row.slice()), ids: state.ids.map(row => row.slice()),
    moved: new Set(state.moved), graveyard: state.graveyard.slice(),
    playerSides: state.playerSides.slice(), castling: new Set(state.castling), firstTurns: state.firstTurns ? new Set(state.firstTurns) : undefined, deck: state.deck.slice(),
    lastMove: state.lastMove ? { from: state.lastMove.from.slice(), to: state.lastMove.to.slice() } : null,
    kingEscapeRequired: state.kingEscapeRequired ? { ...state.kingEscapeRequired } : null,
    augments: structuredClone(state.augments || {}),
  };
}

export const currentSide = state => state.playerSides[state.turnPlayer];
export const isFirstTurnForSide = (state, side) => state.firstTurns ? state.firstTurns.has(side) : !!state.firstTurn;

export function kingSquare(state, side) {
  const king = side === WHITE ? 'K' : 'k';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (state.board[r][c] === king) return [r, c];
  return null;
}

export function isAttacked(state, [r, c], bySide) {
  for (let sr = 0; sr < 8; sr++) for (let sc = 0; sc < 8; sc++) {
    const piece = state.board[sr][sc];
    if (piece === '.' || colorOf(piece) !== bySide) continue;
    const kind = piece.toLowerCase(), dr = r - sr, dc = c - sc;
    if (kind === 'p') {
      const step = bySide === WHITE ? -1 : 1;
      if (dr === step && Math.abs(dc) === 1) return true;
    } else if (kind === 'n') {
      if ((Math.abs(dr) === 1 && Math.abs(dc) === 2) || (Math.abs(dr) === 2 && Math.abs(dc) === 1)) return true;
    } else if (kind === 'a') {
      if ((Math.abs(dr) === 1 && Math.abs(dc) === 2) || (Math.abs(dr) === 2 && Math.abs(dc) === 1)) return true;
      const diagonal = Math.abs(dr) === Math.abs(dc) && dr !== 0;
      const straight = (dr === 0) !== (dc === 0);
      if (!diagonal && !straight) continue;
      const stepR=Math.sign(dr),stepC=Math.sign(dc); let rr=sr+stepR,cc=sc+stepC,clear=true;
      while(rr!==r||cc!==c){if(state.board[rr][cc]!=='.'){clear=false;break;}rr+=stepR;cc+=stepC;}
      if(clear)return true;
    } else if (kind === 'k') {
      if (Math.max(Math.abs(dr), Math.abs(dc)) === 1) return true;
    } else {
      const diagonal = Math.abs(dr) === Math.abs(dc) && dr !== 0;
      const straight = (dr === 0) !== (dc === 0);
      if (kind === 'b' && !diagonal || kind === 'r' && !straight || kind === 'q' && !(diagonal || straight)) continue;
      const stepR = Math.sign(dr), stepC = Math.sign(dc);
      let rr = sr + stepR, cc = sc + stepC, clear = true;
      while (rr !== r || cc !== c) {
        if (state.board[rr][cc] !== '.') { clear = false; break; }
        rr += stepR; cc += stepC;
      }
      if (clear) return true;
    }
  }
  return false;
}

export function inCheck(state, side) {
  const king = kingSquare(state, side);
  return !!king && isAttacked(state, king, opposite(side));
}

export function kingInEnemyRange(state, side, square = kingSquare(state, side)) {
  const enemyKing = kingSquare(state, opposite(side));
  return !!(square && enemyKing && Math.max(Math.abs(square[0] - enemyKing[0]), Math.abs(square[1] - enemyKing[1])) <= 1);
}

function inCheckByNonKing(state, side) {
  const copy = cloneState(state), enemyKing = kingSquare(copy, opposite(side));
  if (enemyKing) {
    copy.board[enemyKing[0]][enemyKing[1]] = '.';
    copy.ids[enemyKing[0]][enemyKing[1]] = null;
  }
  return inCheck(copy, side);
}

function hasSafeKingEscape(state, side, kingId) {
  const from = kingSquare(state, side);
  if (!from) return false;
  return pseudoMoves(state, side).filter(move => move.from[0] === from[0] && move.from[1] === from[1] && state.ids[from[0]][from[1]] === kingId)
    .some(move => {
      if (move.special === 'castle' && inCheck(state, side)) return false;
      const copy = cloneState(state);
      applyMove(copy, move, { recordCapture: false });
      return !kingInEnemyRange(copy, side) && !inCheckByNonKing(copy, side);
    });
}

function inside(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function destinationOkay(state, side, r, c) {
  return inside(r, c) && (state.board[r][c] === '.' || colorOf(state.board[r][c]) !== side);
}

export function pseudoMoves(state, side) {
  const moves = [];
  const add = (from, to, special = null) => moves.push({ from, to, special });
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = state.board[r][c];
    if (piece === '.' || colorOf(piece) !== side) continue;
    const kind = piece.toLowerCase();
    if (kind === 'p') {
      const step = side === WHITE ? -1 : 1, start = side === WHITE ? 6 : 1, next = r + step;
      if (inside(next, c) && state.board[next][c] === '.') {
        add([r, c], [next, c]);
        if (r === start && state.board[r + 2 * step][c] === '.') add([r, c], [r + 2 * step, c]);
      }
      for (const dc of [-1, 1]) {
        const nr = r + step, nc = c + dc;
        if (!inside(nr, nc)) continue;
        if (state.board[nr][nc] !== '.' && colorOf(state.board[nr][nc]) !== side) add([r, c], [nr, nc]);
        else if (state.enPassant && state.enPassant[0] === nr && state.enPassant[1] === nc) add([r, c], [nr, nc], 'ep');
      }
      if (state.augments?.beginner?.[side] > 0) {
        const back = r - step;
        if (inside(back,c) && state.board[back][c] === '.') add([r,c],[back,c]);
        for (const dc of [-1,1]) { const nr=back,nc=c+dc; if(inside(nr,nc)&&state.board[nr][nc]!=='.'&&colorOf(state.board[nr][nc])!==side)add([r,c],[nr,nc]); }
      }
    } else if (kind === 'n') {
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const nr = r + dr, nc = c + dc;
        if (destinationOkay(state, side, nr, nc)) add([r, c], [nr, nc]);
      }
    } else if (kind === 'a') {
      for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const nr=r+dr,nc=c+dc; if(destinationOkay(state,side,nr,nc)) add([r,c],[nr,nc]);
      }
      for (const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]) {
        let nr=r+dr,nc=c+dc; while(inside(nr,nc)){if(state.board[nr][nc]==='.')add([r,c],[nr,nc]);else{if(colorOf(state.board[nr][nc])!==side)add([r,c],[nr,nc]);break;}nr+=dr;nc+=dc;}
      }
    } else if ('brq'.includes(kind)) {
      const dirs = [];
      if ('bq'.includes(kind)) dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
      if ('rq'.includes(kind)) dirs.push([-1,0],[1,0],[0,-1],[0,1]);
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (inside(nr, nc)) {
          if (state.board[nr][nc] === '.') add([r, c], [nr, nc]);
          else { if (colorOf(state.board[nr][nc]) !== side) add([r, c], [nr, nc]); break; }
          nr += dr; nc += dc;
        }
      }
    } else {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        if (destinationOkay(state, side, r + dr, c + dc)) add([r, c], [r + dr, c + dc]);
      }
      const home = side === WHITE ? 7 : 0;
      if (r === home && c === 4 && !inCheck(state, side)) {
        const rights = side === WHITE ? [['K', 7, [5,6], 6, [5,6]], ['Q', 0, [3,2], 2, [1,2,3]]] : [['k', 7, [5,6], 6, [5,6]], ['q', 0, [3,2], 2, [1,2,3]]];
        for (const [right, rookCol, path, dest, between] of rights) {
          const rook = side === WHITE ? 'R' : 'r';
          if (!state.castling.has(right) || state.board[home][rookCol] !== rook) continue;
          if (between.some(col => state.board[home][col] !== '.')) continue;
          if (path.some(col => isAttacked(state, [home, col], opposite(side)))) continue;
          add([home, 4], [home, dest], 'castle');
        }
      }
    }
  }
  return moves;
}

export function applyMove(state, move, { recordCapture = true, markMoved = false } = {}) {
  const [r, c] = move.from, [nr, nc] = move.to;
  const piece = state.board[r][c], movingId = state.ids[r][c];
  let captured = state.board[nr][nc], capturedId = state.ids[nr][nc];
  if (captured.toLowerCase() === 'a') {
    if (recordCapture) state.graveyard.push(piece.toLowerCase());
    const hp = Math.max(0, (state.augments?.giantHits?.[capturedId] ?? 3) - 1);
    if (state.augments?.giantHits) state.augments.giantHits[capturedId] = hp;
    state.board[r][c]='.'; state.ids[r][c]=null; state.moved.delete(movingId);
    if (hp === 0) { if(recordCapture)state.graveyard.push('a'); state.board[nr][nc]='.';state.ids[nr][nc]=null;delete state.augments.giantHits[capturedId]; }
    state.lastMove={from:move.from.slice(),to:move.to.slice()};
    return { captured: piece, giantHit: true, giantDestroyed: hp===0 };
  }
  if (move.special === 'ep') {
    const capRow = nr + (colorOf(piece) === WHITE ? 1 : -1);
    captured = state.board[capRow][nc]; capturedId = state.ids[capRow][nc];
    state.board[capRow][nc] = '.'; state.ids[capRow][nc] = null;
  }
  if (recordCapture && captured !== '.') state.graveyard.push(captured.toLowerCase());
  if (capturedId !== null && capturedId !== undefined) delete state.augments?.traps?.[capturedId];
  if (recordCapture && captured?.toLowerCase() === 'k') state.winner = state.turnPlayer;
  if (capturedId !== null && capturedId !== undefined) state.moved.delete(capturedId);
  state.board[r][c] = '.'; state.ids[r][c] = null;
  state.board[nr][nc] = piece; state.ids[nr][nc] = movingId;
  state.enPassant = piece.toLowerCase() === 'p' && Math.abs(nr-r) === 2 ? [(r+nr)/2, c] : null;
  let rookId = null;
  if (move.special === 'castle') {
    const rookFrom = nc === 6 ? 7 : 0, rookTo = nc === 6 ? 5 : 3;
    rookId = state.ids[nr][rookFrom];
    state.board[nr][rookTo] = state.board[nr][rookFrom]; state.board[nr][rookFrom] = '.';
    state.ids[nr][rookTo] = rookId; state.ids[nr][rookFrom] = null;
  }
  if (piece.toLowerCase() === 'a') state.augments.giantPrevious[movingId] = move.from.slice();
  if (piece.toLowerCase() === 'k') state.augments.kingPrevious[movingId] = move.from.slice();
  if (markMoved && movingId !== null) state.moved.add(movingId);
  if (markMoved && rookId !== null) state.moved.add(rookId);
  if (piece === 'K') { state.castling.delete('K'); state.castling.delete('Q'); }
  if (piece === 'k') { state.castling.delete('k'); state.castling.delete('q'); }
  const lostRights = new Map([['7,7','K'],['7,0','Q'],['0,7','k'],['0,0','q']]);
  for (const pos of [move.from, move.to]) { const right = lostRights.get(pos.join(',')); if (right) state.castling.delete(right); }
  const last = colorOf(piece) === WHITE ? 0 : 7;
  if (piece.toLowerCase() === 'p' && (nr === last || state.augments?.beginner?.[colorOf(piece)] > 0 && [0,7].includes(nr))) {
    const requested = move.promotion || 'q';
    state.board[nr][nc] = colorOf(piece) === WHITE ? requested.toUpperCase() : requested;
  }
  if (captured?.toLowerCase() === 'k') state.kingEscapeRequired = null;
  else if (piece.toLowerCase() === 'k') {
    const side = colorOf(piece);
    if (kingInEnemyRange(state, side)) state.kingEscapeRequired = { side, pieceId: movingId };
    else if (state.kingEscapeRequired?.pieceId === movingId) state.kingEscapeRequired = null;
  }
  state.lastMove = { from: move.from.slice(), to: move.to.slice() };
  return { captured };
}

function safeAfter(state, side, move) {
  const copy = cloneState(state);
  applyMove(copy, move, { recordCapture: false });
  return !inCheck(copy, side);
}

function canEnterEnemyKingRange(state, side, move) {
  const piece = state.board[move.from[0]][move.from[1]], target = state.board[move.to[0]][move.to[1]];
  if (piece.toLowerCase() !== 'k' || target.toLowerCase() === 'k' || !kingInEnemyRange(state, side, move.to)) return false;
  const kingId = state.ids[move.from[0]][move.from[1]];
  if (state.actionsLeft < 2) return false;
  const copy = cloneState(state);
  applyMove(copy, move, { recordCapture: false });
  return !inCheckByNonKing(copy, side) && hasSafeKingEscape(copy, side, kingId);
}

export function legalMoves(state, side, { strict = false } = {}) {
  const firstTurn = isFirstTurnForSide(state, side);
  let candidates = pseudoMoves(state, side).filter(move => {
    const target = state.board[move.to[0]][move.to[1]];
    const id = state.ids[move.from[0]][move.from[1]];
    const backRank = side === WHITE ? 0 : 7;
    const targetSide = colorOf(target), king = targetSide && kingSquare(state,targetSide);
    const protectedByDna = target !== '.' && target.toLowerCase() !== 'k' && state.augments?.kingDna?.[targetSide] && king && Math.max(Math.abs(king[0]-move.to[0]),Math.abs(king[1]-move.to[1])) <= 1;
    const protectedByAlz = target !== '.' && targetSide && state.augments?.alz?.[targetSide] > 0;
    return !(firstTurn && move.to[0] === backRank) && !(target.toLowerCase() === 'k' && state.moved.has(id)) && !protectedByDna && !protectedByAlz;
  });
  if (state.kingEscapeRequired?.side === side) {
    const { pieceId } = state.kingEscapeRequired;
    candidates = candidates.filter(move => {
      if (state.ids[move.from[0]][move.from[1]] !== pieceId) return false;
      return state.board[move.to[0]][move.to[1]].toLowerCase() === 'k' || !kingInEnemyRange(state, side, move.to);
    });
  }
  candidates = candidates.filter(move => {
    const movingPiece = state.board[move.from[0]][move.from[1]];
    const target = state.board[move.to[0]][move.to[1]];
    if (movingPiece.toLowerCase() !== 'k' || target.toLowerCase() === 'k' || !kingInEnemyRange(state, side, move.to)) return true;
    return canEnterEnemyKingRange(state, side, move);
  });
  if (firstTurn) {
    candidates = candidates.filter(move => {
      const copy = cloneState(state); applyMove(copy, move, { recordCapture: false });
      return !inCheck(copy, WHITE) && !inCheck(copy, BLACK);
    });
  }
  if (strict) return candidates.filter(move => {
    if (state.board[move.to[0]][move.to[1]].toLowerCase() === 'k') return false;
    return safeAfter(state, side, move);
  });
  if (inCheck(state, side)) {
    const kingCaptures = candidates.filter(move => state.board[move.to[0]][move.to[1]].toLowerCase() === 'k');
    const protectors = candidates.filter(move => {
      const piece = state.board[move.from[0]][move.from[1]];
      return piece.toLowerCase() !== 'k' && !kingCaptures.includes(move) && safeAfter(state, side, move);
    });
    // A checked side may move the king; other pieces may move when that move shields the king.
    return [...protectors, ...candidates.filter(move => state.board[move.from[0]][move.from[1]].toLowerCase() === 'k'), ...kingCaptures];
  }
  return candidates.filter(move => state.board[move.to[0]][move.to[1]].toLowerCase() === 'k' || safeAfter(state, side, move) || canEnterEnemyKingRange(state, side, move));
}

export function isCheckmated(state, side) {
  return inCheck(state, side) && legalMoves(state, side, { strict: true }).length === 0;
}

export function resurrectionSquares(state, side) {
  const rows = side === WHITE ? [7,6,5,4] : [0,1,2,3];
  const cols = side === WHITE ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
  return rows.flatMap(r => cols.filter(c => state.board[r][c] === '.').map(c => [r,c]));
}

export function revive(state, graveIndex, square) {
  const piece = state.graveyard[graveIndex];
  if (!piece || !resurrectionSquares(state, state.playerSides[state.turnPlayer]).some(pos => pos[0] === square[0] && pos[1] === square[1])) return false;
  const side = state.playerSides[state.turnPlayer], candidate = cloneState(state);
  candidate.board[square[0]][square[1]] = side === WHITE ? piece.toUpperCase() : piece;
  if (isFirstTurnForSide(state, side) && (inCheck(candidate, WHITE) || inCheck(candidate, BLACK))) return false;
  state.graveyard.splice(graveIndex, 1);
  state.board[square[0]][square[1]] = side === WHITE ? piece.toUpperCase() : piece;
  state.ids[square[0]][square[1]] = state.nextId++;
  if(piece.toLowerCase()==='a')state.augments.giantHits[state.ids[square[0]][square[1]]]=3;
  return true;
}

export function transform(state, square, target) {
  const [r,c] = square, piece = state.board[r][c], side = state.playerSides[state.turnPlayer];
  if (piece === '.' || colorOf(piece) !== side || piece.toLowerCase() === 'k' || !'qrbnp'.includes(target)) return false;
  const old = state.board[r][c]; state.board[r][c] = side === WHITE ? target.toUpperCase() : target;
  if (isFirstTurnForSide(state, side) && (inCheck(state, WHITE) || inCheck(state, BLACK))) { state.board[r][c] = old; return false; }
  if (old.toLowerCase() === 'r') {
    const rights = new Map([['7,7','K'],['7,0','Q'],['0,7','k'],['0,0','q']]);
    const right = rights.get(square.join(',')); if (right) state.castling.delete(right);
  }
  return true;
}

export function reverseSides(state) {
  // Keep the board and piece colors; swap player control and rotate the view.
  state.playerSides.reverse();
  state.boardRotated = !state.boardRotated;
}

export function randomizePositions(state) {
  const pieces = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (state.board[r][c] !== '.') pieces.push([state.board[r][c], state.ids[r][c]]);
  const oldBoard = state.board, oldIds = state.ids;
  for (let attempt = 0; attempt < 5000; attempt++) {
    const shuffled = pieces.slice().sort(() => Math.random() - .5), squares = Array.from({length:64}, (_,i) => i).sort(() => Math.random() - .5);
    const board = Array.from({length:8}, () => Array(8).fill('.')), ids = Array.from({length:8}, () => Array(8).fill(null));
    shuffled.forEach(([piece,id],i) => { const sq=squares[i]; board[Math.floor(sq/8)][sq%8]=piece; ids[Math.floor(sq/8)][sq%8]=id; });
    state.board=board; state.ids=ids;
    if (!inCheck(state, WHITE) && !inCheck(state, BLACK)) { state.enPassant=null; state.castling.clear(); return true; }
  }
  state.board=oldBoard; state.ids=oldIds; return false;
}

export function reverseCoordinate(position) {
  return [7 - position[0], 7 - position[1]];
}
