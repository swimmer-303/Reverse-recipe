"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Analysis } from "./api/analyze/gemini";
import Result from "./components/Result";

// Downscale + re-encode in the browser so uploads stay small and fast, and
// so a 12MP phone photo never trips the server's size ceiling.
async function prepareImage(
  file: File
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Couldn't load that image."));
    el.src = dataUrl;
  });

  const MAX = 1280;
  let { width, height } = img;
  if (width > MAX || height > MAX) {
    const scale = MAX / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser blocked the image resize.");
  ctx.drawImage(img, 0, 0, width, height);

  const out = canvas.toDataURL("image/jpeg", 0.85);
  return {
    base64: out.split(",")[1],
    mimeType: "image/jpeg",
    previewUrl: out,
  };
}

type Phase = "idle" | "ready" | "loading" | "done" | "needkey" | "error";

// Cycled through while the model works, so the wait feels less like a stall.
const COOKING_LINES = [
  "Looking at your photo",
  "Identifying the dish",
  "Measuring the ingredients",
  "Doing the calorie math",
  "Writing up the steps",
  "Plating your recipe",
];

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [payload, setPayload] = useState<{
    base64: string;
    mimeType: string;
  } | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [userKey, setUserKey] = useState("");
  const [savedKey, setSavedKey] = useState<string>("");
  const [keyReason, setKeyReason] = useState<"limit" | "missing">("limit");
  const [loadingLine, setLoadingLine] = useState(0);
  const [wakeActive, setWakeActive] = useState(false);

  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  // Advance the loading copy every second or so, but stop at the last line so
  // it doesn't loop forever on a slow request.
  useEffect(() => {
    if (phase !== "loading") {
      setLoadingLine(0);
      return;
    }
    const id = setInterval(() => {
      setLoadingLine((n) => Math.min(n + 1, COOKING_LINES.length - 1));
    }, 1200);
    return () => clearInterval(id);
  }, [phase]);

  // Keep the screen awake on the results view so it doesn't dim mid-cook.
  useEffect(() => {
    type WakeSentinel = { released: boolean; release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<WakeSentinel> };
    };
    if (phase !== "done" || !nav.wakeLock) {
      setWakeActive(false);
      return;
    }
    let sentinel: WakeSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        sentinel = await nav.wakeLock!.request("screen");
        if (cancelled) {
          sentinel.release();
          return;
        }
        setWakeActive(true);
      } catch {
        setWakeActive(false);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      setWakeActive(false);
      if (sentinel && !sentinel.released) sentinel.release().catch(() => {});
    };
  }, [phase]);

  const stopSpeech = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That's not an image. Try a JPG or PNG of your meal.");
      setPhase("error");
      return;
    }
    try {
      const prepped = await prepareImage(file);
      setPreview(prepped.previewUrl);
      setPayload({ base64: prepped.base64, mimeType: prepped.mimeType });
      setResult(null);
      setError("");
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't use that photo.");
      setPhase("error");
    }
  }, []);

  const analyze = useCallback(
    async (keyOverride?: string) => {
      if (!payload) return;
      setPhase("loading");
      setError("");
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: payload.base64,
            mimeType: payload.mimeType,
            userKey: (keyOverride ?? savedKey) || undefined,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          if (data.code === "RATE_LIMIT" && data.error === "limit") {
            setKeyReason("limit");
            setPhase("needkey");
            return;
          }
          if (data.code === "NO_KEY") {
            setKeyReason("missing");
            setPhase("needkey");
            return;
          }
          setError(data.error || "Something went wrong.");
          setPhase("error");
          return;
        }

        setResult(data.analysis);
        setPhase("done");
      } catch {
        setError("Couldn't reach the kitchen. Check your connection and retry.");
        setPhase("error");
      }
    },
    [payload, savedKey]
  );

  const useOwnKey = useCallback(() => {
    const k = userKey.trim();
    if (!k) return;
    setSavedKey(k);
    analyze(k);
  }, [userKey, analyze]);

  const reset = useCallback(() => {
    stopSpeech();
    setPhase("idle");
    setPreview(null);
    setPayload(null);
    setResult(null);
    setError("");
  }, [stopSpeech]);

  const readAloud = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis || !result) {
      return;
    }
    const s = window.speechSynthesis;
    if (s.speaking) {
      s.cancel();
      return;
    }
    const script =
      `${result.dishName}. ` +
      result.steps.map((t, i) => `Step ${i + 1}. ${t}`).join(" ");
    const u = new SpeechSynthesisUtterance(script);
    u.rate = 0.96;
    s.cancel();
    s.speak(u);
  }, [result]);

  const isResults = phase === "done";

  return (
    <div className="app">
      <div className="col">
        <header className="site-head">
          <div className="brand">
            {isResults && (
              <button className="head-btn" aria-label="Back" onClick={reset}>
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
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}
            <span className="brand-mark">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 11a9 9 0 0 1 18 0" />
                <path d="M2 11h20" />
                <path d="M7 11V9M12 11V8M17 11V9" />
                <path d="M6 17h12l-1 3H7z" />
              </svg>
            </span>
            <span className="brand-name">Reverse Recipe</span>
          </div>

          {isResults && (
            <div className="head-actions">
              <button
                className="head-btn accent"
                aria-label="Read steps aloud"
                onClick={readAloud}
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
                  <path d="M11 5 6 9H2v6h4l5 4z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
                </svg>
              </button>
              <button
                className="head-btn"
                aria-label="Save recipe"
                onClick={() => window.print()}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <path d="M17 21v-8H7v8M7 3v5h8" />
                </svg>
              </button>
            </div>
          )}
        </header>

        {/* hidden inputs: camera (capture) + library */}
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <input
          ref={libraryInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {/* ===== EMPTY / DROPZONE ===== */}
        {phase === "idle" && (
          <main className="screen empty">
            <div className="empty-intro">
              <h1 className="empty-title">What did you cook?</h1>
              <p className="empty-sub">
                Snap or upload a photo of any meal and get the whole recipe back
                — ingredients, nutrition and steps.
              </p>
            </div>
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => libraryInput.current?.click()}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") &&
                libraryInput.current?.click()
              }
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFile(e.dataTransfer.files?.[0]);
              }}
            >
              <div className="drop-badge">
                <svg
                  width="27"
                  height="27"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 16V4" />
                  <path d="M8 8l4-4 4 4" />
                  <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
              </div>
              <div className="drop-title">Drop a photo here</div>
              <div className="drop-sub">or tap to choose from your library</div>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => cameraInput.current?.click()}
            >
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
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Take a photo
            </button>
            <div className="empty-foot">
              Works best with a clear, well-lit shot of the plate.
            </div>
          </main>
        )}

        {/* ===== PREVIEW ===== */}
        {phase === "ready" && preview && (
          <main className="screen preview">
            <div className="preview-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="preview-img" src={preview} alt="Your meal" />
              <button
                className="preview-remove"
                aria-label="Remove photo"
                onClick={reset}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <button className="btn btn-primary" onClick={() => analyze()}>
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3l2.4 6.3L21 12l-6.6 2.7L12 21l-2.4-6.3L3 12l6.6-2.7z" />
              </svg>
              Reverse this recipe
            </button>
            <button
              className="btn btn-outline"
              onClick={() => libraryInput.current?.click()}
            >
              Choose a different photo
            </button>
          </main>
        )}

        {/* ===== LOADING ===== */}
        {phase === "loading" && (
          <main className="screen loading">
            <div className="loader" />
            <div key={loadingLine} className="loading-line">
              {COOKING_LINES[loadingLine]}
            </div>
            <p className="loading-sub">Reverse-engineering your dish</p>
            <div className="skeletons">
              <div className="sk w1" />
              <div className="sk w2" />
              <div className="sk w3" />
            </div>
          </main>
        )}

        {/* ===== RESULTS ===== */}
        {phase === "done" && result && (
          <main className="screen">
            <Result data={result} image={preview} wakeActive={wakeActive} />
          </main>
        )}

        {/* ===== RATE LIMIT / NEEDS KEY ===== */}
        {phase === "needkey" && (
          <main className="screen limit">
            <div className="limit-banner">
              <div className="limit-icon">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
              </div>
              <div>
                <div className="limit-title">
                  {keyReason === "missing"
                    ? "Add your Gemini key"
                    : "Daily limit reached"}
                </div>
                <p className="limit-text">
                  {keyReason === "missing"
                    ? "This demo needs a Google AI key to read your photo. Drop in your own free key to start cooking — it stays in your browser and is only sent with this request."
                    : "The shared demo key just ran out of free requests for now. Keep going instantly with your own free Google AI key — it stays in your browser and is only sent with this request."}
                </p>
              </div>
            </div>
            <label className="field-label" htmlFor="gemini-key">
              Your Gemini API key
            </label>
            <input
              id="gemini-key"
              className="field"
              type="password"
              placeholder="Paste your Gemini API key"
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && useOwnKey()}
            />
            <button className="btn btn-primary" onClick={useOwnKey}>
              Save key & continue
            </button>
            <p className="limit-note">
              Stored only in your browser. Grab a free one in under a minute at{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                aistudio.google.com/apikey
              </a>
              .
            </p>
          </main>
        )}

        {/* ===== ERROR ===== */}
        {phase === "error" && (
          <main className="screen error-screen">
            <div className="error-icon">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            </div>
            <h2 className="error-title">Couldn't read that one</h2>
            <p className="error-text">{error}</p>
            {payload ? (
              <>
                <button
                  className="btn btn-primary btn-inline"
                  onClick={() => analyze()}
                >
                  Try again
                </button>
                <button
                  className="btn btn-outline btn-inline"
                  style={{ marginTop: 10 }}
                  onClick={reset}
                >
                  Start over
                </button>
              </>
            ) : (
              <button className="btn btn-primary btn-inline" onClick={reset}>
                Try another photo
              </button>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
