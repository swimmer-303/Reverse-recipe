// Helpers for read-aloud. The default Web Speech voice is usually the robotic
// fallback; picking a real system/cloud voice and speaking one line at a time
// (which also dodges Chrome's ~15s utterance cutoff) sounds far more human.

let cached: SpeechSynthesisVoice[] = [];

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve([]);
      return;
    }
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length) {
      cached = now;
      resolve(now);
      return;
    }
    // Voices load asynchronously on first run in most browsers.
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      cached = synth.getVoices();
      synth.removeEventListener("voiceschanged", done);
      resolve(cached);
    };
    synth.addEventListener("voiceschanged", done);
    setTimeout(done, 600);
  });
}

// Ranked name fragments, most natural first. Covers the good voices shipped on
// iOS/macOS (Samantha, Ava…), Windows (Aria/Jenny neural) and Chrome (Google).
const PREFERRED = [
  "samantha",
  "ava",
  "allison",
  "susan",
  "google us english",
  "microsoft aria",
  "microsoft jenny",
  "microsoft guy",
  "natural",
  "neural",
  "enhanced",
  "premium",
  "google uk english female",
];

export function pickVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
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

function tune(u: SpeechSynthesisUtterance, voice: SpeechSynthesisVoice | null) {
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  // Just under conversational pace with a hair of warmth reads well aloud.
  u.rate = 1.0;
  u.pitch = 1.05;
  u.volume = 1;
}

// Speak several short lines in sequence. Each queues as its own utterance so a
// long recipe never trips the mid-sentence cutoff, and there's a natural beat
// between lines.
export function speakLines(
  lines: string[],
  voice: SpeechSynthesisVoice | null,
  opts: { onStart?: () => void; onEnd?: () => void } = {}
) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  clean.forEach((line, i) => {
    const u = new SpeechSynthesisUtterance(line);
    tune(u, voice);
    if (i === 0 && opts.onStart) u.onstart = opts.onStart;
    if (i === clean.length - 1 && opts.onEnd) u.onend = opts.onEnd;
    synth.speak(u);
  });
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
