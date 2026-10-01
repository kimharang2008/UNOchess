import { createState } from '../src/chess.js';
import { createDeck } from '../src/uno.js';

export function emptyState({ turnPlayer = 0, sides = ['w', 'b'], firstTurn = false } = {}) {
  const state = createState(createDeck());
  state.board = Array.from({ length: 8 }, () => Array(8).fill('.'));
  state.ids = Array.from({ length: 8 }, () => Array(8).fill(null));
  state.nextId = 1;
  state.moved.clear();
  state.graveyard = [];
  state.castling.clear();
  state.enPassant = null;
  state.turnPlayer = turnPlayer;
  state.playerSides = sides.slice();
  state.firstTurn = firstTurn;
  return state;
}

export function put(state, square, piece) {
  const row = 8 - Number(square[1]), col = square.charCodeAt(0) - 97;
  state.board[row][col] = piece;
  state.ids[row][col] = state.nextId++;
  return state.ids[row][col];
}

export const coords = square => [8 - Number(square[1]), square.charCodeAt(0) - 97];
export const at = (state, square) => { const [r, c] = coords(square); return state.board[r][c]; };
export const idAt = (state, square) => { const [r, c] = coords(square); return state.ids[r][c]; };
export const moveNamed = (moves, from, to) => moves.find(move => move.from.join(',') === coords(from).join(',') && move.to.join(',') === coords(to).join(','));
