import Phaser from 'phaser';
import type { CardDefinition, CardIllustrationKey, Resource } from '../../game/types';

export const FONT_FAMILY = 'Georgia';

export const THEME = {
  parchment: 0xf3efe4,
  playerBlue: 0x4a74c9,
  playerBlack: 0x252832,
  enemyRed: 0x9b514d,
  brick: 0xa88746,
  weapon: 0xb5433c,
  crystal: 0x4a74c9,
  gold: 0xffe2b8,
  night: 0x0b1726,
};

export const ANIMATION_PACE = 1.5;

export function animDuration(ms: number): number {
  return Math.round(ms * ANIMATION_PACE);
}

export function animDelay(ms: number): number {
  return Math.round(ms * ANIMATION_PACE);
}

export const RESOURCE_META: Record<
  Resource,
  { label: string; resourceName: string; color: number; generatorKey: 'quarry' | 'barracks' | 'magic' }
> = {
  bricks: {
    label: 'Builders',
    resourceName: 'Bricks',
    color: THEME.brick,
    generatorKey: 'quarry',
  },
  weapons: {
    label: 'Soldiers',
    resourceName: 'Weapons',
    color: THEME.weapon,
    generatorKey: 'barracks',
  },
  crystals: {
    label: 'Mages',
    resourceName: 'Crystals',
    color: THEME.crystal,
    generatorKey: 'magic',
  },
};

export function cardTypeColor(domain: Resource): number {
  if (domain === 'bricks') {
    return THEME.brick;
  }
  if (domain === 'weapons') {
    return THEME.weapon;
  }
  return THEME.crystal;
}

export function mixColor(from: number, to: number, amount: number): number {
  const fromRed = (from >> 16) & 0xff;
  const fromGreen = (from >> 8) & 0xff;
  const fromBlue = from & 0xff;
  const toRed = (to >> 16) & 0xff;
  const toGreen = (to >> 8) & 0xff;
  const toBlue = to & 0xff;

  const red = Math.round(fromRed + (toRed - fromRed) * amount);
  const green = Math.round(fromGreen + (toGreen - fromGreen) * amount);
  const blue = Math.round(fromBlue + (toBlue - fromBlue) * amount);
  return (red << 16) | (green << 8) | blue;
}

export function cardPaperColor(domain: Resource, affordable: boolean): number {
  if (!affordable) {
    return 0xa49d96;
  }
  if (domain === 'bricks') {
    return 0xf0e0b8;
  }
  if (domain === 'weapons') {
    return 0xf6d3cb;
  }
  return 0xc9dafd;
}

export function cardTitleHex(domain: Resource, affordable: boolean): string {
  if (!affordable) {
    return '#605a55';
  }
  if (domain === 'bricks') {
    return '#8b6523';
  }
  if (domain === 'weapons') {
    return '#b3281f';
  }
  return '#315fbf';
}

export function cardFillColor(domain: Resource, affordable: boolean): number {
  return affordable ? cardPaperColor(domain, true) : 0x979089;
}

export function cardBorderColor(domain: Resource, affordable: boolean, selected: boolean): number {
  if (selected) {
    return THEME.gold;
  }
  return affordable ? cardTypeColor(domain) : 0x9aa0a8;
}

