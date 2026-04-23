import Phaser from 'phaser';
import { evaluateAIMove } from '../game/ai';
import { CARD_BY_ID } from '../game/cards';
import { AI_DELAY_MS } from '../game/constants';
import { canAffordCard, cloneGameState, createInitialGameState, reduceGameState, summarizeForText } from '../game/engine';
import { SeededRng, seedFromNow } from '../game/rng';
import { loadMeta, updateMeta } from '../game/storage';
import type { Action, GameMetaV1, GameState, PlayerId, Resource } from '../game/types';

type PanelSide = 'left' | 'right';

interface ResourceBlockRefs {
  root: Phaser.GameObjects.Container;
  generatorValue: Phaser.GameObjects.Text;
  resourceValue: Phaser.GameObjects.Text;
}

interface PlayerPanelRefs {
  side: PanelSide;
  width: number;
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
}

interface CardVisual {
  cardId: string;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Rectangle;
}

interface GestureState {
  cardId: string;
  x: number;
  y: number;
  isTouch: boolean;
}

interface Point {
  x: number;
  y: number;
}

const TIMER_PLACEHOLDER_SECONDS = 20;
const SWIPE_THRESHOLD = 44;

const RESOURCE_META: Record<
  Resource,
  { label: string; resourceName: string; iconLabel: string; color: number; generatorKey: 'quarry' | 'barracks' | 'magic' }
> = {
  bricks: {
    label: 'Builders',
    resourceName: 'Bricks',
    iconLabel: 'HAM',
    color: 0x9f5b46,
    generatorKey: 'quarry',
  },
  weapons: {
    label: 'Soldiers',
    resourceName: 'Weapons',
    iconLabel: 'SWD',
    color: 0x3f7d4d,
    generatorKey: 'barracks',
  },
  crystals: {
    label: 'Mages',
    resourceName: 'Crystals',
    iconLabel: 'STR',
    color: 0x3f63a8,
    generatorKey: 'magic',
  },
};

