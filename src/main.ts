import './style.css';
import { GAME_HEIGHT, GAME_WIDTH } from './game/constants';
import type { GameScene } from './scenes/GameScene';

type TestingWindow = Window & {
  __phaserGame?: import('phaser').Game;
  render_game_to_text?: () => string;
  advanceTime?: (ms: number) => void;
};

let game: import('phaser').Game | null = null;

async function bootstrap(): Promise<void> {
  const Phaser = (await import('phaser')).default;
  const [{ BootScene }, { MenuScene }, { GameScene }] = await Promise.all([
    import('./scenes/BootScene'),
    import('./scenes/MenuScene'),
    import('./scenes/GameScene'),
  ]);

  game = new Phaser.Game({
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
    if (!game) {
      return JSON.stringify({ mode: 'boot', note: 'Game not initialized' }, null, 2);
    }
    const scene = game.scene.getScene('GameScene') as GameScene | undefined;
    if (!scene || !scene.scene.isActive()) {
      return JSON.stringify({ mode: 'menu', note: 'GameScene inactive' }, null, 2);
    }
    return scene.renderGameState();
  };
  testingWindow.advanceTime = (ms: number) => {
    if (!game) {
      return;
    }
    const scene = game.scene.getScene('GameScene') as GameScene | undefined;
    if (!scene || !scene.scene.isActive()) {
      return;
    }
    scene.advanceForTesting(ms);
  };
}

void bootstrap();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.destroy(true);
    game = null;
  });
}
