import Phaser from 'phaser';
import { shouldExposeAutomationHooks } from '../automation';
import { evaluateAIMove } from '../game/ai';
import { CARD_BY_ID } from '../game/cards';
import { AI_DELAY_MS } from '../game/constants';
import { canAffordCard, cloneGameState, createInitialGameState, reduceGameState, summarizeForText } from '../game/engine';
import { SeededRng, seedFromNow } from '../game/rng';
import { loadMeta, updateMeta } from '../game/storage';
import type { Action, GameMetaV1, GameState, PlayerId, Resource } from '../game/types';
import {
  CASTLE_MAX_HEIGHT,
  CASTLE_MIN_HEIGHT,
  DRAG_START_THRESHOLD,
  ENEMY_CARD_REVEAL_MS,
  ENEMY_CARD_SELECTION_MS,
  NARROW_LAYOUT_WIDTH,
  RESOURCE_FLOATING_TEXT_DURATION_MULTIPLIER,
  SWIPE_THRESHOLD,
  WALL_LINE_WIDTH,
  WALL_MAX_HEIGHT,
  WALL_VISUAL_CAP,
} from './game/scene-types';
import type {
  CardVisual,
  EnemyHandRefs,
  EnemyHandVisual,
  GestureState,
  PanelSide,
  PlayerPanelRefs,
  Point,
  ResourceBlockRefs,
  TopPileRefs,
  TowerVisualRefs,
} from './game/scene-types';
import {
  FONT_FAMILY,
  RESOURCE_META,
  THEME,
  animDelay,
  animDuration,
  cardTitleHex,
  cardTypeColor,
  createButton,
  createIllustrationIcon,
  createResourceIcon,
  drawIllustrationIcon,
  drawResourceIcon,
  getCardIllustration,
  mixColor,
  paintCardFrame,
} from './game/visuals';
import { formatCardEffectLine } from './game/card-text';
import {
  animateCardPlay,
  animateCardToDiscard,
  animateDeckDraw,
  animateDiscardReshuffle,
  animateTowerDamage,
  animateTowerHeal,
  createMotionCard,
  spawnFloatingText,
} from './game/card-animations';
import type { AnimationContext } from './game/card-animations';

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

  private playerDeckPile!: TopPileRefs;
  private playerDiscardPile!: TopPileRefs;
  private aiDiscardPile!: TopPileRefs;
  private enemyHand!: EnemyHandRefs;
  private enemyHandVisuals: EnemyHandVisual[] = [];
  private topSummaryText!: Phaser.GameObjects.Text;
  private turnLabelText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private topInfoGlow!: Phaser.GameObjects.Rectangle;
  private turnIndicatorPlayer!: Phaser.GameObjects.Arc;
  private turnIndicatorAi!: Phaser.GameObjects.Arc;

  private handHintText!: Phaser.GameObjects.Text;
  private handSurface!: Phaser.GameObjects.Rectangle;
  private handLaneCenterX = 0;
  private handLaneWidth = 0;
  private bottomHudLayoutMode: 'card-only' | 'stacked-mobile' = 'card-only';
  private topStageMode: 'compact' | 'reveal' = 'compact';
  private topStageCardId: string | null = null;
  private topStageDock!: Phaser.GameObjects.Container;
  private hoverPreviewContainer!: Phaser.GameObjects.Container;
  private hoverPreviewBg!: Phaser.GameObjects.Rectangle;
  private hoverPreviewInset!: Phaser.GameObjects.Rectangle;
  private hoverPreviewText!: Phaser.GameObjects.Text;
  private hoverPreviewCardId: string | null = null;
  private dragGuideText!: Phaser.GameObjects.Text;
  private draggingCardId: string | null = null;

  private endOverlay!: Phaser.GameObjects.Container;
  private endOverlayText!: Phaser.GameObjects.Text;

  private cardVisuals: CardVisual[] = [];
  private gestureState = new Map<number, GestureState>();
  private lastHandRenderKey = '';
  private lastHandAffordabilityKey = '';
  private lastHandLayoutKey = '';
  private lastHandSelectionKey = '';
  private handAllowEntryAnimation = false;

  private selectedCardId: string | null = null;
  private selectedHandIndex: number | null = null;
  private aiCountdownMs: number | null = null;
  private aiSelectionCountdownMs: number | null = null;
  private aiRevealCountdownMs: number | null = null;
  private aiPendingAction: Action | null = null;
  private aiSelectedHandIndex: number | null = null;
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
    this.input.on('pointermove', this.onGlobalPointerMove, this);
    this.input.on('pointerup', this.onGlobalPointerUp, this);

    this.attachAutomationHooks();

    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize, this);
      this.input.off('pointermove', this.onGlobalPointerMove, this);
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
    this.enemyHandVisuals = [];
    this.enemyCardRevealContainer = null;
    this.topStageMode = 'compact';
    this.topStageCardId = null;
    this.hoverPreviewCardId = null;
    this.draggingCardId = null;
    this.lastHandRenderKey = '';
    this.lastHandAffordabilityKey = '';
    this.lastHandLayoutKey = '';
    this.lastHandSelectionKey = '';
    this.handAllowEntryAnimation = false;

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
        this.hideCardHoverPreview();
        this.hideDragGuide();
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
    const panelWidth = narrow ? Math.max(314, width - 18) : Math.max(760, Math.min(1040, width * 0.78));
    const panelHeight = narrow ? 84 : 102;
    const centerX = width / 2;
    const topY = Math.max(8, Math.round(height * 0.018));
    const panelCenterY = topY + panelHeight / 2;
    const pileWidth = narrow ? 58 : 76;
    const pileHeight = narrow ? 68 : 86;
    const deckX = centerX - panelWidth / 2 + (narrow ? 38 : 54);
    const playerDiscardX = deckX + pileWidth + (narrow ? 16 : 20);
    const enemyHandWidth = narrow ? 138 : 198;
    const enemyHandHeight = narrow ? 54 : 66;
    const enemyHandX = centerX + panelWidth / 2 - enemyHandWidth / 2 - (narrow ? 16 : 22);
    const aiDiscardX = enemyHandX - enemyHandWidth / 2 - pileWidth / 2 - (narrow ? 16 : 20);
    const summaryWidth = Math.max(190, aiDiscardX - playerDiscardX - pileWidth);

    this.topInfoGlow = this.add
      .rectangle(centerX, panelCenterY, panelWidth + 8, panelHeight + 8, 0x000000, 0)
      .setStrokeStyle(3, 0x85b5eb, 0.82);

    const panel = this.add
      .rectangle(centerX, panelCenterY, panelWidth, panelHeight, THEME.night, 0.88)
      .setStrokeStyle(2, THEME.gold, 0.82);
    this.topCenterContainer.add([this.topInfoGlow, panel]);

    this.playerDeckPile = this.createTopPile(deckX, panelCenterY + (narrow ? 1 : 2), pileWidth, pileHeight);
    this.playerDiscardPile = this.createTopPile(playerDiscardX, panelCenterY + (narrow ? 1 : 2), pileWidth, pileHeight);
    this.aiDiscardPile = this.createTopPile(aiDiscardX, panelCenterY + (narrow ? 1 : 2), pileWidth, pileHeight);
    this.enemyHand = this.createEnemyHandRail(enemyHandX, panelCenterY + (narrow ? 1 : 2), enemyHandWidth, enemyHandHeight);

    this.topSummaryText = this.add
      .text(centerX, panelCenterY - (narrow ? 8 : 12), 'Goal 100 | Red C30 / W10', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '9px' : '15px',
        color: '#dce8f7',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: summaryWidth },
      })
      .setOrigin(0.5);

    const indicatorY = panelCenterY + (narrow ? 26 : 28);
    const indicatorRadius = narrow ? 6 : 8;
    const indicatorStartX = centerX - (narrow ? 12 : 14);
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
      .text(centerX, panelCenterY - (narrow ? 28 : 33), 'Your turn', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '15px' : '25px',
        color: '#fff1d2',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(centerX, panelCenterY + (narrow ? 9 : 12), '', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '8px' : '12px',
        color: '#d9e2ef',
        align: 'center',
        wordWrap: { width: Math.max(176, summaryWidth) },
      })
      .setOrigin(0.5);

    this.topCenterContainer.add([this.topSummaryText, this.turnIndicatorPlayer, turnIndicatorPlayerText, this.turnIndicatorAi, turnIndicatorAiText, this.turnLabelText, this.statusText]);
  }

  private createTopPile(x: number, y: number, width: number, height: number): TopPileRefs {
    const shadowA = this.add.rectangle(-6, -4, width, height, 0x07101c, 0.24).setStrokeStyle(2, 0xd7dff3, 0.08);
    const shadowB = this.add.rectangle(-3, -2, width, height, 0x0d1a29, 0.46).setStrokeStyle(2, 0xd7dff3, 0.12);
    const frame = this.add.graphics();
    const labelText = this.add
      .text(0, -height / 2 + 7, '', {
        fontFamily: FONT_FAMILY,
        fontSize: this.isNarrowLayout() ? '7px' : '9px',
        color: '#f2e7d4',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: width - 10 },
      })
      .setOrigin(0.5, 0);
    const titleText = this.add
      .text(0, -4, '', {
        fontFamily: FONT_FAMILY,
        fontSize: this.isNarrowLayout() ? '9px' : '12px',
        color: '#fff4e0',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: width - 12 },
      })
      .setOrigin(0.5);
    titleText.setLineSpacing(-2);
    const metaText = this.add
      .text(0, height / 2 - 14, '', {
        fontFamily: FONT_FAMILY,
        fontSize: this.isNarrowLayout() ? '7px' : '9px',
        color: '#e6dccd',
        align: 'center',
        wordWrap: { width: width - 12 },
      })
      .setOrigin(0.5);
    const countBg = this.add.circle(width / 2 - 10, -height / 2 + 10, this.isNarrowLayout() ? 8 : 10, 0x1f2a39, 0.96);
    countBg.setStrokeStyle(2, 0xf0e3c7, 0.84);
    const countText = this.add
      .text(countBg.x, countBg.y, '0', {
        fontFamily: FONT_FAMILY,
        fontSize: this.isNarrowLayout() ? '8px' : '10px',
        color: '#fff6e7',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const container = this.add.container(x, y, [shadowA, shadowB, frame, labelText, titleText, metaText, countBg, countText]);
    this.topCenterContainer.add(container);
    return {
      width,
      height,
      container,
      frame,
      stackBackA: shadowA,
      stackBackB: shadowB,
      labelText,
      titleText,
      metaText,
      countBg,
      countText,
    };
  }

  private createEnemyHandRail(x: number, y: number, width: number, height: number): EnemyHandRefs {
    const rail = this.add.rectangle(0, 0, width, height, 0x101a29, 0.9).setStrokeStyle(2, 0xd6c5b0, 0.46);
    const labelText = this.add
      .text(-width / 2 + 10, -height / 2 + 6, 'Red hidden hand', {
        fontFamily: FONT_FAMILY,
        fontSize: this.isNarrowLayout() ? '7px' : '9px',
        color: '#f2e7d4',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
    const countBg = this.add.circle(width / 2 - 12, -height / 2 + 12, this.isNarrowLayout() ? 8 : 10, 0x8b4f3e, 0.95);
    countBg.setStrokeStyle(2, 0xf6d7c5, 0.86);
    const countText = this.add
      .text(countBg.x, countBg.y, '0', {
        fontFamily: FONT_FAMILY,
        fontSize: this.isNarrowLayout() ? '8px' : '10px',
        color: '#fff4e4',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const cardsContainer = this.add.container(0, this.isNarrowLayout() ? 6 : 7);
    const overflowBg = this.add.circle(width / 2 - 16, height / 2 - 12, this.isNarrowLayout() ? 8 : 10, 0x253546, 0.92);
    overflowBg.setVisible(false);
    const overflowText = this.add
      .text(overflowBg.x, overflowBg.y, '', {
        fontFamily: FONT_FAMILY,
        fontSize: this.isNarrowLayout() ? '7px' : '9px',
        color: '#f6ecdd',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setVisible(false);

    const container = this.add.container(x, y, [rail, labelText, cardsContainer, countBg, countText, overflowBg, overflowText]);
    this.topCenterContainer.add(container);
    return {
      width,
      height,
      container,
      rail,
      labelText,
      countBg,
      countText,
      cardsContainer,
      overflowBg,
      overflowText,
    };
  }

  private updateTopPileViews(): void {
    this.updatePileView(this.playerDeckPile, {
      kind: 'deck',
      owner: 'player',
      label: 'Black deck',
      count: this.state.players.player.deck.length,
    });
    this.updatePileView(this.playerDiscardPile, {
      kind: 'discard',
      owner: 'player',
      label: 'Black discard',
      count: this.state.players.player.discard.length,
      topCardId: this.state.players.player.discard.at(-1) ?? null,
    });
    this.updatePileView(this.aiDiscardPile, {
      kind: 'discard',
      owner: 'ai',
      label: 'Red discard',
      count: this.state.players.ai.discard.length,
      topCardId: this.state.players.ai.discard.at(-1) ?? null,
    });
  }

  private updatePileView(
    pile: TopPileRefs,
    options: { kind: 'deck' | 'discard'; owner: PlayerId; label: string; count: number; topCardId?: string | null },
  ): void {
    const narrow = this.isNarrowLayout();
    const radius = narrow ? 6 : 8;
    const { width, height } = pile;
    const card = options.topCardId ? CARD_BY_ID[options.topCardId] : null;
    const ownerColor = options.owner === 'player' ? THEME.playerBlack : THEME.enemyRed;

    pile.labelText.setText(options.label);
    pile.countText.setText(String(options.count));
    pile.countBg.setFillStyle(options.kind === 'deck' ? 0x253546 : ownerColor, 0.96);
    pile.countBg.setStrokeStyle(2, options.kind === 'deck' ? 0xf0e3c7 : 0xf6d7c5, 0.84);

    pile.frame.clear();
    pile.stackBackA.setVisible(options.count > 0);
    pile.stackBackB.setVisible(options.count > 0);

    if (options.kind === 'deck') {
      pile.stackBackA.setFillStyle(0x1b2b43, options.count > 1 ? 0.54 : 0.18);
      pile.stackBackB.setFillStyle(0x20324c, options.count > 0 ? 0.72 : 0.24);

      pile.frame.fillStyle(0x283651, 0.98);
      pile.frame.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
      pile.frame.lineStyle(2, 0xd7dff3, 0.84);
      pile.frame.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
      pile.frame.fillStyle(0x6f86bc, 0.94);
      pile.frame.fillRoundedRect(-width * 0.28, -height * 0.18, width * 0.56, 5, 2);
      pile.frame.fillRoundedRect(-width * 0.26, 2, width * 0.52, 5, 2);
      pile.frame.fillRoundedRect(-width * 0.24, height * 0.18, width * 0.48, 5, 2);
      pile.titleText.setText(options.count > 0 ? 'Draw pile' : 'Deck empty');
      pile.titleText.setColor('#f2f5fb');
      pile.metaText.setText(options.count > 0 ? 'Reshuffles from discard' : 'Waiting for reshuffle');
      pile.metaText.setColor('#d9e2ef');
      return;
    }

    pile.stackBackA.setFillStyle(card ? ownerColor : 0x182334, card ? 0.22 : 0.12);
    pile.stackBackB.setFillStyle(card ? ownerColor : 0x182334, card ? 0.34 : 0.18);

    if (!card) {
      pile.frame.fillStyle(0x121c2b, 0.9);
      pile.frame.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
      pile.frame.lineStyle(2, 0xd0c0ad, 0.54);
      pile.frame.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
      pile.titleText.setText('Empty');
      pile.titleText.setColor('#e4d8c9');
      pile.metaText.setText('Top card hidden until used');
      pile.metaText.setColor('#c7bcae');
      return;
    }

    const fill = mixColor(cardTypeColor(card.domain), THEME.parchment, 0.42);
    pile.frame.fillStyle(fill, 0.98);
    pile.frame.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    pile.frame.lineStyle(2, cardTypeColor(card.domain), 0.94);
    pile.frame.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
    pile.frame.fillStyle(ownerColor, 0.12);
    pile.frame.fillRoundedRect(-width / 2 + 5, -height / 2 + 18, width - 10, 1, 1);
    pile.titleText.setText(card.name);
    pile.titleText.setColor('#241d19');
    pile.metaText.setText(`${RESOURCE_META[card.domain].resourceName} ${card.cost}`);
    pile.metaText.setColor('#3d352f');
  }

  private rebuildEnemyHand(): void {
    this.enemyHandVisuals.forEach((entry) => entry.container.destroy(true));
    this.enemyHandVisuals = [];

    const hand = this.state.players.ai.hand;
    const narrow = this.isNarrowLayout();
    const visibleSlots = narrow ? 4 : 6;
    const shownCount = Math.min(hand.length, visibleSlots);
    const hiddenCount = Math.max(0, hand.length - shownCount);
    const cardWidth = narrow ? 26 : 34;
    const cardHeight = narrow ? 34 : 46;
    const gap = narrow ? 14 : 18;
    const start = this.getEnemyHandWindowStart(hand.length, shownCount);
    const rowWidth = shownCount > 0 ? cardWidth + (shownCount - 1) * gap : 0;
    const startX = -rowWidth / 2 + cardWidth / 2;

    this.enemyHand.labelText.setText('Red hidden hand');
    this.enemyHand.countText.setText(String(hand.length));
    this.enemyHand.overflowBg.setVisible(hiddenCount > 0);
    this.enemyHand.overflowText.setVisible(hiddenCount > 0);
    this.enemyHand.overflowText.setText(hiddenCount > 0 ? `+${hiddenCount}` : '');

    for (let slot = 0; slot < shownCount; slot += 1) {
      const handIndex = start + slot;
      const selected = handIndex === this.aiSelectedHandIndex;
      const x = startX + slot * gap;
      const baseY = 0;
      const container = this.add.container(x, selected ? baseY - 7 : baseY);
      container.setScale(selected ? 1.08 : 1);

      const shadow = this.add.rectangle(3, 4, cardWidth, cardHeight, 0x04080f, 0.3);
      const body = this.add.rectangle(0, 0, cardWidth, cardHeight, 0x22324a, 0.98).setStrokeStyle(selected ? 3 : 2, selected ? THEME.gold : 0xaeb7c8, selected ? 0.94 : 0.72);
      const topBand = this.add.rectangle(0, -cardHeight / 2 + 7, cardWidth - 8, 5, 0x6f86bc, 0.95);
      const midBand = this.add.rectangle(0, 0, cardWidth - 10, 4, 0xd7dff3, 0.24);
      const mark = this.add.text(0, 0, '?', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '14px' : '18px',
        color: selected ? '#fff3de' : '#dbe4f3',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      container.add([shadow, body, topBand, midBand, mark]);
      this.enemyHand.cardsContainer.add(container);
      this.enemyHandVisuals.push({ handIndex, container, baseY });
    }
  }

  private getEnemyHandWindowStart(handLength: number, shownCount: number): number {
    if (handLength <= shownCount || this.aiSelectedHandIndex === null) {
      return 0;
    }
    return Math.max(0, Math.min(this.aiSelectedHandIndex - shownCount + 1, handLength - shownCount));
  }

  private createSidePanels(width: number, height: number): void {
    const compact = this.isNarrowLayout(width);
    const sideMargin = compact ? 8 : Math.max(12, Math.floor(width * 0.014));
    const panelWidth = compact ? Math.max(124, Math.min(158, (width - sideMargin * 3) / 2)) : Math.max(184, Math.min(252, (width - sideMargin * 3) / 2));
    const reservedHandHeight = compact ? Math.max(176, Math.min(224, height * 0.29)) : 0;
    const panelTop = compact ? Math.max(108, height * 0.14) : Math.max(98, height * 0.12);
    const compactAvailableHeight = height - panelTop - reservedHandHeight - 18;
    const panelHeight = compact
      ? Math.max(236, Math.min(276, compactAvailableHeight))
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
    const headerY = config.compact ? 22 : 30;
    const headerHeight = config.compact ? 34 : 48;
    const resourceTopStart = config.compact ? 46 : 74;
    const resourceGap = config.compact ? 48 : 82;

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
        fontSize: config.compact ? '14px' : '24px',
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
        resource,
        label: RESOURCE_META[resource].label,
        resourceName: RESOURCE_META[resource].resourceName,
        color: RESOURCE_META[resource].color,
        compact: config.compact,
      });
      resourceBlocks[resource] = block;
      container.add(block.root);
    });

    const towerTop = config.height - (config.compact ? 68 : 112);
    const towerBlockHeight = config.compact ? 60 : 94;
    const towerBlock = this.add
      .rectangle(config.width / 2, towerTop + towerBlockHeight / 2, config.width - 24, towerBlockHeight, 0xe9e3d4, 0.95)
      .setStrokeStyle(2, 0xb8ac92);

    const towerLabelX = isRight ? config.width - 24 : 24;
    const towerLabel = this.add
      .text(towerLabelX, towerTop + (config.compact ? 8 : 12), 'Castle', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '11px' : '18px',
        color: '#243446',
        fontStyle: 'bold',
      })
      .setOrigin(isRight ? 1 : 0, 0);

    const wallLabel = this.add
      .text(towerLabelX, towerTop + (config.compact ? 38 : 58), 'Wall', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '11px' : '18px',
        color: '#243446',
        fontStyle: 'bold',
      })
      .setOrigin(isRight ? 1 : 0, 0);

    const valueOffset = config.compact ? 38 : 88;
    const towerValue = this.add
      .text(isRight ? valueOffset : config.width - valueOffset, towerTop + (config.compact ? 4 : 8), '30', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '20px' : '34px',
        color: '#22374e',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    const wallValue = this.add
      .text(isRight ? valueOffset : config.width - valueOffset, towerTop + (config.compact ? 34 : 54), '10', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '20px' : '34px',
        color: '#22374e',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    container.add([towerBlock, towerLabel, wallLabel, towerValue, wallValue]);

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
    resource: Resource;
    label: string;
    resourceName: string;
    color: number;
    compact: boolean;
  }): ResourceBlockRefs {
    const root = this.add.container(0, 0);

    const width = config.panelWidth - 24;
    const left = 12;
    const blockHeight = config.compact ? 44 : 72;
    const bg = this.add
      .rectangle(left + width / 2, config.top + blockHeight / 2, width, blockHeight, config.color, 0.9)
      .setStrokeStyle(2, 0xe5d9c1);

    const iconX = left + (config.compact ? 22 : 30);
    const iconY = config.top + (config.compact ? 15 : 24);
    const iconGraphic = createResourceIcon(this, config.resource, iconX, iconY, (config.compact ? 9 : 14) * 2, false, 0xf6f1e4);

    const labelX = left + (config.compact ? 42 : 60);
    const generatorValueX = left + width - (config.compact ? 16 : 28);
    const labelWrapWidth = Math.max(42, generatorValueX - labelX - (config.compact ? 14 : 24));

    const labelText = this.add
      .text(labelX, config.top + (config.compact ? 5 : 8), config.label, {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '10px' : '16px',
        color: '#f5f2ea',
        fontStyle: 'bold',
        wordWrap: { width: labelWrapWidth },
      })
      .setOrigin(0, 0);

    const resourceNameText = this.add
      .text(labelX, config.top + (config.compact ? 20 : 30), config.resourceName, {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '8px' : '14px',
        color: '#f1e8d8',
        wordWrap: { width: labelWrapWidth },
      })
      .setOrigin(0, 0);

    const generatorValue = this.add
      .text(generatorValueX, config.top + (config.compact ? 2 : 5), '2', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '15px' : '23px',
        color: '#f9f5eb',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    const resourceValue = this.add
      .text(generatorValueX, config.top + (config.compact ? 21 : 34), '5', {
        fontFamily: FONT_FAMILY,
        fontSize: config.compact ? '18px' : '28px',
        color: '#f7f2e6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    root.add([bg, iconGraphic, labelText, resourceNameText, generatorValue, resourceValue]);

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

    this.playerTowerVisual = this.createTowerVisual(width / 2 - spacing, centerY, 0x5e7ea9, 'left', towerScale);
    this.aiTowerVisual = this.createTowerVisual(width / 2 + spacing, centerY, 0x9f615a, 'right', towerScale);

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

  private createTowerVisual(
    x: number,
    y: number,
    baseColor: number,
    side: 'left' | 'right',
    scale = 1,
  ): TowerVisualRefs {
    const container = this.add.container(x, y).setScale(scale);
    const baseBodyHeight = 242;

    const wallLine = this.add
      .rectangle(side === 'left' ? 84 : -84, 0, WALL_LINE_WIDTH, 24, 0xf2b08f, 0.95)
      .setOrigin(0.5, 1)
      .setStrokeStyle(1, 0xffd5b8, 0.92);
    const body = this.add
      .rectangle(0, 0, 132, baseBodyHeight, baseColor, 0.95)
      .setStrokeStyle(3, 0xe0d5c2)
      .setOrigin(0.5, 1);

    const roof = this.add.triangle(0, -baseBodyHeight, 0, 0, 66, 34, -66, 34, 0x7b4b43, 0.95).setStrokeStyle(2, 0xd9c8b5);

    container.add([body, roof, wallLine]);
    this.towerContainer.add(container);

    return {
      container,
      body,
      roof,
      wallLine,
      baseBodyHeight,
      bodyTargetHeight: baseBodyHeight,
      wallTargetHeight: 24,
    };
  }

  private createHandArea(width: number, height: number): void {
    this.handContainer = this.add.container(0, 0).setDepth(30);

    const narrow = this.isNarrowLayout(width);
    const panelHeight = narrow ? Math.max(192, Math.min(228, height * 0.29)) : Math.max(212, Math.min(246, height * 0.28));
    const panelTop = height - panelHeight - 10;
    const hintBottomInset = narrow ? 12 : 14;
    const hintReserve = narrow ? 40 : 28;
    const laneTopInset = narrow ? 16 : 18;
    const laneBottomInset = hintReserve + (narrow ? 8 : 6);

    this.handSurface = this.add
      .rectangle(width / 2, panelTop + panelHeight / 2, width - 20, panelHeight, 0x211a14, 0.93)
      .setStrokeStyle(2, THEME.gold, 0.65);

    this.handHintText = this.add
      .text(width / 2, panelTop + panelHeight - hintBottomInset, narrow ? 'Drag to center to play\nDrag down to discard' : 'Click to play | Drag to center to play | Drag down to discard', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '9px' : '11px',
        color: '#b9c6db',
        align: 'center',
      })
      .setOrigin(0.5, 1);

    this.bottomHudLayoutMode = narrow ? 'stacked-mobile' : 'card-only';
    this.handLaneCenterX = width / 2;
    this.handLaneWidth = Math.max(220, width - (narrow ? 28 : 76));
    const handLaneTop = panelTop + laneTopInset;
    const handLaneBottom = panelTop + panelHeight - laneBottomInset;
    this.handCardsContainer = this.add.container(this.handLaneCenterX, Math.round((handLaneTop + handLaneBottom) / 2));

    this.handContainer.add([this.handSurface, this.handHintText, this.handCardsContainer]);
  }

  private createOverlayLayer(): void {
    this.overlayContainer = this.add.container(0, 0).setDepth(40);
    this.topStageDock = this.createTopStageDock();
    this.topStageDock.setVisible(false);
    this.hoverPreviewContainer = this.createHoverPreview();
    this.dragGuideText = this.createDragGuideText();
    this.overlayContainer.add([this.topStageDock, this.hoverPreviewContainer, this.dragGuideText]);
  }

  private createTopStageDock(): Phaser.GameObjects.Container {
    const narrow = this.isNarrowLayout();
    const width = narrow ? 172 : 248;
    const height = narrow ? 34 : 40;
    const glow = this.add.ellipse(0, -6, width * 0.78, height * 0.58, 0x92b7ff, 0.12);
    const baseShadow = this.add.ellipse(0, 11, width * 0.74, height * 0.74, 0x08121d, 0.34);
    const base = this.add.rectangle(0, 0, width, height, 0x121a27, 0.92).setStrokeStyle(2, THEME.gold, 0.44);
    const inset = this.add.rectangle(0, -2, width - 14, height - 10, 0x1b2738, 0.42).setStrokeStyle(1, 0xe9dcc0, 0.08);
    const label = this.add
      .text(0, 0, 'Reveal stage', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '10px' : '12px',
        color: '#fff0d1',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const container = this.add.container(this.scale.width / 2, narrow ? 140 : 154, [glow, baseShadow, base, inset, label]);
    container.setAlpha(0);
    return container;
  }

  private createHoverPreview(): Phaser.GameObjects.Container {
    this.hoverPreviewBg = this.add.rectangle(0, 0, 164, 70, 0x14100c, 0.94).setStrokeStyle(2, 0xb9996d, 0.58);
    this.hoverPreviewInset = this.add.rectangle(0, 0, 156, 62, 0x241b14, 0.5).setStrokeStyle(1, 0xe8d8bb, 0.1);
    this.hoverPreviewText = this.add
      .text(-68, -23, '', {
        fontFamily: FONT_FAMILY,
        fontSize: this.isNarrowLayout() ? '10px' : '13px',
        color: '#f6ead7',
        lineSpacing: this.isNarrowLayout() ? 1 : 3,
        wordWrap: { width: this.isNarrowLayout() ? 132 : 154 },
      })
      .setOrigin(0, 0);

    const container = this.add.container(0, 0, [this.hoverPreviewBg, this.hoverPreviewInset, this.hoverPreviewText]);
    container.setDepth(45);
    container.setVisible(false);
    container.setAlpha(0);
    return container;
  }

  private createDragGuideText(): Phaser.GameObjects.Text {
    const guide = this.add
      .text(this.scale.width / 2, this.scale.height * 0.54, '', {
        fontFamily: FONT_FAMILY,
        fontSize: this.isNarrowLayout() ? '12px' : '15px',
        color: '#ffe9c8',
        fontStyle: 'bold',
        align: 'center',
        backgroundColor: 'rgba(15, 23, 37, 0.72)',
        padding: { left: 12, right: 12, top: 6, bottom: 6 },
      })
      .setOrigin(0.5);
    guide.setVisible(false);
    guide.setDepth(44);
    return guide;
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
    this.resultPersisted = false;

    this.clearSelectedCard();
    this.aiCountdownMs = null;
    this.aiSelectionCountdownMs = null;
    this.aiRevealCountdownMs = null;
    this.aiPendingAction = null;
    this.aiSelectedHandIndex = null;
    this.topStageMode = 'compact';
    this.topStageCardId = null;
    this.lastHandRenderKey = '';
    this.lastHandAffordabilityKey = '';
    this.lastHandLayoutKey = '';
    this.lastHandSelectionKey = '';
    this.handAllowEntryAnimation = true;
    this.clearEnemyCardReveal();
    this.gestureState.clear();

    this.endOverlay.setVisible(false);
    this.updateHud();
  }

  private dispatch(action: Action): boolean {
    const previous = cloneGameState(this.state);
    const actionCardOrigin =
      action.type === 'play_card' || action.type === 'discard_card' ? this.getActionCardOrigin(action) : null;

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
    this.emitFeedback(previous, this.state, action, actionCardOrigin);

    if (this.state.phase === 'ended') {
      this.handleMatchEnd();
    }

    return true;
  }

  private emitFeedback(previous: GameState, next: GameState, action: Action, actionCardOrigin: Point | null): void {
    const playerIds: PlayerId[] = ['player', 'ai'];

    for (const playerId of playerIds) {
      const before = previous.players[playerId];
      const after = next.players[playerId];

      const ctx = this.animCtx();
      const towerDelta = after.tower - before.tower;
      if (towerDelta < 0) {
        spawnFloatingText(ctx, this.getTowerAnchor(playerId), `Castle ${towerDelta}`, '#ff8f8f');
        animateTowerDamage(ctx, playerId === 'player' ? this.playerTowerVisual : this.aiTowerVisual);
      } else if (towerDelta > 0) {
        spawnFloatingText(ctx, this.getTowerAnchor(playerId), `Castle +${towerDelta}`, '#8ff0b5');
        animateTowerHeal(ctx, playerId === 'player' ? this.playerTowerVisual : this.aiTowerVisual);
      }

      const wallDelta = after.wall - before.wall;
      if (wallDelta !== 0) {
        spawnFloatingText(ctx, this.getWallAnchor(playerId), `Wall ${wallDelta > 0 ? '+' : ''}${wallDelta}`, wallDelta > 0 ? '#afe3ff' : '#ffb6b6');
      }

      const resources: Resource[] = ['bricks', 'weapons', 'crystals'];
      for (const resource of resources) {
        const delta = after[resource] - before[resource];
        if (delta !== 0) {
          const text = `${delta > 0 ? '+' : ''}${delta} ${RESOURCE_META[resource].resourceName}`;
          spawnFloatingText(ctx, this.getPanelAnchor(playerId, resources.indexOf(resource) + 1), text, delta > 0 ? '#9bf2b8' : '#ffc0c0', {
            durationMultiplier: RESOURCE_FLOATING_TEXT_DURATION_MULTIPLIER,
          });
        }

        const generatorKey = RESOURCE_META[resource].generatorKey;
        const generatorDelta = after[generatorKey] - before[generatorKey];
        if (generatorDelta !== 0) {
          const text = `${generatorDelta > 0 ? '+' : ''}${generatorDelta} ${RESOURCE_META[resource].label}`;
          spawnFloatingText(ctx, this.getPanelAnchor(playerId, resources.indexOf(resource) + 1), text, '#fff2b0', {
            durationMultiplier: RESOURCE_FLOATING_TEXT_DURATION_MULTIPLIER,
          });
        }
      }

      const handDelta = after.hand.length - before.hand.length;
      const deckDelta = after.deck.length - before.deck.length;
      if (handDelta > 0 || deckDelta < 0) {
        animateDeckDraw(ctx, playerId === 'player' ? this.playerDeckPile.container : this.enemyHand.container);
      }

      if (before.deck.length === 0 && before.discard.length > 0 && after.discard.length < before.discard.length) {
        animateDiscardReshuffle(ctx, this.getDiscardAnchor(playerId), this.getDeckAnchor(playerId));
      }
    }

    if (action.type === 'play_card') {
      const ctx = this.animCtx();
      const origin = actionCardOrigin ?? this.getActionOrigin(action);
      const target = this.getActionTarget(action, previous, next);
      const discardTarget = this.getDiscardAnchor(action.playerId);
      animateCardPlay(ctx, action.cardId, origin, target, () => {
        animateCardToDiscard(ctx, action.cardId, target, discardTarget, {
          owner: action.playerId,
          facedown: false,
        });
      });
      return;
    }

    if (action.type === 'discard_card' && actionCardOrigin) {
      animateCardToDiscard(this.animCtx(), action.cardId, actionCardOrigin, this.getDiscardAnchor(action.playerId), {
        owner: action.playerId,
        facedown: action.playerId === 'ai',
      });
    }
  }

  private animCtx(): AnimationContext {
    return {
      scene: this,
      overlay: this.overlayContainer,
      animationsEnabled: this.animationsEnabled,
      isNarrow: this.isNarrowLayout(),
    };
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
    tower.container.getWorldTransformMatrix().transformPoint(0, -tower.bodyTargetHeight - 24, world);
    return { x: world.x, y: world.y };
  }

  private getWallAnchor(playerId: PlayerId): Point {
    const tower = playerId === 'player' ? this.playerTowerVisual : this.aiTowerVisual;
    const wallHeight = Math.max(tower.wallTargetHeight, 18);
    const world = new Phaser.Math.Vector2();
    tower.container.getWorldTransformMatrix().transformPoint(tower.wallLine.x, -wallHeight - 12, world);
    return { x: world.x, y: world.y };
  }

  private getActionCardOrigin(action: Extract<Action, { type: 'play_card' | 'discard_card' }>): Point | null {
    if (action.playerId === 'player') {
      return this.getCardWorldPosition(action.cardId, action.handIndex);
    }
    if (action.type === 'play_card' && this.enemyCardRevealContainer) {
      return this.getContainerWorldPosition(this.enemyCardRevealContainer);
    }
    if (this.aiSelectedHandIndex !== null) {
      return this.getEnemyHandWorldPosition(this.aiSelectedHandIndex);
    }
    return null;
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

  private getDiscardAnchor(playerId: PlayerId): Point {
    const pile = playerId === 'player' ? this.playerDiscardPile : this.aiDiscardPile;
    return this.getContainerWorldPosition(pile.container);
  }

  private getDeckAnchor(playerId: PlayerId): Point {
    if (playerId === 'player') {
      return this.getContainerWorldPosition(this.playerDeckPile.container);
    }
    return {
      x: this.enemyHand.container.x - this.enemyHand.width / 2 + (this.isNarrowLayout() ? 24 : 30),
      y: this.enemyHand.container.y + (this.isNarrowLayout() ? 2 : 4),
    };
  }

  private getEnemyHandWorldPosition(handIndex: number): Point | null {
    const visual = this.enemyHandVisuals.find((entry) => entry.handIndex === handIndex);
    if (!visual) {
      return null;
    }
    return this.getContainerWorldPosition(visual.container);
  }

  private getContainerWorldPosition(container: Phaser.GameObjects.Container): Point {
    const world = new Phaser.Math.Vector2();
    container.getWorldTransformMatrix().transformPoint(0, 0, world);
    return { x: world.x, y: world.y };
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

  private getTopStageCardPosition(): Point {
    return {
      x: this.scale.width / 2,
      y: this.isNarrowLayout() ? 198 : 206,
    };
  }

  private setTopStageDockVisible(visible: boolean): void {
    if (!this.topStageDock) {
      return;
    }

    this.tweens.killTweensOf(this.topStageDock);
    if (!visible) {
      this.topStageDock.setVisible(true);
      if (this.animationsEnabled) {
        this.tweens.add({
          targets: this.topStageDock,
          alpha: 0,
          scaleX: 0.96,
          scaleY: 0.96,
          duration: animDuration(140),
          ease: 'Sine.In',
          onComplete: () => this.topStageDock.setVisible(false),
        });
      } else {
        this.topStageDock.setAlpha(0);
        this.topStageDock.setVisible(false);
      }
      return;
    }

    this.topStageDock.setVisible(true);
    this.topStageDock.setScale(this.animationsEnabled ? 0.94 : 1);
    this.topStageDock.setAlpha(this.animationsEnabled ? 0 : 1);
    if (this.animationsEnabled) {
      this.tweens.add({
        targets: this.topStageDock,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        duration: animDuration(180),
        ease: 'Back.Out',
      });
    } else {
      this.topStageDock.setAlpha(1);
    }
  }

  private showEnemyCardReveal(cardId: string): void {
    const card = CARD_BY_ID[cardId];
    if (!card) {
      return;
    }

    this.clearEnemyCardReveal();
    this.topStageMode = 'reveal';
    this.topStageCardId = cardId;
    this.setTopStageDockVisible(true);

    const narrow = this.isNarrowLayout();
    const width = narrow ? Math.min(184, this.scale.width - 56) : 224;
    const height = narrow ? 246 : 296;
    const stagePos = this.getTopStageCardPosition();
    const x = stagePos.x;
    const y = stagePos.y;
    const frame = this.add.graphics();
    paintCardFrame(frame, width, height, card.domain, true, false);
    const label = this.add
      .text(0, -height / 2 - 24, 'Red reveals', {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '13px' : '15px',
        color: '#ffe9c8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const iconSize = narrow ? 18 : 22;
    const resourceIcon = createResourceIcon(
      this,
      card.domain,
      -width / 2 + 16,
      -height / 2 + 18,
      iconSize,
      false,
    );
    const costShadow = this.add
      .text(width / 2 - 16, -height / 2 + 8, String(card.cost), {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '22px' : '28px',
        color: '#fffdf7',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0);
    const cost = this.add
      .text(width / 2 - 18, -height / 2 + 6, String(card.cost), {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '22px' : '28px',
        color: '#12100e',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0);
    const title = this.add
      .text(0, -height / 2 + 28, card.name, {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '19px' : '24px',
        color: cardTitleHex(card.domain, true),
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: width - 34 },
      })
      .setOrigin(0.5, 0);
    title.setLineSpacing(-2);
    const illustration = createIllustrationIcon(
      this,
      getCardIllustration(card),
      0,
      narrow ? 18 : 26,
      narrow ? 54 : 68,
      cardTypeColor(card.domain),
      false,
    );
    const text = this.add
      .text(0, height / 2 - (narrow ? 58 : 70), formatCardEffectLine(card), {
        fontFamily: FONT_FAMILY,
        fontSize: narrow ? '14px' : '16px',
        color: '#24201c',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: width - 40 },
      })
      .setOrigin(0.5);

    const reveal = this.add.container(x, y, [label, frame, resourceIcon, costShadow, cost, title, illustration, text]);
    reveal.setDepth(55);
    reveal.setAlpha(this.animationsEnabled ? 0 : 1);
    reveal.setScale(1);
    this.overlayContainer.add(reveal);
    this.enemyCardRevealContainer = reveal;

    const origin = this.aiSelectedHandIndex !== null ? this.getEnemyHandWorldPosition(this.aiSelectedHandIndex) : null;
    if (this.animationsEnabled && origin) {
      const travel = createMotionCard(this.animCtx(), cardId, origin, { facedown: true, compact: true });
      travel.setScale(0.74);
      this.overlayContainer.add(travel);

      this.tweens.add({
        targets: travel,
        x,
        y,
        scaleX: 0.3,
        duration: animDuration(220),
        ease: 'Sine.InOut',
        onComplete: () => travel.destroy(true),
      });
      this.tweens.add({
        targets: reveal,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        delay: animDelay(190),
        duration: animDuration(180),
        ease: 'Back.Out',
      });
      return;
    }

    if (this.animationsEnabled) {
      reveal.setScale(0.88);
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
    this.topStageMode = 'compact';
    this.topStageCardId = null;
    this.tweens.killTweensOf(reveal);
    this.setTopStageDockVisible(false);

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
      this.aiSelectionCountdownMs = null;
    }

    this.updateHud();
  }

  private tickAi(delta: number): void {
    if (this.aiRevealCountdownMs !== null) {
      this.aiRevealCountdownMs -= delta;
      if (this.aiRevealCountdownMs > 0) {
        return;
      }

      this.aiRevealCountdownMs = null;
      if (this.aiPendingAction?.type === 'play_card' && this.state.phase === 'playing') {
        this.resolveAiAction(this.aiPendingAction);
      }
      return;
    }

    if (this.aiSelectionCountdownMs !== null) {
      this.aiSelectionCountdownMs -= delta;
      if (this.aiSelectionCountdownMs > 0) {
        return;
      }

      this.aiSelectionCountdownMs = null;

      if (!this.aiPendingAction || this.state.phase !== 'playing') {
        return;
      }

      if (this.aiPendingAction.type === 'play_card') {
        this.showEnemyCardReveal(this.aiPendingAction.cardId);
        this.aiRevealCountdownMs = ENEMY_CARD_REVEAL_MS;
        this.updateHud();
        return;
      }

      this.resolveAiAction(this.aiPendingAction);
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

    this.aiPendingAction = action;
    this.aiSelectedHandIndex = this.resolveAiHandIndex(action.cardId);
    this.aiSelectionCountdownMs = ENEMY_CARD_SELECTION_MS;
    this.updateHud();
  }

  private resolveAiAction(action: Action): void {
    const ok = this.dispatch(action);
    if (!ok) {
      this.aiPendingAction = null;
      this.aiSelectedHandIndex = null;
      this.aiSelectionCountdownMs = null;
      this.aiRevealCountdownMs = null;
      this.clearEnemyCardReveal(true);
      this.updateHud();
      return;
    }

    this.aiPendingAction = null;
    this.aiSelectedHandIndex = null;
    this.aiSelectionCountdownMs = null;
    this.aiRevealCountdownMs = null;
    this.clearEnemyCardReveal(true);
    this.updateHud();

    if (this.dispatch({ type: 'end_turn' })) {
      this.progressLoop();
    }
  }

  private resolveAiHandIndex(cardId: string): number | null {
    const index = this.state.players.ai.hand.indexOf(cardId);
    return index === -1 ? null : index;
  }

  private canPlayerIssueAction(): boolean {
    return this.state.phase === 'playing' && this.state.turn.current === 'player' && this.state.turn.started && !this.state.turn.actionTaken;
  }

  private findCardVisual(handIndex: number, cardId: string): CardVisual | null {
    return this.cardVisuals.find((entry) => entry.handIndex === handIndex && entry.cardId === cardId) ?? null;
  }

  private showCardHoverPreview(cardId: string, anchor: Point): void {
    const card = CARD_BY_ID[cardId];
    if (!card) {
      this.hideCardHoverPreview();
      return;
    }

    const resourceName = RESOURCE_META[card.domain].resourceName;
    const owned = this.getPlayerResource(card.domain);
    const maxWidth = this.isNarrowLayout() ? 146 : 186;
    this.hoverPreviewText.setText(`${card.name}\n${resourceName} ${owned}/${card.cost}\n${formatCardEffectLine(card)}`);

    const width = Phaser.Math.Clamp(this.hoverPreviewText.width + 24, this.isNarrowLayout() ? 132 : 152, maxWidth);
    const height = this.hoverPreviewText.height + 18;
    this.hoverPreviewBg.setSize(width, height);
    this.hoverPreviewInset.setSize(width - 8, height - 8);
    this.hoverPreviewText.setPosition(-width / 2 + 12, -height / 2 + 8);

    const clampedX = Phaser.Math.Clamp(anchor.x, width / 2 + 10, this.scale.width - width / 2 - 10);
    const clampedY = Phaser.Math.Clamp(anchor.y, height / 2 + 10, this.scale.height - height / 2 - 10);
    this.hoverPreviewContainer.setPosition(clampedX, clampedY);
    this.hoverPreviewContainer.setVisible(true);
    this.hoverPreviewContainer.setAlpha(1);
    this.hoverPreviewCardId = cardId;
  }

  private hideCardHoverPreview(): void {
    this.hoverPreviewCardId = null;
    this.hoverPreviewContainer?.setVisible(false);
    this.hoverPreviewContainer?.setAlpha(0);
  }

  private showDragGuide(text: string, x: number, y: number): void {
    this.dragGuideText.setText(text);
    this.dragGuideText.setPosition(x, y);
    this.dragGuideText.setVisible(true);
    this.dragGuideText.setAlpha(1);
  }

  private hideDragGuide(): void {
    this.dragGuideText?.setVisible(false);
    this.dragGuideText?.setAlpha(0);
  }

  private isPointInPlayDropZone(x: number, y: number): boolean {
    const centerX = this.scale.width / 2;
    const topOfTray = this.handSurface.y - this.handSurface.height / 2;
    return Math.abs(x - centerX) < this.scale.width * 0.24 && y < topOfTray - 16 && y > 130;
  }

  private shouldDiscardFromDrag(pointer: Phaser.Input.Pointer, gesture: GestureState): boolean {
    const dx = pointer.x - gesture.x;
    const dy = pointer.y - gesture.y;
    return dy > SWIPE_THRESHOLD && dy > Math.abs(dx);
  }

  private restoreCardVisual(entry: CardVisual): void {
    this.tweens.killTweensOf(entry.container);
    const selected = entry.handIndex === this.selectedHandIndex && entry.affordable;
    entry.container.setAlpha(entry.targetAlpha);
    if (this.animationsEnabled) {
      this.tweens.add({
        targets: entry.container,
        x: entry.baseX,
        y: selected ? entry.baseY - 12 : entry.baseY,
        scaleX: selected ? 1.04 : 1,
        scaleY: selected ? 1.04 : 1,
        duration: animDuration(130),
        ease: 'Sine.Out',
      });
    } else {
      entry.container.setX(entry.baseX);
      entry.container.setY(selected ? entry.baseY - 12 : entry.baseY);
      entry.container.setScale(selected ? 1.04 : 1);
    }
  }

  private onCardPointerDown(cardId: string, handIndex: number, pointer: Phaser.Input.Pointer): void {
    const event = pointer.event as MouseEvent | PointerEvent | undefined;
    const isRightClick = pointer.button === 2 || pointer.rightButtonDown() || event?.button === 2;

    if (isRightClick) {
      this.tryDiscardCard(cardId, handIndex);
      return;
    }

    const world = this.getCardWorldPosition(cardId, handIndex);
    this.gestureState.set(pointer.id, {
      cardId,
      handIndex,
      x: pointer.x,
      y: pointer.y,
      isTouch: this.isTouchPointer(pointer),
      dragging: false,
      offsetX: world ? world.x - pointer.x : 0,
      offsetY: world ? world.y - pointer.y : 0,
    });
    this.selectCardAt(handIndex);
    if (world) {
      const entry = this.findCardVisual(handIndex, cardId);
      const previewY = world.y - (entry ? entry.height / 2 + 22 : 78);
      this.showCardHoverPreview(cardId, { x: world.x, y: previewY });
    }
  }

  private onGlobalPointerMove(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gestureState.get(pointer.id);
    if (!gesture) {
      return;
    }

    const entry = this.findCardVisual(gesture.handIndex, gesture.cardId);
    if (!entry) {
      return;
    }

    const dx = pointer.x - gesture.x;
    const dy = pointer.y - gesture.y;
    if (!gesture.dragging && Math.hypot(dx, dy) < DRAG_START_THRESHOLD) {
      return;
    }

    gesture.dragging = true;
    this.draggingCardId = gesture.cardId;
    this.handCardsContainer.bringToTop(entry.container);
    this.tweens.killTweensOf(entry.container);

    const localX = pointer.x + gesture.offsetX - this.handCardsContainer.x;
    const localY = pointer.y + gesture.offsetY - this.handCardsContainer.y;
    entry.container.setPosition(localX, localY);
    entry.container.setScale(entry.affordable ? 1.08 : 1.04);
    entry.container.setAlpha(entry.affordable ? 1 : 0.86);

    const worldX = pointer.x + gesture.offsetX;
    const worldY = pointer.y + gesture.offsetY;
    this.showCardHoverPreview(gesture.cardId, { x: worldX, y: worldY - entry.height / 2 - 24 });

    if (this.canPlayerIssueAction() && entry.affordable && this.isPointInPlayDropZone(pointer.x, pointer.y)) {
      this.showDragGuide('Release to play', this.scale.width / 2, this.isNarrowLayout() ? this.scale.height * 0.57 : this.scale.height * 0.53);
    } else if (this.canPlayerIssueAction() && this.shouldDiscardFromDrag(pointer, gesture)) {
      this.showDragGuide(
        'Release to discard',
        this.scale.width / 2,
        this.handSurface.y + this.handSurface.height / 2 - (this.isNarrowLayout() ? 56 : 42),
      );
    } else {
      this.hideDragGuide();
    }
  }

  private onGlobalPointerUp(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gestureState.get(pointer.id);
    if (!gesture) {
      return;
    }
    this.gestureState.delete(pointer.id);
    this.draggingCardId = null;

    const dx = pointer.x - gesture.x;
    const dy = pointer.y - gesture.y;
    const entry = this.findCardVisual(gesture.handIndex, gesture.cardId);
    const playByDrop = !!entry && entry.affordable && this.canPlayerIssueAction() && this.isPointInPlayDropZone(pointer.x, pointer.y);
    const discardByDrag = this.canPlayerIssueAction() && this.shouldDiscardFromDrag(pointer, gesture);
    this.hideDragGuide();

    if (playByDrop) {
      this.hideCardHoverPreview();
      this.tryPlayCard(gesture.cardId, gesture.handIndex);
      return;
    }

    if (discardByDrag) {
      this.hideCardHoverPreview();
      this.tryDiscardCard(gesture.cardId, gesture.handIndex);
      return;
    }

    if (gesture.dragging) {
      if (entry) {
        this.restoreCardVisual(entry);
      }
      if (!gesture.isTouch) {
        this.hideCardHoverPreview();
      }
      if (gesture.isTouch) {
        this.selectCardAt(gesture.handIndex);
      }
      return;
    }

    if (Math.abs(dy) > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0 && entry?.affordable) {
        this.hideCardHoverPreview();
        this.tryPlayCard(gesture.cardId, gesture.handIndex);
      } else if (dy > 0) {
        this.hideCardHoverPreview();
        this.tryDiscardCard(gesture.cardId, gesture.handIndex);
      } else if (entry) {
        this.restoreCardVisual(entry);
      }
      return;
    }

    if (gesture.isTouch) {
      this.selectCardAt(gesture.handIndex);
      return;
    }

    this.hideCardHoverPreview();
    this.tryPlayCard(gesture.cardId, gesture.handIndex);
  }

  private isTouchPointer(pointer: Phaser.Input.Pointer): boolean {
    const event = pointer.event as PointerEvent | MouseEvent | undefined;
    if (event && 'pointerType' in event) {
      return event.pointerType === 'touch' || event.pointerType === 'pen';
    }
    return pointer.wasTouch;
  }

  private onCardPointerOver(cardId: string, handIndex: number): void {
    this.selectCardAt(handIndex);
    const entry = this.findCardVisual(handIndex, cardId);
    const world = this.getCardWorldPosition(cardId, handIndex);
    if (!entry || !world || this.draggingCardId) {
      return;
    }
    this.showCardHoverPreview(cardId, { x: world.x, y: world.y - entry.height / 2 - 22 });
  }

  private onCardPointerOut(pointer: Phaser.Input.Pointer): void {
    if (this.draggingCardId || this.isTouchPointer(pointer)) {
      return;
    }
    this.hideCardHoverPreview();
    this.refreshCardSelection();
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
      this.hideCardHoverPreview();
      this.refreshCardSelection();
      return;
    }

    const cardId = this.state.players.player.hand[handIndex];
    if (!cardId) {
      this.clearSelectedCard();
      this.hideCardHoverPreview();
      this.refreshCardSelection();
      return;
    }

    this.selectedHandIndex = handIndex;
    this.selectedCardId = cardId;
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


  private getHandRenderKey(): string {
    return this.state.players.player.hand.join('|');
  }

  private getHandAffordabilityKey(): string {
    return this.state.players.player.hand
      .map((cardId, index) => `${index}:${canAffordCard(this.state, 'player', cardId) ? 1 : 0}`)
      .join('|');
  }

  private getHandLayoutKey(): string {
    return [
      this.bottomHudLayoutMode,
      Math.round(this.handLaneWidth),
      Math.round(this.handCardsContainer?.x ?? 0),
      Math.round(this.handCardsContainer?.y ?? 0),
      Math.round(this.scale.width),
      Math.round(this.scale.height),
    ].join(':');
  }

  private refreshHandVisualState(): void {
    this.cardVisuals.forEach((entry) => {
      const card = CARD_BY_ID[entry.cardId];
      if (!card) {
        return;
      }

      const affordable = canAffordCard(this.state, 'player', entry.cardId);
      const muted = !affordable;
      entry.affordable = affordable;
      entry.targetAlpha = affordable ? 1 : 0.84;

      entry.titleText.setColor(cardTitleHex(entry.domain, affordable));
      entry.costText.setColor(muted ? '#685f58' : '#12100e');
      entry.effectText.setColor(muted ? '#5c5650' : '#24201c');
      paintCardFrame(entry.frame, entry.width, entry.height, entry.domain, affordable, entry.handIndex === this.selectedHandIndex && affordable);
      drawResourceIcon(entry.resourceIcon, entry.domain, entry.iconSize, muted);
      drawIllustrationIcon(entry.illustration, getCardIllustration(card), entry.illustrationSize, cardTypeColor(entry.domain), muted);

      if (entry.hitArea.input) {
        entry.hitArea.input.cursor = affordable ? 'pointer' : 'default';
      }
      if (this.draggingCardId !== entry.cardId) {
        entry.container.setAlpha(entry.targetAlpha);
      }
    });
  }

  private syncHandView(): void {
    const renderKey = this.getHandRenderKey();
    const affordabilityKey = this.getHandAffordabilityKey();
    const layoutKey = this.getHandLayoutKey();
    const selectionKey = `${this.selectedHandIndex ?? -1}`;
    const handChanged = this.lastHandRenderKey !== renderKey;
    const layoutChanged = this.lastHandLayoutKey !== layoutKey;
    const needsStructuralSync = this.cardVisuals.length !== this.state.players.player.hand.length || handChanged || layoutChanged;

    if (needsStructuralSync) {
      const animateEntry = this.handAllowEntryAnimation || (this.lastHandRenderKey !== '' && handChanged);
      this.rebuildHand(animateEntry);
      this.lastHandRenderKey = renderKey;
      this.lastHandAffordabilityKey = affordabilityKey;
      this.lastHandLayoutKey = layoutKey;
      this.lastHandSelectionKey = selectionKey;
      this.handAllowEntryAnimation = false;
      this.refreshCardSelection();
      return;
    }

    const affordabilityChanged = this.lastHandAffordabilityKey !== affordabilityKey;
    if (affordabilityChanged) {
      this.refreshHandVisualState();
      this.lastHandAffordabilityKey = affordabilityKey;
    }

    if (affordabilityChanged || this.lastHandSelectionKey !== selectionKey) {
      this.refreshCardSelection();
      this.lastHandSelectionKey = selectionKey;
    }
  }

  private updateHud(): void {
    const player = this.state.players.player;
    const ai = this.state.players.ai;
    const narrow = this.isNarrowLayout();
    this.selectDefaultCard();
    this.updateTopPileViews();
    this.rebuildEnemyHand();
    this.topSummaryText.setText(narrow ? `Red ${ai.tower}/${ai.wall}` : `Goal ${this.state.winTower} | Red C${ai.tower} / W${ai.wall}`);

    const turnLabel =
      this.state.phase === 'ended'
        ? 'Match Over'
        : this.state.turn.current === 'player'
          ? 'Your turn'
          : this.aiRevealCountdownMs !== null
            ? 'Opponent reveals'
            : this.aiSelectionCountdownMs !== null
              ? 'Opponent chooses'
              : 'Opponent turn';
    this.turnLabelText.setText(turnLabel);

    const currentInstruction =
      this.state.phase === 'ended'
        ? this.state.winner === 'player'
          ? 'Victory secured.'
          : 'Defeat. The tower fell.'
        : this.state.turn.current === 'player'
          ? 'Click a full-color card or drag it to center. Drag down discards.'
          : this.aiRevealCountdownMs !== null && this.aiPendingAction?.type === 'play_card'
            ? `Red reveals ${CARD_BY_ID[this.aiPendingAction.cardId]?.name ?? 'a card'}.`
            : this.aiSelectionCountdownMs !== null && this.aiPendingAction
              ? this.aiPendingAction.type === 'play_card'
                ? 'Red chooses a hidden card.'
                : 'Red cycles a hidden card.'
              : this.aiPendingAction?.type === 'play_card'
                ? 'Red card is resolving.'
            : 'Red is thinking.';
    this.statusText.setText(
      narrow
        ? this.state.phase === 'ended'
          ? currentInstruction
          : this.state.turn.current === 'player'
            ? ''
            : this.aiRevealCountdownMs !== null
              ? 'Red reveals a card.'
              : 'Red is thinking.'
        : currentInstruction,
    );

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

    this.updateTowerPressure(this.playerTowerVisual, player.tower, player.wall, this.state.winTower);
    this.updateTowerPressure(this.aiTowerVisual, ai.tower, ai.wall, this.state.winTower);

    if (this.aiRevealCountdownMs !== null && this.aiPendingAction?.type === 'play_card') {
      if (!this.enemyCardRevealContainer || this.topStageCardId !== this.aiPendingAction.cardId) {
        this.showEnemyCardReveal(this.aiPendingAction.cardId);
      }
    } else if (this.enemyCardRevealContainer && this.aiPendingAction?.type !== 'play_card') {
      this.clearEnemyCardReveal();
    }

    this.handHintText.setText(
      this.state.turn.current === 'player'
        ? narrow
          ? 'Drag to center to play\nDrag down to discard'
          : 'Click to play | Drag to center to play | Drag down to discard'
        : narrow
          ? 'Opponent turn'
          : 'Opponent turn: watch the top strip',
    );

    this.hideCardHoverPreview();
    this.hideDragGuide();
    this.syncHandView();

    if (this.state.phase === 'ended') {
      this.endOverlayText.setText(this.state.winner === 'player' ? 'Victory' : 'Defeat');
      this.endOverlay.setVisible(true);
    } else {
      this.endOverlay.setVisible(false);
    }
  }

  private updateTowerPressure(tower: TowerVisualRefs, towerValue: number, wallValue: number, winTower: number): void {
    const castleRatio = Phaser.Math.Clamp(towerValue / winTower, 0, 1);
    const castleHeight = Phaser.Math.Linear(CASTLE_MIN_HEIGHT, CASTLE_MAX_HEIGHT, castleRatio);
    const wallSafeValue = Math.max(0, wallValue);
    const wallRatio = Phaser.Math.Clamp(wallSafeValue / WALL_VISUAL_CAP, 0, 1);
    const wallHeight = wallSafeValue <= 0 ? 0 : Math.max(6, WALL_MAX_HEIGHT * wallRatio);
    const shouldAnimate = this.animationsEnabled && Math.abs(tower.bodyTargetHeight - castleHeight) > 0.5;

    if (shouldAnimate) {
      this.tweens.killTweensOf([tower.body, tower.roof]);
      this.tweens.add({
        targets: tower.body,
        displayHeight: castleHeight,
        duration: animDuration(260),
        ease: 'Back.Out',
      });
      this.tweens.add({
        targets: tower.roof,
        y: -castleHeight,
        duration: animDuration(260),
        ease: 'Back.Out',
      });
    } else {
      tower.body.displayHeight = castleHeight;
      tower.roof.y = -castleHeight;
    }

    tower.bodyTargetHeight = castleHeight;

    if (wallSafeValue <= 0) {
      if (tower.wallLine.visible && this.animationsEnabled) {
        this.tweens.killTweensOf(tower.wallLine);
        this.tweens.add({
          targets: tower.wallLine,
          displayHeight: 0,
          alpha: 0,
          duration: animDuration(180),
          ease: 'Sine.In',
          onComplete: () => tower.wallLine.setVisible(false),
        });
      } else {
        tower.wallLine.setVisible(false);
        tower.wallLine.displayHeight = 0;
        tower.wallLine.setAlpha(0);
      }
      tower.wallTargetHeight = 0;
      return;
    }

    tower.wallLine.setVisible(true);
    tower.wallLine.setAlpha(0.95);
    tower.wallLine.displayWidth = WALL_LINE_WIDTH;

    if (this.animationsEnabled && Math.abs(tower.wallTargetHeight - wallHeight) > 0.5) {
      this.tweens.killTweensOf(tower.wallLine);
      this.tweens.add({
        targets: tower.wallLine,
        displayHeight: wallHeight,
        alpha: 0.95,
        duration: animDuration(220),
        ease: 'Back.Out',
      });
    } else {
      tower.wallLine.displayHeight = wallHeight;
    }
    tower.wallTargetHeight = wallHeight;
  }

  private rebuildHand(animateEntry = false): void {
    this.cardVisuals.forEach((entry) => entry.container.destroy());
    this.cardVisuals = [];

    const narrow = this.isNarrowLayout();
    const hand = this.state.players.player.hand;
    const panelWidth = this.handLaneWidth || this.handSurface.width - 42;
    const maxWidth = panelWidth - (narrow ? 10 : 12);
    const targetCardWidth = narrow ? 78 : 134;
    const gap = hand.length > 1 ? Math.min(narrow ? 7 : 16, Math.max(4, (maxWidth - hand.length * targetCardWidth) / (hand.length - 1))) : 0;
    const count = Math.max(1, hand.length);
    const cardWidth = Math.min(narrow ? 92 : 148, Math.max(narrow ? 62 : 110, (maxWidth - gap * (count - 1)) / count));
    const compact = cardWidth < 118;
    const ultraCompact = cardWidth < 80;
    const cardHeight = Math.round(cardWidth * (ultraCompact ? 1.45 : compact ? 1.42 : 1.38));

    const rowWidth = count * cardWidth + (count - 1) * gap;
    const startX = -rowWidth / 2 + cardWidth / 2;

    hand.forEach((cardId, index) => {
      const card = CARD_BY_ID[cardId];
      if (!card) {
        return;
      }

      const x = startX + index * (cardWidth + gap);
      const y = 0;
      const affordable = canAffordCard(this.state, 'player', cardId);
      const targetAlpha = affordable ? 1 : 0.84;
      const muted = !affordable;
      const cardPadding = ultraCompact ? 6 : compact ? 8 : 12;
      const isSelected = this.selectedHandIndex === index;
      const emphasized = isSelected && affordable;
      const iconSize = ultraCompact ? 12 : compact ? 15 : 18;
      const illustrationSize = ultraCompact ? 24 : compact ? 34 : 42;
      const titleY = -cardHeight / 2 + (ultraCompact ? 20 : compact ? 24 : 30);
      const titleWrapWidth = Math.max(36, cardWidth - cardPadding * 2 - 8);
      const effectText = formatCardEffectLine(card);

      const container = this.add.container(x, y);
      container.setAlpha(targetAlpha);
      container.setY(emphasized ? -12 : 0);
      container.setScale(emphasized ? 1.04 : 1);
      const frame = this.add.graphics();
      paintCardFrame(frame, cardWidth, cardHeight, card.domain, affordable, emphasized);

      const resourceIcon = createResourceIcon(
        this,
        card.domain,
        -cardWidth / 2 + cardPadding + iconSize / 2 + 1,
        -cardHeight / 2 + cardPadding + iconSize / 2 + 1,
        iconSize,
        muted,
      );

      const title = this.add
        .text(0, titleY, card.name, {
          fontFamily: FONT_FAMILY,
          fontSize: ultraCompact ? '8px' : compact ? '11px' : '15px',
          color: cardTitleHex(card.domain, affordable),
          fontStyle: 'bold',
          align: 'center',
          wordWrap: { width: titleWrapWidth },
        })
        .setOrigin(0.5, 0);
      title.setLineSpacing(ultraCompact ? -2 : -1);

      const costShadow = this.add
        .text(cardWidth / 2 - cardPadding - 1, -cardHeight / 2 + cardPadding - 1, String(card.cost), {
          fontFamily: FONT_FAMILY,
          fontSize: ultraCompact ? '12px' : compact ? '16px' : '22px',
          color: '#fffdf7',
          fontStyle: 'bold',
        })
        .setOrigin(1, 0);
      const costText = this.add
        .text(cardWidth / 2 - cardPadding - 2, -cardHeight / 2 + cardPadding - 2, String(card.cost), {
          fontFamily: FONT_FAMILY,
          fontSize: ultraCompact ? '12px' : compact ? '16px' : '22px',
          color: muted ? '#685f58' : '#12100e',
          fontStyle: 'bold',
        })
        .setOrigin(1, 0);

      const illustration = createIllustrationIcon(
        this,
        getCardIllustration(card),
        0,
        ultraCompact ? 6 : compact ? 13 : 18,
        illustrationSize,
        cardTypeColor(card.domain),
        muted,
      );

      const effect = this.add
        .text(0, cardHeight / 2 - (ultraCompact ? 16 : compact ? 22 : 28), ultraCompact ? '' : effectText, {
          fontFamily: FONT_FAMILY,
          fontSize: ultraCompact ? '8px' : compact ? '10px' : '13px',
          color: muted ? '#5c5650' : '#24201c',
          fontStyle: compact ? 'normal' : 'bold',
          align: 'center',
          wordWrap: { width: Math.max(30, cardWidth - cardPadding * 2) },
        })
        .setOrigin(0.5);
      effect.setLineSpacing(ultraCompact ? -1 : 0);

      const hit = this.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0).setInteractive({ useHandCursor: affordable });
      hit.on('pointerover', () => {
        this.onCardPointerOver(cardId, index);
      });
      hit.on('pointerout', (pointer: Phaser.Input.Pointer) => {
        this.onCardPointerOut(pointer);
      });
      hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.onCardPointerDown(cardId, index, pointer);
      });

      container.add([frame, resourceIcon, title, costShadow, costText, illustration, effect, hit]);
      this.handCardsContainer.add(container);

      if (this.animationsEnabled && animateEntry) {
        container.setY((emphasized ? -12 : 0) + 14);
        container.setScale((emphasized ? 1.04 : 1) * 0.97);
        this.tweens.add({
          targets: container,
          y: emphasized ? -12 : 0,
          scaleX: emphasized ? 1.04 : 1,
          scaleY: emphasized ? 1.04 : 1,
          duration: animDuration(160),
          delay: animDelay(index * 24),
          ease: 'Sine.Out',
        });
      }

      this.cardVisuals.push({
        cardId,
        handIndex: index,
        container,
        frame,
        resourceIcon,
        titleText: title,
        costText,
        illustration,
        effectText: effect,
        hitArea: hit,
        width: cardWidth,
        height: cardHeight,
        domain: card.domain,
        affordable,
        baseX: x,
        baseY: y,
        targetAlpha,
        iconSize,
        illustrationSize,
      });
    });
  }

  private refreshCardSelection(): void {
    this.cardVisuals.forEach((entry) => {
      const selected = entry.handIndex === this.selectedHandIndex && entry.affordable;
      paintCardFrame(entry.frame, entry.width, entry.height, entry.domain, entry.affordable, selected);
      this.tweens.killTweensOf(entry.container);
      if (this.animationsEnabled) {
        this.tweens.add({
          targets: entry.container,
          x: entry.baseX,
          y: selected ? entry.baseY - 12 : entry.baseY,
          scaleX: selected ? 1.04 : 1,
          scaleY: selected ? 1.04 : 1,
          duration: animDuration(130),
          ease: 'Sine.Out',
        });
      } else {
        entry.container.setX(entry.baseX);
        entry.container.setY(selected ? entry.baseY - 12 : entry.baseY);
        entry.container.setScale(selected ? 1.04 : 1);
      }
    });
  }

  private getPlayerResource(resource: Resource): number {
    return this.state.players.player[resource];
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
    payload.ui = {
      activePlayer: this.state.turn.current,
      playerDeckCount: this.state.players.player.deck.length,
      playerDiscardCount: this.state.players.player.discard.length,
      playerDiscardTopCardId: this.state.players.player.discard.at(-1) ?? null,
      enemyDiscardCount: this.state.players.ai.discard.length,
      enemyDiscardTopCardId: this.state.players.ai.discard.at(-1) ?? null,
      enemyHiddenHandCount: this.state.players.ai.hand.length,
      selectedEnemyHandIndex: this.aiSelectedHandIndex,
      chosenEnemyCardId:
        this.aiPendingAction?.type === 'play_card' || this.aiPendingAction?.type === 'discard_card'
          ? this.aiPendingAction.cardId
          : null,
      revealedEnemyCardId:
        this.aiRevealCountdownMs !== null && this.aiPendingAction?.type === 'play_card' ? this.aiPendingAction.cardId : null,
      selectedCardId: this.selectedCardId,
      selectedHandIndex: this.selectedHandIndex,
      selectedCardName: selectedCard?.name ?? null,
      selectedCardPlayable: selectedCard ? canAffordCard(this.state, 'player', selectedCard.id) : false,
      selectedCardImpact: selectedCard ? formatCardEffectLine(selectedCard) : null,
      hoverPreviewCardId: this.hoverPreviewCardId,
      draggingCardId: this.draggingCardId,
      renderedHandCardCount: this.cardVisuals.length,
      fullyVisibleHandCardCount: this.cardVisuals.filter((entry) => Math.abs(entry.container.alpha - entry.targetAlpha) < 0.02).length,
      bottomHudLayout: this.bottomHudLayoutMode,
      topStageMode: this.topStageMode,
      topStageCardId: this.topStageCardId,
      phase: this.state.phase,
    };
    return JSON.stringify(payload, null, 2);
  }

  public advanceForTesting(ms: number): void {
    this.advanceVirtualTime(ms);
  }
}