export function paintCardFrame(
  frame: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  domain: Resource,
  affordable: boolean,
  selected: boolean,
): void {
  const radius = Math.min(16, Math.max(8, Math.round(width * 0.1)));
  const outerColor = affordable ? cardTypeColor(domain) : 0x8c929a;
  const paperColor = cardFillColor(domain, affordable);
  const innerColor = affordable ? mixColor(paperColor, 0xffffff, 0.18) : mixColor(paperColor, 0x000000, 0.08);
  const insetStroke = affordable ? mixColor(outerColor, 0xffffff, 0.62) : 0xd0d6df;
  const seamColor = affordable ? mixColor(outerColor, 0x000000, 0.26) : 0x676d75;
  frame.clear();
  frame.fillStyle(0x02050c, 0.3);
  frame.fillRoundedRect(-width / 2 + 6, -height / 2 + 9, width, height, radius + 1);
  if (selected) {
    frame.fillStyle(THEME.gold, 0.22);
    frame.fillRoundedRect(-width / 2 - 4, -height / 2 - 4, width + 8, height + 8, radius + 4);
  }
  frame.fillStyle(outerColor, affordable ? 0.98 : 0.9);
  frame.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
  frame.fillStyle(seamColor, affordable ? 0.16 : 0.2);
  frame.fillRoundedRect(-width / 2 + 3, -height / 2 + 3, width - 6, height - 6, Math.max(4, radius - 2));
  frame.fillStyle(paperColor, affordable ? 1 : 0.97);
  frame.fillRoundedRect(-width / 2 + 6, -height / 2 + 6, width - 12, height - 12, Math.max(4, radius - 4));
  frame.fillStyle(innerColor, affordable ? 0.62 : 0.68);
  frame.fillRoundedRect(-width / 2 + 12, -height / 2 + 12, width - 24, height - 24, Math.max(4, radius - 8));
  frame.lineStyle(2, insetStroke, affordable ? 0.82 : 0.7);
  frame.strokeRoundedRect(-width / 2 + 6, -height / 2 + 6, width - 12, height - 12, Math.max(4, radius - 5));
  frame.lineStyle(selected ? 3 : 0, cardBorderColor(domain, affordable, selected), affordable ? 0.86 : 0.72);
  if (selected) {
    frame.strokeRoundedRect(-width / 2 - 1, -height / 2 - 1, width + 2, height + 2, radius + 1);
  }
}

export function drawResourceIcon(
  graphics: Phaser.GameObjects.Graphics,
  resource: Resource,
  size: number,
  muted: boolean,
  colorOverride?: number,
): void {
  const color = colorOverride ?? (muted ? 0x9ba0a8 : cardTypeColor(resource));
  const accent = muted ? 0xc1c5cc : mixColor(color, 0xffffff, 0.34);
  const shadow = muted ? 0x5e6168 : mixColor(color, 0x000000, 0.46);
  graphics.clear();

  if (resource === 'bricks') {
    const brickW = size * 0.29;
    const brickH = size * 0.17;
    const gapX = size * 0.05;
    const gapY = size * 0.04;
    const startY = -size * 0.26;
    const mortar = muted ? 0x6e737a : mixColor(color, 0x000000, 0.34);

    const drawBrick = (x: number, y: number): void => {
      graphics.fillStyle(shadow, 0.34);
      graphics.fillRoundedRect(x + size * 0.02, y + size * 0.02, brickW, brickH, Math.max(2, size * 0.05));
      graphics.fillStyle(color, 1);
      graphics.fillRoundedRect(x, y, brickW, brickH, Math.max(2, size * 0.05));
      graphics.fillStyle(accent, 0.5);
      graphics.fillRect(x + brickW * 0.12, y + brickH * 0.16, brickW * 0.56, brickH * 0.16);
      graphics.lineStyle(Math.max(1, size * 0.03), mortar, 0.62);
      graphics.strokeRoundedRect(x, y, brickW, brickH, Math.max(2, size * 0.05));
    };

    for (let row = 0; row < 3; row += 1) {
      const cols = row === 1 ? 2 : 3;
      const offsetX = row === 1 ? (brickW + gapX) * 0.5 : 0;
      const y = startY + row * (brickH + gapY);
      for (let col = 0; col < cols; col += 1) {
        const x = -size * 0.52 + offsetX + col * (brickW + gapX);
        drawBrick(x, y);
      }
    }
    return;
  }

  if (resource === 'weapons') {
    graphics.lineStyle(Math.max(2, size * 0.14), shadow, 0.42);
    graphics.lineBetween(-size * 0.28, size * 0.34, size * 0.34, -size * 0.24);
    graphics.lineStyle(Math.max(2, size * 0.14), color, 1);
    graphics.lineBetween(-size * 0.32, size * 0.32, size * 0.3, -size * 0.28);
    graphics.fillStyle(accent, 1);
    graphics.fillTriangle(size * 0.22, -size * 0.34, size * 0.46, -size * 0.48, size * 0.36, -size * 0.18);
    graphics.lineStyle(Math.max(1, size * 0.09), accent, 1);
    graphics.lineBetween(-size * 0.4, size * 0.08, -size * 0.12, size * 0.36);
    return;
  }

  graphics.fillStyle(shadow, 0.3);
  graphics.fillTriangle(size * 0.04, -size * 0.42, size * 0.42, 0.04, size * 0.04, size * 0.48);
  graphics.fillTriangle(size * 0.04, -size * 0.42, -size * 0.38, 0.04, size * 0.04, size * 0.48);
  graphics.fillStyle(color, 1);
  graphics.fillTriangle(0, -size * 0.5, size * 0.42, 0, 0, size * 0.5);
  graphics.fillTriangle(0, -size * 0.5, -size * 0.42, 0, 0, size * 0.5);
  graphics.lineStyle(Math.max(1, size * 0.08), accent, 0.9);
  graphics.lineBetween(0, -size * 0.35, 0, size * 0.32);
}

