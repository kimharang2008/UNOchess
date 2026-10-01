import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, legalMoves, pseudoMoves, reverseSides, transform } from '../src/chess.js';
import { at, coords, emptyState, idAt, moveNamed, put } from './helpers.js';

test('캐슬링은 킹과 룩을 함께 옮기고 두 기물 모두 이동 기록을 남긴다', () => {
  const state = emptyState();
  const kingId = put(state, 'e1', 'K'), rookId = put(state, 'h1', 'R'); put(state, 'e8', 'k');
  state.castling.add('K');
  const castle = moveNamed(legalMoves(state, 'w'), 'e1', 'g1');
  assert.ok(castle);
  applyMove(state, castle, { markMoved: true });
  assert.equal(at(state, 'g1'), 'K'); assert.equal(at(state, 'f1'), 'R');
  assert.ok(state.moved.has(kingId)); assert.ok(state.moved.has(rookId));
});

test('앙파상은 옆의 폰을 공동묘지로 보내고 도착 칸에 폰을 둔다', () => {
  const state = emptyState();
  put(state, 'h1', 'K'); put(state, 'e5', 'P'); put(state, 'd5', 'p'); put(state, 'a8', 'k');
  state.enPassant = coords('d6');
  const move = moveNamed(legalMoves(state, 'w'), 'e5', 'd6');
  assert.equal(move.special, 'ep');
  applyMove(state, move, { markMoved: true });
  assert.equal(at(state, 'd6'), 'P'); assert.equal(at(state, 'd5'), '.');
  assert.equal(state.graveyard.at(-1), 'p');
});

test('폰 승격은 선택한 종류와 기존 기물 ID를 유지한다', () => {
  const state = emptyState();
  put(state, 'a1', 'K'); const pawnId = put(state, 'e7', 'P'); put(state, 'h8', 'k');
  const move = { ...moveNamed(legalMoves(state, 'w'), 'e7', 'e8'), promotion: 'n' };
  applyMove(state, move, { markMoved: true });
  assert.equal(at(state, 'e8'), 'N');
  assert.equal(idAt(state, 'e8'), pawnId);
});

test('일반 리버스는 기물 위치를 유지하고 플레이어의 진영만 바꾼다', () => {
  const state = emptyState();
  const kingId = put(state, 'e1', 'K'); put(state, 'e8', 'k'); put(state, 'a1', 'R');
  reverseSides(state);
  assert.equal(at(state, 'e1'), 'K');
  assert.equal(at(state, 'e8'), 'k');
  assert.equal(at(state, 'a1'), 'R');
  assert.equal(idAt(state, 'e1'), kingId);
  assert.deepEqual(state.playerSides, ['b','w']);
  assert.equal(state.boardRotated, true);
});

test('첫 턴 포획 자격은 카드 행동 동안 유지되고 다음 턴 초기화로 풀린다', () => {
  const state = emptyState();
  put(state, 'a1', 'K'); const queenId = put(state, 'd2', 'Q'); put(state, 'e4', 'k');
  const first = moveNamed(legalMoves(state, 'w'), 'd2', 'e2');
  applyMove(state, first, { markMoved: true });
  assert.equal(moveNamed(legalMoves(state, 'w'), 'e2', 'e4'), undefined);
  state.moved.clear();
  assert.ok(moveNamed(legalMoves(state, 'w'), 'e2', 'e4'));
  assert.equal(idAt(state, 'e2'), queenId);
});

test('와일드 변환은 킹은 제외하고 기물 종류를 바꾼다', () => {
  const state = emptyState();
  put(state, 'e1', 'K'); put(state, 'e8', 'k'); put(state, 'c3', 'B');
  assert.equal(transform(state, coords('c3'), 'q'), true);
  assert.equal(at(state, 'c3'), 'Q');
  assert.equal(transform(state, coords('e1'), 'q'), false);
});

test('거신병은 퀸과 나이트처럼 움직이고 공격받으면 공격자를 쓰러뜨린다', () => {
  const state=emptyState();put(state,'h1','K');put(state,'h8','k');put(state,'a4','R');
  const giantId=put(state,'d4','a');state.augments.giantHits[giantId]=3;
  assert.ok(pseudoMoves(state,'b').some(move=>move.from.join(',')===coords('d4').join(',')&&move.to.join(',')===coords('e6').join(',')));
  applyMove(state,{from:coords('a4'),to:coords('d4')});
  assert.equal(at(state,'a4'),'.');assert.equal(at(state,'d4'),'a');
  assert.equal(state.augments.giantHits[giantId],2);assert.equal(state.graveyard.at(-1),'r');
});

test('체스 처음 해봄 효과는 폰의 후진 수를 허용한다', () => {
  const state=emptyState();put(state,'a1','K');put(state,'h8','k');put(state,'d4','P');state.augments.beginner.w=2;
  assert.ok(pseudoMoves(state,'w').some(move=>move.from.join(',')===coords('d4').join(',')&&move.to.join(',')===coords('d3').join(',')));
});

test('왕의 DNA와 알츠하이머는 지정된 기물 포획을 막는다', () => {
  for(const effect of ['kingDna','alz']){
    const state=emptyState();put(state,'a1','K');put(state,'e7','k');put(state,'d4','Q');put(state,'d6','p');
    state.augments[effect].b=effect==='alz'?3:true;
    assert.equal(moveNamed(legalMoves(state,'w'),'d4','d6'),undefined);
  }
});
