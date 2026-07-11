"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  speak,
  stopSpeech,
  prefetchSpeech,
  prepareVoice,
  onVoiceStatus,
  type VoiceState,
} from "../lib/voice";

// ---- Minimal typing for the Web Speech recognition API (no lib.dom types) ----
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  0: SRAlternative;
  isFinal: boolean;
}
interface SRResultList {
  length: number;
  [index: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRCtor;
    webkitSpeechRecognition?: SRCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Command = "next" | "prev" | "repeat" | "first" | "exit";

// Map a spoken phrase to a step action. Checked in an order that avoids
// overlaps ("go back" vs "go on").
function classify(raw: string): Command | null {
  const p = ` ${raw.toLowerCase().trim()} `;
  const has = (...w: string[]) => w.some((x) => p.includes(` ${x} `) || p.includes(x));
  if (has("go back", "back", "previous", "last step", "step back", "before"))
    return "prev";
  if (has("repeat", "again", "say that again", "read again", "one more time", "what was that"))
    return "repeat";
  if (has("start over", "first step", "from the top", "restart", "beginning"))
    return "first";
  if (has("exit", "close", "stop cooking", "i'm done", "im done", "finish", "quit", "all done"))
    return "exit";
  if (has("next", "forward", "continue", "go on", "keep going", "ready", "onward", "next step"))
    return "next";
  return null;
}

export default function CookMode({
  steps,
  dishName,
  userKey,
  onExit,
}: {
  steps: string[];
  dishName: string;
  userKey?: string;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);
  const [micError, setMicError] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceProgress, setVoiceProgress] = useState(0);

  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const listenRef = useRef(false); // whether the user wants the mic on
  const speakingRef = useRef(false); // ignore mic input while we talk to it
  const total = steps.length;

  const speakStep = useCallback(
    (i: number) => {
      speakingRef.current = true;
      setSpeaking(true);
      speak(`Step ${i + 1}. ${steps[i]}`, {
        userKey,
        onEnd: () => {
          speakingRef.current = false;
          setSpeaking(false);
        },
      });
      // Warm the next step's audio so it plays without a pause.
      if (i + 1 < steps.length) {
        prefetchSpeech(`Step ${i + 2}. ${steps[i + 1]}`);
      }
    },
    [steps, userKey]
  );

  // Detect support up front and start warming the neural voice.
  useEffect(() => {
    setSupported(!!getRecognitionCtor());
    prepareVoice();
    return onVoiceStatus((s) => {
      setVoiceState(s.state);
      setVoiceProgress(s.progress);
    });
  }, []);

  // Speak each step as it becomes active.
  useEffect(() => {
    speakStep(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(i + 1, total - 1));
  }, [total]);
  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);
  const goFirst = useCallback(() => setIndex(0), []);
  const repeat = useCallback(() => {
    // Re-run speech for the current step without changing index.
    setIndex((i) => {
      speakStep(i);
      return i;
    });
  }, [speakStep]);

  const exit = useCallback(() => {
    listenRef.current = false;
    if (recogRef.current) {
      try {
        recogRef.current.abort();
      } catch {}
    }
    stopSpeech();
    onExit();
  }, [onExit]);

  const runCommand = useCallback(
    (cmd: Command) => {
      if (cmd === "next") goNext();
      else if (cmd === "prev") goPrev();
      else if (cmd === "first") goFirst();
      else if (cmd === "repeat") repeat();
      else if (cmd === "exit") exit();
    },
    [goNext, goPrev, goFirst, repeat, exit]
  );

  const startListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const recog = new Ctor();
    recog.lang = "en-US";
    recog.continuous = true;
    recog.interimResults = false;
    recog.maxAlternatives = 1;

    recog.onresult = (e) => {
      // Ignore anything picked up while we're reading a step aloud.
      if (speakingRef.current) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res.isFinal) continue;
        const phrase = res[0].transcript.trim();
        if (!phrase) continue;
        setHeard(phrase);
        const cmd = classify(phrase);
        if (cmd) runCommand(cmd);
      }
    };
    recog.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setMicError("Microphone blocked. Allow mic access to use voice commands.");
        listenRef.current = false;
        setListening(false);
      }
      // "no-speech"/"aborted" just end the session; onend restarts if wanted.
    };
    recog.onend = () => {
      // The engine stops itself periodically; restart while the user wants it.
      if (listenRef.current) {
        try {
          recog.start();
        } catch {}
      } else {
        setListening(false);
      }
    };

    recogRef.current = recog;
    listenRef.current = true;
    setMicError("");
    try {
      recog.start();
      setListening(true);
    } catch {
      // start() throws if called twice; treat as already-on.
      setListening(true);
    }
  }, [runCommand]);

  const stopListening = useCallback(() => {
    listenRef.current = false;
    setListening(false);
    if (recogRef.current) {
      try {
        recogRef.current.stop();
      } catch {}
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, stopListening, startListening]);

  // Keyboard support (arrows) for testing and accessibility.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, exit]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      listenRef.current = false;
      if (recogRef.current) {
        try {
          recogRef.current.abort();
        } catch {}
      }
      stopSpeech();
    };
  }, []);

  const isLast = index === total - 1;

  return (
    <div className="cook" role="group" aria-label="Cook mode">
      <div className="cook-head">
        <button className="head-btn" aria-label="Exit cook mode" onClick={exit}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="cook-dish">{dishName}</div>
        <button
          className={`head-btn ${listening ? "accent live" : ""}`}
          aria-label={listening ? "Turn off voice commands" : "Turn on voice commands"}
          aria-pressed={listening}
          onClick={toggleListening}
          disabled={!supported}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10a7 7 0 0 1-14 0M12 17v4" />
          </svg>
        </button>
      </div>

      <div className="cook-progress">
        {steps.map((_, i) => (
          <span
            key={i}
            className={`cook-tick ${i === index ? "on" : ""} ${
              i < index ? "done" : ""
            }`}
          />
        ))}
      </div>

      <div className="cook-count">
        Step {index + 1} <span>of {total}</span>
      </div>

      <div key={index} className="cook-card">
        <p className="cook-step">{steps[index]}</p>
      </div>

      <div className="cook-mic-row" data-active={listening}>
        {speaking && voiceState === "loading" ? (
          <span className="cook-hint">
            <span className="cook-eq">
              <i />
              <i />
              <i />
            </span>
            Preparing the natural voice… {voiceProgress}%
          </span>
        ) : !supported ? (
          <span className="cook-hint muted">
            Voice commands aren&apos;t supported in this browser — use the buttons.
          </span>
        ) : micError ? (
          <span className="cook-hint muted">{micError}</span>
        ) : listening ? (
          <span className="cook-hint">
            <span className="cook-eq">
              <i />
              <i />
              <i />
            </span>
            {speaking
              ? "Reading the step…"
              : heard
                ? `Heard: “${heard}”`
                : "Listening — say “next step” or “go back”"}
          </span>
        ) : (
          <span className="cook-hint muted">
            Tap the mic to go hands-free — say “next step” or “go back”.
          </span>
        )}
      </div>

      <div className="cook-controls">
        <button
          className="cook-nav"
          onClick={goPrev}
          disabled={index === 0}
          aria-label="Previous step"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <button className="cook-repeat" onClick={repeat} aria-label="Repeat step">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 5 6 9H2v6h4l5 4z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
          </svg>
          Repeat
        </button>

        {isLast ? (
          <button className="cook-nav done-btn" onClick={exit} aria-label="Finish">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>
        ) : (
          <button className="cook-nav" onClick={goNext} aria-label="Next step">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
