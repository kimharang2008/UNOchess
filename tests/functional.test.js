import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, currentSide, legalMoves, nameOf, revive } from '../src/chess.js';
import { createDeck, NUMBER_COUNTS, SPECIAL_COUNTS, resolveCard } from '../src/uno.js';
import { at, coords, emptyState, moveNamed, put } from './helpers.js';

test('초기 보드와 백의 기본 합법 수를 만든다', () => {
  const state = emptyState({ firstTurn: true });
  state.board = [Array.from('rnbqkbnr'), Array(8).fill('p'), ...Array.from({ length: 4 }, () => Array(8).fill('.')), Array(8).fill('P'), Array.from('RNBQKBNR')];
  state.ids = state.board.map(row => row.map(() => null));
  for (let r=0;r<8;r++) for(let c=0;c<8;c++) if(state.board[r][c]!=='.') state.ids[r][c]=state.nextId++;
  assert.equal(legalMoves(state, 'w').length, 20);
});

test('카드 덱은 숫자 65%, 특수 35% 비율과 지정된 숫자 확률을 반영한다', () => {
  const deck = createDeck();
  assert.equal(deck.length, 4000);
  for (let n=0;n<=9;n++) assert.equal(deck.filter(card => card === String(n)).length, NUMBER_COUNTS[n]);
  for (let i=0;i<SPECIAL_COUNTS.length;i++) assert.equal(deck.filter(card => card === ['금지','+2','와일드','리버스','와일드 리버스','특수증강 와일드','+4 와일드'][i]).length, SPECIAL_COUNTS[i]);
  assert.equal(deck.filter(card => !/^\d$/.test(card)).length, 1400);
  assert.equal(NUMBER_COUNTS.reduce((sum, n) => sum+n, 0), 2600);
});

test('첫 이동 전인 퀸은 킹을 직접 잡을 수 있고 승격 이름을 보여준다', () => {
  const state = emptyState();
  put(state, 'a1', 'K'); put(state, 'd2', 'Q'); put(state, 'd4', 'k');
  const move = moveNamed(legalMoves(state, 'w'), 'd2', 'd4');
  assert.ok(move);
  const { captured } = applyMove(state, move, { markMoved: true });
  assert.equal(at(state, 'd4'), 'Q');
  assert.equal(captured.toLowerCase(), 'k');
  assert.equal(state.winner, 0);
  assert.equal(state.graveyard.at(-1), 'k');
  assert.equal(at(state, 'd4'), 'Q');
  assert.equal(nameOf('q'), '퀸');
});

test('묘지에서 선택한 기물을 지정한 아군 필드 칸에 부활시킨다', () => {
  const state = emptyState();
  put(state, 'e1', 'K'); put(state, 'e8', 'k');
  state.graveyard = ['n', 'q'];
  assert.equal(revive(state, 1, coords('h4')), true);
  assert.equal(at(state, 'h4'), 'Q');
  assert.deepEqual(state.graveyard, ['n']);
});

test('흑의 첫 행동은 h8부터 a5까지 자기 진영 범위를 사용한다', () => {
  const state = emptyState({ turnPlayer: 1 });
  put(state, 'e1', 'K'); put(state, 'e8', 'k'); state.graveyard = ['r'];
  assert.equal(revive(state, 0, coords('h8')), true);
  assert.equal(at(state, 'h8'), 'r');
  assert.equal(currentSide(state), 'b');
});

test('+2와 +4는 선택 부활 과정을 각각 두 번과 네 번 요청한다', async () => {
  const state = emptyState();
  const calls = [];
  const ui = {
    async chooseResurrections(_state, count) { calls.push(count); return count; },
  };
  await resolveCard(state, '+2', ui);
  const result = await resolveCard(state, '+4 와일드', ui);
  assert.deepEqual(calls, [2, 4]);
  assert.equal(result.pendingTransform, true);
  assert.equal(result.actions, 1);
  const wild = await resolveCard(state, '와일드', ui);
  assert.equal(wild.pendingTransform, true);
  assert.equal(wild.actions, 1);
});

test('특수증강 와일드는 증강 선택과 1회 행동을 제공한다', async () => {
  const result = await resolveCard(emptyState(), '특수증강 와일드', {});
  assert.equal(result.pendingAugment, true);
  assert.equal(result.actions, 1);
});
