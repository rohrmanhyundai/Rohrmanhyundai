// Notification sounds.
//
// The chat blip is one soft falling tone. A message sent straight to you is a
// different kind of event, so it gets a different sound rather than a louder
// version of the same one: three strikes of a bell, bright enough to carry over
// a shop and distinct enough that people learn what it means without looking.
//
// Synthesised rather than shipped as an audio file — no asset to load, nothing
// to go missing, and it works the moment the page does.

const DINGS = 3;
const SPACING = 0.42;    // seconds between strikes — a bell, not a buzzer
const RING = 1.1;        // how long each strike rings out

// A struck bell isn't one frequency: the partials above the fundamental are what
// make it read as a bell rather than a beep. These are quieter and shorter-lived
// than the fundamental, which is what gives the metallic "ding" and its fade.
const PARTIALS = [
  { ratio: 1,    gain: 0.50, decay: 1.00 },
  { ratio: 2,    gain: 0.22, decay: 0.55 },
  { ratio: 2.76, gain: 0.14, decay: 0.35 },  // inharmonic — the bell character
  { ratio: 5.4,  gain: 0.05, decay: 0.16 },  // brief strike transient
];

const FUNDAMENTAL = 1046.5;   // C6 — sits above engine and compressor noise

function strike(ctx, at, master) {
  for (const p of PARTIALS) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(FUNDAMENTAL * p.ratio, at);
    // Fast attack, exponential fade: the shape of something struck.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(p.gain, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + RING * p.decay);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + RING * p.decay + 0.02);
  }
}

// Three dings for a new message in the floating messenger.
export function playMessageBell() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.55;      // a step above the chat blip, short of startling
    master.connect(ctx.destination);

    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < DINGS; i++) strike(ctx, t0 + i * SPACING, master);

    // Close the context once the last strike has rung out, or the browser keeps
    // an audio thread alive for every message that ever arrived.
    const total = (DINGS - 1) * SPACING + RING + 0.1;
    setTimeout(() => { try { ctx.close(); } catch { /* already closed */ } }, total * 1000);
  } catch { /* no audio on this device, or blocked until first interaction */ }
}

// Exposed for tests and for anyone tuning the sound later.
export const BELL_SHAPE = { DINGS, SPACING, RING, FUNDAMENTAL, PARTIALS };
