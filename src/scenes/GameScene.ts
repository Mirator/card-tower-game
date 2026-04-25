import Phaser from 'phaser';
import { shouldExposeAutomationHooks } from '../automation';
import { evaluateAIMove } from '../game/ai';
import { CARD_BY_ID } from '../game/cards';
import { AI_DELAY_MS } from '../game/constants';
import { canAffordCard, cloneGameState, createInitialGameState, reduceGameState, summarizeForText } from '../game/engine';
import { SeededRng, seedFromNow } from '../game/rng';
import { loadMeta, updateMeta } from '../game/storage';
import type { Action, CardDefinition, EffectSpec, GameMetaV1, GameState, PlayerId, Resource } from '../game/types';

type PanelSide = 'left' | 'right';

interface ResourceBlockRefs {
  root: Phaser.GameObjects.Container;
  generatorValue: Phaser.GameObjects.Text;
  resourceValue: Phaser.GameObjects.Text;
}

interface PlayerPanelRefs {
  side: PanelSide;
  width: number;
  height: number;
  container: Phaser.GameObjects.Container;
  activeGlow: Phaser.GameObjects.Rectangle;
  headerText: Phaser.GameObjects.Text;
  resourceBlocks: Record<Resource, ResourceBlockRefs>;
  towerValue: Phaser.GameObjects.Text;
  wallValue: Phaser.GameObjects.Text;
}

interface TowerVisualRefs {
  container: Phaser.GameObjects.Container;
  windows: Phaser.GameObjects.Rectangle[];
  flash: Phaser.GameObjects.Rectangle;
  glow: Phaser.GameObjects.Ellipse;
  dangerGlow: Phaser.GameObjects.Ellipse;
  wallShield: Phaser.GameObjects.Rectangle;
  wallValueText: Phaser.GameObjects.Text;
  towerValueText: Phaser.GameObjects.Text;
  progressFill: Phaser.GameObjects.Rectangle;
}

interface CardVisual {
  cardId: string;
  handIndex: number;
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Graphics;
  width: number;
  height: number;
  domain: Resource;
  affordable: boolean;
  baseY: number;
}

interface ActionButtonRefs {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
}

interface GestureState {
  cardId: string;
  handIndex: number;
  x: number;
  y: number;
  isTouch: boolean;
}

interface Point {
  x: number;
  y: number;
}

const SWIPE_THRESHOLD = 44;
const NARROW_LAYOUT_WIDTH = 720;
const ANIMATION_PACE = 1.5;
const RESOURCE_FLOATING_TEXT_DURATION_MULTIPLIER = 2;
const ENEMY_CARD_REVEAL_MS = 2200;

const FONT_FAMILY = 'Georgia';

