// Every sound is synthesised with the Web Audio API: there are no audio files.
let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem("hearts.muted") === "1";
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem("hearts.muted", value ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

function audio(): AudioContext | null {
  if (muted || typeof window === "undefined" || !("AudioContext" in window)) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBurst(duration: number, freq: number, gain: number, delay = 0) {
  const a = audio();
  if (!a) return;
  const length = Math.max(1, Math.floor(a.sampleRate * duration));
  const buffer = a.createBuffer(1, length, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 0.9;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(a.currentTime + delay);
}

function tone(freq: number, duration: number, gain: number, delay = 0, type: OscillatorType = "sine") {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = a.currentTime + delay;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export const sfx = {
  card: () => noiseBurst(0.07, 2400, 0.55),
  deal: (count = 13) => {
    for (let i = 0; i < count; i++) noiseBurst(0.045, 2800, 0.22, i * 0.04);
  },
  collect: () => {
    noiseBurst(0.22, 900, 0.35);
    noiseBurst(0.18, 1400, 0.2, 0.05);
  },
  heartsBroken: () => {
    tone(784, 0.5, 0.12, 0, "triangle");
    tone(1046, 0.6, 0.09, 0.08, "triangle");
  },
  queen: () => {
    tone(110, 0.7, 0.16, 0, "sawtooth");
    tone(82, 0.9, 0.18, 0.05, "sine");
  },
  turn: () => tone(660, 0.14, 0.07, 0, "sine"),
  select: () => tone(520, 0.06, 0.05, 0, "triangle"),
  error: () => tone(180, 0.18, 0.08, 0, "square"),
  moon: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.5, 0.09, i * 0.09, "triangle")),
  win: () => [392, 523, 659, 784].forEach((f, i) => tone(f, 0.7, 0.1, i * 0.14, "triangle")),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.6, 0.08, i * 0.18, "sine"))
};