export function createResourceIcon(
  scene: Phaser.Scene,
  resource: Resource,
  x: number,
  y: number,
  size: number,
  muted: boolean,
  colorOverride?: number,
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.setPosition(x, y);
  drawResourceIcon(graphics, resource, size, muted, colorOverride);
  return graphics;
}

export function getCardIllustration(card: CardDefinition): CardIllustrationKey {
  if (card.illustrationKey) {
    return card.illustrationKey;
  }
  if (card.effects.some((effect) => effect.type === 'setShield' || effect.type === 'setBarrier' || effect.type === 'setIncomingDamageReduction')) {
    return 'shield';
  }
  if (card.effects.some((effect) => effect.type === 'adjustGenerator' || effect.type === 'towerPerGenerator')) {
    return 'book';
  }
  if (card.effects.some((effect) => effect.type === 'adjustWall' && effect.target === 'self' && effect.amount > 0) || card.effects.some((effect) => effect.type === 'doubleWall')) {
    return 'wall';
  }
  if (card.effects.some((effect) => effect.type === 'adjustTower' && effect.target === 'self' && effect.amount > 0)) {
    return 'tower';
  }
  if (card.effects.some((effect) => effect.type === 'adjustResource' && effect.target === 'self')) {
    return 'crate';
  }
  if (card.effects.some((effect) => effect.type === 'attack' && effect.wallOnly)) {
    return 'bow';
  }
  if (card.effects.some((effect) => effect.type === 'attack')) {
    return card.domain === 'crystals' ? 'crystal' : 'sword';
  }
  return card.domain === 'crystals' ? 'crystal' : card.domain === 'weapons' ? 'sword' : 'wall';
}

