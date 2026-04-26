import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameMetaV1 } from '../src/game/types';
import { loadMeta, resetMeta, saveMeta, updateMeta } from '../src/game/storage';

function stubStorage(initial: Record<string, string> = {}, throwsOnSet = false): Storage {
  const values = new Map(Object.entries(initial));
  const storage = {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => {
      if (throwsOnSet) {
        throw new Error('Storage write blocked');
      }
      values.set(key, value);
    }),
  };

  vi.stubGlobal('localStorage', storage);
  return storage as unknown as Storage;
}

const customMeta: GameMetaV1 = {
  version: 1,
  stats: {
    wins: 2,
    losses: 1,
    matchesPlayed: 3,
  },
  settings: {
    animations: false,
  },
};

describe('meta storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves and loads valid meta', () => {
    stubStorage();

    expect(saveMeta(customMeta)).toBe(true);
    expect(loadMeta()).toEqual(customMeta);
  });

  it('does not throw when browser storage rejects writes', () => {
    stubStorage({}, true);

    expect(saveMeta(customMeta)).toBe(false);
    expect(() => resetMeta()).not.toThrow();
    expect(() => {
      updateMeta((prev) => ({
        ...prev,
        stats: {
          ...prev.stats,
          wins: prev.stats.wins + 1,
        },
      }));
    }).not.toThrow();
  });

  it('still returns the updated in-memory meta when persistence fails', () => {
    stubStorage({}, true);

    const updated = updateMeta((prev) => ({
      ...prev,
      stats: {
        ...prev.stats,
        matchesPlayed: prev.stats.matchesPlayed + 1,
      },
    }));

    expect(updated.stats.matchesPlayed).toBe(1);
  });
});
