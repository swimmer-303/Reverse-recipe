// Client-side speech controller. It prefers Gemini's neural voice (fetched from
// /api/speak and played as real audio), which sounds like a person — and only
// falls back to the browser's built-in Web Speech voice if that call fails
// (offline, no key, rate limited). The browser voice is the safety net, not the
// default, because on most devices it sounds robotic no matter how it's tuned.

// ---------------------------------------------------------------------------
// Gemini neural audio (primary)
// ---------------------------------------------------------------------------

let audioEl: HTMLAudioElement | null = null;
const urlCache = new Map<string, string>(); // text -> object URL
const inflight = new Map<string, Promise<string | null>>();
let token = 0; // bumps on every stop/new speak to cancel stale playback

function getAudio(): HTMLAudioElement {
  if (!audioEl) audioEl = new Audio();
  return audioEl;
}

async function fetchAudioUrl(
  text: string,
  userKey?: string
): Promise<string | null> {
  const cached = urlCache.get(text);
  if (cached) return cached;
  const pending = inflight.get(text);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, userKey: userKey || undefined }),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.size) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(text, url);
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(text);
    }
  })();

  inflight.set(text, p);
  return p;
}

// Warm the cache so the next step is ready to play instantly.
export function prefetchSpeech(text: string, userKey?: string) {
  const t = text.trim();
  if (t) fetchAudioUrl(t, userKey);
}

export interface SpeakOpts {
  userKey?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

// Speak a block of text. Resolves when playback finishes (or falls back).
export async function speak(text: string, opts: SpeakOpts = {}): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  stopSpeech();
  const mine = ++token;

  const url = await fetchAudioUrl(clean, opts.userKey);
  if (mine !== token) return; // superseded while fetching

  if (url) {
    const el = getAudio();
    el.src = url;
    el.onended = () => {
      if (mine === token) opts.onEnd?.();
    };
    opts.onStart?.();
    try {
      await el.play();
      return;
    } catch {
      // Autoplay blocked or decode failed — fall through to the browser voice.
      if (mine !== token) return;
    }
  }

  // Fallback: on-device speech synthesis.
  if (mine !== token) return;
  browserSpeak(clean, opts.onStart, opts.onEnd);
}

export function stopSpeech() {
  token++;
  if (audioEl) {
    audioEl.pause();
    audioEl.onended = null;
    // Detach the source so a paused clip can't resume on its own.
    audioEl.removeAttribute("src");
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// ---------------------------------------------------------------------------
// Browser Web Speech fallback
// ---------------------------------------------------------------------------

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

// Warm the voice list on first import so the fallback is ready if needed.
if (typeof window !== "undefined") {
  loadVoices();
}

function browserSpeak(
  text: string,
  onStart?: () => void,
  onEnd?: () => void
) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = pickVoice(cachedVoices);
  // Split into sentence-sized chunks: each queues separately, which keeps a
  // long read from tripping Chrome's mid-utterance cutoff.
  const lines = text
    .split(/(?<=[.!?])\s+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const chunks = lines.length ? lines : [text];
  chunks.forEach((line, i) => {
    const u = new SpeechSynthesisUtterance(line);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = 1.0;
    u.pitch = 1.05;
    if (i === 0 && onStart) u.onstart = onStart;
    if (i === chunks.length - 1 && onEnd) u.onend = onEnd;
    synth.speak(u);
  });
}