const THEME = {
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

function animDuration(ms: number): number {
  return Math.round(ms * ANIMATION_PACE);
}

function animDelay(ms: number): number {
  return Math.round(ms * ANIMATION_PACE);
}

const RESOURCE_META: Record<
  Resource,
  { label: string; resourceName: string; iconLabel: string; color: number; generatorKey: 'quarry' | 'barracks' | 'magic' }
> = {
  bricks: {
    label: 'Builders',
    resourceName: 'Bricks',
    iconLabel: 'HAM',
    color: THEME.brick,
    generatorKey: 'quarry',
  },
  weapons: {
    label: 'Soldiers',
    resourceName: 'Weapons',
    iconLabel: 'SWD',
    color: THEME.weapon,
    generatorKey: 'barracks',
  },
  crystals: {
    label: 'Mages',
    resourceName: 'Crystals',
    iconLabel: 'STR',
    color: THEME.crystal,
    generatorKey: 'magic',
  },
};

function cardTypeColor(domain: Resource): number {
  if (domain === 'bricks') {
    return THEME.brick;
  }
  if (domain === 'weapons') {
    return THEME.weapon;
  }
  return THEME.crystal;
}

function mixColor(from: number, to: number, amount: number): number {
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

function cardFillColor(domain: Resource, affordable: boolean): number {
  return affordable ? mixColor(cardTypeColor(domain), THEME.parchment, 0.42) : 0x8a7f74;
}

function cardBorderColor(domain: Resource, affordable: boolean, selected: boolean): number {
  if (selected) {
    return THEME.gold;
  }
  return affordable ? cardTypeColor(domain) : 0xd3c2b0;
}

function paintCardFrame(
  frame: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  domain: Resource,
  affordable: boolean,
  selected: boolean,
): void {
  const radius = Math.min(12, Math.max(7, Math.round(width * 0.08)));
  frame.clear();
  frame.fillStyle(0x03070f, 0.28);
  frame.fillRoundedRect(-width / 2 + 4, -height / 2 + 7, width, height, radius);
  frame.fillStyle(cardFillColor(domain, affordable), affordable ? 0.98 : 0.84);
  frame.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
  frame.lineStyle(selected ? 4 : 2, cardBorderColor(domain, affordable, selected), affordable ? 0.98 : 0.78);
  frame.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
}

function createResourceIcon(
  scene: Phaser.Scene,
  resource: Resource,
  x: number,
  y: number,
  size: number,
  muted: boolean,
): Phaser.GameObjects.Graphics {
  const color = muted ? 0xd2c6ba : cardTypeColor(resource);
  const accent = muted ? 0xf0e6dc : mixColor(color, 0xffffff, 0.3);
  const graphics = scene.add.graphics();
  graphics.setPosition(x, y);

  if (resource === 'bricks') {
    const unit = size / 4;
    graphics.fillStyle(color, 1);
    graphics.fillRect(-size / 2, -unit * 1.35, unit * 1.8, unit);
    graphics.fillRect(-size / 2 + unit * 2, -unit * 1.35, unit * 1.8, unit);
    graphics.fillRect(-size / 2 + unit, -unit * 0.2, unit * 1.8, unit);
    graphics.fillStyle(accent, 1);
    graphics.fillRect(-size / 2 + unit * 0.15, -unit * 1.1, unit * 0.8, unit * 0.18);
    graphics.fillRect(-size / 2 + unit * 2.15, -unit * 1.1, unit * 0.8, unit * 0.18);
    return graphics;
  }

  if (resource === 'weapons') {
    graphics.lineStyle(Math.max(2, size * 0.14), color, 1);
    graphics.lineBetween(-size * 0.32, size * 0.34, size * 0.3, -size * 0.28);
    graphics.fillStyle(accent, 1);
    graphics.fillTriangle(size * 0.22, -size * 0.34, size * 0.46, -size * 0.48, size * 0.36, -size * 0.18);
    graphics.lineStyle(Math.max(1, size * 0.09), accent, 1);
    graphics.lineBetween(-size * 0.4, size * 0.08, -size * 0.12, size * 0.36);
    return graphics;
  }

  graphics.fillStyle(color, 1);
  graphics.fillTriangle(0, -size * 0.5, size * 0.42, 0, 0, size * 0.5);
  graphics.fillTriangle(0, -size * 0.5, -size * 0.42, 0, 0, size * 0.5);
  graphics.lineStyle(Math.max(1, size * 0.08), accent, 0.9);
  graphics.lineBetween(0, -size * 0.35, 0, size * 0.32);
  return graphics;
}

type CardIllustration = 'wall' | 'tower' | 'sword' | 'bow' | 'book' | 'crystal' | 'shield' | 'crate';

function getCardIllustration(card: CardDefinition): CardIllustration {
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

function createIllustrationIcon(
  scene: Phaser.Scene,
  illustration: CardIllustration,
  x: number,
  y: number,
  size: number,
  color: number,
  muted: boolean,
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.setPosition(x, y);

  const main = muted ? 0xd8cdc1 : color;
  const light = muted ? 0xf2ece5 : mixColor(color, 0xffffff, 0.42);
  const dark = muted ? 0x6c625a : mixColor(color, 0x000000, 0.36);

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
    case 'sword': {
      graphics.lineStyle(Math.max(4, size * 0.16), main, 0.96);
      graphics.lineBetween(-size * 0.34, size * 0.34, size * 0.32, -size * 0.32);
      graphics.fillStyle(light, 0.98);
      graphics.fillTriangle(size * 0.24, -size * 0.4, size * 0.48, -size * 0.52, size * 0.38, -size * 0.22);
      graphics.lineStyle(Math.max(3, size * 0.11), dark, 0.96);
      graphics.lineBetween(-size * 0.42, size * 0.08, -size * 0.08, size * 0.42);
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
    case 'crate': {
      graphics.fillStyle(main, 0.94);
      graphics.fillRoundedRect(-size * 0.38, -size * 0.28, size * 0.76, size * 0.56, 4);
      graphics.lineStyle(Math.max(1, size * 0.05), dark, 0.8);
      graphics.lineBetween(-size * 0.3, -size * 0.2, size * 0.3, size * 0.2);
      graphics.lineBetween(size * 0.3, -size * 0.2, -size * 0.3, size * 0.2);
      break;
    }
  }

  return graphics;
}

function createButton(
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

function createActionButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  label: string,
  fill: number,
  onClick: () => void,
): ActionButtonRefs {
  const bg = scene.add.rectangle(0, 0, width, 34, fill, 0.96).setStrokeStyle(2, THEME.gold, 0.82);
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: FONT_FAMILY,
      fontSize: '14px',
      color: '#fff4dd',
      fontStyle: 'bold',
    })
    .setOrigin(0.5);
  const hit = scene.add.rectangle(0, 0, width, 34, 0x000000, 0).setInteractive({ useHandCursor: true });
  hit.on('pointerover', () => bg.setScale(1.03, 1.04));
  hit.on('pointerout', () => bg.setScale(1));
  hit.on('pointerdown', onClick);

  return {
    container: scene.add.container(x, y, [bg, text, hit]),
    bg,
    text,
  };
}

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private rng!: SeededRng;
  private meta!: GameMetaV1;

  private backgroundContainer!: Phaser.GameObjects.Container;
  private topCenterContainer!: Phaser.GameObjects.Container;
  private leftPanelContainer!: Phaser.GameObjects.Container;
  private rightPanelContainer!: Phaser.GameObjects.Container;
  private towerContainer!: Phaser.GameObjects.Container;
  private handContainer!: Phaser.GameObjects.Container;
  private handCardsContainer!: Phaser.GameObjects.Container;
  private overlayContainer!: Phaser.GameObjects.Container;

  private playerPanel!: PlayerPanelRefs;
  private aiPanel!: PlayerPanelRefs;
  private playerTowerVisual!: TowerVisualRefs;
  private aiTowerVisual!: TowerVisualRefs;

  private deckCard!: Phaser.GameObjects.Rectangle;
  private drawPreviewContainer!: Phaser.GameObjects.Container;
  private drawPreviewFrame!: Phaser.GameObjects.Graphics;
  private drawPreviewTitleText!: Phaser.GameObjects.Text;
  private drawPreviewEffectText!: Phaser.GameObjects.Text;
  private drawPreviewCostText!: Phaser.GameObjects.Text;
  private drawPreviewWidth = 0;
  private drawPreviewHeight = 0;
  private opponentNameText!: Phaser.GameObjects.Text;
  private opponentTowerText!: Phaser.GameObjects.Text;
  private turnLabelText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private topInfoGlow!: Phaser.GameObjects.Rectangle;
  private turnIndicatorPlayer!: Phaser.GameObjects.Arc;
  private turnIndicatorAi!: Phaser.GameObjects.Arc;

  private handPreviewText!: Phaser.GameObjects.Text;
  private handHintText!: Phaser.GameObjects.Text;
  private battleFeedText!: Phaser.GameObjects.Text;
  private actionPanelContainer!: Phaser.GameObjects.Container;
  private actionPanelTitleText!: Phaser.GameObjects.Text;
  private actionPanelStatusText!: Phaser.GameObjects.Text;
  private playActionButton!: ActionButtonRefs;
  private discardActionButton!: ActionButtonRefs;
  private handSurface!: Phaser.GameObjects.Rectangle;

  private endOverlay!: Phaser.GameObjects.Container;
  private endOverlayText!: Phaser.GameObjects.Text;

  private cardVisuals: CardVisual[] = [];
  private gestureState = new Map<number, GestureState>();

  private selectedCardId: string | null = null;
  private selectedHandIndex: number | null = null;
  private drawPreviewCardId: string | null = null;
  private aiCountdownMs: number | null = null;
  private aiRevealCountdownMs: number | null = null;
  private aiPendingAction: Action | null = null;
  private enemyCardRevealContainer: Phaser.GameObjects.Container | null = null;
  private resultPersisted = false;

  private animationsEnabled = true;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.meta = loadMeta();
    this.animationsEnabled = this.meta.settings.animations;

    this.input.mouse?.disableContextMenu();

    this.buildLayout();
    this.bindKeys();

    this.startNewMatch();
    this.progressLoop();

    this.scale.on('resize', this.handleResize, this);
    this.input.on('pointerup', this.onGlobalPointerUp, this);

    this.attachAutomationHooks();

    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize, this);
      this.input.off('pointerup', this.onGlobalPointerUp, this);
      this.detachAutomationHooks();
    });
  }

  update(_time: number, delta: number): void {
    this.tickAi(delta);
  }

  private handleResize(): void {
    this.buildLayout();
    this.updateHud();
  }

  private buildLayout(): void {
    this.destroyLayout();

    const { width, height } = this.scale;

    this.createBackground(width, height);
    this.createTopCenterArea(width, height);
    this.createSidePanels(width, height);
    this.createTowerArea(width, height);
    this.createHandArea(width, height);
    this.createOverlayLayer();
    this.createEndOverlay(width, height);
  }

  private destroyLayout(): void {
    this.cardVisuals = [];
    this.enemyCardRevealContainer = null;

    this.backgroundContainer?.destroy(true);
    this.topCenterContainer?.destroy(true);
    this.leftPanelContainer?.destroy(true);
    this.rightPanelContainer?.destroy(true);
    this.towerContainer?.destroy(true);
    this.handContainer?.destroy(true);
    this.overlayContainer?.destroy(true);
    this.endOverlay?.destroy(true);
  }

  private isNarrowLayout(width = this.scale.width): boolean {
    return width < NARROW_LAYOUT_WIDTH;
  }

  private attachAutomationHooks(): void {
    if (!shouldExposeAutomationHooks()) {
      return;
    }

    const win = window as typeof window & {
      __game?: {
        interact?: () => void;
        clearInput?: () => void;
      };
    };

    win.__game = {
      interact: () => {
        if (this.state.phase !== 'playing' || this.state.turn.current !== 'player' || !this.state.turn.started) {
          return;
        }

        const hand = this.state.players.player.hand;
        const targetIndex = hand.findIndex((cardId) => canAffordCard(this.state, 'player', cardId));
        const handIndex = targetIndex === -1 ? 0 : targetIndex;
        const target = hand[handIndex];
        if (!target) {
          return;
        }
        this.tryPlayCard(target, handIndex);
      },
      clearInput: () => {
        this.clearSelectedCard();
        this.updateCardPreview();
        this.refreshCardSelection();
      },
    };
  }

  private detachAutomationHooks(): void {
    if (!shouldExposeAutomationHooks()) {
      return;
    }

    const active = window as typeof window & { __game?: unknown };
    delete active.__game;
  }

  private createBackground(width: number, height: number): void {
    const graphics = this.add.graphics();

    graphics.fillGradientStyle(0x193252, 0x193252, 0x0f1f35, 0x0f1f35, 1);
    graphics.fillRect(-2, -2, width + 4, height + 4);

    graphics.fillStyle(0x1a3f2f, 0.35);
    graphics.fillEllipse(width * 0.2, height * 0.78, width * 0.7, height * 0.42);
    graphics.fillEllipse(width * 0.8, height * 0.8, width * 0.7, height * 0.44);

    for (let i = 0; i < 18; i += 1) {
      const x = (i / 17) * width;
      const treeHeight = 70 + (i % 5) * 22;
      graphics.fillStyle(0x163925, 0.3);
      graphics.fillTriangle(x - 20, height * 0.76, x + 20, height * 0.76, x, height * 0.76 - treeHeight);
    }

    const vignette = this.add.rectangle(width / 2, height / 2, width + 4, height + 4, 0x091323, 0.24);

    this.backgroundContainer = this.add.container(0, 0, [graphics, vignette]);
    this.backgroundContainer.setDepth(0);
  }

  private createTopCenterArea(width: number, height: number): void {
    this.topCenterContainer = this.add.container(0, 0);
    this.topCenterContainer.setDepth(20);

    const narrow = this.isNarrowLayout(width);
    const panelWidth = narrow ? Math.max(286, width - 18) : Math.max(620, Math.min(980, width * 0.62));
    const panelHeight = narrow ? 66 : 76;
    const centerX = width / 2;
    const topY = Math.max(8, Math.round(height * 0.018));
    const panelCenterY = topY + panelHeight / 2;
    const deckWidth = narrow ? 34 : 44;
    const deckHeight = narrow ? 46 : 58;
    const deckX = centerX - panelWidth / 2 + (narrow ? 28 : 40);
    const deckY = panelCenterY;
    this.drawPreviewWidth = narrow ? 58 : 82;
    this.drawPreviewHeight = narrow ? 46 : 58;
    const previewX = deckX + deckWidth / 2 + this.drawPreviewWidth / 2 + (narrow ? 8 : 12);
    const sideTextWidth = narrow ? Math.max(84, panelWidth * 0.26) : Math.max(168, panelWidth * 0.24);

    this.topInfoGlow = this.add
      .rectangle(centerX, panelCenterY, panelWidth + 8, panelHeight + 8, 0x000000, 0)
      .setStrokeStyle(3, 0x85b5eb, 0.82);

    const panel = this.add
      .rectangle(centerX, panelCenterY, panelWidth, panelHeight, THEME.night, 0.88)
      .setStrokeStyle(2, THEME.gold, 0.82);

    this.deckCard = this.add
      .rectangle(deckX, deckY, deckWidth, deckHeight, 0x283651, 0.98)
      .setStrokeStyle(2, 0xd7dff3, 0.85);
    const deckPatternWidth = narrow ? 22 : 30;
    const deckPatternA = this.add.rectangle(deckX, deckY - (narrow ? 9 : 12), deckPatternWidth, 5, 0x6f86bc, 0.95);
    const deckPatternB = this.add.rectangle(deckX, deckY + (narrow ? 2 : 3), deckPatternWidth, 5, 0x6f86bc, 0.95);
    const deckPatternC = this.add.rectangle(deckX, deckY + (narrow ? 13 : 18), deckPatternWidth, 5, 0x6f86bc, 0.95);

    this.drawPreviewFrame = this.add.graphics();
    this.drawPreviewTitleText = this.add
      .text(0, narrow ? -13 : -18, 'Draw', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '8px' : '11px',
        color: '#2b241d',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: this.drawPreviewWidth - 12 },
      })
      .setOrigin(0.5);
    this.drawPreviewEffectText = this.add
      .text(0, narrow ? 7 : 10, 'Ready', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '7px' : '9px',
        color: '#3d352f',
        align: 'center',
        wordWrap: { width: this.drawPreviewWidth - 10 },
      })
      .setOrigin(0.5);
    this.drawPreviewCostText = this.add
      .text(this.drawPreviewWidth / 2 - (narrow ? 8 : 11), -this.drawPreviewHeight / 2 + (narrow ? 8 : 11), '', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '8px' : '10px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.drawPreviewContainer = this.add.container(previewX, deckY, [
      this.drawPreviewFrame,
      this.drawPreviewTitleText,
      this.drawPreviewEffectText,
      this.drawPreviewCostText,
    ]);

    this.opponentNameText = this.add
      .text(centerX + panelWidth / 2 - (narrow ? 10 : 20), panelCenterY - (narrow ? 19 : 21), 'Red C30 / W10', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '11px' : '15px',
        color: '#dce8f7',
        fontStyle: 'bold',
        align: 'right',
        wordWrap: { width: sideTextWidth },
      })
      .setOrigin(1, 0);

    this.opponentTowerText = this.add
      .text(centerX + panelWidth / 2 - (narrow ? 10 : 20), panelCenterY + (narrow ? 4 : 6), 'Goal 50', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '11px' : '15px',
        color: '#f7dfb8',
        fontStyle: 'bold',
        align: 'right',
        wordWrap: { width: sideTextWidth },
      })
      .setOrigin(1, 0);

    const indicatorY = panelCenterY + (narrow ? 17 : 20);
    const indicatorRadius = narrow ? 6 : 8;
    const indicatorStartX = previewX + this.drawPreviewWidth / 2 + (narrow ? 14 : 20);
    this.turnIndicatorPlayer = this.add.circle(indicatorStartX, indicatorY, indicatorRadius, THEME.playerBlack, 0.4).setStrokeStyle(2, 0xd8e5ff);
    const turnIndicatorPlayerText = this.add
      .text(this.turnIndicatorPlayer.x, indicatorY, 'B', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '7px' : '9px',
        color: '#f3f4ef',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.turnIndicatorAi = this.add.circle(indicatorStartX + (narrow ? 18 : 24), indicatorY, indicatorRadius, THEME.enemyRed, 0.4).setStrokeStyle(2, 0xf2d8d6);
    const turnIndicatorAiText = this.add
      .text(this.turnIndicatorAi.x, indicatorY, 'R', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '7px' : '9px',
        color: '#f3f4ef',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.turnLabelText = this.add
      .text(centerX, panelCenterY - (narrow ? 21 : 24), 'Your turn', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '18px' : '26px',
        color: '#fff1d2',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    this.statusText = this.add
      .text(centerX, panelCenterY + (narrow ? 7 : 10), '', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '10px' : '13px',
        color: '#d9e2ef',
        align: 'center',
        wordWrap: { width: Math.max(150, panelWidth * 0.48) },
      })
      .setOrigin(0.5, 0);

    this.topCenterContainer.add([
      this.topInfoGlow,
      panel,
      this.deckCard,
      deckPatternA,
      deckPatternB,
      deckPatternC,
      this.drawPreviewContainer,
      this.opponentNameText,
      this.opponentTowerText,
      this.turnIndicatorPlayer,
      turnIndicatorPlayerText,
      this.turnIndicatorAi,
      turnIndicatorAiText,
      this.turnLabelText,
      this.statusText,
    ]);
  }

  private createSidePanels(width: number, height: number): void {
    const compact = this.isNarrowLayout(width);
    const sideMargin = compact ? 8 : Math.max(12, Math.floor(width * 0.014));
    const panelWidth = compact ? Math.max(136, (width - sideMargin * 3) / 2) : Math.max(184, Math.min(252, (width - sideMargin * 3) / 2));
    const reservedHandHeight = compact ? Math.max(176, Math.min(224, height * 0.29)) : 0;
    const panelTop = compact ? Math.max(94, height * 0.13) : Math.max(98, height * 0.12);
    const compactAvailableHeight = height - panelTop - reservedHandHeight - 18;
    const panelHeight = compact
      ? Math.max(288, Math.min(340, compactAvailableHeight))
      : Math.max(386, Math.min(480, height * 0.52));

    this.playerPanel = this.createPlayerPanel({
      side: 'left',
      x: sideMargin,
      y: panelTop,
      width: panelWidth,
      height: panelHeight,
      headerColor: THEME.playerBlack,
      borderColor: 0xbac0cf,
      title: 'Black',
      compact,
    });

    this.aiPanel = this.createPlayerPanel({
      side: 'right',
      x: width - panelWidth - sideMargin,
      y: panelTop,
      width: panelWidth,
      height: panelHeight,
      headerColor: THEME.enemyRed,
      borderColor: 0xe3b8b5,
      title: 'Red',
      compact,
    });
  }

  private createPlayerPanel(config: {
    side: PanelSide;
    x: number;
    y: number;
    width: number;
    height: number;
    headerColor: number;
    borderColor: number;
    title: string;
    compact: boolean;
  }): PlayerPanelRefs {
    const isRight = config.side === 'right';
    const headerY = config.compact ? 24 : 30;
    const headerHeight = config.compact ? 38 : 48;
    const resourceTopStart = config.compact ? 52 : 74;
    const resourceGap = config.compact ? 54 : 82;

    const container = this.add.container(config.x, config.y).setDepth(20);

    const frame = this.add.rectangle(config.width / 2, config.height / 2, config.width, config.height, THEME.parchment, 0.94);
    frame.setStrokeStyle(2, 0xb6ab92, 0.85);

    const activeGlow = this.add
      .rectangle(config.width / 2, config.height / 2, config.width + 8, config.height + 8, 0x000000, 0)
      .setStrokeStyle(4, config.borderColor)
      .setVisible(false);

    const headerBg = this.add
      .rectangle(config.width / 2, headerY, config.width - 16, headerHeight, config.headerColor, 0.96)
      .setStrokeStyle(2, config.borderColor);

    const headerText = this.add
      .text(config.width / 2, headerY, config.title, {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '16px' : '24px',
        color: '#f5f1e7',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    container.add([frame, activeGlow, headerBg, headerText]);

    const resourceBlocks: Partial<Record<Resource, ResourceBlockRefs>> = {};
    const resources: Resource[] = ['bricks', 'weapons', 'crystals'];

    resources.forEach((resource, index) => {
      const top = resourceTopStart + index * resourceGap;
      const block = this.createResourceBlock({
        side: config.side,
        panelWidth: config.width,
        top,
        label: RESOURCE_META[resource].label,
        resourceName: RESOURCE_META[resource].resourceName,
        iconLabel: RESOURCE_META[resource].iconLabel,
        color: RESOURCE_META[resource].color,
        compact: config.compact,
      });
      resourceBlocks[resource] = block;
      container.add(block.root);
    });

    const towerTop = config.height - (config.compact ? 78 : 112);
    const towerBlockHeight = config.compact ? 70 : 94;
    const towerBlock = this.add
      .rectangle(config.width / 2, towerTop + towerBlockHeight / 2, config.width - 24, towerBlockHeight, 0xe9e3d4, 0.95)
      .setStrokeStyle(2, 0xb8ac92);

    const towerLabelX = isRight ? config.width - 24 : 24;
    const towerLabel = this.add
      .text(towerLabelX, towerTop + (config.compact ? 8 : 12), 'Castle', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '12px' : '18px',
        color: '#243446',
        fontStyle: 'bold',
      })
      .setOrigin(isRight ? 1 : 0, 0);

    const wallLabel = this.add
      .text(towerLabelX, towerTop + (config.compact ? 38 : 58), 'Wall', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '12px' : '18px',
        color: '#243446',
        fontStyle: 'bold',
      })
      .setOrigin(isRight ? 1 : 0, 0);

    const castleBadge = this.add.circle(config.width / 2, towerTop + towerBlockHeight / 2, config.compact ? 16 : 24, 0x5a6f8a, 0.95).setStrokeStyle(2, 0xd6d9e0);
    const castleText = this.add
      .text(castleBadge.x, castleBadge.y, 'CAS', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '8px' : '11px',
        color: '#f2f5f8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const valueOffset = config.compact ? 42 : 88;
    const towerValue = this.add
      .text(isRight ? valueOffset : config.width - valueOffset, towerTop + (config.compact ? 4 : 8), '30', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '24px' : '34px',
        color: '#22374e',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    const wallValue = this.add
      .text(isRight ? valueOffset : config.width - valueOffset, towerTop + (config.compact ? 34 : 54), '10', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '24px' : '34px',
        color: '#22374e',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    container.add([towerBlock, towerLabel, wallLabel, castleBadge, castleText, towerValue, wallValue]);

    if (config.side === 'left') {
      this.leftPanelContainer = container;
    } else {
      this.rightPanelContainer = container;
    }

    return {
      side: config.side,
      width: config.width,
      height: config.height,
      container,
      activeGlow,
      headerText,
      resourceBlocks: resourceBlocks as Record<Resource, ResourceBlockRefs>,
      towerValue,
      wallValue,
    };
  }

  private createResourceBlock(config: {
    side: PanelSide;
    panelWidth: number;
    top: number;
    label: string;
    resourceName: string;
    iconLabel: string;
    color: number;
    compact: boolean;
  }): ResourceBlockRefs {
    const root = this.add.container(0, 0);

    const width = config.panelWidth - 24;
    const left = 12;
    const blockHeight = config.compact ? 48 : 72;
    const bg = this.add
      .rectangle(left + width / 2, config.top + blockHeight / 2, width, blockHeight, config.color, 0.9)
      .setStrokeStyle(2, 0xe5d9c1);

    const iconX = left + (config.compact ? 16 : 24);
    const iconBadge = this.add.circle(iconX, config.top + (config.compact ? 16 : 24), config.compact ? 11 : 17, 0x253546, 0.95).setStrokeStyle(2, 0xe4d8bd);
    const iconText = this.add
      .text(iconX, iconBadge.y, config.iconLabel, {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '7px' : '10px',
        color: '#f4f0e5',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const labelX = left + (config.compact ? 34 : 50);
    const generatorValueX = left + width - (config.compact ? 18 : 28);

    const labelText = this.add
      .text(labelX, config.top + (config.compact ? 5 : 8), config.label, {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '11px' : '16px',
        color: '#f5f2ea',
        fontStyle: 'bold',
        wordWrap: { width: Math.max(42, width - (config.compact ? 92 : 132)) },
      })
      .setOrigin(0, 0);

    const resourceNameText = this.add
      .text(labelX, config.top + (config.compact ? 20 : 30), config.resourceName, {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '10px' : '14px',
        color: '#f1e8d8',
        wordWrap: { width: Math.max(42, width - (config.compact ? 92 : 132)) },
      })
      .setOrigin(0, 0);

    const generatorValue = this.add
      .text(generatorValueX, config.top + (config.compact ? 2 : 5), '2', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '20px' : '28px',
        color: '#f9f5eb',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    const resourceValue = this.add
      .text(generatorValueX, config.top + (config.compact ? 25 : 39), '5', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '16px' : '21px',
        color: '#f7f2e6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    root.add([bg, iconBadge, iconText, labelText, resourceNameText, generatorValue, resourceValue]);

    return {
      root,
      generatorValue,
      resourceValue,
    };
  }

  private createTowerArea(width: number, height: number): void {
    this.towerContainer = this.add.container(0, 0).setDepth(10);

    const narrow = this.isNarrowLayout(width);
    const centerY = narrow ? height * 0.55 : height * 0.61;
    const spacing = narrow ? Math.max(78, Math.min(124, width * 0.25)) : Math.max(210, Math.min(310, width * 0.14));
    const towerScale = narrow ? Math.max(0.52, Math.min(0.72, width / 500)) : Math.max(1.04, Math.min(1.22, width / 1700));

    const stage = this.add.graphics();
    stage.fillStyle(0x08131d, 0.58);
    stage.fillEllipse(width / 2, centerY + 30 * towerScale, spacing * 2 + 280 * towerScale, 120 * towerScale);
    stage.fillStyle(0x153126, 0.54);
    stage.fillEllipse(width / 2, centerY + 52 * towerScale, spacing * 2 + 360 * towerScale, 86 * towerScale);
    stage.lineStyle(4, THEME.gold, 0.28);
    stage.lineBetween(width / 2 - spacing + 88 * towerScale, centerY - 86 * towerScale, width / 2 + spacing - 88 * towerScale, centerY - 86 * towerScale);
    stage.lineStyle(2, 0xb8c9e6, 0.18);
    stage.lineBetween(width / 2 - spacing + 74 * towerScale, centerY - 42 * towerScale, width / 2 + spacing - 74 * towerScale, centerY - 42 * towerScale);
    this.towerContainer.add(stage);

    this.playerTowerVisual = this.createTowerVisual(width / 2 - spacing, centerY, 0x5e7ea9, 'Black', towerScale);
    this.aiTowerVisual = this.createTowerVisual(width / 2 + spacing, centerY, 0x9f615a, 'Red', towerScale);

    const versusText = this.add
      .text(width / 2, centerY - 92 * towerScale, 'VS', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '20px' : '34px',
        color: '#fff1d2',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.towerContainer.add(versusText);
  }

  private createTowerVisual(x: number, y: number, baseColor: number, label: string, scale = 1): TowerVisualRefs {
    const container = this.add.container(x, y).setScale(scale);

    const dangerGlow = this.add.ellipse(0, -124, 220, 296, 0xff6f5f, 0).setVisible(false);
    const shadow = this.add.ellipse(0, 14, 170, 42, 0x040a12, 0.36);
    const wallShield = this.add
      .rectangle(0, -50, 184, 46, 0x94c7e3, 0.16)
      .setStrokeStyle(3, 0xbde6ff, 0.72);
    const body = this.add
      .rectangle(0, 0, 132, 242, baseColor, 0.95)
      .setStrokeStyle(3, 0xe0d5c2)
      .setOrigin(0.5, 1);

    const roof = this.add.triangle(0, -242, 0, 0, 66, 34, -66, 34, 0x7b4b43, 0.95).setStrokeStyle(2, 0xd9c8b5);

    const glow = this.add.ellipse(0, -118, 170, 260, 0x7de0b4, 0.18).setVisible(false);
    const flash = this.add.rectangle(0, -121, 128, 238, 0xee6a6a, 0).setOrigin(0.5, 0);

    const progressBack = this.add
      .rectangle(92, -12, 12, 214, 0x152132, 0.88)
      .setStrokeStyle(1, 0xd7c9ad, 0.65)
      .setOrigin(0.5, 1);
    const progressFill = this.add.rectangle(92, -12, 12, 120, THEME.gold, 0.92).setOrigin(0.5, 1);

    const towerValueText = this.add
      .text(0, -286, 'Castle 30', {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        color: '#fff2d4',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const wallValueText = this.add
      .text(0, -58, 'Wall 10', {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        color: '#dff2ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const labelText = this.add
      .text(0, 16, label, {
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        color: '#f0ecdf',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    const windows: Phaser.GameObjects.Rectangle[] = [];
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const windowRect = this.add.rectangle(-34 + col * 34, -30 - row * 44, 18, 24, 0x2a3550, 0.9).setStrokeStyle(1, 0xb2c3d8);
        windows.push(windowRect);
      }
    }

    container.add([dangerGlow, shadow, glow, wallShield, body, roof, progressBack, progressFill, ...windows, flash, towerValueText, wallValueText, labelText]);
    this.towerContainer.add(container);

    return {
      container,
      windows,
      flash,
      glow,
      dangerGlow,
      wallShield,
      wallValueText,
      towerValueText,
      progressFill,
    };
  }

  private createHandArea(width: number, height: number): void {
    this.handContainer = this.add.container(0, 0).setDepth(30);

    const narrow = this.isNarrowLayout(width);
    const panelHeight = narrow ? Math.max(176, Math.min(224, height * 0.29)) : Math.max(238, Math.min(286, height * 0.28));
    const panelTop = height - panelHeight - 10;

    this.handSurface = this.add
      .rectangle(width / 2, panelTop + panelHeight / 2, width - 20, panelHeight, 0x211a14, 0.93)
      .setStrokeStyle(2, THEME.gold, 0.65);

    this.handPreviewText = this.add
      .text(26, panelTop + 12, 'Selected card\nTap or hover a card to inspect details.', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '12px' : '17px',
        color: '#f6ead7',
        lineSpacing: narrow ? 2 : 5,
        wordWrap: { width: narrow ? Math.max(142, width * 0.48) : Math.min(420, width * 0.26) },
      })
      .setOrigin(0, 0);

    this.battleFeedText = this.add
      .text(width / 2, panelTop + 12, 'Battle feed will appear here.', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '10px' : '14px',
        color: '#ffdca8',
        align: 'center',
        lineSpacing: narrow ? 1 : 3,
        wordWrap: { width: narrow ? Math.max(120, width * 0.38) : Math.min(560, width * 0.34) },
      })
      .setOrigin(0.5, 0);

    this.handHintText = this.add
      .text(width - 26, panelTop + (narrow ? panelHeight - 36 : 16), narrow ? 'Tap: select\nSwipe: play/discard' : 'Click full-color cards | right-click discard', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '10px' : '13px',
        color: '#c7d2e6',
        align: 'right',
      })
      .setOrigin(1, 0);
    this.handHintText.setVisible(false);

    const actionPanelWidth = narrow ? Math.min(168, width * 0.42) : Math.min(226, width * 0.2);
    const actionPanelX = width - actionPanelWidth / 2 - 22;
    const actionPanelY = panelTop + (narrow ? 42 : 46);
    const actionPanelBg = this.add
      .rectangle(0, 0, actionPanelWidth, narrow ? 70 : 68, 0x0f1725, 0.88)
      .setStrokeStyle(2, THEME.gold, 0.52);
    this.actionPanelTitleText = this.add
      .text(0, narrow ? -23 : -21, 'Select a card', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '12px' : '15px',
        color: '#fff1d2',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: actionPanelWidth - 20 },
      })
      .setOrigin(0.5);
    this.actionPanelStatusText = this.add
      .text(0, narrow ? -7 : -3, 'Choose from hand', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '10px' : '12px',
        color: '#cbd8ee',
        align: 'center',
        wordWrap: { width: actionPanelWidth - 20 },
      })
      .setOrigin(0.5);
    this.playActionButton = createActionButton(this, -actionPanelWidth * 0.24, narrow ? 23 : 22, actionPanelWidth * 0.42, 'Play', 0x2f8f5d, () => {
      this.tryPlaySelectedCard();
    });
    this.discardActionButton = createActionButton(this, actionPanelWidth * 0.24, narrow ? 23 : 22, actionPanelWidth * 0.42, 'Discard', 0x8b4f3e, () => {
      this.tryDiscardSelectedCard();
    });
    this.actionPanelContainer = this.add.container(actionPanelX, actionPanelY, [
      actionPanelBg,
      this.actionPanelTitleText,
      this.actionPanelStatusText,
      this.playActionButton.container,
      this.discardActionButton.container,
    ]);

    this.handCardsContainer = this.add.container(0, panelTop + panelHeight - (narrow ? 46 : 72));

    this.handContainer.add([this.handSurface, this.handPreviewText, this.battleFeedText, this.handHintText, this.actionPanelContainer, this.handCardsContainer]);
  }

  private createOverlayLayer(): void {
    this.overlayContainer = this.add.container(0, 0).setDepth(40);
  }

  private createEndOverlay(width: number, height: number): void {
    const overlayBg = this.add.rectangle(width / 2, height / 2, width, height, 0x0f1725, 0.82);

    this.endOverlayText = this.add
      .text(width / 2, height / 2 - 92, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '46px',
        color: '#f2efe8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const rematchButton = createButton(this, width / 2 - 114, height / 2 + 16, 172, 'Rematch', () => {
      this.startNewMatch();
      this.progressLoop();
    });

    const menuButton = createButton(this, width / 2 + 114, height / 2 + 16, 172, 'Back to Menu', () => {
      this.scene.start('MenuScene');
    });

    this.endOverlay = this.add.container(0, 0, [overlayBg, this.endOverlayText, rematchButton, menuButton]).setDepth(60);
    this.endOverlay.setVisible(false);
  }

  private bindKeys(): void {
    this.input.keyboard?.on('keydown-F', () => {
      if (this.scale.isFullscreen) {
        this.scale.stopFullscreen();
      } else {
        this.scale.startFullscreen();
      }
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.scale.isFullscreen) {
        this.scale.stopFullscreen();
      }
    });

    this.input.keyboard?.on('keydown-ENTER', () => {
      this.tryPlaySelectedCard();
    });

    this.input.keyboard?.on('keydown-BACKSPACE', () => {
      this.tryDiscardSelectedCard();
    });

    this.input.keyboard?.on('keydown-DELETE', () => {
      this.tryDiscardSelectedCard();
    });
  }

  private startNewMatch(seed?: number): void {
    const matchSeed = seed ?? seedFromNow();
    this.rng = new SeededRng(matchSeed ^ 0xa55aa55a);
    this.state = createInitialGameState(matchSeed);
    this.drawPreviewCardId = this.state.players.player.hand.at(-1) ?? null;
    this.resultPersisted = false;

    this.clearSelectedCard();
    this.aiCountdownMs = null;
    this.aiRevealCountdownMs = null;
    this.aiPendingAction = null;
    this.clearEnemyCardReveal();
    this.gestureState.clear();

    this.endOverlay.setVisible(false);
    this.updateHud();
  }

  private dispatch(action: Action): boolean {
    const previous = cloneGameState(this.state);
    const playedCardOrigin = action.type === 'play_card' ? this.getCardWorldPosition(action.cardId, action.handIndex) : null;

    const result = reduceGameState(this.state, action, this.rng);
    this.state = result.state;

    if (result.errors.length > 0) {
      const msg = `Error: ${result.errors[0]}`;
      this.state.log.push(msg);
      if (this.state.log.length > this.state.maxLogEntries) {
        this.state.log = this.state.log.slice(this.state.log.length - this.state.maxLogEntries);
      }
      this.updateHud();
      return false;
    }

    this.updateDrawPreviewFromDiff(previous, this.state, action);
    this.updateHud();
    this.emitFeedback(previous, this.state, action, playedCardOrigin);

    if (this.state.phase === 'ended') {
      this.handleMatchEnd();
    }

    return true;
  }

  private emitFeedback(previous: GameState, next: GameState, action: Action, playedCardOrigin: Point | null): void {
    const playerIds: PlayerId[] = ['player', 'ai'];

    for (const playerId of playerIds) {
      const before = previous.players[playerId];
      const after = next.players[playerId];

      const towerDelta = after.tower - before.tower;
      if (towerDelta < 0) {
        this.spawnFloatingText(this.getTowerAnchor(playerId), `${towerDelta}`, '#ff8f8f');
        this.animateTowerDamage(playerId);
      } else if (towerDelta > 0) {
        this.spawnFloatingText(this.getTowerAnchor(playerId), `+${towerDelta}`, '#8ff0b5');
        this.animateTowerHeal(playerId);
      }

      const wallDelta = after.wall - before.wall;
      if (wallDelta !== 0) {
        this.spawnFloatingText(this.getPanelAnchor(playerId, 0), `${wallDelta > 0 ? '+' : ''}${wallDelta} Wall`, wallDelta > 0 ? '#afe3ff' : '#ffb6b6');
      }

      const resources: Resource[] = ['bricks', 'weapons', 'crystals'];
      for (const resource of resources) {
        const delta = after[resource] - before[resource];
        if (delta !== 0) {
          const text = `${delta > 0 ? '+' : ''}${delta} ${RESOURCE_META[resource].resourceName}`;
          this.spawnFloatingText(this.getPanelAnchor(playerId, resources.indexOf(resource) + 1), text, delta > 0 ? '#9bf2b8' : '#ffc0c0', {
            durationMultiplier: RESOURCE_FLOATING_TEXT_DURATION_MULTIPLIER,
          });
        }

        const generatorKey = RESOURCE_META[resource].generatorKey;
        const generatorDelta = after[generatorKey] - before[generatorKey];
        if (generatorDelta !== 0) {
          const text = `${generatorDelta > 0 ? '+' : ''}${generatorDelta} ${RESOURCE_META[resource].label}`;
          this.spawnFloatingText(this.getPanelAnchor(playerId, resources.indexOf(resource) + 1), text, '#fff2b0', {
            durationMultiplier: RESOURCE_FLOATING_TEXT_DURATION_MULTIPLIER,
          });
        }
      }

      const handDelta = after.hand.length - before.hand.length;
      const deckDelta = after.deck.length - before.deck.length;
      if (handDelta > 0 || deckDelta < 0) {
        this.animateDeckDraw();
      }
    }

    if (action.type === 'play_card') {
      const origin = playedCardOrigin ?? this.getActionOrigin(action);
      const target = this.getActionTarget(action, previous, next);
      this.animateCardPlay(action.cardId, origin, target);
    }
  }

  private getPanelAnchor(playerId: PlayerId, level: number): Point {
    const panel = playerId === 'player' ? this.playerPanel : this.aiPanel;
    const compact = this.isNarrowLayout();
    if (level === 0) {
      return {
        x: panel.container.x + panel.width / 2,
        y: panel.container.y + panel.height - (compact ? 44 : 58),
      };
    }

    const resourceTopStart = compact ? 52 : 74;
    const resourceGap = compact ? 54 : 82;
    const blockHeight = compact ? 48 : 72;
    return {
      x:
        playerId === 'player'
          ? panel.container.x + panel.width - (compact ? 30 : 18)
          : panel.container.x + (compact ? 30 : 18),
      y: panel.container.y + resourceTopStart + (level - 1) * resourceGap + blockHeight / 2,
    };
  }

  private getTowerAnchor(playerId: PlayerId): Point {
    const tower = playerId === 'player' ? this.playerTowerVisual : this.aiTowerVisual;
    const world = new Phaser.Math.Vector2();
    tower.container.getWorldTransformMatrix().transformPoint(0, -150, world);
    return { x: world.x, y: world.y };
  }

  private getActionOrigin(action: Extract<Action, { type: 'play_card' }>): Point {
    if (action.playerId === 'ai') {
      return {
        x: this.scale.width / 2,
        y: this.isNarrowLayout() ? this.scale.height * 0.36 : this.scale.height * 0.4,
      };
    }

    return this.getPanelAnchor('player', 3);
  }

  private getActionTarget(action: Extract<Action, { type: 'play_card' }>, previous: GameState, next: GameState): Point {
    const actor = action.playerId;
    const opponent = actor === 'player' ? 'ai' : 'player';
    const opponentBefore = previous.players[opponent];
    const opponentAfter = next.players[opponent];
    const actorBefore = previous.players[actor];
    const actorAfter = next.players[actor];

    if (opponentAfter.tower !== opponentBefore.tower || opponentAfter.wall !== opponentBefore.wall) {
      return this.getTowerAnchor(opponent);
    }

    if (actorAfter.tower !== actorBefore.tower || actorAfter.wall !== actorBefore.wall) {
      return this.getTowerAnchor(actor);
    }

    const resources: Resource[] = ['bricks', 'weapons', 'crystals'];
    const changedOpponentResourceIndex = resources.findIndex((resource) => opponentAfter[resource] !== opponentBefore[resource]);
    if (changedOpponentResourceIndex >= 0) {
      return this.getPanelAnchor(opponent, changedOpponentResourceIndex + 1);
    }

    const generatorKeys = ['quarry', 'barracks', 'magic'] as const;
    const changedOpponentGeneratorIndex = generatorKeys.findIndex((generator) => opponentAfter[generator] !== opponentBefore[generator]);
    if (changedOpponentGeneratorIndex >= 0) {
      return this.getPanelAnchor(opponent, changedOpponentGeneratorIndex + 1);
    }

    const changedResourceIndex = resources.findIndex((resource) => actorAfter[resource] !== actorBefore[resource]);
    if (changedResourceIndex >= 0) {
      return this.getPanelAnchor(actor, changedResourceIndex + 1);
    }

    const changedGeneratorIndex = generatorKeys.findIndex((generator) => actorAfter[generator] !== actorBefore[generator]);
    if (changedGeneratorIndex >= 0) {
      return this.getPanelAnchor(actor, changedGeneratorIndex + 1);
    }

    return this.getTowerAnchor(actor);
  }

  private animateDeckDraw(): void {
    if (!this.deckCard) {
      return;
    }

    this.tweens.killTweensOf(this.deckCard);
    this.deckCard.setScale(1);

    this.tweens.add({
      targets: this.deckCard,
      scaleX: 0.82,
      scaleY: 1.12,
      yoyo: true,
      repeat: 1,
      duration: animDuration(110),
      ease: 'Sine.InOut',
    });
  }

  private animateCardPlay(cardId: string, origin: Point, target: Point): void {
    const card = CARD_BY_ID[cardId];
    if (!card) {
      return;
    }

    const color = cardTypeColor(card.domain);
    const beam = this.add.graphics();
    beam.lineStyle(4, color, 0.34);
    beam.lineBetween(origin.x, origin.y, target.x, target.y);
    beam.setAlpha(this.animationsEnabled ? 0 : 0.34);

    const clone = this.add.container(origin.x, origin.y);
    const cloneShadow = this.add.rectangle(5, 7, 166, 88, 0x03070d, 0.35);
    const cloneBody = this.add
      .rectangle(0, 0, 166, 88, color, 0.96)
      .setStrokeStyle(3, THEME.gold, 0.88);
    const cloneText = this.add
      .text(0, -8, card.name, {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        color: '#f4f0e8',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: 138 },
      })
      .setOrigin(0.5);
    const cloneEffect = this.add
      .text(0, 22, card.text, {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        color: '#ffe8c6',
        align: 'center',
        wordWrap: { width: 142 },
      })
      .setOrigin(0.5);

    clone.add([cloneShadow, cloneBody, cloneText, cloneEffect]);
    clone.setScale(this.animationsEnabled ? 0.8 : 1);
    this.overlayContainer.add([beam, clone]);

    if (!this.animationsEnabled) {
      clone.destroy(true);
      beam.destroy();
      this.spawnImpactBurst(target, color);
      return;
    }

    this.tweens.add({
      targets: beam,
      alpha: 0.34,
      duration: animDuration(120),
      yoyo: true,
      hold: animDelay(220),
      ease: 'Sine.InOut',
      onComplete: () => beam.destroy(),
    });

    this.tweens.add({
      targets: clone,
      x: target.x,
      y: target.y,
      scaleX: 0.72,
      scaleY: 0.72,
      duration: animDuration(520),
      ease: 'Sine.InOut',
      onComplete: () => {
        clone.destroy(true);
        this.spawnImpactBurst(target, color);
      },
    });
  }

  private spawnImpactBurst(target: Point, color: number): void {
    const ring = this.add.circle(target.x, target.y, 14, color, 0).setStrokeStyle(4, THEME.gold, 0.82);
    const core = this.add.circle(target.x, target.y, 8, color, 0.55);
    this.overlayContainer.add([ring, core]);

    this.tweens.add({
      targets: ring,
      scaleX: 2.6,
      scaleY: 2.6,
      alpha: 0,
      duration: animDuration(420),
      ease: 'Sine.Out',
      onComplete: () => ring.destroy(),
    });

    this.tweens.add({
      targets: core,
      scaleX: 0.2,
      scaleY: 0.2,
      alpha: 0,
      duration: animDuration(280),
      ease: 'Sine.In',
      onComplete: () => core.destroy(),
    });
  }

  private showEnemyCardReveal(cardId: string): void {
    const card = CARD_BY_ID[cardId];
    if (!card) {
      return;
    }

    this.clearEnemyCardReveal();

    const narrow = this.isNarrowLayout();
    const width = narrow ? Math.min(250, this.scale.width - 44) : 292;
    const height = narrow ? 148 : 174;
    const x = this.scale.width / 2;
    const y = narrow ? Math.max(190, this.scale.height * 0.38) : this.scale.height * 0.43;
    const cardColor = cardTypeColor(card.domain);

    const shadow = this.add.rectangle(8, 10, width, height, 0x06101e, 0.58);
    const frame = this.add
      .rectangle(0, 0, width, height, cardColor, 0.98)
      .setStrokeStyle(4, 0xffe2b8, 0.95);
    const header = this.add.rectangle(0, -height / 2 + 22, width - 18, 34, 0x121c2b, 0.78);
    const label = this.add
      .text(0, -height / 2 + 8, 'Opponent plays', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '14px' : '16px',
        color: '#ffe9c8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    const title = this.add
      .text(0, -height / 2 + 48, card.name, {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '24px' : '30px',
        color: '#fff8e8',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: width - 34 },
      })
      .setOrigin(0.5, 0);
    const cost = this.add
      .text(0, title.y + (narrow ? 34 : 42), `${card.domain.toUpperCase()} ${card.cost}`, {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '13px' : '15px',
        color: '#fbe0b6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    const text = this.add
      .text(0, height / 2 - (narrow ? 48 : 54), card.text, {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '13px' : '15px',
        color: '#fff3dd',
        align: 'center',
        wordWrap: { width: width - 40 },
      })
      .setOrigin(0.5, 0);

    const reveal = this.add.container(x, y, [shadow, frame, header, label, title, cost, text]);
    reveal.setDepth(55);
    reveal.setAlpha(this.animationsEnabled ? 0 : 1);
    reveal.setScale(this.animationsEnabled ? 0.88 : 1);
    this.overlayContainer.add(reveal);
    this.enemyCardRevealContainer = reveal;

    this.turnLabelText.setText('Opponent plays');
    this.statusText.setText(`AI reveals ${card.name}. Effects resolve shortly.`);

    if (this.animationsEnabled) {
      this.tweens.add({
        targets: reveal,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        duration: animDuration(220),
        ease: 'Back.Out',
      });
    }
  }

  private clearEnemyCardReveal(animated = false): void {
    const reveal = this.enemyCardRevealContainer;
    if (!reveal) {
      return;
    }

    this.enemyCardRevealContainer = null;
    this.tweens.killTweensOf(reveal);

    if (animated && this.animationsEnabled) {
      this.tweens.add({
        targets: reveal,
        alpha: 0,
        scaleX: 0.94,
        scaleY: 0.94,
        duration: animDuration(180),
        ease: 'Sine.In',
        onComplete: () => reveal.destroy(true),
      });
      return;
    }

    reveal.destroy(true);
  }

  private animateTowerDamage(playerId: PlayerId): void {
    const tower = playerId === 'player' ? this.playerTowerVisual : this.aiTowerVisual;
    this.tweens.killTweensOf(tower.container);
    this.tweens.killTweensOf(tower.flash);

    tower.flash.setAlpha(0.58);

    this.tweens.add({
      targets: tower.container,
      x: tower.container.x + 6,
      yoyo: true,
      repeat: 3,
      duration: animDuration(36),
      ease: 'Sine.InOut',
      onComplete: () => {
        this.tweens.add({
          targets: tower.flash,
          alpha: 0,
          duration: animDuration(180),
          ease: 'Sine.Out',
        });
      },
    });
  }

  private animateTowerHeal(playerId: PlayerId): void {
    const tower = playerId === 'player' ? this.playerTowerVisual : this.aiTowerVisual;
    this.tweens.killTweensOf(tower.glow);

    tower.glow.setVisible(true);
    tower.glow.setAlpha(0.08);
    tower.glow.setScale(0.82);

    this.tweens.add({
      targets: tower.glow,
      alpha: 0,
      scaleX: 1.24,
      scaleY: 1.24,
      duration: animDuration(460),
      ease: 'Sine.Out',
      onComplete: () => {
        tower.glow.setVisible(false);
      },
    });
  }

  private spawnFloatingText(
    anchor: Point,
    text: string,
    color: string,
    options: { durationMultiplier?: number } = {},
  ): void {
    const floating = this.add
      .text(anchor.x, anchor.y, text, {
        fontFamily: FONT_FAMILY,
        fontSize: '19px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.overlayContainer.add(floating);

    this.tweens.add({
      targets: floating,
      y: anchor.y - 48,
      alpha: 0,
      duration: animDuration(640 * (options.durationMultiplier ?? 1)),
      ease: 'Sine.Out',
      onComplete: () => floating.destroy(),
    });
  }

  private progressLoop(): void {
    if (this.state.phase === 'ended') {
      return;
    }

    if (!this.state.turn.started) {
      const started = this.dispatch({ type: 'start_turn' });
      if (!started) {
        return;
      }
    }

    if (this.state.turn.current === 'ai' && this.state.turn.started && !this.state.turn.actionTaken) {
      this.aiCountdownMs = AI_DELAY_MS;
    } else {
      this.aiCountdownMs = null;
    }

    this.updateHud();
  }

  private tickAi(delta: number): void {
    if (this.aiRevealCountdownMs !== null) {
      this.aiRevealCountdownMs -= delta;
      if (this.aiRevealCountdownMs > 0) {
        return;
      }

      const pendingAction = this.aiPendingAction;
      this.aiRevealCountdownMs = null;
      this.aiPendingAction = null;
      this.clearEnemyCardReveal(true);

      if (pendingAction && this.state.phase === 'playing') {
        this.resolveAiAction(pendingAction);
      }
      return;
    }

    if (this.aiCountdownMs === null || this.state.phase !== 'playing') {
      return;
    }

    this.aiCountdownMs -= delta;
    if (this.aiCountdownMs > 0) {
      return;
    }

    this.aiCountdownMs = null;

    if (this.state.turn.current !== 'ai' || !this.state.turn.started || this.state.turn.actionTaken) {
      return;
    }

    const move = evaluateAIMove(this.state);
    const action: Action =
      move.type === 'play_card'
        ? { type: 'play_card', playerId: 'ai', cardId: move.cardId }
        : { type: 'discard_card', playerId: 'ai', cardId: move.cardId };

    if (action.type === 'play_card') {
      this.aiPendingAction = action;
      this.aiRevealCountdownMs = ENEMY_CARD_REVEAL_MS;
      this.showEnemyCardReveal(action.cardId);
      return;
    }

    this.resolveAiAction(action);
  }

  private resolveAiAction(action: Action): void {
    const ok = this.dispatch(action);
    if (!ok) {
      return;
    }

    if (this.dispatch({ type: 'end_turn' })) {
      this.progressLoop();
    }
  }

  private onCardPointerDown(cardId: string, handIndex: number, pointer: Phaser.Input.Pointer): void {
    const event = pointer.event as MouseEvent | PointerEvent | undefined;
    const isRightClick = pointer.button === 2 || pointer.rightButtonDown() || event?.button === 2;

    if (isRightClick) {
      this.tryDiscardCard(cardId, handIndex);
      return;
    }

    this.gestureState.set(pointer.id, {
      cardId,
      handIndex,
      x: pointer.x,
      y: pointer.y,
      isTouch: this.isTouchPointer(pointer),
    });
  }

  private onGlobalPointerUp(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gestureState.get(pointer.id);
    if (!gesture) {
      return;
    }
    this.gestureState.delete(pointer.id);

    const dx = pointer.x - gesture.x;
    const dy = pointer.y - gesture.y;

    if (Math.abs(dy) > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) {
        this.tryPlayCard(gesture.cardId, gesture.handIndex);
      } else {
        this.tryDiscardCard(gesture.cardId, gesture.handIndex);
      }
      return;
    }

    if (gesture.isTouch) {
      this.selectCardAt(gesture.handIndex);
      return;
    }

    this.tryPlayCard(gesture.cardId, gesture.handIndex);
  }

  private isTouchPointer(pointer: Phaser.Input.Pointer): boolean {
    const event = pointer.event as PointerEvent | MouseEvent | undefined;
    if (event && 'pointerType' in event) {
      return event.pointerType === 'touch' || event.pointerType === 'pen';
    }
    return pointer.wasTouch;
  }

  private tryPlayCard(cardId: string, handIndex?: number): void {
    const selectedIndex = this.resolveHandIndex(cardId, handIndex);
    if (selectedIndex === null) {
      return;
    }
    this.selectCardAt(selectedIndex);

    if (this.state.phase !== 'playing') {
      return;
    }
    if (this.state.turn.current !== 'player' || !this.state.turn.started || this.state.turn.actionTaken) {
      return;
    }

    if (!canAffordCard(this.state, 'player', cardId)) {
      return;
    }

    const played = this.dispatch({ type: 'play_card', playerId: 'player', cardId, handIndex: selectedIndex });
    if (!played) {
      return;
    }

    if (this.dispatch({ type: 'end_turn' })) {
      this.progressLoop();
    }
  }

  private tryPlaySelectedCard(): void {
    if (this.selectedHandIndex === null) {
      this.selectDefaultCard();
    }
    const selected = this.getSelectedHandEntry();
    if (!selected) {
      return;
    }

    this.tryPlayCard(selected.cardId, selected.handIndex);
  }

  private tryDiscardCard(cardId: string, handIndex?: number): void {
    const selectedIndex = this.resolveHandIndex(cardId, handIndex);
    if (selectedIndex === null) {
      return;
    }
    this.selectCardAt(selectedIndex);

    if (this.state.phase !== 'playing') {
      return;
    }
    if (this.state.turn.current !== 'player' || !this.state.turn.started || this.state.turn.actionTaken) {
      return;
    }

    const discarded = this.dispatch({ type: 'discard_card', playerId: 'player', cardId, handIndex: selectedIndex });
    if (!discarded) {
      return;
    }

    if (this.dispatch({ type: 'end_turn' })) {
      this.progressLoop();
    }
  }

  private tryDiscardSelectedCard(): void {
    if (this.selectedHandIndex === null) {
      this.selectDefaultCard();
    }
    const selected = this.getSelectedHandEntry();
    if (!selected) {
      return;
    }

    this.tryDiscardCard(selected.cardId, selected.handIndex);
  }

  private clearSelectedCard(): void {
    this.selectedCardId = null;
    this.selectedHandIndex = null;
  }

  private getSelectedHandEntry(): { cardId: string; handIndex: number } | null {
    if (this.selectedHandIndex === null) {
      return null;
    }
    const cardId = this.state.players.player.hand[this.selectedHandIndex];
    if (!cardId) {
      return null;
    }
    return { cardId, handIndex: this.selectedHandIndex };
  }

  private resolveHandIndex(cardId: string, handIndex?: number): number | null {
    const hand = this.state.players.player.hand;
    if (handIndex !== undefined && hand[handIndex] === cardId) {
      return handIndex;
    }
    const fallbackIndex = hand.indexOf(cardId);
    return fallbackIndex === -1 ? null : fallbackIndex;
  }

  private selectCardAt(handIndex: number | null): void {
    if (handIndex === null) {
      this.clearSelectedCard();
      this.updateCardPreview();
      this.refreshCardSelection();
      return;
    }

    const cardId = this.state.players.player.hand[handIndex];
    if (!cardId) {
      this.clearSelectedCard();
      this.updateCardPreview();
      this.refreshCardSelection();
      return;
    }

    this.selectedHandIndex = handIndex;
    this.selectedCardId = cardId;
    this.updateCardPreview(cardId);
    this.refreshCardSelection();
  }

  private selectDefaultCard(): void {
    const hand = this.state.players.player.hand;
    const selected = this.getSelectedHandEntry();
    if (selected && selected.cardId === this.selectedCardId) {
      return;
    }

    const playableIndex = hand.findIndex((cardId) => canAffordCard(this.state, 'player', cardId));
    const handIndex = playableIndex === -1 ? (hand.length > 0 ? 0 : null) : playableIndex;
    this.selectCardAt(handIndex);
  }

  private updateDrawPreviewFromDiff(previous: GameState, next: GameState, action: Action): void {
    const owner =
      action.type === 'discard_card'
        ? action.playerId
        : action.type === 'end_turn'
          ? previous.turn.current
          : null;

    if (owner !== 'player') {
      return;
    }

    const beforeHand = previous.players.player.hand;
    const afterHand = next.players.player.hand;
    if (afterHand.length === 0) {
      return;
    }

    if (action.type === 'discard_card') {
      this.drawPreviewCardId = afterHand.at(-1) ?? this.drawPreviewCardId;
      return;
    }

    if (action.type === 'end_turn' && afterHand.length > beforeHand.length) {
      this.drawPreviewCardId = afterHand.at(-1) ?? this.drawPreviewCardId;
    }
  }

  private generatorUiName(generator: 'quarry' | 'barracks' | 'magic'): string {
    if (generator === 'quarry') {
      return 'Builders';
    }
    if (generator === 'barracks') {
      return 'Army';
    }
    return 'Magic';
  }

  private formatCardEffectLine(card: CardDefinition): string {
    const formatAmount = (amount: number): string => `${amount > 0 ? '+' : ''}${amount}`;
    const parts = card.effects.map((effect) => {
      switch (effect.type) {
        case 'adjustWall':
          return `${effect.target === 'opponent' ? 'Enemy Wall' : 'Wall'} ${formatAmount(effect.amount)}`;
        case 'adjustTower':
          return `${effect.target === 'opponent' ? 'Enemy Castle' : 'Castle'} ${formatAmount(effect.amount)}`;
        case 'adjustResource':
          return `${effect.target === 'opponent' ? 'Enemy ' : ''}${RESOURCE_META[effect.resource].resourceName} ${formatAmount(effect.amount)}`;
        case 'adjustGenerator':
          return `${effect.target === 'opponent' ? 'Enemy ' : ''}${this.generatorUiName(effect.generator)} ${formatAmount(effect.amount)}`;
        case 'attack': {
          const amount = effect.amount * (effect.hits ?? 1);
          if (effect.bypassWall) {
            return `Castle dmg ${amount}`;
          }
          if (effect.wallOnly) {
            return `Wall dmg ${amount}`;
          }
          return `Attack +${amount}`;
        }
        case 'towerPerGenerator':
          return `Castle +${effect.amountPer} / Builder`;
        case 'setShield':
          return 'Block next attack';
        default:
          return this.describeEffectImpact(effect);
      }
    });

    return parts.slice(0, 2).join('\n');
  }

  private updateDrawPreviewCard(): void {
    if (!this.drawPreviewFrame) {
      return;
    }

    const card = this.drawPreviewCardId ? CARD_BY_ID[this.drawPreviewCardId] : null;
    const width = this.drawPreviewWidth;
    const height = this.drawPreviewHeight;
    const radius = this.isNarrowLayout() ? 6 : 8;

    this.drawPreviewFrame.clear();
    if (!card) {
      this.drawPreviewFrame.fillStyle(0x30384a, 0.94);
      this.drawPreviewFrame.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
      this.drawPreviewFrame.lineStyle(2, 0xd7dff3, 0.76);
      this.drawPreviewFrame.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
      this.drawPreviewTitleText.setText('Draw');
      this.drawPreviewEffectText.setText('Waiting');
      this.drawPreviewCostText.setText('');
      return;
    }

    const fill = mixColor(cardTypeColor(card.domain), THEME.parchment, 0.42);
    this.drawPreviewFrame.fillStyle(fill, 0.98);
    this.drawPreviewFrame.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    this.drawPreviewFrame.lineStyle(2, cardTypeColor(card.domain), 0.98);
    this.drawPreviewFrame.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
    this.drawPreviewFrame.fillStyle(0x1f2a39, 0.96);
    this.drawPreviewFrame.fillCircle(width / 2 - (this.isNarrowLayout() ? 8 : 11), -height / 2 + (this.isNarrowLayout() ? 8 : 11), this.isNarrowLayout() ? 8 : 10);

    this.drawPreviewTitleText.setText(card.name);
    this.drawPreviewTitleText.setColor('#241d19');
    this.drawPreviewEffectText.setText(this.formatCardEffectLine(card).replace('\n', ' / '));
    this.drawPreviewEffectText.setColor('#3d352f');
    this.drawPreviewCostText.setText(String(card.cost));
  }

  private updateHud(): void {
    const player = this.state.players.player;
    const ai = this.state.players.ai;
    this.selectDefaultCard();

    this.updateDrawPreviewCard();

    this.opponentNameText.setText(`Red C${ai.tower} / W${ai.wall}`);
    this.opponentTowerText.setText(`Goal ${this.state.winTower} | Deck ${player.deck.length}`);

    const turnLabel =
      this.state.phase === 'ended' ? 'Match Over' : this.state.turn.current === 'player' ? 'Your turn' : 'Opponent turn';
    this.turnLabelText.setText(turnLabel);

    const lastLogs = this.state.log.slice(-3);
    const currentInstruction =
      this.state.phase === 'ended'
        ? this.state.winner === 'player'
          ? 'Victory secured.'
          : 'Defeat. The tower fell.'
        : this.state.turn.current === 'player'
          ? this.selectedCardId
            ? 'Click a full-color card to play. Discard cycles the selected card.'
            : 'Pick a card from the hand.'
          : this.aiPendingAction
            ? 'Opponent card revealed. Effects resolve next.'
            : 'Opponent is choosing a response.';
    this.statusText.setText(currentInstruction);
    this.battleFeedText.setText(lastLogs.length > 0 ? lastLogs.map((entry) => `- ${entry}`).join('\n') : 'No battle events yet.');

    this.playerPanel.headerText.setText('Black');
    this.aiPanel.headerText.setText('Red');

    this.playerPanel.resourceBlocks.bricks.generatorValue.setText(`+${player.quarry}`);
    this.playerPanel.resourceBlocks.bricks.resourceValue.setText(String(player.bricks));
    this.playerPanel.resourceBlocks.weapons.generatorValue.setText(`+${player.barracks}`);
    this.playerPanel.resourceBlocks.weapons.resourceValue.setText(String(player.weapons));
    this.playerPanel.resourceBlocks.crystals.generatorValue.setText(`+${player.magic}`);
    this.playerPanel.resourceBlocks.crystals.resourceValue.setText(String(player.crystals));
    this.playerPanel.towerValue.setText(String(player.tower));
    this.playerPanel.wallValue.setText(String(player.wall));

    this.aiPanel.resourceBlocks.bricks.generatorValue.setText(`+${ai.quarry}`);
    this.aiPanel.resourceBlocks.bricks.resourceValue.setText(String(ai.bricks));
    this.aiPanel.resourceBlocks.weapons.generatorValue.setText(`+${ai.barracks}`);
    this.aiPanel.resourceBlocks.weapons.resourceValue.setText(String(ai.weapons));
    this.aiPanel.resourceBlocks.crystals.generatorValue.setText(`+${ai.magic}`);
    this.aiPanel.resourceBlocks.crystals.resourceValue.setText(String(ai.crystals));
    this.aiPanel.towerValue.setText(String(ai.tower));
    this.aiPanel.wallValue.setText(String(ai.wall));

    const playerTurn = this.state.phase === 'playing' && this.state.turn.current === 'player';
    const aiTurn = this.state.phase === 'playing' && this.state.turn.current === 'ai';
    this.playerPanel.activeGlow.setVisible(playerTurn);
    this.aiPanel.activeGlow.setVisible(aiTurn);
    this.turnIndicatorPlayer.setFillStyle(THEME.playerBlack, playerTurn ? 1 : 0.35);
    this.turnIndicatorPlayer.setScale(playerTurn ? 1.12 : 1);
    this.turnIndicatorAi.setFillStyle(THEME.enemyRed, aiTurn ? 1 : 0.35);
    this.turnIndicatorAi.setScale(aiTurn ? 1.12 : 1);
    this.topInfoGlow.setStrokeStyle(3, playerTurn ? 0x89b5ff : aiTurn ? 0xf3a59f : 0x85b5eb, 0.9);

    this.updateTowerWindows(this.playerTowerVisual, player.tower, this.state.winTower);
    this.updateTowerWindows(this.aiTowerVisual, ai.tower, this.state.winTower);
    this.updateTowerPressure(this.playerTowerVisual, player.tower, player.wall, this.state.winTower);
    this.updateTowerPressure(this.aiTowerVisual, ai.tower, ai.wall, this.state.winTower);

    const narrow = this.isNarrowLayout();
    this.handHintText.setText(
      this.state.turn.current === 'player'
        ? narrow
          ? 'Tap card\nPlay / discard below'
          : 'Enter plays selected | Backspace discards'
        : narrow
          ? 'Opponent turn'
          : 'Opponent turn: watch the center stage',
    );

    this.rebuildHand();

    if (this.selectedCardId && CARD_BY_ID[this.selectedCardId]) {
      this.updateCardPreview(this.selectedCardId);
    } else {
      this.updateCardPreview();
    }

    if (this.state.phase === 'ended') {
      this.endOverlayText.setText(this.state.winner === 'player' ? 'Victory' : 'Defeat');
      this.endOverlay.setVisible(true);
    } else {
      this.endOverlay.setVisible(false);
    }
  }

  private updateTowerWindows(tower: TowerVisualRefs, towerValue: number, winTower: number): void {
    const litCount = Phaser.Math.Clamp(Math.round((towerValue / winTower) * tower.windows.length), 0, tower.windows.length);

    tower.windows.forEach((windowRect, index) => {
      if (index < litCount) {
        windowRect.setFillStyle(0xf4e79e, 0.96);
      } else {
        windowRect.setFillStyle(0x2a3550, 0.9);
      }
    });
  }

  private updateTowerPressure(tower: TowerVisualRefs, towerValue: number, wallValue: number, winTower: number): void {
    const towerRatio = Phaser.Math.Clamp(towerValue / winTower, 0, 1);
    const wallRatio = Phaser.Math.Clamp(wallValue / 30, 0, 1);
    const danger = towerValue <= Math.ceil(winTower * 0.35);

    tower.towerValueText.setText(`Castle ${towerValue}/${winTower}`);
    tower.wallValueText.setText(wallValue > 0 ? `Wall ${wallValue}` : 'Wall down');
    tower.progressFill.displayHeight = Math.max(8, 214 * towerRatio);
    tower.progressFill.setFillStyle(towerRatio >= 0.78 ? 0x94f0a6 : danger ? 0xff8a70 : THEME.gold, 0.92);
    tower.wallShield.setAlpha(wallValue > 0 ? 0.18 + wallRatio * 0.36 : 0.04);
    tower.wallShield.setScale(1 + wallRatio * 0.18, 1 + wallRatio * 0.08);
    tower.wallValueText.setColor(wallValue > 0 ? '#dff2ff' : '#ffb7a8');
    tower.dangerGlow.setVisible(danger);
    tower.dangerGlow.setAlpha(danger ? 0.18 : 0);
  }

  private rebuildHand(): void {
    this.cardVisuals.forEach((entry) => entry.container.destroy());
    this.cardVisuals = [];

    const narrow = this.isNarrowLayout();
    const hand = this.state.players.player.hand;
    const panelWidth = this.handSurface.width;
    const maxWidth = panelWidth - 42;
    const targetCardWidth = narrow ? 68 : 168;
    const gap = hand.length > 1 ? Math.min(narrow ? 7 : 16, Math.max(4, (maxWidth - hand.length * targetCardWidth) / (hand.length - 1))) : 0;
    const count = Math.max(1, hand.length);
    const cardWidth = Math.min(narrow ? 88 : 214, Math.max(narrow ? 54 : 126, (maxWidth - gap * (count - 1)) / count));
    const compact = cardWidth < 136;
    const ultraCompact = cardWidth < 74;
    const cardHeight = ultraCompact ? 92 : compact ? 118 : 138;

    const rowWidth = count * cardWidth + (count - 1) * gap;
    const startX = this.scale.width / 2 - rowWidth / 2 + cardWidth / 2;

    hand.forEach((cardId, index) => {
      const card = CARD_BY_ID[cardId];
      if (!card) {
        return;
      }

      const x = startX + index * (cardWidth + gap);
      const y = 0;
      const affordable = canAffordCard(this.state, 'player', cardId);
      const muted = !affordable;
      const cardPadding = ultraCompact ? 5 : compact ? 8 : 12;
      const isSelected = this.selectedHandIndex === index;
      const iconSize = ultraCompact ? 13 : compact ? 18 : 24;
      const illustrationSize = ultraCompact ? 25 : compact ? 36 : 48;
      const titleY = -cardHeight / 2 + (ultraCompact ? 19 : compact ? 24 : 29);
      const titleWrapWidth = Math.max(36, cardWidth - cardPadding * 2);
      const effectText = this.formatCardEffectLine(card);

      const container = this.add.container(x, y);
      container.setY(isSelected ? -16 : 0);
      container.setScale(isSelected ? 1.06 : 1);
      const frame = this.add.graphics();
      paintCardFrame(frame, cardWidth, cardHeight, card.domain, affordable, isSelected);

      const topRule = this.add.rectangle(0, -cardHeight / 2 + (ultraCompact ? 17 : compact ? 22 : 27), cardWidth - cardPadding * 2, 1, 0x241d19, muted ? 0.18 : 0.26);
      const resourceIcon = createResourceIcon(
        this,
        card.domain,
        -cardWidth / 2 + cardPadding + iconSize / 2,
        -cardHeight / 2 + cardPadding + iconSize / 2,
        iconSize,
        muted,
      );

      const title = this.add
        .text(0, titleY, card.name, {
          fontFamily: FONT_FAMILY,
          fontSize: ultraCompact ? '8px' : compact ? '12px' : '16px',
          color: muted ? '#f0e5d8' : '#241d19',
          fontStyle: 'bold',
          align: 'center',
          wordWrap: { width: titleWrapWidth },
        })
        .setOrigin(0.5, 0);
      title.setLineSpacing(ultraCompact ? -2 : -1);

      const costBadge = this.add.circle(
        cardWidth / 2 - cardPadding - iconSize / 2,
        -cardHeight / 2 + cardPadding + iconSize / 2,
        ultraCompact ? 8 : compact ? 11 : 14,
        muted ? 0x6e6258 : 0x1f2a39,
        0.96,
      );
      costBadge.setStrokeStyle(2, muted ? 0xe4d8ca : 0xf0e3c7, muted ? 0.78 : 0.95);
      const costText = this.add
        .text(costBadge.x, costBadge.y, String(card.cost), {
          fontFamily: FONT_FAMILY,
          fontSize: ultraCompact ? '8px' : compact ? '12px' : '16px',
          color: muted ? '#f4ece3' : '#f9f4e7',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);

      const illustration = createIllustrationIcon(
        this,
        getCardIllustration(card),
        0,
        ultraCompact ? 4 : compact ? 8 : 10,
        illustrationSize,
        cardTypeColor(card.domain),
        muted,
      );

      const effect = this.add
        .text(0, cardHeight / 2 - (ultraCompact ? 14 : compact ? 20 : 25), ultraCompact ? '' : effectText, {
          fontFamily: FONT_FAMILY,
          fontSize: compact ? '10px' : '13px',
          color: muted ? '#efe4d7' : '#2f2924',
          align: 'center',
          wordWrap: { width: Math.max(30, cardWidth - cardPadding * 2) },
        })
        .setOrigin(0.5);

      const hit = this.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0).setInteractive({ useHandCursor: affordable });
      hit.on('pointerover', () => {
        this.selectCardAt(index);
      });
      hit.on('pointerout', () => {
        if (this.isTouchPointer(this.input.activePointer)) {
          return;
        }
        this.refreshCardSelection();
      });
      hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.onCardPointerDown(cardId, index, pointer);
      });

      container.add([frame, topRule, resourceIcon, title, costBadge, costText, illustration, effect, hit]);
      this.handCardsContainer.add(container);

      if (this.animationsEnabled) {
        container.setAlpha(0);
        this.tweens.add({
          targets: container,
          alpha: 1,
          y: container.y,
          duration: animDuration(180),
          delay: animDelay(index * 24),
          ease: 'Sine.Out',
        });
      }

      this.cardVisuals.push({
        cardId,
        handIndex: index,
        container,
        frame,
        width: cardWidth,
        height: cardHeight,
        domain: card.domain,
        affordable,
        baseY: y,
      });
    });
  }

  private refreshCardSelection(): void {
    this.cardVisuals.forEach((entry) => {
      const selected = entry.handIndex === this.selectedHandIndex;
      paintCardFrame(entry.frame, entry.width, entry.height, entry.domain, entry.affordable, selected);
      this.tweens.killTweensOf(entry.container);
      if (this.animationsEnabled) {
        this.tweens.add({
          targets: entry.container,
          y: selected ? entry.baseY - 16 : entry.baseY,
          scaleX: selected ? 1.06 : 1,
          scaleY: selected ? 1.06 : 1,
          duration: animDuration(130),
          ease: 'Sine.Out',
        });
      } else {
        entry.container.setY(selected ? entry.baseY - 16 : entry.baseY);
        entry.container.setScale(selected ? 1.06 : 1);
      }
    });
  }

  private getPlayerResource(resource: Resource): number {
    return this.state.players.player[resource];
  }

  private describeCardImpact(card: CardDefinition): string {
    const parts = card.effects.map((effect) => this.describeEffectImpact(effect)).filter(Boolean);
    return parts.slice(0, 3).join(' | ') || card.text;
  }

  private describeEffectImpact(effect: EffectSpec): string {
    const targetLabel = 'target' in effect && effect.target === 'opponent' ? 'Enemy' : 'You';
    const signed = (amount: number): string => `${amount > 0 ? '+' : ''}${amount}`;

    switch (effect.type) {
      case 'adjustWall':
        return `${targetLabel} wall ${signed(effect.amount)}`;
      case 'adjustTower':
        return `${targetLabel} tower ${signed(effect.amount)}`;
      case 'adjustResource':
        return `${targetLabel} ${RESOURCE_META[effect.resource].resourceName} ${signed(effect.amount)}`;
      case 'adjustRandomResource':
        return `${targetLabel} random resource ${signed(effect.amount)}`;
      case 'adjustAllResources':
        return `${targetLabel} all resources ${signed(effect.amount)}`;
      case 'adjustGenerator':
        return `${targetLabel} ${effect.generator} ${signed(effect.amount)}`;
      case 'adjustAllGenerators':
        return `${targetLabel} all income ${signed(effect.amount)}`;
      case 'attack': {
        const total = effect.amount * (effect.hits ?? 1);
        if (effect.bypassWall) {
          return `Enemy tower -${total} bypass`;
        }
        if (effect.wallOnly) {
          return `Enemy wall -${total}`;
        }
        return `Enemy wall/tower -${total}`;
      }
      case 'setNextAttackBonus':
        return `Next attack +${effect.amount}`;
      case 'setOutgoingDamagePenalty':
        return `${effect.target === 'opponent' ? 'Enemy' : 'Your'} damage -${effect.amount}`;
      case 'setIncomingDamageReduction':
        return `Next hit reduced by ${effect.amount}`;
      case 'setBarrier':
        return `Barrier ${effect.amount}`;
      case 'setShield':
        return 'Block next attack';
      case 'setSkipGain':
        return `${effect.target === 'opponent' ? 'Enemy' : 'You'} skip income`;
      case 'setCurse':
        return `${effect.target === 'opponent' ? 'Enemy' : 'You'} curse -${effect.towerLoss}/turn`;
      case 'drawCards':
        return `${effect.target === 'opponent' ? 'Enemy' : 'You'} draw ${effect.amount}`;
      case 'discardCards':
        return `${effect.target === 'opponent' ? 'Enemy' : 'You'} discard ${effect.amount}`;
      case 'doubleWall':
        return `Double wall up to ${effect.cap}`;
      case 'towerPerGenerator':
        return `Tower +${effect.amountPer} per ${effect.generator}`;
      case 'wallToTower':
        return `Convert ${effect.amount} wall to tower`;
      case 'stealResources':
        return `Steal ${effect.amount} resources`;
      case 'convertResources':
        return `Convert ${effect.amount} resources`;
      case 'gainChosenResource':
        return `Gain ${effect.amount} best resource`;
      case 'swapResources':
        return 'Swap resources';
      case 'chaos':
        return 'Chaotic resource swing';
      case 'repeatLastResolved':
        return 'Repeat last card effect';
      case 'drainEnemyResources':
        return `Enemy resources -${effect.amount}`;
      case 'sabotageGenerators':
        return 'Enemy all income -1';
      case 'enemyDiscard':
        return `Enemy discards ${effect.amount}`;
    }
  }

  private setActionButtonEnabled(button: ActionButtonRefs, enabled: boolean, fill: number): void {
    button.bg.setFillStyle(enabled ? fill : 0x39414d, enabled ? 0.96 : 0.54);
    button.bg.setStrokeStyle(2, enabled ? THEME.gold : 0x7e8897, enabled ? 0.82 : 0.46);
    button.text.setAlpha(enabled ? 1 : 0.55);
    button.container.setAlpha(enabled ? 1 : 0.72);
  }

  private updateActionPanel(card: CardDefinition | null, affordable = false): void {
    if (!this.actionPanelContainer) {
      return;
    }

    const canAct = this.state.phase === 'playing' && this.state.turn.current === 'player' && this.state.turn.started && !this.state.turn.actionTaken;
    if (!card) {
      this.actionPanelTitleText.setText('Select a card');
      this.actionPanelStatusText.setText('Hover or tap a card');
      this.setActionButtonEnabled(this.playActionButton, false, 0x2f8f5d);
      this.setActionButtonEnabled(this.discardActionButton, false, 0x8b4f3e);
      return;
    }

    const owned = this.getPlayerResource(card.domain);
    const shortfall = Math.max(0, card.cost - owned);
    this.actionPanelTitleText.setText(card.name);
    this.actionPanelStatusText.setText(
      affordable ? `Ready: ${card.cost} ${RESOURCE_META[card.domain].resourceName}` : `Need ${shortfall} more ${RESOURCE_META[card.domain].resourceName}`,
    );
    this.setActionButtonEnabled(this.playActionButton, canAct && affordable, 0x2f8f5d);
    this.setActionButtonEnabled(this.discardActionButton, canAct, 0x8b4f3e);
  }

  private updateCardPreview(cardId?: string): void {
    const selected = cardId ? CARD_BY_ID[cardId] : null;
    if (!selected) {
      this.handPreviewText.setText('Selected card\nChoose a hand slot to preview its effect.');
      this.updateActionPanel(null);
      return;
    }

    const affordable = canAffordCard(this.state, 'player', selected.id);
    const resourceName = RESOURCE_META[selected.domain].resourceName;
    const owned = this.getPlayerResource(selected.domain);
    this.handPreviewText.setText(
      `${selected.name} (${resourceName} ${owned}/${selected.cost})\n${this.formatCardEffectLine(selected)}\n${affordable ? 'Playable now' : `Need ${selected.cost - owned} more ${resourceName}`}`,
    );
    this.updateActionPanel(selected, affordable);
  }

  private getCardWorldPosition(cardId: string, handIndex?: number): Point | null {
    const visual =
      handIndex === undefined
        ? this.cardVisuals.find((entry) => entry.cardId === cardId)
        : this.cardVisuals.find((entry) => entry.handIndex === handIndex && entry.cardId === cardId);
    if (!visual) {
      return null;
    }

    const world = new Phaser.Math.Vector2();
    visual.container.getWorldTransformMatrix().transformPoint(0, 0, world);
    return { x: world.x, y: world.y };
  }

  private handleMatchEnd(): void {
    if (!this.resultPersisted) {
      this.meta = updateMeta((prev) => ({
        ...prev,
        stats: {
          ...prev.stats,
          matchesPlayed: prev.stats.matchesPlayed + 1,
          wins: prev.stats.wins + (this.state.winner === 'player' ? 1 : 0),
          losses: prev.stats.losses + (this.state.winner === 'ai' ? 1 : 0),
        },
      }));
      this.resultPersisted = true;
    }

    this.endOverlayText.setText(this.state.winner === 'player' ? 'Victory' : 'Defeat');
    this.endOverlay.setVisible(true);
  }

  private advanceVirtualTime(ms: number): void {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    const delta = ms / steps;
    for (let i = 0; i < steps; i += 1) {
      this.tickAi(delta);
    }
  }

  public renderGameState(): string {
    const payload = JSON.parse(summarizeForText(this.state)) as Record<string, unknown>;
    const selectedCard = this.selectedCardId ? CARD_BY_ID[this.selectedCardId] : null;
    const drawPreviewCard = this.drawPreviewCardId ? CARD_BY_ID[this.drawPreviewCardId] : null;
    payload.ui = {
      activePlayer: this.state.turn.current,
      revealedEnemyCardId: this.aiPendingAction?.type === 'play_card' ? this.aiPendingAction.cardId : null,
      drawPreviewCardId: this.drawPreviewCardId,
      drawPreviewCardName: drawPreviewCard?.name ?? null,
      drawPreviewCardEffect: drawPreviewCard ? this.formatCardEffectLine(drawPreviewCard) : null,
      selectedCardId: this.selectedCardId,
      selectedHandIndex: this.selectedHandIndex,
      selectedCardName: selectedCard?.name ?? null,
      selectedCardPlayable: selectedCard ? canAffordCard(this.state, 'player', selectedCard.id) : false,
      selectedCardImpact: selectedCard ? this.formatCardEffectLine(selectedCard) : null,
      phase: this.state.phase,
    };
    return JSON.stringify(payload, null, 2);
  }

  public advanceForTesting(ms: number): void {
    this.advanceVirtualTime(ms);
  }
}
