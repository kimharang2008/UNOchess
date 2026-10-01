import { BLACK, WHITE, reverseSides, randomizePositions } from './chess.js';

// Card mix is 65% numeric and 35% special; these are weights within each group.
export const NUMBER_PERCENTAGES = [5, 16, 16, 16, 12, 12, 6, 6, 6, 5];
export const SPECIAL_WEIGHTS = [
  ['금지', 16], ['+2', 16], ['와일드', 16], ['리버스', 15],
  ['와일드 리버스', 15], ['특수증강 와일드', 11], ['+4 와일드', 11],
];

const GROUP_SCALE = 40; // 4,000 cards keeps both probability groups exact.
export const NUMBER_COUNTS = NUMBER_PERCENTAGES.map(percent => Math.round(percent * 0.65 * GROUP_SCALE));
export const SPECIAL_COUNTS = SPECIAL_WEIGHTS.map(([, percent]) => Math.round(percent * 0.35 * GROUP_SCALE));

export function createDeck() {
  const cards = [];
  NUMBER_COUNTS.forEach((count, number) => { for (let i = 0; i < count; i++) cards.push(String(number)); });
  SPECIAL_WEIGHTS.forEach(([card], index) => { for (let i = 0; i < SPECIAL_COUNTS[index]; i++) cards.push(card); });
  return shuffle(cards);
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function drawCard(state) {
  if (!state.deck.length) state.deck = createDeck();
  return state.deck.pop();
}

export async function resolveCard(state, card, ui) {
  if (/^\d$/.test(card)) return { actions: Number(card), messages: [`남은 턴 ${card}회`] };
  if (card === '+2' || card === '+4 와일드') {
    const target = card === '+2' ? 2 : 4;
    const revived = await ui.chooseResurrections(state, target);
    const messages = [`기물 ${revived}/${target}명을 부활시킬 수 있습니다.`];
    if (card === '+4 와일드') {
      if (revived === 4) return { actions: 1, messages: [...messages, '원하는 기물을 프로모션 하세요!'], pendingTransform: true };
      else return { actions: 1, messages: [...messages, '부활할 기물이 부족해 승급만 진행합니다.'], pendingTransform: true };
    }
    return { actions: null, messages };
  }
  if (card === '금지') return { actions: null, messages: ['턴 스킵!'] };
  if (card === '리버스') {
    reverseSides(state);
    const sideName = state.playerSides[state.turnPlayer] === 'w' ? '백' : '흑';
    const turnLabel = `플레이어${state.turnPlayer + 1}(${sideName})의 차례`;
    return { actions: null, messages: [`진영 변경! ${turnLabel}입니다. 같은 플레이어가 새 진영으로 다시 카드를 뽑습니다.`], repeatDraw: true };
  }
  if (card === '와일드') {
    return { actions: 1, messages: ['원하는 기물을 프로모션 하세요!'], pendingTransform: true };
  }
  if (card === '와일드 리버스') {
    const randomized = randomizePositions(state);
    if (randomized) {
      const pending = new Set(state.pendingCampPromotions || []);
      for (const side of [WHITE, BLACK]) {
        const pawn = side === WHITE ? 'P' : 'p';
        const promotionRow = side === WHITE ? 0 : 7;
        if (state.board[promotionRow].includes(pawn)) pending.add(side);
      }
      state.pendingCampPromotions = [...pending];
    }
    return { actions: null, messages: [randomized ? '와일드 리버스 발동! 기물 위치를 섞었습니다.' : '와일드 리버스 발동! 체크 없는 배치를 찾지 못했습니다.'] };
  }
  if (card === '특수증강 와일드') return { actions: 1, messages: ['특수 증강을 선택하세요! 한 번 행동할 수 있습니다.'], pendingAugment: true };
  return { actions: null, messages: [`알 수 없는 카드: ${card}`] };
}
