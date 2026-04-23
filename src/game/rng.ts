import type { RandomSource } from './types';

export class SeededRng implements RandomSource {
  private state: number;

  constructor(seed: number) {
    const normalized = seed >>> 0;
    this.state = normalized === 0 ? 0x9e3779b9 : normalized;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  int(maxExclusive: number): number {
    if (maxExclusive <= 0) {
      return 0;
    }
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return values[this.int(values.length)];
  }

  fork(salt: number): SeededRng {
    return new SeededRng((this.state ^ salt) >>> 0);
  }
}

export function seedFromNow(): number {
  return Math.floor((Date.now() ^ performance.now()) >>> 0);
}
