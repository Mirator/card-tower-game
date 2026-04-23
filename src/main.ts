import Phaser from 'phaser';
import './style.css';
import { GAME_HEIGHT, GAME_WIDTH } from './game/constants';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';

type TestingWindow = Window & {
  __phaserGame?: Phaser.Game;
  render_game_to_text?: () => string;
  advanceTime?: (ms: number) => void;
};

const game = new Phaser.Game({
  type: Phaser.CANVAS,
  parent: 'app',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#111b2c',
  scene: [BootScene, MenuScene, GameScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  render: {
    antialias: true,
  },
});

const testingWindow = window as TestingWindow;
testingWindow.__phaserGame = game;
testingWindow.render_game_to_text = () => {
  const scene = game.scene.getScene('GameScene') as GameScene | undefined;
  if (!scene || !scene.scene.isActive()) {
    return JSON.stringify({ mode: 'menu', note: 'GameScene inactive' }, null, 2);
  }
  return scene.renderGameState();
};
testingWindow.advanceTime = (ms: number) => {
  const scene = game.scene.getScene('GameScene') as GameScene | undefined;
  if (!scene || !scene.scene.isActive()) {
    return;
  }
  scene.advanceForTesting(ms);
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.destroy(true);
  });
}