function cardTypeColor(domain: Resource): number {
  if (domain === 'bricks') {
    return 0x8f4f3c;
  }
  if (domain === 'weapons') {
    return 0x3f7d4d;
  }
  return 0x3f63a8;
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
      fontFamily: 'Georgia',
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
  private opponentNameText!: Phaser.GameObjects.Text;
  private opponentTowerText!: Phaser.GameObjects.Text;
  private turnLabelText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private timerBarFill!: Phaser.GameObjects.Rectangle;
  private timerRing!: Phaser.GameObjects.Graphics;
  private timerRingCenter: Point = { x: 0, y: 0 };
  private topInfoGlow!: Phaser.GameObjects.Rectangle;
  private turnIndicatorPlayer!: Phaser.GameObjects.Arc;
  private turnIndicatorAi!: Phaser.GameObjects.Arc;

  private handPreviewText!: Phaser.GameObjects.Text;
  private handHintText!: Phaser.GameObjects.Text;
  private handSurface!: Phaser.GameObjects.Rectangle;

  private endOverlay!: Phaser.GameObjects.Container;
  private endOverlayText!: Phaser.GameObjects.Text;

  private cardVisuals: CardVisual[] = [];
  private gestureState = new Map<number, GestureState>();

  private selectedCardId: string | null = null;
  private aiCountdownMs: number | null = null;
  private resultPersisted = false;

  private animationsEnabled = true;

  private turnTimerSeconds = TIMER_PLACEHOLDER_SECONDS;
  private turnSignature = '';

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
        const target = hand.find((cardId) => canAffordCard(this.state, 'player', cardId)) ?? hand[0];
        if (!target) {
          return;
        }
        this.tryPlayCard(target);
      },
      clearInput: () => {
        this.selectedCardId = null;
        this.updateCardPreview();
        this.refreshCardSelection();
      },
    };

    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize, this);
      this.input.off('pointerup', this.onGlobalPointerUp, this);
      const active = window as typeof window & { __game?: unknown };
      delete active.__game;
    });
  }

  update(_time: number, delta: number): void {
    this.tickAi(delta);
    this.updateTurnTimer(delta);
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

    this.backgroundContainer?.destroy(true);
    this.topCenterContainer?.destroy(true);
    this.leftPanelContainer?.destroy(true);
    this.rightPanelContainer?.destroy(true);
    this.towerContainer?.destroy(true);
    this.handContainer?.destroy(true);
    this.overlayContainer?.destroy(true);
    this.endOverlay?.destroy(true);
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

    const panelWidth = Math.max(420, Math.min(640, width * 0.48));
    const panelHeight = Math.max(116, Math.min(142, height * 0.16));
    const centerX = width / 2;
    const topY = Math.max(10, Math.round(height * 0.02));
    const panelCenterY = topY + panelHeight / 2;

    this.topInfoGlow = this.add
      .rectangle(centerX, panelCenterY, panelWidth + 10, panelHeight + 10, 0x000000, 0)
      .setStrokeStyle(3, 0x85b5eb, 0.9);

    const panel = this.add
      .rectangle(centerX, panelCenterY, panelWidth, panelHeight, 0xf3efe4, 0.94)
      .setStrokeStyle(2, 0xb5a98f);

    const deckX = centerX - panelWidth / 2 + 54;
    const deckY = panelCenterY;
    this.deckCard = this.add
      .rectangle(deckX, deckY, 68, 92, 0x2f3753)
      .setStrokeStyle(2, 0xd7dff3);
    const deckPatternA = this.add.rectangle(deckX, deckY - 16, 46, 8, 0x4f6391, 0.95);
    const deckPatternB = this.add.rectangle(deckX, deckY + 4, 46, 8, 0x4f6391, 0.95);
    const deckPatternC = this.add.rectangle(deckX, deckY + 24, 46, 8, 0x4f6391, 0.95);

    this.opponentNameText = this.add
      .text(centerX - 34, topY + 20, 'Opponent: Player B (AI)', {
        fontFamily: 'Georgia',
        fontSize: '22px',
        color: '#223143',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);

    this.opponentTowerText = this.add
      .text(centerX - 34, topY + 54, 'Tower: 30', {
        fontFamily: 'Georgia',
        fontSize: '30px',
        color: '#293f67',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);

    const indicatorY = topY + panelHeight - 20;
    this.turnIndicatorPlayer = this.add.circle(centerX - 62, indicatorY, 11, 0x3f63a8, 0.4).setStrokeStyle(2, 0xd8e5ff);
    const turnIndicatorPlayerText = this.add
      .text(this.turnIndicatorPlayer.x, indicatorY, 'A', {
        fontFamily: 'Georgia',
        fontSize: '12px',
        color: '#f3f4ef',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.turnIndicatorAi = this.add.circle(centerX - 28, indicatorY, 11, 0x9b514d, 0.4).setStrokeStyle(2, 0xf2d8d6);
    const turnIndicatorAiText = this.add
      .text(this.turnIndicatorAi.x, indicatorY, 'B', {
        fontFamily: 'Georgia',
        fontSize: '12px',
        color: '#f3f4ef',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.turnLabelText = this.add
      .text(centerX, topY + panelHeight + 8, 'Your turn', {
        fontFamily: 'Georgia',
        fontSize: '24px',
        color: '#f3f0e8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    const timerBarBg = this.add.rectangle(centerX + panelWidth / 2 - 112, panelCenterY - 28, 164, 14, 0x43597a, 0.82);
    this.timerBarFill = this.add.rectangle(timerBarBg.x - 80, timerBarBg.y, 160, 10, 0x66d186, 0.96).setOrigin(0, 0.5);
    this.timerText = this.add
      .text(timerBarBg.x + 18, timerBarBg.y + 16, 'Timer: 20s', {
        fontFamily: 'Georgia',
        fontSize: '14px',
        color: '#243344',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    this.timerRingCenter = { x: timerBarBg.x + 72, y: timerBarBg.y + 3 };
    this.timerRing = this.add.graphics();

    this.statusText = this.add
      .text(centerX, topY + panelHeight + 38, '', {
        fontFamily: 'Georgia',
        fontSize: '15px',
        color: '#d9e2ef',
      })
      .setOrigin(0.5, 0);

    this.topCenterContainer.add([
      this.topInfoGlow,
      panel,
      this.deckCard,
      deckPatternA,
      deckPatternB,
      deckPatternC,
      this.opponentNameText,
      this.opponentTowerText,
      this.turnIndicatorPlayer,
      turnIndicatorPlayerText,
      this.turnIndicatorAi,
      turnIndicatorAiText,
      this.turnLabelText,
      timerBarBg,
      this.timerBarFill,
      this.timerRing,
      this.timerText,
      this.statusText,
    ]);

    this.refreshTimerVisual();
  }

  private createSidePanels(width: number, height: number): void {
    const sideMargin = Math.max(12, Math.floor(width * 0.014));
    const panelWidth = Math.max(170, Math.min(300, (width - sideMargin * 3) / 2));
    const panelHeight = Math.max(420, Math.min(560, height * 0.63));
    const panelTop = Math.max(122, height * 0.17);

    this.playerPanel = this.createPlayerPanel({
      side: 'left',
      x: sideMargin,
      y: panelTop,
      width: panelWidth,
      height: panelHeight,
      headerColor: 0x3f63a8,
      borderColor: 0x9eb8e8,
      title: 'Player A',
    });

    this.aiPanel = this.createPlayerPanel({
      side: 'right',
      x: width - panelWidth - sideMargin,
      y: panelTop,
      width: panelWidth,
      height: panelHeight,
      headerColor: 0x9b514d,
      borderColor: 0xe3b8b5,
      title: 'Player B',
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
  }): PlayerPanelRefs {
    const isRight = config.side === 'right';

    const container = this.add.container(config.x, config.y).setDepth(20);

    const frame = this.add.rectangle(config.width / 2, config.height / 2, config.width, config.height, 0xf3efe4, 0.95);
    frame.setStrokeStyle(2, 0xb6ab92);

    const activeGlow = this.add
      .rectangle(config.width / 2, config.height / 2, config.width + 8, config.height + 8, 0x000000, 0)
      .setStrokeStyle(4, config.borderColor)
      .setVisible(false);

    const headerBg = this.add
      .rectangle(config.width / 2, 30, config.width - 16, 48, config.headerColor, 0.96)
      .setStrokeStyle(2, config.borderColor);

    const headerText = this.add
      .text(config.width / 2, 30, config.title, {
        fontFamily: 'Georgia',
        fontSize: '24px',
        color: '#f5f1e7',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    container.add([frame, activeGlow, headerBg, headerText]);

    const resourceBlocks: Partial<Record<Resource, ResourceBlockRefs>> = {};
    const resources: Resource[] = ['bricks', 'weapons', 'crystals'];

    resources.forEach((resource, index) => {
      const top = 74 + index * 94;
      const block = this.createResourceBlock({
        side: config.side,
        panelWidth: config.width,
        top,
        label: RESOURCE_META[resource].label,
        resourceName: RESOURCE_META[resource].resourceName,
        iconLabel: RESOURCE_META[resource].iconLabel,
        color: RESOURCE_META[resource].color,
      });
      resourceBlocks[resource] = block;
      container.add(block.root);
    });

    const towerTop = config.height - 138;
    const towerBlock = this.add
      .rectangle(config.width / 2, towerTop + 60, config.width - 24, 118, 0xe9e3d4, 0.95)
      .setStrokeStyle(2, 0xb8ac92);

    const towerLabelX = isRight ? config.width - 24 : 24;
    const towerLabel = this.add
      .text(towerLabelX, towerTop + 12, 'Tower', {
        fontFamily: 'Georgia',
        fontSize: '18px',
        color: '#243446',
        fontStyle: 'bold',
      })
      .setOrigin(isRight ? 1 : 0, 0);

    const wallLabel = this.add
      .text(towerLabelX, towerTop + 58, 'Wall', {
        fontFamily: 'Georgia',
        fontSize: '18px',
        color: '#243446',
        fontStyle: 'bold',
      })
      .setOrigin(isRight ? 1 : 0, 0);

    const castleBadge = this.add.circle(config.width / 2, towerTop + 60, 24, 0x5a6f8a, 0.95).setStrokeStyle(2, 0xd6d9e0);
    const castleText = this.add
      .text(castleBadge.x, castleBadge.y, 'CAS', {
        fontFamily: 'Georgia',
        fontSize: '11px',
        color: '#f2f5f8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const towerValue = this.add
      .text(isRight ? 88 : config.width - 88, towerTop + 8, '30', {
        fontFamily: 'Georgia',
        fontSize: '34px',
        color: '#22374e',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    const wallValue = this.add
      .text(isRight ? 88 : config.width - 88, towerTop + 54, '10', {
        fontFamily: 'Georgia',
        fontSize: '34px',
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
  }): ResourceBlockRefs {
    const isRight = config.side === 'right';
    const root = this.add.container(0, 0);

    const width = config.panelWidth - 24;
    const left = 12;
    const bg = this.add
      .rectangle(left + width / 2, config.top + 40, width, 82, config.color, 0.9)
      .setStrokeStyle(2, 0xe5d9c1);

    const iconX = isRight ? left + width - 24 : left + 24;
    const iconBadge = this.add.circle(iconX, config.top + 24, 17, 0x253546, 0.95).setStrokeStyle(2, 0xe4d8bd);
    const iconText = this.add
      .text(iconX, iconBadge.y, config.iconLabel, {
        fontFamily: 'Georgia',
        fontSize: '10px',
        color: '#f4f0e5',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const labelX = isRight ? left + width - 50 : left + 50;
    const generatorValueX = isRight ? left + 24 : left + width - 24;

    const labelText = this.add
      .text(labelX, config.top + 8, config.label, {
        fontFamily: 'Georgia',
        fontSize: '16px',
        color: '#f5f2ea',
        fontStyle: 'bold',
      })
      .setOrigin(isRight ? 1 : 0, 0);

    const resourceNameText = this.add
      .text(labelX, config.top + 31, config.resourceName, {
        fontFamily: 'Georgia',
        fontSize: '14px',
        color: '#f1e8d8',
      })
      .setOrigin(isRight ? 1 : 0, 0);

    const generatorValue = this.add
      .text(generatorValueX, config.top + 5, '2', {
        fontFamily: 'Georgia',
        fontSize: '28px',
        color: '#f9f5eb',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    const resourceValue = this.add
      .text(generatorValueX, config.top + 41, '5', {
        fontFamily: 'Georgia',
        fontSize: '21px',
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

    const centerY = height * 0.52;
    const spacing = Math.max(150, Math.min(220, width * 0.17));

    this.playerTowerVisual = this.createTowerVisual(width / 2 - spacing, centerY, 0x5e7ea9, 'Player A');
    this.aiTowerVisual = this.createTowerVisual(width / 2 + spacing, centerY, 0x9f615a, 'Player B');

    const versusText = this.add
      .text(width / 2, centerY + 150, 'VS', {
        fontFamily: 'Georgia',
        fontSize: '32px',
        color: '#d8e0f0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.towerContainer.add(versusText);
  }

  private createTowerVisual(x: number, y: number, baseColor: number, label: string): TowerVisualRefs {
    const container = this.add.container(x, y);

    const body = this.add
      .rectangle(0, 0, 132, 242, baseColor, 0.95)
      .setStrokeStyle(3, 0xe0d5c2)
      .setOrigin(0.5, 1);

    const roof = this.add.triangle(0, -242, 0, 0, 66, 34, -66, 34, 0x7b4b43, 0.95).setStrokeStyle(2, 0xd9c8b5);

    const glow = this.add.ellipse(0, -118, 170, 260, 0x7de0b4, 0.18).setVisible(false);
    const flash = this.add.rectangle(0, -121, 128, 238, 0xee6a6a, 0).setOrigin(0.5, 0);

    const labelText = this.add
      .text(0, 16, label, {
        fontFamily: 'Georgia',
        fontSize: '18px',
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

    container.add([glow, body, roof, ...windows, flash, labelText]);
    this.towerContainer.add(container);

    return {
      container,
      windows,
      flash,
      glow,
    };
  }

  private createHandArea(width: number, height: number): void {
    this.handContainer = this.add.container(0, 0).setDepth(30);

    const panelHeight = Math.max(178, Math.min(228, height * 0.27));
    const panelTop = height - panelHeight - 12;

    this.handSurface = this.add
      .rectangle(width / 2, panelTop + panelHeight / 2, width - 24, panelHeight, 0xf1ece0, 0.95)
      .setStrokeStyle(2, 0xb9ad93);

    this.handPreviewText = this.add
      .text(26, panelTop + 12, 'Card preview\nTap or hover a card to inspect details.', {
        fontFamily: 'Georgia',
        fontSize: '18px',
        color: '#243344',
        lineSpacing: 6,
      })
      .setOrigin(0, 0);

    this.handHintText = this.add
      .text(width - 24, panelTop + 12, 'Desktop: click play, right-click discard\nMobile: tap select, swipe up play, swipe down discard', {
        fontFamily: 'Georgia',
        fontSize: '14px',
        color: '#4d5e73',
        align: 'right',
      })
      .setOrigin(1, 0);

    this.handCardsContainer = this.add.container(0, panelTop + panelHeight - 76);

    this.handContainer.add([this.handSurface, this.handPreviewText, this.handHintText, this.handCardsContainer]);
  }

  private createOverlayLayer(): void {
    this.overlayContainer = this.add.container(0, 0).setDepth(40);
  }

  private createEndOverlay(width: number, height: number): void {
    const overlayBg = this.add.rectangle(width / 2, height / 2, width, height, 0x0f1725, 0.82);

    this.endOverlayText = this.add
      .text(width / 2, height / 2 - 92, '', {
        fontFamily: 'Georgia',
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
  }

  private startNewMatch(seed?: number): void {
    const matchSeed = seed ?? seedFromNow();
    this.rng = new SeededRng(matchSeed ^ 0xa55aa55a);
    this.state = createInitialGameState(matchSeed);
    this.resultPersisted = false;

    this.selectedCardId = null;
    this.aiCountdownMs = null;
    this.gestureState.clear();

    this.turnTimerSeconds = TIMER_PLACEHOLDER_SECONDS;
    this.turnSignature = '';

    this.endOverlay.setVisible(false);
    this.updateHud();
  }

  private dispatch(action: Action): boolean {
    const previous = cloneGameState(this.state);
    const playedCardOrigin = action.type === 'play_card' ? this.getCardWorldPosition(action.cardId) : null;

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
          this.spawnFloatingText(this.getPanelAnchor(playerId, resources.indexOf(resource) + 1), text, delta > 0 ? '#9bf2b8' : '#ffc0c0');
        }

        const generatorKey = RESOURCE_META[resource].generatorKey;
        const generatorDelta = after[generatorKey] - before[generatorKey];
        if (generatorDelta !== 0) {
          const text = `${generatorDelta > 0 ? '+' : ''}${generatorDelta} ${RESOURCE_META[resource].label}`;
          this.spawnFloatingText(this.getPanelAnchor(playerId, resources.indexOf(resource) + 1), text, '#fff2b0');
        }
      }

      const handDelta = after.hand.length - before.hand.length;
      const deckDelta = after.deck.length - before.deck.length;
      if (handDelta > 0 || deckDelta < 0) {
        this.animateDeckDraw();
      }
    }

    if (action.type === 'play_card' && playedCardOrigin) {
      this.animateCardPlay(action.cardId, playedCardOrigin);
    }
  }

  private getPanelAnchor(playerId: PlayerId, level: number): Point {
    const panel = playerId === 'player' ? this.playerPanel : this.aiPanel;
    return {
      x: panel.container.x + panel.width / 2,
      y: panel.container.y + 106 + level * 72,
    };
  }

  private getTowerAnchor(playerId: PlayerId): Point {
    const tower = playerId === 'player' ? this.playerTowerVisual : this.aiTowerVisual;
    const world = new Phaser.Math.Vector2();
    tower.container.getWorldTransformMatrix().transformPoint(0, -150, world);
    return { x: world.x, y: world.y };
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
      duration: 110,
    });
  }

  private animateCardPlay(cardId: string, origin: Point): void {
    const card = CARD_BY_ID[cardId];
    if (!card) {
      return;
    }

    const cloneBody = this.add
      .rectangle(origin.x, origin.y, 144, 78, cardTypeColor(card.domain), 0.96)
      .setStrokeStyle(2, 0xf4e7cf);
    const cloneText = this.add
      .text(origin.x, origin.y, card.name, {
        fontFamily: 'Georgia',
        fontSize: '16px',
        color: '#f4f0e8',
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5);

    this.overlayContainer.add([cloneBody, cloneText]);

    this.tweens.add({
      targets: [cloneBody, cloneText],
      x: this.scale.width / 2,
      y: this.scale.height * 0.49,
      alpha: 0,
      scaleX: 0.72,
      scaleY: 0.72,
      duration: 340,
      onComplete: () => {
        cloneBody.destroy();
        cloneText.destroy();
      },
    });
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
      duration: 36,
      onComplete: () => {
        this.tweens.add({
          targets: tower.flash,
          alpha: 0,
          duration: 180,
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
      duration: 460,
      onComplete: () => {
        tower.glow.setVisible(false);
      },
    });
  }

  private spawnFloatingText(anchor: Point, text: string, color: string): void {
    const floating = this.add
      .text(anchor.x, anchor.y, text, {
        fontFamily: 'Georgia',
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
      duration: 640,
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

    const ok = this.dispatch(action);
    if (!ok) {
      return;
    }

    if (this.dispatch({ type: 'end_turn' })) {
      this.progressLoop();
    }
  }

  private onCardPointerDown(cardId: string, pointer: Phaser.Input.Pointer): void {
    const event = pointer.event as MouseEvent | PointerEvent | undefined;
    const isRightClick = pointer.button === 2 || pointer.rightButtonDown() || event?.button === 2;

    if (isRightClick) {
      this.tryDiscardCard(cardId);
      return;
    }

    this.gestureState.set(pointer.id, {
      cardId,
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
        this.tryPlayCard(gesture.cardId);
      } else {
        this.tryDiscardCard(gesture.cardId);
      }
      return;
    }

    if (gesture.isTouch) {
      this.selectedCardId = gesture.cardId;
      this.updateCardPreview(gesture.cardId);
      this.refreshCardSelection();
      return;
    }

    this.tryPlayCard(gesture.cardId);
  }

  private isTouchPointer(pointer: Phaser.Input.Pointer): boolean {
    const event = pointer.event as PointerEvent | MouseEvent | undefined;
    if (event && 'pointerType' in event) {
      return event.pointerType === 'touch' || event.pointerType === 'pen';
    }
    return pointer.wasTouch;
  }

  private tryPlayCard(cardId: string): void {
    this.selectedCardId = cardId;
    this.updateCardPreview(cardId);
    this.refreshCardSelection();

    if (this.state.phase !== 'playing') {
      return;
    }
    if (this.state.turn.current !== 'player' || !this.state.turn.started || this.state.turn.actionTaken) {
      return;
    }

    if (!canAffordCard(this.state, 'player', cardId)) {
      this.state.log.push('Card is not affordable this turn.');
      if (this.state.log.length > this.state.maxLogEntries) {
        this.state.log = this.state.log.slice(this.state.log.length - this.state.maxLogEntries);
      }
      this.updateHud();
      return;
    }

    const played = this.dispatch({ type: 'play_card', playerId: 'player', cardId });
    if (!played) {
      return;
    }

    if (this.dispatch({ type: 'end_turn' })) {
      this.progressLoop();
    }
  }

  private tryDiscardCard(cardId: string): void {
    this.selectedCardId = cardId;
    this.updateCardPreview(cardId);
    this.refreshCardSelection();

    if (this.state.phase !== 'playing') {
      return;
    }
    if (this.state.turn.current !== 'player' || !this.state.turn.started || this.state.turn.actionTaken) {
      return;
    }

    const discarded = this.dispatch({ type: 'discard_card', playerId: 'player', cardId });
    if (!discarded) {
      return;
    }

    if (this.dispatch({ type: 'end_turn' })) {
      this.progressLoop();
    }
  }

  private updateTurnTimer(delta: number): void {
    if (this.state.phase !== 'playing' || !this.state.turn.started) {
      return;
    }

    this.turnTimerSeconds = Math.max(0, this.turnTimerSeconds - delta / 1000);
    this.refreshTimerVisual();
  }

  private refreshTimerVisual(): void {
    const ratio = Phaser.Math.Clamp(this.turnTimerSeconds / TIMER_PLACEHOLDER_SECONDS, 0, 1);
    this.timerBarFill.setScale(ratio, 1);
    this.timerText.setText(`Timer: ${Math.ceil(this.turnTimerSeconds)}s`);
    this.timerRing.clear();
    this.timerRing.lineStyle(3, 0x43597a, 0.95);
    this.timerRing.strokeCircle(this.timerRingCenter.x, this.timerRingCenter.y, 14);
    if (ratio <= 0) {
      return;
    }
    this.timerRing.lineStyle(4, 0x66d186, 1);
    this.timerRing.beginPath();
    this.timerRing.arc(
      this.timerRingCenter.x,
      this.timerRingCenter.y,
      14,
      Phaser.Math.DegToRad(-90),
      Phaser.Math.DegToRad(-90 + ratio * 360),
      false,
    );
    this.timerRing.strokePath();
  }

  private updateHud(): void {
    const player = this.state.players.player;
    const ai = this.state.players.ai;

    const signature = `${this.state.turn.number}:${this.state.turn.current}:${this.state.turn.started}`;
    if (signature !== this.turnSignature && this.state.turn.started) {
      this.turnSignature = signature;
      this.turnTimerSeconds = TIMER_PLACEHOLDER_SECONDS;
      this.refreshTimerVisual();
    }

    this.opponentNameText.setText('Opponent: Player B (AI)');
    this.opponentTowerText.setText(`Tower: ${ai.tower}`);

    const turnLabel =
      this.state.phase === 'ended' ? 'Match Over' : this.state.turn.current === 'player' ? 'Your turn' : 'Opponent turn';
    this.turnLabelText.setText(turnLabel);

    const lastLogs = this.state.log.slice(-2);
    this.statusText.setText(lastLogs.join('  |  '));

    this.playerPanel.headerText.setText('Player A');
    this.aiPanel.headerText.setText('Player B');

    this.playerPanel.resourceBlocks.bricks.generatorValue.setText(String(player.quarry));
    this.playerPanel.resourceBlocks.bricks.resourceValue.setText(String(player.bricks));
    this.playerPanel.resourceBlocks.weapons.generatorValue.setText(String(player.barracks));
    this.playerPanel.resourceBlocks.weapons.resourceValue.setText(String(player.weapons));
    this.playerPanel.resourceBlocks.crystals.generatorValue.setText(String(player.magic));
    this.playerPanel.resourceBlocks.crystals.resourceValue.setText(String(player.crystals));
    this.playerPanel.towerValue.setText(String(player.tower));
    this.playerPanel.wallValue.setText(String(player.wall));

    this.aiPanel.resourceBlocks.bricks.generatorValue.setText(String(ai.quarry));
    this.aiPanel.resourceBlocks.bricks.resourceValue.setText(String(ai.bricks));
    this.aiPanel.resourceBlocks.weapons.generatorValue.setText(String(ai.barracks));
    this.aiPanel.resourceBlocks.weapons.resourceValue.setText(String(ai.weapons));
    this.aiPanel.resourceBlocks.crystals.generatorValue.setText(String(ai.magic));
    this.aiPanel.resourceBlocks.crystals.resourceValue.setText(String(ai.crystals));
    this.aiPanel.towerValue.setText(String(ai.tower));
    this.aiPanel.wallValue.setText(String(ai.wall));

    const playerTurn = this.state.phase === 'playing' && this.state.turn.current === 'player';
    const aiTurn = this.state.phase === 'playing' && this.state.turn.current === 'ai';
    this.playerPanel.activeGlow.setVisible(playerTurn);
    this.aiPanel.activeGlow.setVisible(aiTurn);
    this.turnIndicatorPlayer.setFillStyle(0x3f63a8, playerTurn ? 1 : 0.35);
    this.turnIndicatorPlayer.setScale(playerTurn ? 1.12 : 1);
    this.turnIndicatorAi.setFillStyle(0x9b514d, aiTurn ? 1 : 0.35);
    this.turnIndicatorAi.setScale(aiTurn ? 1.12 : 1);
    this.topInfoGlow.setStrokeStyle(3, playerTurn ? 0x89b5ff : aiTurn ? 0xf3a59f : 0x85b5eb, 0.9);

    this.updateTowerWindows(this.playerTowerVisual, player.tower, this.state.winTower);
    this.updateTowerWindows(this.aiTowerVisual, ai.tower, this.state.winTower);

    this.handHintText.setText(
      this.state.turn.current === 'player'
        ? 'Desktop: click play, right-click discard\nMobile: tap select, swipe up play, swipe down discard'
        : 'AI is resolving turn...\nWatch effects in the center overlay',
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
    const litCount = Math.round((towerValue / winTower) * tower.windows.length);

    tower.windows.forEach((windowRect, index) => {
      if (index < litCount) {
        windowRect.setFillStyle(0xf4e79e, 0.96);
      } else {
        windowRect.setFillStyle(0x2a3550, 0.9);
      }
    });
  }

  private rebuildHand(): void {
    this.cardVisuals.forEach((entry) => entry.container.destroy());
    this.cardVisuals = [];

    const hand = this.state.players.player.hand;
    const panelWidth = this.handSurface.width;
    const maxWidth = panelWidth - 42;
    const gap = hand.length > 1 ? Math.min(10, Math.max(4, (maxWidth - hand.length * 70) / (hand.length - 1))) : 0;
    const count = Math.max(1, hand.length);
    const cardWidth = Math.min(180, Math.max(54, (maxWidth - gap * (count - 1)) / count));
    const compact = cardWidth < 112;
    const cardHeight = compact ? 98 : 106;

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

      const container = this.add.container(x, y);
      const body = this.add
        .rectangle(0, 0, cardWidth, cardHeight, cardTypeColor(card.domain), affordable ? 0.97 : 0.4)
        .setStrokeStyle(this.selectedCardId === cardId ? 4 : 2, this.selectedCardId === cardId ? 0xfff3dd : 0xf1dbc2);

      const title = this.add
        .text(-cardWidth / 2 + 10, -cardHeight / 2 + 8, card.name, {
          fontFamily: 'Georgia',
          fontSize: compact ? '13px' : '17px',
          color: '#f8f5ec',
          fontStyle: 'bold',
          wordWrap: { width: cardWidth - 58 },
        })
        .setOrigin(0, 0);

      const costBadge = this.add
        .circle(cardWidth / 2 - (compact ? 14 : 18), -cardHeight / 2 + (compact ? 14 : 18), compact ? 11 : 14, 0x1f2a39, 0.95)
        .setStrokeStyle(2, 0xf0e3c7);
      const costText = this.add
        .text(costBadge.x, costBadge.y, String(card.cost), {
          fontFamily: 'Georgia',
          fontSize: compact ? '12px' : '15px',
          color: '#f9f4e7',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);

      const effect = this.add
        .text(-cardWidth / 2 + 10, -2, card.text, {
          fontFamily: 'Georgia',
          fontSize: compact ? '11px' : '13px',
          color: '#f4f1e9',
          wordWrap: { width: cardWidth - 18 },
        })
        .setOrigin(0, 0);

      const stateText = this.add
        .text(-cardWidth / 2 + 10, cardHeight / 2 - 24, affordable ? 'Playable' : 'Not affordable', {
          fontFamily: 'Georgia',
          fontSize: compact ? '10px' : '12px',
          color: affordable ? '#dcffdc' : '#f2d4d4',
          fontStyle: 'bold',
        })
        .setOrigin(0, 0);

      const hit = this.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => {
        this.selectedCardId = cardId;
        this.updateCardPreview(cardId);
        this.refreshCardSelection();
      });
      hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.onCardPointerDown(cardId, pointer);
      });

      container.add([body, title, costBadge, costText, effect, stateText, hit]);
      this.handCardsContainer.add(container);

      if (this.animationsEnabled) {
        container.setAlpha(0);
        this.tweens.add({
          targets: container,
          alpha: 1,
          y,
          duration: 180,
          delay: index * 24,
        });
      }

      this.cardVisuals.push({
        cardId,
        container,
        body,
      });
    });
  }

  private refreshCardSelection(): void {
    this.cardVisuals.forEach((entry) => {
      entry.body.setStrokeStyle(entry.cardId === this.selectedCardId ? 4 : 2, entry.cardId === this.selectedCardId ? 0xfff3dd : 0xf1dbc2);
    });
  }

  private updateCardPreview(cardId?: string): void {
    const selected = cardId ? CARD_BY_ID[cardId] : null;
    if (!selected) {
      this.handPreviewText.setText('Card preview\nTap or hover a card to inspect details.');
      return;
    }

    const affordable = canAffordCard(this.state, 'player', selected.id);
    this.handPreviewText.setText(
      `${selected.name} (${selected.domain.toUpperCase()} ${selected.cost})\n${selected.text}\n${affordable ? 'Playable now' : 'Need more resources'}`,
    );
  }

  private getCardWorldPosition(cardId: string): Point | null {
    const visual = this.cardVisuals.find((entry) => entry.cardId === cardId);
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
      this.updateTurnTimer(delta);
    }
  }

  public renderGameState(): string {
    const payload = JSON.parse(summarizeForText(this.state)) as Record<string, unknown>;
    payload.ui = {
      activePlayer: this.state.turn.current,
      timerDisplaySeconds: Math.ceil(this.turnTimerSeconds),
      selectedCardId: this.selectedCardId,
      phase: this.state.phase,
    };
    return JSON.stringify(payload, null, 2);
  }

  public advanceForTesting(ms: number): void {
    this.advanceVirtualTime(ms);
  }
}
