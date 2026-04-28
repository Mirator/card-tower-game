import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_DIR = new URL('../output/browser-smoke/', import.meta.url);
const USE_SHELL = process.platform === 'win32';
const NPM = 'npm';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getFreePort(preferredPort) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      const fallback = createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const address = fallback.address();
        fallback.close(() => resolve(address.port));
      });
    });
    server.listen(preferredPort, '127.0.0.1', () => {
      server.close(() => resolve(preferredPort));
    });
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...options.env,
      },
      shell: USE_SHELL,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${output}`));
      }
    });
  });
}

function startServer(script, port, env = {}) {
  const child = spawn(NPM, ['run', script, '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...env,
    },
    shell: USE_SHELL,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
    process.stderr.write(chunk);
  });

  return { child, output: () => output };
}

async function stopServer(child) {
  if (!child.pid || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      killer.on('exit', resolve);
      killer.on('error', resolve);
    });
    return;
  }

  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForHttp(url, child, getOutput) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming ready.\n${getOutput()}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}\n${getOutput()}`);
}

async function withServer(script, preferredPort, env, callback) {
  const port = await getFreePort(preferredPort);
  const url = `http://127.0.0.1:${port}`;
  const server = startServer(script, port, env);
  try {
    await waitForHttp(url, server.child, server.output);
    return await callback(url);
  } finally {
    await stopServer(server.child);
  }
}

function readState(text) {
  return JSON.parse(text);
}

async function assertNoConsoleErrors(errors) {
  assert(errors.length === 0, `Console/page errors during browser smoke:\n${errors.join('\n')}`);
}

async function runDevSmoke(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');

    const hookState = await page.evaluate(() => ({
      hasRender: typeof window.render_game_to_text === 'function',
      hasAdvance: typeof window.advanceTime === 'function',
      hasPhaserGame: '__phaserGame' in window,
    }));

    assert(hookState.hasRender, 'render_game_to_text hook should be exposed in dev smoke');
    assert(hookState.hasAdvance, 'advanceTime hook should be exposed in dev smoke');
    assert(!hookState.hasPhaserGame, '__phaserGame should not be exposed');

    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const state = JSON.parse(window.render_game_to_text());
      return state.mode === 'playing' && state.ui?.renderedHandCardCount === 6 && typeof window.__game?.interact === 'function';
    });

    assert(await page.evaluate(() => typeof window.__game?.interact === 'function'), '__game.interact hook should be exposed in GameScene');

    const initial = readState(await page.evaluate(() => window.render_game_to_text()));
    assert(initial.player.hand.length === 6, 'Player hand should start with 6 cards');
    assert(initial.ui.renderedHandCardCount === 6, 'Rendered hand should contain 6 cards');
    assert(initial.ui.fullyVisibleHandCardCount === 6, 'Rendered hand should be fully visible');
    assert(initial.ui.enemyHiddenHandCount === 6, 'Enemy hidden hand should start at 6 cards');
    await page.screenshot({ path: fileURLToPath(new URL('dev-start.png', OUTPUT_DIR)) });

    await page.evaluate(() => window.__game.interact());
    await page.evaluate(() => window.advanceTime(6_000));
    await page.waitForFunction(() => {
      const state = JSON.parse(window.render_game_to_text());
      return state.mode === 'playing' && state.turn.current === 'player' && state.turn.started;
    });

    const afterTurn = readState(await page.evaluate(() => window.render_game_to_text()));
    assert(afterTurn.turn.current === 'player', 'Turn should return to player after AI action');
    assert(afterTurn.player.hand.length === 6, 'Player hand should refill to 6 after action');
    assert(afterTurn.ui.renderedHandCardCount === 6, 'Rendered hand should still contain 6 cards after action');
    assert(afterTurn.ui.fullyVisibleHandCardCount === 6, 'Rendered hand should stay fully visible after action');
    // After the AI's turn the enemy hand drops to 5 (played) or stays 6 (discard-cycle); refill happens at AI's next turn start.
    assert(
      afterTurn.ui.enemyHiddenHandCount === 5 || afterTurn.ui.enemyHiddenHandCount === 6,
      `Enemy hidden hand should be 5 (played) or 6 (cycled), got ${afterTurn.ui.enemyHiddenHandCount}`,
    );
    await page.screenshot({ path: fileURLToPath(new URL('dev-after-turn.png', OUTPUT_DIR)) });

    await assertNoConsoleErrors(errors);
  } finally {
    await browser.close();
  }
}

async function runProductionHookGate(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    const hooks = await page.evaluate(() => ({
      hasRender: 'render_game_to_text' in window,
      hasAdvance: 'advanceTime' in window,
      hasGame: '__game' in window,
      hasPhaserGame: '__phaserGame' in window,
    }));

    assert(!hooks.hasRender, 'render_game_to_text should be absent in production preview');
    assert(!hooks.hasAdvance, 'advanceTime should be absent in production preview');
    assert(!hooks.hasGame, '__game should be absent in production preview');
    assert(!hooks.hasPhaserGame, '__phaserGame should be absent in production preview');
    await page.screenshot({ path: fileURLToPath(new URL('production-hooks-gated.png', OUTPUT_DIR)) });
    await assertNoConsoleErrors(errors);
  } finally {
    await browser.close();
  }
}

await mkdir(OUTPUT_DIR, { recursive: true });

console.log('Running dev browser smoke...');
await withServer('dev', 5173, { VITE_EXPOSE_TEST_HOOKS: 'true' }, runDevSmoke);

console.log('Building production bundle...');
await runCommand(NPM, ['run', 'build']);

console.log('Checking production hook gating...');
await withServer('preview', 4173, {}, runProductionHookGate);

console.log('Browser smoke passed.');
