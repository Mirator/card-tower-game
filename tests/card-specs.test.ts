import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_BY_ID, STARTER_DECK_CARD_IDS } from '../src/game/cards';
import type { Resource } from '../src/game/types';

interface SpecCard {
  copies: number;
  name: string;
  cost: number;
  text: string;
  domain: Resource;
}

const SPEC_FILES: Array<{ path: string; domain: Resource }> = [
  ['../specs/05-brick-cards.md', 'bricks'],
  ['../specs/06-weapon-cards.md', 'weapons'],
  ['../specs/07-crystal-cards.md', 'crystals'],
].map(([path, domain]) => ({ path, domain: domain as Resource }));

function parseCardRows(path: string, domain: Resource): SpecCard[] {
  const markdown = readFileSync(new URL(path, import.meta.url), 'utf8');
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
      return {
        copies: Number(cells[0]),
        name: cells[1],
        cost: Number(cells[2]),
        text: cells[3],
        domain,
      };
    });
}

describe('card specs', () => {
  it('match the active 30-card starter deck', () => {
    const specCards = SPEC_FILES.flatMap(({ path, domain }) => parseCardRows(path, domain));
    const starterCounts = STARTER_DECK_CARD_IDS.reduce<Record<string, number>>((acc, cardId) => {
      acc[cardId] = (acc[cardId] ?? 0) + 1;
      return acc;
    }, {});

    const starterByName = new Map(
      Object.entries(starterCounts).map(([cardId, copies]) => {
        const card = CARD_BY_ID[cardId];
        return [
          card.name,
          {
            copies,
            cost: card.cost,
            text: card.text,
            domain: card.domain,
          },
        ];
      }),
    );

    expect(specCards).toHaveLength(starterByName.size);

    for (const specCard of specCards) {
      expect(starterByName.get(specCard.name)).toEqual({
        copies: specCard.copies,
        cost: specCard.cost,
        text: specCard.text,
        domain: specCard.domain,
      });
    }

    expect(specCards.map((card) => card.name).sort()).toEqual([...starterByName.keys()].sort());
    expect(STARTER_DECK_CARD_IDS).toHaveLength(30);
  });
});
