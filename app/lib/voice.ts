// Read-aloud voice controller.
//
// Primary: Kokoro, a small neural TTS model that runs 100% on-device in a Web
// Worker (WebAssembly / WebGPU). It sounds genuinely human, is completely free,
// and — because it runs in the user's browser — has none of the IP-blocking or
// cost problems of hosted TTS. The weights (~80MB, quantized) download once and
// are cached by the browser thereafter.
//
// Fallback: the browser's built-in Web Speech voice, used if the device can't
// load the model (old browser, no storage, fetch blocked). It's robotic but it
// always works, so read-aloud never simply fails.

// ---------------------------------------------------------------------------
// Loading status (so the UI can show "preparing voice" on first use)
// ---------------------------------------------------------------------------

export type VoiceState = "idle" | "loading" | "ready" | "error";
type StatusListener = (s: { state: VoiceState; progress: number }) => void;

let state: VoiceState = "idle";
let progress = 0;
const listeners = new Set<StatusListener>();

function setStatus(next: VoiceState, p?: number) {
  state = next;
  if (typeof p === "number") progress = p;
  listeners.forEach((cb) => cb({ state, progress }));
}

export function onVoiceStatus(cb: StatusListener): () => void {
  listeners.add(cb);
  cb({ state, progress });
  return () => listeners.delete(cb);
}

// ---------------------------------------------------------------------------
// Kokoro worker
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let kokoroEnabled = true; // flips false permanently if the model can't load
let reqId = 0;
const pending = new Map<
  number,
  { resolve: (url: string | null) => void }
>();
const urlCache = new Map<string, string>(); // text -> object URL
const inflight = new Map<string, Promise<string | null>>();

let audioEl: HTMLAudioElement | null = null;
let token = 0; // bumps on stop / new speak to cancel stale playback

function getAudio(): HTMLAudioElement {
  if (!audioEl) audioEl = new Audio();
  return audioEl;
}

function ensureWorker(): Worker | null {
  if (!kokoroEnabled) return null;
  if (worker) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    kokoroEnabled = false;
    return null;
  }
  try {
    worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url));
  } catch {
    kokoroEnabled = false;
    return null;
  }

  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === "progress") {
      if (state !== "ready") setStatus("loading", Math.round(m.progress));
    } else if (m.type === "ready") {
      setStatus("ready", 100);
    } else if (m.type === "result") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) {
        const blob = new Blob([m.wav], { type: "audio/wav" });
        p.resolve(URL.createObjectURL(blob));
      }
    } else if (m.type === "error") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) p.resolve(null);
    } else if (m.type === "fatal") {
      // The model itself failed to load — give up on Kokoro for this session.
      kokoroEnabled = false;
      setStatus("error");
      pending.forEach((p) => p.resolve(null));
      pending.clear();
    }
  };
  worker.onerror = () => {
    kokoroEnabled = false;
    setStatus("error");
    pending.forEach((p) => p.resolve(null));
    pending.clear();
  };

  // Kick off the model download/init (backend + quantization are fixed in the
  // worker to the combination that produces correct audio).
  setStatus("loading", 0);
  worker.postMessage({ type: "load" });
  return worker;
}

// Start downloading/initialising the model ahead of the first tap.
export function prepareVoice() {
  ensureWorker();
}

function synth(text: string): Promise<string | null> {
  const cached = urlCache.get(text);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(text);
  if (running) return running;

  const w = ensureWorker();
  if (!w) return Promise.resolve(null);

  const id = ++reqId;
  const p = new Promise<string | null>((resolve) => {
    pending.set(id, {
      resolve: (url) => {
        if (url) urlCache.set(text, url);
        inflight.delete(text);
        resolve(url);
      },
    });
    w.postMessage({ type: "generate", id, text });
  });
  inflight.set(text, p);
  return p;
}

// Warm the cache for an upcoming line (e.g. the next cook-mode step).
export function prefetchSpeech(text: string) {
  const t = text.trim();
  if (t && kokoroEnabled) synth(t);
}

export interface SpeakOpts {
  userKey?: string; // accepted for call-site compatibility; unused
  onStart?: () => void;
  onEnd?: () => void;
}

export async function speak(text: string, opts: SpeakOpts = {}): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  stopSpeech();
  const mine = ++token;

  if (kokoroEnabled) {
    const url = await synth(clean);
    if (mine !== token) return; // superseded while generating
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
        if (mine !== token) return;
        // fall through to browser voice
      }
    }
  }

  if (mine !== token) return;
  browserSpeak(clean, opts.onStart, opts.onEnd);
}

export function stopSpeech(): void {
  token++;
  if (audioEl) {
    audioEl.pause();
    audioEl.onended = null;
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

function loadVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) {
    cachedVoices = now;
    return;
  }
  synth.addEventListener(
    "voiceschanged",
    () => {
      cachedVoices = synth.getVoices();
    },
    { once: true }
  );
}
if (typeof window !== "undefined") loadVoices();

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
];

function pickVoice(): SpeechSynthesisVoice | null {
  if (!cachedVoices.length) return null;
  const en = cachedVoices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = en.length ? en : cachedVoices;
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

function browserSpeak(text: string, onStart?: () => void, onEnd?: () => void) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = pickVoice();
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
