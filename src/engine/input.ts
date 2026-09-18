export interface Intent {
  forward: number;
  strafe: number;
  turn: number;
  run: boolean;
  fire: boolean;
}

const STICK_RADIUS = 56;
const TOUCH_LOOK_SENSITIVITY = 0.0055;
const MOUSE_SENSITIVITY = 0.0022;

interface Stick {
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

/**
 * Keyboard, pointer-lock mouse and touch, reduced to one intent per frame.
 * Look deltas accumulate between frames and are drained by consumeLook().
 */
export class Input {
  private readonly keys = new Set<string>();
  private stick: Stick | null = null;
  private lookPointer: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private lastLookX = 0;
  private lastLookY = 0;
  private touchFiring = false;

  /** While false, movement keys are ignored — used when an editor overlay is up. */
  enabled = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onCommand: (key: string) => void,
  ) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.releaseAll);
    canvas.addEventListener('mousemove', this.handleMouseMove);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestPointerLock(): void {
    if (this.pointerLocked) return;
    // Rejects when there is no user gesture behind the call, and on browsers that
    // simply refuse; play continues either way, just without mouse look.
    void Promise.resolve(this.canvas.requestPointerLock()).catch(() => {});
  }

  exitPointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (!this.enabled) {
      this.onCommand(key);
      return;
    }
    this.keys.add(key);
    if (['m', 'c', 'escape', 'p', 'r'].includes(key)) {
      event.preventDefault();
      this.onCommand(key);
    }
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      event.preventDefault();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private releaseAll = (): void => {
    this.keys.clear();
    this.stick = null;
    this.lookPointer = null;
    this.touchFiring = false;
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked || !this.enabled) return;
    this.lookX += event.movementX * MOUSE_SENSITIVITY;
    this.lookY += event.movementY;
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || !this.enabled) return;
    const rect = this.canvas.getBoundingClientRect();
    if (event.clientX - rect.left < rect.width / 2) {
      if (this.stick) return;
      this.stick = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        x: 0,
        y: 0,
      };
    } else {
      if (this.lookPointer !== null) return;
      this.lookPointer = event.pointerId;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
    }
    this.canvas.setPointerCapture(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || !this.enabled) return;
    if (this.stick?.pointerId === event.pointerId) {
      const dx = event.clientX - this.stick.originX;
      const dy = event.clientY - this.stick.originY;
      const distance = Math.hypot(dx, dy) || 1;
      const scale = Math.min(1, distance / STICK_RADIUS) / distance;
      this.stick.x = dx * scale;
      this.stick.y = dy * scale;
    } else if (this.lookPointer === event.pointerId) {
      this.lookX += (event.clientX - this.lastLookX) * TOUCH_LOOK_SENSITIVITY;
      this.lookY += event.clientY - this.lastLookY;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
    }
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.stick?.pointerId === event.pointerId) this.stick = null;
    if (this.lookPointer === event.pointerId) this.lookPointer = null;
  };

  setTouchFiring(firing: boolean): void {
    this.touchFiring = firing;
  }

  /** Drains the accumulated look delta: yaw in radians, pitch in screen pixels. */
  consumeLook(): { yaw: number; pitch: number } {
    const yaw = this.lookX;
    const pitch = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return { yaw, pitch };
  }

  readIntent(): Intent {
    if (!this.enabled) return { forward: 0, strafe: 0, turn: 0, run: false, fire: false };
    const held = (...names: string[]): number => (names.some((n) => this.keys.has(n)) ? 1 : 0);

    let forward = held('w', 'z') - held('s');
    let strafe = held('a', 'q') - held('d');
    if (this.stick) {
      forward -= this.stick.y;
      strafe -= this.stick.x;
    }

    return {
      forward: Math.min(Math.max(forward, -1), 1),
      strafe: Math.min(Math.max(strafe, -1), 1),
      turn: held('arrowleft') - held('arrowright'),
      run: this.keys.has('shift'),
      fire: this.touchFiring || this.keys.has(' '),
    };
  }
}
