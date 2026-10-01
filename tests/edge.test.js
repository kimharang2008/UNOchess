import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, inCheck, isCheckmated, legalMoves, revive } from '../src/chess.js';
import { at, coords, emptyState, moveNamed, put } from './helpers.js';

test('같은 턴에 이미 움직인 퀸은 다음 행동으로 킹을 잡지 못한다', () => {
  const state = emptyState();
  put(state, 'a1', 'K'); const queenId = put(state, 'd2', 'Q'); put(state, 'e4', 'k');
  const first = moveNamed(legalMoves(state, 'w'), 'd2', 'e2');
  assert.ok(first);
  applyMove(state, first, { markMoved: true });
  assert.ok(state.moved.has(queenId));
  assert.equal(moveNamed(legalMoves(state, 'w'), 'e2', 'e4'), undefined);
});

test('킹을 잡는 첫 수는 가능하고 턴 기록은 기물 이동 후 보존된다', () => {
  const state = emptyState();
  put(state, 'a1', 'K'); const queenId = put(state, 'd2', 'Q'); put(state, 'd4', 'k');
  assert.ok(moveNamed(legalMoves(state, 'w'), 'd2', 'd4'));
  const move = moveNamed(legalMoves(state, 'w'), 'd2', 'd3');
  applyMove(state, move, { markMoved: true });
  assert.ok(state.moved.has(queenId));
});

test('체크 중 아군 룩이 공격 경로를 막는 수로 킹을 보호할 수 있다', () => {
  const state = emptyState({ turnPlayer: 1 });
  put(state, 'a1', 'K'); put(state, 'h8', 'R'); put(state, 'd8', 'k'); put(state, 'f7', 'r');
  assert.equal(inCheck(state, 'b'), true);
  const block = moveNamed(legalMoves(state, 'b'), 'f7', 'f8');
  assert.ok(block);
  applyMove(state, block);
  assert.equal(inCheck(state, 'b'), false);
});

test('체크메이트는 게임 상태로 남고 킹은 계속 이동할 수 있다', () => {
  const state = emptyState({ turnPlayer: 1 });
  put(state, 'f6', 'K'); put(state, 'g7', 'Q'); put(state, 'h8', 'k');
  assert.equal(isCheckmated(state, 'b'), true);
  const kingMoves = legalMoves(state, 'b').filter(move => state.board[move.from[0]][move.from[1]] === 'k');
  assert.ok(kingMoves.length > 0);
});

test('첫 턴에는 어느 쪽에도 체크를 만드는 수를 둘 수 없다', () => {
  const state = emptyState({ firstTurn: true });
  put(state, 'a1', 'K'); put(state, 'e2', 'R'); put(state, 'e8', 'k');
  assert.equal(moveNamed(legalMoves(state, 'w'), 'e2', 'e7'), undefined);
});

test('부활은 내 진영 밖이나 점유된 칸을 거부하며 묘지는 보존한다', () => {
  const state = emptyState();
  put(state, 'e1', 'K'); put(state, 'e8', 'k'); put(state, 'h4', 'N');
  state.graveyard = ['q'];
  assert.equal(revive(state, 0, coords('a5')), false);
  assert.equal(revive(state, 0, coords('h4')), false);
  assert.deepEqual(state.graveyard, ['q']);
});
