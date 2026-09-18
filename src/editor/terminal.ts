/** Shared chrome for the M and C screens: a full-screen fake terminal. */

export interface TerminalOptions {
  id: string;
  title: string;
  hint: string;
}

export class Terminal {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly status: HTMLDivElement;
  readonly prompt: HTMLInputElement;

  constructor(options: TerminalOptions) {
    this.root = document.createElement('div');
    this.root.className = 'terminal';
    this.root.id = options.id;
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="terminal-frame">
        <header>
          <span class="dot"></span>
          <span class="title">${options.title}</span>
          <span class="hint">${options.hint}</span>
        </header>
        <div class="terminal-body"></div>
        <div class="terminal-status"></div>
        <label class="terminal-prompt">
          <span>&gt;</span>
          <input type="text" spellcheck="false" autocomplete="off" autocapitalize="off" />
        </label>
      </div>
      <div class="scanlines" aria-hidden="true"></div>
    `;
    this.body = this.root.querySelector('.terminal-body')!;
    this.status = this.root.querySelector('.terminal-status')!;
    this.prompt = this.root.querySelector('input')!;
    document.querySelector('#stage')!.append(this.root);
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.prompt.value = '';
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  setStatus(text: string, tone: 'ok' | 'warn' | 'error' | 'muted' = 'muted'): void {
    this.status.textContent = text;
    this.status.dataset.tone = tone;
  }

  onCommand(handler: (command: string, args: string[]) => void): void {
    this.prompt.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key !== 'Enter') return;
      const raw = this.prompt.value.trim().replace(/^:/, '');
      this.prompt.value = '';
      if (raw.length === 0) return;
      const [command, ...args] = raw.split(/\s+/);
      handler(command!.toLowerCase(), args);
    });
  }
}

/** A collapsible plain-English explainer, used by both screens. */
export function explainer(title: string, html: string): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'explainer';
  details.innerHTML = `<summary>${title}</summary><div>${html}</div>`;
  return details;
}
