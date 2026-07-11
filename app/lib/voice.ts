// On-device read-aloud via the browser's Web Speech API. It's free and works
// everywhere, but the voice quality is capped by whatever the device ships —
// we pick the most natural installed voice and speak a line at a time (each
// queues separately, which dodges Chrome's ~15s mid-utterance cutoff).

export interface SpeakOpts {
  // Accepted for call-site compatibility; unused by the on-device voice.
  userKey?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

let cachedVoices: SpeechSynthesisVoice[] = [];

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve([]);
      return;
    }
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length) {
      cachedVoices = now;
      resolve(now);
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      cachedVoices = synth.getVoices();
      synth.removeEventListener("voiceschanged", done);
      resolve(cachedVoices);
    };
    synth.addEventListener("voiceschanged", done);
    setTimeout(done, 600);
  });
}

const PREFERRED = [
  "samantha",
  "ava",
  "allison",
  "google us english",
  "microsoft aria",
  "microsoft jenny",
  "natural",
  "neural",
  "enhanced",
  "premium",
];

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = en.length ? en : voices;
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const v of pool) {
    const name = v.name.toLowerCase();
    let score = 0;
    PREFERRED.forEach((frag, i) => {
      if (name.includes(frag)) score = Math.max(score, PREFERRED.length - i);
    });
    if (v.lang?.toLowerCase() === "en-us") score += 0.6;
    if (v.localService) score += 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best ?? pool[0];
}

// Warm the voice list on first import so the first read is ready.
if (typeof window !== "undefined") {
  loadVoices();
}

// No-op: the on-device voice needs no pre-fetching. Kept so callers (cook mode)
// don't need to branch.
export function prefetchSpeech(_text: string, _userKey?: string) {}

export function speak(text: string, opts: SpeakOpts = {}): void {
  const clean = text.trim();
  if (!clean || typeof window === "undefined" || !window.speechSynthesis) {
    opts.onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = pickVoice(cachedVoices);
  // Sentence-sized chunks: each queues separately so a long read doesn't trip
  // Chrome's mid-utterance cutoff.
  const lines = clean
    .split(/(?<=[.!?])\s+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const chunks = lines.length ? lines : [clean];
  chunks.forEach((line, i) => {
    const u = new SpeechSynthesisUtterance(line);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = 1.0;
    u.pitch = 1.05;
    if (i === 0 && opts.onStart) u.onstart = opts.onStart;
    if (i === chunks.length - 1 && opts.onEnd) u.onend = opts.onEnd;
    synth.speak(u);
  });
}

export function stopSpeech(): void {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
