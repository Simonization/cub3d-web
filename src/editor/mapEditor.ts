import { parseCub, serializeCub, validateWalls } from '../format/cub';
import type { Game } from '../main';
import { explainer, Terminal } from './terminal';

const PAINTABLE = new Set(['0', '1', ' ']);
const SPAWNS = new Set(['N', 'S', 'E', 'W']);
const MAX_SIDE = 64;

const PATH_EXPLAINER = `
<p>In the C version a line like <code>NO ./textures/wall_n.xpm</code> is a <em>path</em>.
The <code>./</code> means &ldquo;start looking from the folder I launched the program in&rdquo;.
The operating system walks that path, opens the file, and the program checks it ends in
<code>.xpm</code> and that its first 255 bytes contain the words <code>XPM</code> and
<code>static char</code> before trusting it. Then it decodes the text into pixels.</p>
<p>A browser has no such folder. When you pick a file, the page is handed the <em>bytes</em>
and never the location &mdash; a web page is not allowed to learn where things sit on your
disk. So this game keeps a small dictionary instead: the text <code>./user/north.png</code>
simply stands for the image you gave it, held in your browser.</p>
<p>Same idea either way &mdash; a short name standing in for a pile of pixels. Only the
lookup differs.</p>
`;

export function mountMapEditor(game: Game): void {
  const terminal = new Terminal({
    id: 'map-editor',
    title: 'MAP',
    hint: 'arrows move · 0 1 space paint · NSEW spawn · :w apply · :q cancel',
  });

  const layout = document.createElement('div');
  layout.className = 'map-layout';
  layout.innerHTML = `
    <div class="map-grid-wrap"><div class="map-grid" tabindex="0"></div></div>
    <aside class="map-side">
      <div class="legend">
        <div><b>1</b> wall</div>
        <div><b>0</b> floor</div>
        <div><b>&middot;</b> outside</div>
        <div><b>N S E W</b> you, and which way you face</div>
      </div>
      <div class="lint"></div>
      <div class="explainers"></div>
    </aside>
  `;
  terminal.body.append(layout);

  const gridEl = layout.querySelector<HTMLDivElement>('.map-grid')!;
  const lintEl = layout.querySelector<HTMLDivElement>('.lint')!;
  layout
    .querySelector('.explainers')!
    .append(explainer('How does it read an image path?', PATH_EXPLAINER));

  let rows: string[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let painting: string | null = null;

  const width = (): number => rows.reduce((max, row) => Math.max(max, row.length), 0);

  function setCell(x: number, y: number, ch: string): void {
    if (y < 0 || y >= rows.length || x < 0) return;
    const row = rows[y]!.padEnd(x + 1, ' ');
    if (SPAWNS.has(ch)) {
      rows = rows.map((r) => r.replace(/[NSEW]/g, '0'));
    }
    rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
    render();
  }

  function render(): void {
    const w = Math.max(width(), 1);
    const errors = validateWalls(rows);
    const bad = new Set(errors.map((e) => `${e.col},${e.line}`));

    gridEl.style.setProperty('--cols', String(w));
    gridEl.replaceChildren(
      ...rows.flatMap((row, y) =>
        Array.from({ length: w }, (_, x) => {
          const ch = row[x] ?? ' ';
          const cell = document.createElement('span');
          cell.className = 'cell';
          cell.textContent = ch === ' ' ? '·' : ch;
          cell.dataset.x = String(x);
          cell.dataset.y = String(y);
          if (ch === '1') cell.classList.add('wall');
          else if (SPAWNS.has(ch)) cell.classList.add('spawn');
          else if (ch === ' ') cell.classList.add('void');
          if (bad.has(`${x},${y}`)) cell.classList.add('bad');
          if (x === cursorX && y === cursorY) cell.classList.add('cursor');
          return cell;
        }),
      ),
    );

    lint(errors.length);
  }

  function lint(wallErrors: number): void {
    const draft = draftLevel();
    const parsed = parseCub(draft);
    if (parsed.ok) {
      lintEl.innerHTML = '<p class="ok">Map is valid. <b>:w</b> to drop into it.</p>';
      terminal.setStatus(`${width()}x${rows.length} · valid`, 'ok');
      return;
    }
    const unique = [...new Map(parsed.errors.map((e) => [e.message, e])).values()];
    lintEl.innerHTML =
      `<p class="err">${parsed.errors.length} problem${parsed.errors.length === 1 ? '' : 's'}</p>` +
      unique
        .map((e) => {
          const where = e.line === undefined ? '' : ` <span class="at">row ${e.line + 1}</span>`;
          return `<div class="lint-row">${e.message}${where}</div>`;
        })
        .join('');
    terminal.setStatus(
      `${width()}x${rows.length} · ${wallErrors} open cell${wallErrors === 1 ? '' : 's'}`,
      'error',
    );
  }

  /** The grid the player is editing, wrapped in the level's current header. */
  function draftLevel(): string {
    return serializeCub({ ...game.level, grid: rows });
  }

  function open(): void {
    rows = [...game.level.grid];
    const spawn = game.level.spawn;
    cursorX = spawn.x;
    cursorY = spawn.y;
    terminal.show();
    render();
    gridEl.focus();
  }

  function close(): void {
    terminal.hide();
    game.setMode('PLAYING');
  }

  async function apply(): Promise<void> {
    const parsed = parseCub(draftLevel());
    if (!parsed.ok) {
      terminal.setStatus(`cannot apply: ${parsed.errors[0]!.message}`, 'error');
      return;
    }
    await game.applyLevel(parsed.level);
    close();
  }

  function resize(w: number, h: number): void {
    const cols = Math.min(Math.max(w, 3), MAX_SIDE);
    const height = Math.min(Math.max(h, 3), MAX_SIDE);
    rows = Array.from({ length: height }, (_, y) =>
      Array.from({ length: cols }, (_, x) =>
        y === 0 || y === height - 1 || x === 0 || x === cols - 1 ? '1' : '0',
      ).join(''),
    );
    const midY = height >> 1;
    const midX = cols >> 1;
    rows[midY] = rows[midY]!.slice(0, midX) + 'N' + rows[midY]!.slice(midX + 1);
    cursorX = midX;
    cursorY = midY;
    render();
  }

  function download(): void {
    const blob = new Blob([draftLevel()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'level.cub';
    link.click();
    URL.revokeObjectURL(url);
    terminal.setStatus('saved level.cub — it runs in the C binary too', 'ok');
  }

  function loadFile(): void {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.cub,text/plain';
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      const parsed = parseCub(await file.text());
      if (!parsed.ok) {
        terminal.setStatus(`${file.name}: ${parsed.errors[0]!.message}`, 'error');
        return;
      }
      rows = [...parsed.level.grid];
      cursorX = parsed.level.spawn.x;
      cursorY = parsed.level.spawn.y;
      render();
      terminal.setStatus(`loaded ${file.name}`, 'ok');
    });
    picker.click();
  }

  gridEl.addEventListener('keydown', (event) => {
    const key = event.key;
    const lower = key.toLowerCase();
    const w = width();

    if (key === 'Escape') return void close();
    if (key === ':') {
      event.preventDefault();
      terminal.prompt.focus();
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      void apply();
      return;
    }

    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[key];
    if (move) {
      event.preventDefault();
      cursorX = Math.min(Math.max(cursorX + move[0], 0), Math.max(w - 1, 0));
      cursorY = Math.min(Math.max(cursorY + move[1], 0), rows.length - 1);
      render();
      return;
    }

    if (PAINTABLE.has(key)) {
      event.preventDefault();
      setCell(cursorX, cursorY, key);
      return;
    }
    if (SPAWNS.has(lower.toUpperCase()) && 'nsew'.includes(lower)) {
      event.preventDefault();
      setCell(cursorX, cursorY, lower.toUpperCase());
      return;
    }
    if (key === 'Tab') {
      event.preventDefault();
      const current = rows[cursorY]?.[cursorX] ?? ' ';
      setCell(cursorX, cursorY, current === '1' ? '0' : '1');
    }
  });

  const cellAt = (target: EventTarget | null): HTMLElement | null => {
    const el = target as HTMLElement | null;
    return el?.classList.contains('cell') ? el : null;
  };

  gridEl.addEventListener('pointerdown', (event) => {
    const cell = cellAt(event.target);
    if (!cell) return;
    event.preventDefault();
    gridEl.focus();
    cursorX = Number(cell.dataset.x);
    cursorY = Number(cell.dataset.y);
    const current = rows[cursorY]?.[cursorX] ?? ' ';
    painting = current === '1' ? '0' : '1';
    setCell(cursorX, cursorY, painting);
  });

  gridEl.addEventListener('pointerover', (event) => {
    if (painting === null) return;
    const cell = cellAt(event.target);
    if (!cell) return;
    setCell(Number(cell.dataset.x), Number(cell.dataset.y), painting);
  });

  window.addEventListener('pointerup', () => {
    painting = null;
  });

  terminal.onCommand((command, args) => {
    switch (command) {
      case 'w':
        void apply();
        break;
      case 'q':
        close();
        break;
      case 'new':
        resize(Number(args[0] ?? 20), Number(args[1] ?? 12));
        break;
      case 'save':
        download();
        break;
      case 'load':
        loadFile();
        break;
      case 'help':
        terminal.setStatus(':w apply · :q cancel · :new W H · :load · :save · :help', 'muted');
        break;
      default:
        terminal.setStatus(`unknown command "${command}" — try :help`, 'warn');
    }
    gridEl.focus();
  });

  game.onModeChange((mode) => {
    if (mode === 'MAP_EDITOR') open();
    else if (terminal.visible) terminal.hide();
  });
}