export function drawIllustrationIcon(
  graphics: Phaser.GameObjects.Graphics,
  illustration: CardIllustrationKey,
  size: number,
  color: number,
  muted: boolean,
): void {
  const main = muted ? 0x9ea2a8 : mixColor(color, 0xffffff, 0.22);
  const light = muted ? 0xc4c7cc : mixColor(main, 0xffffff, 0.36);
  const dark = muted ? 0x64686f : mixColor(color, 0x000000, 0.28);
  graphics.clear();

  graphics.fillStyle(0x000000, muted ? 0.06 : 0.16);
  graphics.fillEllipse(size * 0.06, size * 0.22, size * 0.84, size * 0.26);

  switch (illustration) {
    case 'wall': {
      const rowHeight = size * 0.18;
      graphics.fillStyle(main, 0.94);
      for (let row = 0; row < 4; row += 1) {
        const offset = row % 2 === 0 ? 0 : size * 0.12;
        for (let col = 0; col < 3; col += 1) {
          graphics.fillRoundedRect(-size * 0.45 + col * size * 0.3 + offset, -size * 0.28 + row * rowHeight, size * 0.24, rowHeight * 0.72, 2);
        }
      }
      break;
    }
    case 'masonry': {
      const rowHeight = size * 0.15;
      graphics.fillStyle(main, 0.96);
      for (let row = 0; row < 3; row += 1) {
        const offset = row % 2 === 0 ? 0 : size * 0.12;
        for (let col = 0; col < 3; col += 1) {
          graphics.fillRoundedRect(-size * 0.42 + col * size * 0.26 + offset, -size * 0.2 + row * rowHeight, size * 0.2, rowHeight * 0.68, 2);
        }
      }
      graphics.fillStyle(light, 0.95);
      graphics.fillRect(-size * 0.1, -size * 0.42, size * 0.22, size * 0.12);
      graphics.fillStyle(dark, 0.9);
      graphics.fillRect(size * 0.02, -size * 0.38, size * 0.04, size * 0.56);
      break;
    }
    case 'tower': {
      graphics.fillStyle(main, 0.94);
      graphics.fillRoundedRect(-size * 0.22, -size * 0.34, size * 0.44, size * 0.68, 4);
      graphics.fillStyle(light, 0.96);
      graphics.fillRect(-size * 0.34, -size * 0.42, size * 0.2, size * 0.16);
      graphics.fillRect(-size * 0.1, -size * 0.42, size * 0.2, size * 0.16);
      graphics.fillRect(size * 0.14, -size * 0.42, size * 0.2, size * 0.16);
      graphics.fillStyle(dark, 0.9);
      graphics.fillRoundedRect(-size * 0.06, size * 0.1, size * 0.12, size * 0.24, 3);
      break;
    }
    case 'quarry': {
      graphics.lineStyle(Math.max(3, size * 0.09), dark, 0.98);
      graphics.lineBetween(-size * 0.28, size * 0.18, size * 0.08, -size * 0.3);
      graphics.lineBetween(0, size * 0.24, size * 0.26, -size * 0.1);
      graphics.fillStyle(main, 0.96);
      graphics.fillTriangle(size * 0.22, -size * 0.18, size * 0.46, -size * 0.08, size * 0.16, 0);
      graphics.fillStyle(light, 0.96);
      graphics.fillTriangle(-size * 0.12, -size * 0.4, size * 0.08, -size * 0.28, -size * 0.26, -size * 0.18);
      break;
    }
    case 'sword': {
      graphics.lineStyle(Math.max(4, size * 0.16), main, 0.96);
      graphics.lineBetween(-size * 0.34, size * 0.34, size * 0.32, -size * 0.32);
      graphics.fillStyle(light, 0.98);
      graphics.fillTriangle(size * 0.24, -size * 0.4, size * 0.48, -size * 0.52, size * 0.38, -size * 0.22);
      graphics.lineStyle(Math.max(3, size * 0.11), dark, 0.96);
      graphics.lineBetween(-size * 0.42, size * 0.08, -size * 0.08, size * 0.42);
      break;
    }
    case 'crossed_swords': {
      graphics.lineStyle(Math.max(3, size * 0.12), main, 0.98);
      graphics.lineBetween(-size * 0.34, size * 0.28, size * 0.24, -size * 0.32);
      graphics.lineBetween(size * 0.34, size * 0.28, -size * 0.24, -size * 0.32);
      graphics.fillStyle(light, 0.98);
      graphics.fillTriangle(size * 0.18, -size * 0.38, size * 0.38, -size * 0.5, size * 0.28, -size * 0.2);
      graphics.fillTriangle(-size * 0.18, -size * 0.38, -size * 0.38, -size * 0.5, -size * 0.28, -size * 0.2);
      graphics.lineStyle(Math.max(2, size * 0.08), dark, 0.98);
      graphics.lineBetween(-size * 0.38, 0.04, -size * 0.08, size * 0.32);
      graphics.lineBetween(size * 0.38, 0.04, size * 0.08, size * 0.32);
      break;
    }
    case 'bow': {
      graphics.lineStyle(Math.max(3, size * 0.1), main, 0.96);
      graphics.beginPath();
      graphics.arc(-size * 0.08, 0, size * 0.42, -1.15, 1.15, false);
      graphics.strokePath();
      graphics.lineStyle(Math.max(1, size * 0.04), light, 0.94);
      graphics.lineBetween(size * 0.1, -size * 0.36, size * 0.1, size * 0.36);
      graphics.lineStyle(Math.max(2, size * 0.07), dark, 0.96);
      graphics.lineBetween(-size * 0.36, 0, size * 0.42, 0);
      graphics.fillStyle(dark, 0.96);
      graphics.fillTriangle(size * 0.42, 0, size * 0.24, -size * 0.08, size * 0.24, size * 0.08);
      break;
    }
    case 'book': {
      graphics.fillStyle(main, 0.94);
      graphics.fillRoundedRect(-size * 0.43, -size * 0.32, size * 0.38, size * 0.64, 4);
      graphics.fillRoundedRect(size * 0.05, -size * 0.32, size * 0.38, size * 0.64, 4);
      graphics.lineStyle(Math.max(1, size * 0.05), light, 0.8);
      graphics.lineBetween(0, -size * 0.32, 0, size * 0.32);
      graphics.lineBetween(-size * 0.3, -size * 0.1, -size * 0.12, -size * 0.1);
      graphics.lineBetween(size * 0.14, size * 0.08, size * 0.32, size * 0.08);
      break;
    }
    case 'crystal': {
      graphics.fillStyle(main, 0.95);
      graphics.fillTriangle(0, -size * 0.48, size * 0.4, -size * 0.02, 0, size * 0.5);
      graphics.fillStyle(light, 0.95);
      graphics.fillTriangle(0, -size * 0.48, -size * 0.4, -size * 0.02, 0, size * 0.5);
      graphics.lineStyle(Math.max(1, size * 0.05), dark, 0.7);
      graphics.lineBetween(0, -size * 0.36, 0, size * 0.32);
      break;
    }
    case 'shield': {
      graphics.fillStyle(main, 0.95);
      graphics.fillPoints(
        [
          new Phaser.Math.Vector2(0, -size * 0.48),
          new Phaser.Math.Vector2(size * 0.38, -size * 0.24),
          new Phaser.Math.Vector2(size * 0.28, size * 0.28),
          new Phaser.Math.Vector2(0, size * 0.5),
          new Phaser.Math.Vector2(-size * 0.28, size * 0.28),
          new Phaser.Math.Vector2(-size * 0.38, -size * 0.24),
        ],
        true,
      );
      graphics.lineStyle(Math.max(1, size * 0.05), light, 0.9);
      graphics.lineBetween(0, -size * 0.36, 0, size * 0.36);
      break;
    }
    case 'ram': {
      graphics.fillStyle(main, 0.96);
      graphics.fillRoundedRect(-size * 0.34, -size * 0.1, size * 0.52, size * 0.22, 6);
      graphics.fillStyle(dark, 0.94);
      graphics.fillTriangle(size * 0.18, -size * 0.18, size * 0.46, 0, size * 0.18, size * 0.18);
      graphics.lineStyle(Math.max(2, size * 0.07), light, 0.9);
      graphics.lineBetween(-size * 0.26, -size * 0.1, -size * 0.42, -size * 0.34);
      graphics.lineBetween(-size * 0.04, -size * 0.1, -size * 0.18, -size * 0.34);
      break;
    }
    case 'cracked_shield': {
      graphics.fillStyle(main, 0.95);
      graphics.fillPoints(
        [
          new Phaser.Math.Vector2(0, -size * 0.48),
          new Phaser.Math.Vector2(size * 0.38, -size * 0.24),
          new Phaser.Math.Vector2(size * 0.28, size * 0.28),
          new Phaser.Math.Vector2(0, size * 0.5),
          new Phaser.Math.Vector2(-size * 0.28, size * 0.28),
          new Phaser.Math.Vector2(-size * 0.38, -size * 0.24),
        ],
        true,
      );
      graphics.lineStyle(Math.max(2, size * 0.07), dark, 0.96);
      graphics.lineBetween(-size * 0.06, -size * 0.32, size * 0.08, -size * 0.02);
      graphics.lineBetween(size * 0.08, -size * 0.02, -size * 0.04, size * 0.34);
      break;
    }
    case 'drum': {
      graphics.fillStyle(main, 0.96);
      graphics.fillEllipse(0, 0, size * 0.6, size * 0.48);
      graphics.lineStyle(Math.max(2, size * 0.06), dark, 0.94);
      graphics.strokeEllipse(0, 0, size * 0.6, size * 0.48);
      graphics.lineStyle(Math.max(1, size * 0.05), light, 0.96);
      graphics.lineBetween(-size * 0.22, -size * 0.16, size * 0.22, size * 0.16);
      graphics.lineBetween(size * 0.22, -size * 0.16, -size * 0.22, size * 0.16);
      graphics.lineStyle(Math.max(2, size * 0.05), dark, 0.92);
      graphics.lineBetween(-size * 0.34, -size * 0.28, -size * 0.1, -size * 0.04);
      graphics.lineBetween(size * 0.34, -size * 0.28, size * 0.1, -size * 0.04);
      break;
    }
    case 'crate': {
      graphics.fillStyle(main, 0.94);
      graphics.fillRoundedRect(-size * 0.38, -size * 0.28, size * 0.76, size * 0.56, 4);
      graphics.lineStyle(Math.max(1, size * 0.05), dark, 0.8);
      graphics.lineBetween(-size * 0.3, -size * 0.2, size * 0.3, size * 0.2);
      graphics.lineBetween(size * 0.3, -size * 0.2, -size * 0.3, size * 0.2);
      break;
    }
    case 'orb': {
      graphics.fillStyle(main, 0.96);
      graphics.fillCircle(0, -size * 0.02, size * 0.24);
      graphics.lineStyle(Math.max(2, size * 0.06), light, 0.8);
      graphics.strokeCircle(0, -size * 0.02, size * 0.24);
      graphics.fillStyle(dark, 0.9);
      graphics.fillRoundedRect(-size * 0.08, size * 0.14, size * 0.16, size * 0.16, 3);
      graphics.lineStyle(Math.max(1, size * 0.05), dark, 0.85);
      graphics.lineBetween(-size * 0.22, size * 0.2, size * 0.22, size * 0.2);
      break;
    }
    case 'blast': {
      graphics.fillStyle(light, 0.96);
      graphics.fillCircle(0, 0, size * 0.14);
      graphics.lineStyle(Math.max(2, size * 0.08), main, 0.98);
      graphics.lineBetween(0, -size * 0.42, 0, size * 0.42);
      graphics.lineBetween(-size * 0.42, 0, size * 0.42, 0);
      graphics.lineBetween(-size * 0.28, -size * 0.28, size * 0.28, size * 0.28);
      graphics.lineBetween(size * 0.28, -size * 0.28, -size * 0.28, size * 0.28);
      break;
    }
  }
}

export function createIllustrationIcon(
  scene: Phaser.Scene,
  illustration: CardIllustrationKey,
  x: number,
  y: number,
  size: number,
  color: number,
  muted: boolean,
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.setPosition(x, y);
  drawIllustrationIcon(graphics, illustration, size, color, muted);
  return graphics;
}

export function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  label: string,
  onClick: () => void,
): Phaser.GameObjects.Container {
  const bg = scene.add.rectangle(0, 0, width, 50, 0xd86f3d).setStrokeStyle(2, 0xf3d9c2);
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: FONT_FAMILY,
      fontSize: '20px',
      color: '#241d19',
      fontStyle: 'bold',
    })
    .setOrigin(0.5);

  const hit = scene.add.rectangle(0, 0, width, 50, 0x000000, 0).setInteractive({ useHandCursor: true });
  hit.on('pointerover', () => bg.setFillStyle(0xe78854));
  hit.on('pointerout', () => bg.setFillStyle(0xd86f3d));
  hit.on('pointerdown', onClick);

  return scene.add.container(x, y, [bg, text, hit]);
}
