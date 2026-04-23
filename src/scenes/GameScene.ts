import Phaser from 'phaser';
import { evaluateAIMove } from '../game/ai';
import { CARD_BY_ID } from '../game/cards';
import { AI_DELAY_MS } from '../game/constants';
import { canAffordCard, createInitialGameState, reduceGameState, summarizeForText } from '../game/engine';
import { SeededRng, seedFromNow } from '../game/rng';
import { loadMeta, updateMeta } from '../game/storage';
import type { Action, GameMetaV1, GameState } from '../game/types';

interface CardVisual {
  cardId: string;
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Rectangle;
}

function cardColor(domain: 'bricks' | 'weapons' | 'crystals'): number {
  if (domain === 'bricks') {
    return 0xc18f62;
  }
  if (domain === 'weapons') {
    return 0xb6504b;
  }
  return 0x4a6fb8;
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

  private topStatsText!: Phaser.GameObjects.Text;
  private playerStatsText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private detailText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  private handContainer!: Phaser.GameObjects.Container;
  private cardVisuals: CardVisual[] = [];

  private discardMode = false;
  private discardButtonBg!: Phaser.GameObjects.Rectangle;
  private discardButtonText!: Phaser.GameObjects.Text;

  private aiCountdownMs: number | null = null;
  private selectedCardId: string | null = null;

  private endOverlay!: Phaser.GameObjects.Container;
  private endOverlayText!: Phaser.GameObjects.Text;

  private resultPersisted = false;
  private animationsEnabled = true;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.meta = loadMeta();
    this.animationsEnabled = this.meta.settings.animations;

    this.buildLayout();
    this.bindKeys();

    this.startNewMatch();
    this.progressLoop();

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
        const target =
          hand.find((cardId) => canAffordCard(this.state, 'player', cardId)) ??
          hand[0];
        if (!target) {
          return;
        }
        this.onCardPressed(target);
      },
      clearInput: () => {
        this.selectedCardId = null;
      },
    };

    this.events.once('shutdown', () => {
      const active = window as typeof window & { __game?: unknown };
      delete active.__game;
    });
  }

  update(_time: number, delta: number): void {
    this.tickAi(delta);
  }

  private buildLayout(): void {
    const { width, height } = this.scale;

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x243b56, 0x243b56, 0x111b2c, 0x111b2c, 1);
    bg.fillRect(0, 0, width, height);

    this.add.rectangle(width / 2, 84, width - 30, 136, 0xf2efe4, 0.95).setStrokeStyle(2, 0x9f9785);
    this.add.rectangle(width / 2, 348, width - 30, 312, 0xf0ebe0, 0.9).setStrokeStyle(2, 0x9f9785);
    this.add.rectangle(width / 2, 696, width - 30, 236, 0xf3efe4, 0.95).setStrokeStyle(2, 0x9f9785);

    this.topStatsText = this.add.text(35, 28, '', {
      fontFamily: 'Georgia',
      fontSize: '24px',
      color: '#1d2630',
      fontStyle: 'bold',
      lineSpacing: 8,
    });

    this.turnText = this.add
      .text(width - 24, 28, '', {
        fontFamily: 'Georgia',
        fontSize: '24px',
        color: '#27435f',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0);

    this.logText = this.add.text(35, 212, '', {
      fontFamily: 'Georgia',
      fontSize: '20px',
      color: '#1d2630',
      lineSpacing: 7,
      wordWrap: { width: width * 0.58 },
    });

    this.detailText = this.add.text(width * 0.64, 212, '', {
      fontFamily: 'Georgia',
      fontSize: '18px',
      color: '#1c2c3d',
      wordWrap: { width: width * 0.31 },
      lineSpacing: 5,
    });

    this.playerStatsText = this.add.text(35, 588, '', {
      fontFamily: 'Georgia',
      fontSize: '23px',
      color: '#1d2630',
      fontStyle: 'bold',
      lineSpacing: 8,
    });

    this.handContainer = this.add.container(0, 0);

    const discardButton = this.add.container(width - 180, 596);
    this.discardButtonBg = this.add.rectangle(0, 0, 150, 44, 0x59647a).setStrokeStyle(2, 0xe8dec8);
    this.discardButtonText = this.add
      .text(0, 0, 'Discard: Off', {
        fontFamily: 'Georgia',
        fontSize: '18px',
        color: '#f5f4ef',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const discardHit = this.add
      .rectangle(0, 0, 150, 44, 0x000000, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this.discardMode = !this.discardMode;
        this.refreshDiscardToggle();
      });
    discardButton.add([this.discardButtonBg, this.discardButtonText, discardHit]);

    this.hintText = this.add
      .text(width - 20, 640, 'Tap a card to play. Press F for fullscreen.', {
        fontFamily: 'Georgia',
        fontSize: '15px',
        color: '#364658',
      })
      .setOrigin(1, 0);

    this.endOverlayText = this.add
      .text(width / 2, height / 2 - 90, '', {
        fontFamily: 'Georgia',
        fontSize: '46px',
        color: '#f2efe8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const overlayBg = this.add.rectangle(width / 2, height / 2, width, height, 0x0f1725, 0.82);
    const rematchButton = createButton(this, width / 2 - 110, height / 2 + 20, 170, 'Rematch', () => {
      this.startNewMatch();
      this.progressLoop();
    });
    const menuButton = createButton(this, width / 2 + 110, height / 2 + 20, 170, 'Back to Menu', () => {
      this.scene.start('MenuScene');
    });

    this.endOverlay = this.add.container(0, 0, [overlayBg, this.endOverlayText, rematchButton, menuButton]);
    this.endOverlay.setVisible(false);

    this.refreshDiscardToggle();
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
    this.aiCountdownMs = null;
    this.selectedCardId = null;
    this.discardMode = false;
    this.refreshDiscardToggle();

    this.endOverlay.setVisible(false);
    this.updateHud();
  }

  private dispatch(action: Action): boolean {
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

    if (this.state.phase === 'ended') {
      this.handleMatchEnd();
    }

    return true;
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
      this.hintText.setText('AI is evaluating best move...');
    } else {
      this.aiCountdownMs = null;
      this.hintText.setText(
        this.discardMode
          ? 'Discard mode is ON. Tap a card to discard it.'
          : 'Tap a card to play. Toggle Discard to cycle your hand.',
      );
    }
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

  private onCardPressed(cardId: string): void {
    this.selectedCardId = cardId;
    this.updateDetail(cardId);

    if (this.state.phase !== 'playing') {
      return;
    }
    if (this.state.turn.current !== 'player' || !this.state.turn.started || this.state.turn.actionTaken) {
      return;
    }

    if (this.discardMode) {
      const ok = this.dispatch({ type: 'discard_card', playerId: 'player', cardId });
      if (!ok) {
        return;
      }
      if (this.dispatch({ type: 'end_turn' })) {
        this.progressLoop();
      }
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

  private refreshDiscardToggle(): void {
    this.discardButtonText.setText(this.discardMode ? 'Discard: On' : 'Discard: Off');
    this.discardButtonBg.setFillStyle(this.discardMode ? 0xa14f4f : 0x59647a);
  }

  private updateHud(): void {
    const player = this.state.players.player;
    const ai = this.state.players.ai;

    this.topStatsText.setText(
      `AI Tower ${ai.tower}   Wall ${ai.wall}\nBricks ${ai.bricks} (Q:${ai.quarry})   Weapons ${ai.weapons} (B:${ai.barracks})   Crystals ${ai.crystals} (M:${ai.magic})`,
    );

    this.playerStatsText.setText(
      `Your Tower ${player.tower}   Wall ${player.wall}\nBricks ${player.bricks} (Q:${player.quarry})   Weapons ${player.weapons} (B:${player.barracks})   Crystals ${player.crystals} (M:${player.magic})`,
    );

    this.turnText.setText(
      `Turn ${this.state.turn.number} • ${
        this.state.phase === 'ended' ? 'Match Over' : this.state.turn.current === 'player' ? 'Your Turn' : 'AI Turn'
      }`,
    );

    const logLines = this.state.log.slice(-8).map((line) => `- ${line}`);
    this.logText.setText(logLines.join('\n'));

    this.rebuildHand();

    if (this.selectedCardId && CARD_BY_ID[this.selectedCardId]) {
      this.updateDetail(this.selectedCardId);
    } else {
      this.detailText.setText('Card details\nSelect a card from your hand.');
    }
  }

  private rebuildHand(): void {
    this.cardVisuals.forEach((card) => card.container.destroy());
    this.cardVisuals = [];

    const hand = this.state.players.player.hand;
    const areaX = 28;
    const areaY = 650;
    const cardW = 170;
    const cardH = 88;
    const gap = 12;

    hand.forEach((cardId, index) => {
      const card = CARD_BY_ID[cardId];
      if (!card) {
        return;
      }

      const x = areaX + (cardW + gap) * index + cardW / 2;
      const y = areaY + cardH / 2;
      const affordable = canAffordCard(this.state, 'player', cardId);

      const bg = this.add
        .rectangle(0, 0, cardW, cardH, cardColor(card.domain), affordable ? 0.95 : 0.45)
        .setStrokeStyle(this.selectedCardId === cardId ? 4 : 2, this.selectedCardId === cardId ? 0xfff4dd : 0xf5d9bf);

      const title = this.add
        .text(0, -20, card.name, {
          fontFamily: 'Georgia',
          fontSize: '16px',
          color: '#f8f6f1',
          fontStyle: 'bold',
          align: 'center',
          wordWrap: { width: cardW - 12 },
        })
        .setOrigin(0.5);

      const info = this.add
        .text(0, 18, `${card.domain.toUpperCase()} ${card.cost} • ${card.text}`, {
          fontFamily: 'Georgia',
          fontSize: '12px',
          color: '#f5f2ec',
          align: 'center',
          wordWrap: { width: cardW - 14 },
        })
        .setOrigin(0.5);

      const hit = this.add.rectangle(0, 0, cardW, cardH, 0x000000, 0).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => this.updateDetail(cardId));
      hit.on('pointerdown', () => this.onCardPressed(cardId));

      const cardContainer = this.add.container(x, y, [bg, title, info, hit]);
      this.handContainer.add(cardContainer);

      if (this.animationsEnabled) {
        cardContainer.setAlpha(0);
        this.tweens.add({
          targets: cardContainer,
          alpha: 1,
          y,
          duration: 180,
          delay: index * 15,
        });
      }

      this.cardVisuals.push({
        cardId,
        container: cardContainer,
        background: bg,
      });
    });
  }

  private updateDetail(cardId: string): void {
    const card = CARD_BY_ID[cardId];
    if (!card) {
      return;
    }

    const affordable = canAffordCard(this.state, 'player', cardId);
    const status = affordable ? 'Affordable' : 'Not affordable';

    this.detailText.setText(
      `${card.name}\n${card.domain.toUpperCase()} cost ${card.cost}\n${card.text}\n\nTags: ${card.tags.join(', ')}\nStatus: ${status}`,
    );

    this.cardVisuals.forEach((entry) => {
      entry.background.setStrokeStyle(entry.cardId === cardId ? 4 : 2, entry.cardId === cardId ? 0xfff4dd : 0xf5d9bf);
    });
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
    this.hintText.setText('Match ended. Choose Rematch or Back to Menu.');
  }

  private advanceVirtualTime(ms: number): void {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    const delta = ms / steps;
    for (let i = 0; i < steps; i += 1) {
      this.tickAi(delta);
    }
  }

  public renderGameState(): string {
    return summarizeForText(this.state);
  }

  public advanceForTesting(ms: number): void {
    this.advanceVirtualTime(ms);
  }
}
