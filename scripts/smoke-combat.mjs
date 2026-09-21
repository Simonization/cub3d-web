/**
 * Combat pass: load level 1, face the enemy, shoot it until it dies, take a hit,
 * then check the level-3 door leads somewhere.
 *
 *     node scripts/smoke-combat.mjs http://localhost:5180 ./shots
 *
 * Same headless caveat as scripts/smoke.mjs: `channel: 'chromium'` is required, and
 * everything that happens while the render loop is live goes in one evaluate.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5180';
const outDir = process.argv[3] ?? 'shots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(20000);

const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const savePng = (name, dataUrl) =>
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));

const HELPERS = `
  const g = globalThis.__cub3d;
  const frames = (n) => new Promise((res) => {
    let i = 0;
    const tick = () => (++i >= n ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
  const canvas = () => document.querySelector('#screen').toDataURL('image/png');
  const faceEnemy = (e) => {
    g.player.angle = Math.atan2(-(e.y - g.player.y), e.x - g.player.x);
    g.player.rotate(0);
  };
`;
const inPage = (body) => page.evaluate(`(async () => { ${HELPERS} ${body} })()`);

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__cub3d !== undefined, null, { timeout: 20000 });
await page.click('#start');

// --- level 1: find the enemy, look at it, shoot it dead -------------------
const fight = await inPage(`
  await g.loadLevel(1);
  g.setMode('PLAYING');
  await frames(4);
  const enemy = g.enemies[0];
  faceEnemy(enemy);
  await frames(3);
  const seen = canvas();

  const startHealth = enemy.health;
  const shots = [];
  for (let i = 0; i < 12 && !enemy.dead; i++) {
    faceEnemy(enemy);
    const before = enemy.health;
    g.weapon.ammo = 40;
    // fire() is TS-private, which is public at runtime; this is the same call the
    // mousedown handler makes.
    Object.getPrototypeOf(g).fire.call(g);
    shots.push({ before, after: enemy.health, state: enemy.state });
    await frames(14);
  }

  return {
    levelName: g.levelDef.name,
    enemyCount: g.enemies.length,
    startHealth,
    shots,
    dead: enemy.dead,
    state: enemy.state,
    ammo: g.weapon.ammo,
    seen,
    corpse: canvas(),
  };
`);
savePng('10-enemy-in-view', fight.seen);
savePng('11-after-kill', fight.corpse);

// --- a deliberate miss ---------------------------------------------------
const miss = await inPage(`
  await g.loadLevel(1);
  g.setMode('PLAYING');
  await frames(3);
  const enemy = g.enemies[0];
  // Fire through the game's own path and read g.lastShot, so this works against the
  // bundled production build as well as the dev server. Clearing the cooldown and
  // nulling lastShot first matters: a blocked shot leaves the PREVIOUS result in
  // place, which silently turns a miss into a hit.
  const fire = () => {
    g.weapon.ammo = 40;
    // Both halves of "busy" have to go: the cooldown AND the firing animation,
    // which otherwise blocks the next shot and leaves lastShot stale.
    g.weapon.cooldown = 0;
    g.weapon.firing = false;
    g.lastShot = null;
    Object.getPrototypeOf(g).fire.call(g);
    return g.lastShot;
  };

  // Miss first, while the enemy is still asleep and standing still.
  faceEnemy(enemy);
  g.player.rotate(25 * Math.PI / 180);
  const wide = fire();

  const stillThere = { x: enemy.x, y: enemy.y };
  faceEnemy(enemy);
  const hit = fire();

  return {
    aimed: { hit: hit.enemy !== null, missedBy: hit.missedBy, distance: +hit.distance.toFixed(2) },
    wide: { hit: wide.enemy !== null, missedBy: wide.missedBy === null ? null : +wide.missedBy.toFixed(2) },
    bothFired: hit !== null && wide !== null,
    enemyMoved: enemy.x !== stillThere.x || enemy.y !== stillThere.y,
  };
`);

// --- the enemy fights back ----------------------------------------------
const hurt = await inPage(`
  await g.loadLevel(1);
  g.setMode('PLAYING');
  await frames(3);
  const enemy = g.enemies[0];
  // Stand next to it and wait for the windup and the strike.
  g.player.x = enemy.x - 0.8;
  g.player.y = enemy.y;
  const startHealth = g.health;
  const states = new Set();
  for (let i = 0; i < 120 && g.health === startHealth; i++) {
    states.add(enemy.state);
    await frames(1);
  }
  return { startHealth, health: g.health, states: [...states], enemyState: enemy.state };
`);

// --- level 3 door --------------------------------------------------------
const door = await inPage(`
  await g.loadLevel(3);
  g.setMode('PLAYING');
  await frames(3);
  const d = g.levelDef.grid.findIndex((r) => r.includes('D'));
  const dx = g.levelDef.grid[d].indexOf('D');
  const before = { level: g.levelIndex, mode: g.mode };
  g.player.x = dx - 0.6;
  g.player.y = d + 0.5;
  g.player.angle = 0;
  g.player.rotate(0);
  const facing = canvas();
  await frames(4);
  return { before, doorAt: { x: dx, y: d }, mode: g.mode, title: document.querySelector('#between-title').textContent, facing };
`);
savePng('12-the-end-door', door.facing);

await browser.close();

console.log(
  JSON.stringify(
    {
      fight: { ...fight, seen: undefined, corpse: undefined },
      miss,
      hurt,
      door: { ...door, facing: undefined },
      problems,
    },
    null,
    2,
  ),
);
if (problems.length > 0) process.exitCode = 1;
