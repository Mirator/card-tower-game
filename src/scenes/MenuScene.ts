import Phaser from 'phaser';
import { loadMeta, updateMeta } from '../game/storage';

function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
): Phaser.GameObjects.Container {
  const bg = scene.add.rectangle(0, 0, 260, 58, 0xd86f3d).setStrokeStyle(2, 0xf8d6b8);
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: 'Georgia',
      fontSize: '22px',
      color: '#1f1a17',
      fontStyle: 'bold',
    })
    .setOrigin(0.5);

  const button = scene.add.container(x, y, [bg, text]);
  const hit = scene.add.rectangle(0, 0, 260, 58, 0x000000, 0).setInteractive({ useHandCursor: true });
  hit.on('pointerover', () => {
    bg.setFillStyle(0xe7844f);
  });
  hit.on('pointerout', () => {
    bg.setFillStyle(0xd86f3d);
  });
  hit.on('pointerdown', onClick);
  button.add(hit);
  return button;
}

export class MenuScene extends Phaser.Scene {
  private animationsEnabled = true;

  constructor() {
    super('MenuScene');
  }

  private handleResize(): void {
    this.scene.restart();
  }

  create(): void {
    const { width, height } = this.scale;

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1f3348, 0x1f3348, 0x132034, 0x132034, 1);
    bg.fillRect(0, 0, width, height);

    this.add
      .text(width / 2, 110, 'CARD TOWER DUEL', {
        fontFamily: 'Georgia',
        fontSize: '58px',
        color: '#f3efe4',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 170, 'Build your tower or collapse theirs in one-card turns.', {
        fontFamily: 'Georgia',
        fontSize: '22px',
        color: '#d8dce2',
      })
      .setOrigin(0.5);

    const meta = loadMeta();
    this.animationsEnabled = meta.settings.animations;

    const statsPanel = this.add.rectangle(width / 2, height / 2 - 40, 520, 190, 0xf0eee7, 0.95).setStrokeStyle(2, 0x9c947f);
    this.add
      .text(statsPanel.x, statsPanel.y - 58, 'Career Stats', {
        fontFamily: 'Georgia',
        fontSize: '28px',
        color: '#1f2226',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(statsPanel.x, statsPanel.y - 5, `Matches: ${meta.stats.matchesPlayed}   Wins: ${meta.stats.wins}   Losses: ${meta.stats.losses}`, {
        fontFamily: 'Georgia',
        fontSize: '24px',
        color: '#253343',
      })
      .setOrigin(0.5);

    const animationLabel = this.add
      .text(statsPanel.x - 120, statsPanel.y + 50, 'UI Motion', {
        fontFamily: 'Georgia',
        fontSize: '20px',
        color: '#253343',
      })
      .setOrigin(0.5);

    const toggleBg = this.add
      .rectangle(statsPanel.x + 80, statsPanel.y + 50, 150, 44, this.animationsEnabled ? 0x2f8f5c : 0xa14f4f)
      .setStrokeStyle(2, 0xe8dec8)
      .setInteractive({ useHandCursor: true });
    const toggleText = this.add
      .text(toggleBg.x, toggleBg.y, this.animationsEnabled ? 'Enabled' : 'Disabled', {
        fontFamily: 'Georgia',
        fontSize: '20px',
        color: '#f5f4ef',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    toggleBg.on('pointerdown', () => {
      this.animationsEnabled = !this.animationsEnabled;
      toggleBg.setFillStyle(this.animationsEnabled ? 0x2f8f5c : 0xa14f4f);
      toggleText.setText(this.animationsEnabled ? 'Enabled' : 'Disabled');

      updateMeta((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          animations: this.animationsEnabled,
        },
      }));
    });

    createButton(this, width / 2, height - 150, 'Start Duel', () => {
      this.scene.start('GameScene');
    });

    this.input.keyboard?.once('keydown-ENTER', () => {
      this.scene.start('GameScene');
    });
    this.input.keyboard?.once('keydown-SPACE', () => {
      this.scene.start('GameScene');
    });

    this.add
      .text(width / 2, height - 70, 'Desktop: left click play, right click discard. Mobile: swipe up/down on card.', {
        fontFamily: 'Georgia',
        fontSize: '18px',
        color: '#cbd1da',
      })
      .setOrigin(0.5);

    this.scale.on('resize', this.handleResize, this);

    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize, this);
      animationLabel.destroy();
    });
  }
}
