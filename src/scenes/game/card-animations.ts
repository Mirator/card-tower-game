import Phaser from 'phaser';
import { CARD_BY_ID } from '../../game/cards';
import type { PlayerId } from '../../game/types';
import { formatCardEffectLine } from './card-text';
import type { Point, TowerVisualRefs } from './scene-types';
import {
  FONT_FAMILY,
  RESOURCE_META,
  THEME,
  animDelay,
  animDuration,
  cardTitleHex,
  cardTypeColor,
  createIllustrationIcon,
  createResourceIcon,
  getCardIllustration,
  mixColor,
  paintCardFrame,
} from './visuals';

export interface AnimationContext {
  scene: Phaser.Scene;
  overlay: Phaser.GameObjects.Container;
  animationsEnabled: boolean;
  isNarrow: boolean;
}

export function createMotionCard(
  ctx: AnimationContext,
  cardId: string | null,
  origin: Point,
  options: { facedown: boolean; compact: boolean },
): Phaser.GameObjects.Container {
  const { scene } = ctx;
  const card = cardId ? CARD_BY_ID[cardId] : null;
  const width = options.compact ? 96 : 136;
  const height = options.compact ? 68 : 186;
  const clone = scene.add.container(origin.x, origin.y);
  const cloneShadow = scene.add.rectangle(5, 7, width, height, 0x03070d, options.compact ? 0.28 : 0.35);

  if (options.facedown || !card) {
    const cloneBody = scene.add
      .rectangle(0, 0, width, height, 0x283651, 0.98)
      .setStrokeStyle(3, 0xd7dff3, 0.84);
    const bandA = scene.add.rectangle(0, -12, width * 0.54, 5, 0x6f86bc, 0.95);
    const bandB = scene.add.rectangle(0, 2, width * 0.5, 5, 0xd7dff3, 0.22);
    const mark = scene.add
      .text(0, 16, '?', {
        fontFamily: FONT_FAMILY,
        fontSize: options.compact ? '16px' : '22px',
        color: '#f4f0e8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    clone.add([cloneShadow, cloneBody, bandA, bandB, mark]);
    return clone;
  }

  if (options.compact) {
    const color = cardTypeColor(card.domain);
    const cloneBody = scene.add
      .rectangle(0, 0, width, height, mixColor(color, THEME.parchment, 0.34), 0.96)
      .setStrokeStyle(3, color, 0.88);
    const cloneText = scene.add
      .text(0, -4, card.name, {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        color: '#241d19',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: 74 },
      })
      .setOrigin(0.5);
    const cloneEffect = scene.add
      .text(0, 16, `${RESOURCE_META[card.domain].resourceName} ${card.cost}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '9px',
        color: '#4b4138',
        align: 'center',
        wordWrap: { width: 78 },
      })
      .setOrigin(0.5);
    clone.add([cloneShadow, cloneBody, cloneText, cloneEffect]);
    return clone;
  }

  const frame = scene.add.graphics();
  paintCardFrame(frame, width, height, card.domain, true, false);
  const iconSize = 18;
  const resourceIcon = createResourceIcon(scene, card.domain, -width / 2 + 18, -height / 2 + 18, iconSize, false);
  const title = scene.add
    .text(0, -height / 2 + 28, card.name, {
      fontFamily: FONT_FAMILY,
      fontSize: '16px',
      color: cardTitleHex(card.domain, true),
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: width - 30 },
    })
    .setOrigin(0.5, 0);
  title.setLineSpacing(-2);
  const costShadow = scene.add
    .text(width / 2 - 14, -height / 2 + 8, String(card.cost), {
      fontFamily: FONT_FAMILY,
      fontSize: '22px',
      color: '#fffdf7',
      fontStyle: 'bold',
    })
    .setOrigin(1, 0);
  const costText = scene.add
    .text(width / 2 - 16, -height / 2 + 6, String(card.cost), {
      fontFamily: FONT_FAMILY,
      fontSize: '22px',
      color: '#12100e',
      fontStyle: 'bold',
    })
    .setOrigin(1, 0);
  const illustration = createIllustrationIcon(scene, getCardIllustration(card), 0, 24, 48, cardTypeColor(card.domain), false);
  const effectText = scene.add
    .text(0, height / 2 - 26, formatCardEffectLine(card), {
      fontFamily: FONT_FAMILY,
      fontSize: '13px',
      color: '#24201c',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: width - 28 },
    })
    .setOrigin(0.5);

  clone.add([cloneShadow, frame, resourceIcon, title, costShadow, costText, illustration, effectText]);
  return clone;
}

export function spawnImpactBurst(ctx: AnimationContext, target: Point, color: number): void {
  const { scene, overlay } = ctx;
  const ring = scene.add.circle(target.x, target.y, 14, color, 0).setStrokeStyle(4, THEME.gold, 0.82);
  const core = scene.add.circle(target.x, target.y, 8, color, 0.55);
  overlay.add([ring, core]);

  scene.tweens.add({
    targets: ring,
    scaleX: 2.6,
    scaleY: 2.6,
    alpha: 0,
    duration: animDuration(420),
    ease: 'Sine.Out',
    onComplete: () => ring.destroy(),
  });

  scene.tweens.add({
    targets: core,
    scaleX: 0.2,
    scaleY: 0.2,
    alpha: 0,
    duration: animDuration(280),
    ease: 'Sine.In',
    onComplete: () => core.destroy(),
  });
}

export function animateDeckDraw(ctx: AnimationContext, target: Phaser.GameObjects.Container): void {
  if (!target) {
    return;
  }
  ctx.scene.tweens.killTweensOf(target);
  target.setScale(1);

  ctx.scene.tweens.add({
    targets: target,
    scaleX: 0.82,
    scaleY: 1.12,
    yoyo: true,
    repeat: 1,
    duration: animDuration(110),
    ease: 'Sine.InOut',
  });
}

export function animateCardPlay(
  ctx: AnimationContext,
  cardId: string,
  origin: Point,
  target: Point,
  onComplete?: () => void,
): void {
  const card = CARD_BY_ID[cardId];
  if (!card) {
    return;
  }

  const color = cardTypeColor(card.domain);
  const beam = ctx.scene.add.graphics();
  beam.lineStyle(4, color, 0.34);
  beam.lineBetween(origin.x, origin.y, target.x, target.y);
  beam.setAlpha(ctx.animationsEnabled ? 0 : 0.34);

  const clone = createMotionCard(ctx, cardId, origin, { facedown: false, compact: false });
  clone.setScale(ctx.animationsEnabled ? 0.8 : 1);
  ctx.overlay.add([beam, clone]);

  if (!ctx.animationsEnabled) {
    clone.destroy(true);
    beam.destroy();
    spawnImpactBurst(ctx, target, color);
    onComplete?.();
    return;
  }

  ctx.scene.tweens.add({
    targets: beam,
    alpha: 0.34,
    duration: animDuration(120),
    yoyo: true,
    hold: animDelay(220),
    ease: 'Sine.InOut',
    onComplete: () => beam.destroy(),
  });

  ctx.scene.tweens.add({
    targets: clone,
    x: target.x,
    y: target.y,
    scaleX: 0.72,
    scaleY: 0.72,
    duration: animDuration(520),
    ease: 'Sine.InOut',
    onComplete: () => {
      clone.destroy(true);
      spawnImpactBurst(ctx, target, color);
      onComplete?.();
    },
  });
}

export function animateCardToDiscard(
  ctx: AnimationContext,
  cardId: string,
  origin: Point,
  target: Point,
  options: { owner: PlayerId; facedown: boolean },
): void {
  const color = options.owner === 'player' ? THEME.playerBlack : THEME.enemyRed;
  const clone = createMotionCard(ctx, cardId, origin, { facedown: options.facedown, compact: true });
  ctx.overlay.add(clone);

  if (!ctx.animationsEnabled) {
    clone.destroy(true);
    spawnImpactBurst(ctx, target, color);
    return;
  }

  ctx.scene.tweens.add({
    targets: clone,
    x: target.x,
    y: target.y,
    scaleX: 0.48,
    scaleY: 0.48,
    alpha: 0.12,
    duration: animDuration(420),
    ease: 'Sine.InOut',
    onComplete: () => {
      clone.destroy(true);
      spawnImpactBurst(ctx, target, color);
    },
  });
}

export function animateDiscardReshuffle(
  ctx: AnimationContext,
  origin: Point,
  target: Point,
): void {
  const clone = createMotionCard(ctx, null, origin, { facedown: true, compact: true });
  ctx.overlay.add(clone);

  if (!ctx.animationsEnabled) {
    clone.destroy(true);
    return;
  }

  ctx.scene.tweens.add({
    targets: clone,
    x: target.x,
    y: target.y,
    scaleX: 0.44,
    scaleY: 0.44,
    alpha: 0.08,
    duration: animDuration(340),
    ease: 'Sine.InOut',
    onComplete: () => clone.destroy(true),
  });
}

export function animateTowerDamage(ctx: AnimationContext, tower: TowerVisualRefs): void {
  ctx.scene.tweens.killTweensOf(tower.container);
  const baseX = tower.container.x;

  ctx.scene.tweens.add({
    targets: tower.container,
    x: baseX + 6,
    yoyo: true,
    repeat: 3,
    duration: animDuration(36),
    ease: 'Sine.InOut',
    onComplete: () => {
      tower.container.x = baseX;
    },
  });
}

export function animateTowerHeal(ctx: AnimationContext, tower: TowerVisualRefs): void {
  ctx.scene.tweens.killTweensOf(tower.container);
  const baseScaleX = tower.container.scaleX;
  const baseScaleY = tower.container.scaleY;

  ctx.scene.tweens.add({
    targets: tower.container,
    scaleX: baseScaleX * 1.04,
    scaleY: baseScaleY * 1.04,
    yoyo: true,
    duration: animDuration(240),
    ease: 'Sine.Out',
    onComplete: () => {
      tower.container.setScale(baseScaleX, baseScaleY);
    },
  });
}

export function spawnFloatingText(
  ctx: AnimationContext,
  anchor: Point,
  text: string,
  color: string,
  options: { durationMultiplier?: number } = {},
): void {
  const { scene, overlay, isNarrow } = ctx;
  const floating = scene.add
    .text(anchor.x, anchor.y, text, {
      fontFamily: FONT_FAMILY,
      fontSize: isNarrow ? '15px' : '19px',
      color,
      fontStyle: 'bold',
    })
    .setOrigin(0.5);
  floating.setStroke('#1a1110', isNarrow ? 3 : 4);
  floating.setShadow(0, 2, '#000000', 4, true, true);

  overlay.add(floating);

  scene.tweens.add({
    targets: floating,
    y: anchor.y - (isNarrow ? 34 : 48),
    alpha: 0,
    duration: animDuration(640 * (options.durationMultiplier ?? 1)),
    ease: 'Sine.Out',
    onComplete: () => floating.destroy(),
  });
}
