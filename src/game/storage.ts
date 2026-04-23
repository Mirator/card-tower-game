import type { GameMetaV1 } from './types';

const STORAGE_KEY = 'card-tower-game.meta.v1';

const DEFAULT_META: GameMetaV1 = {
  version: 1,
  stats: {
    wins: 0,
    losses: 0,
    matchesPlayed: 0,
  },
  settings: {
    animations: true,
  },
};

function isMeta(value: unknown): value is GameMetaV1 {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as GameMetaV1;
  return (
    maybe.version === 1 &&
    typeof maybe.stats?.wins === 'number' &&
    typeof maybe.stats?.losses === 'number' &&
    typeof maybe.stats?.matchesPlayed === 'number' &&
    typeof maybe.settings?.animations === 'boolean'
  );
}

export function loadMeta(): GameMetaV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return structuredClone(DEFAULT_META);
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isMeta(parsed)) {
      return structuredClone(DEFAULT_META);
    }

    return parsed;
  } catch {
    return structuredClone(DEFAULT_META);
  }
}

export function saveMeta(meta: GameMetaV1): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
}

export function updateMeta(mutator: (meta: GameMetaV1) => GameMetaV1): GameMetaV1 {
  const next = mutator(loadMeta());
  saveMeta(next);
  return next;
}

export function resetMeta(): GameMetaV1 {
  saveMeta(DEFAULT_META);
  return structuredClone(DEFAULT_META);
}
