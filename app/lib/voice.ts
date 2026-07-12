// Read-aloud voice controller.
//
// Primary: Kokoro, a small neural TTS model that runs 100% on-device in a Web
// Worker (WebAssembly). It sounds genuinely human, is completely free, and —
// because it runs in the user's browser — has none of the IP-blocking or cost
// problems of hosted TTS. The weights (~80MB, quantized) download once and are
// cached by the browser thereafter.
//
// Fallback: the browser's built-in Web Speech voice, used if the device can't
// load the model (old browser, no storage, fetch blocked). It's robotic but it
// always works, so read-aloud never simply fails.
//
// Long text is spoken as a queue of short chunks: chunk 1 starts playing while
// chunk 2 is still being synthesised. On the WASM backend a whole recipe takes
// many seconds to synthesise in one go, so chunking is the difference between
// audio starting in ~1s and starting in ~20s.

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
// Chunking
// ---------------------------------------------------------------------------

const MAX_CHUNK = 180; // characters — roughly 10s of speech

// Break text into speakable chunks on sentence boundaries, then on commas if a
// sentence is still very long. Short fragments are merged back together so we
// don't stutter between "Step 4." and its body.
function chunkText(text: string): string[] {
  const raw = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // "Step 4." parses as its own sentence. Glue such a label onto the sentence
  // it introduces, or greedy packing strands it at the end of the previous
  // chunk and the voice reads "...until golden. Step 4." then pauses.
  const sentences: string[] = [];
  for (const s of raw) {
    const prev = sentences[sentences.length - 1];
    if (prev && /^step\s+\d+\s*[.:]?$/i.test(prev)) {
      sentences[sentences.length - 1] = `${prev} ${s}`;
    } else {
      sentences.push(s);
    }
  }

  const parts: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CHUNK) {
      parts.push(sentence);
      continue;
    }
    // Too long for one breath — split on commas, packing greedily.
    let buf = "";
    for (const piece of sentence.split(/,\s*/)) {
      const next = buf ? `${buf}, ${piece}` : piece;
      if (next.length > MAX_CHUNK && buf) {
        parts.push(buf);
        buf = piece;
      } else {
        buf = next;
      }
    }
    if (buf) parts.push(buf);
  }

  // Merge runs that are shorter than a breath ("Step 4." + the instruction).
  const merged: string[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.length + part.length + 1 <= MAX_CHUNK) {
      merged[merged.length - 1] = `${last} ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged.length ? merged : [text];
}

// ---------------------------------------------------------------------------
// Kokoro worker
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let kokoroEnabled = true; // flips false permanently if the model can't load
let reqId = 0;
const pending = new Map<number, { resolve: (url: string | null) => void }>();
const inflight = new Map<string, Promise<string | null>>();

// text -> object URL. Bounded, because every entry holds a decoded WAV in
// memory; oldest entries are revoked when we go over.
const urlCache = new Map<string, string>();
const CACHE_LIMIT = 48;

function cachePut(text: string, url: string) {
  urlCache.set(text, url);
  while (urlCache.size > CACHE_LIMIT) {
    const oldest = urlCache.keys().next().value;
    if (oldest === undefined) break;
    const stale = urlCache.get(oldest);
    urlCache.delete(oldest);
    if (stale) URL.revokeObjectURL(stale);
  }
}

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
        if (url) cachePut(text, url);
        inflight.delete(text);
        resolve(url);
      },
    });
    w.postMessage({ type: "generate", id, text });
  });
  inflight.set(text, p);
  return p;
}

// Warm the cache for an upcoming line (e.g. the next cook-mode step). Only the
// first chunk is urgent — that's what determines how fast playback starts.
export function prefetchSpeech(text: string) {
  const t = text.trim();
  if (!t || !kokoroEnabled) return;
  const chunks = chunkText(t);
  if (chunks[0]) synth(chunks[0]);
}

export interface SpeakOpts {
  onStart?: () => void;
  onEnd?: () => void;
}

// Resolves the in-flight chunk when stopSpeech() cuts playback short, so the
// speak() loop below never sits awaiting an <audio> event that will never fire.
let cancelPlay: ((finished: boolean) => void) | null = null;

function playUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = getAudio();
    const done = (finished: boolean) => {
      if (cancelPlay === done) cancelPlay = null;
      el.onended = null;
      el.onerror = null;
      resolve(finished);
    };
    cancelPlay = done;
    el.src = url;
    el.onended = () => done(true);
    el.onerror = () => done(false);
    el.play().catch(() => done(false));
  });
}

export async function speak(text: string, opts: SpeakOpts = {}): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  stopSpeech();
  const mine = ++token;

  if (kokoroEnabled) {
    const chunks = chunkText(clean);
    // Kick off the first two so playback can start as soon as chunk 1 lands.
    const queue: Array<Promise<string | null>> = [synth(chunks[0])];
    if (chunks[1]) queue.push(synth(chunks[1]));

    let started = false;
    for (let i = 0; i < chunks.length; i++) {
      const url = await (queue[i] ?? synth(chunks[i]));
      if (mine !== token) return; // superseded while generating
      if (!url) break; // synthesis failed — drop to the browser voice

      // Stay one chunk ahead of playback.
      if (chunks[i + 2] && !queue[i + 2]) queue[i + 2] = synth(chunks[i + 2]);
      else if (chunks[i + 1] && !queue[i + 1]) queue[i + 1] = synth(chunks[i + 1]);

      if (!started) {
        started = true;
        opts.onStart?.();
      }
      const ok = await playUrl(url);
      if (mine !== token) return;
      if (!ok) break;

      if (i === chunks.length - 1) {
        opts.onEnd?.();
        return;
      }
    }

    if (mine !== token) return;
    if (started) {
      // Playback began but a later chunk failed. Bailing to the robotic voice
      // mid-sentence would be worse than just stopping cleanly.
      opts.onEnd?.();
      return;
    }
  }

  if (mine !== token) return;
  browserSpeak(clean, opts.onStart, opts.onEnd);
}

export function stopSpeech(): void {
  token++;
  cancelPlay?.(false);
  if (audioEl) {
    audioEl.pause();
    audioEl.onended = null;
    audioEl.onerror = null;
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
  // Chunking also dodges Chrome's ~15s cutoff on a single utterance.
  const chunks = chunkText(text);
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
