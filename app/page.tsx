"use client";

import { useCallback, useRef, useState } from "react";
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

type Phase = "idle" | "ready" | "loading" | "done" | "limit" | "error";

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

  const fileInput = useRef<HTMLInputElement>(null);

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
            setPhase("limit");
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
    setPhase("idle");
    setPreview(null);
    setPayload(null);
    setResult(null);
    setError("");
  }, []);

  const showDropzone = phase === "idle" || phase === "error";

  return (
    <main className="wrap">
      <header className="masthead">
        <p className="kicker">Reverse Recipe</p>
        <h1>What's on the plate?</h1>
        <p className="lede">
          Snap a photo of any meal and get back the ingredients, a calorie
          estimate, and a recipe you can actually cook at home.
        </p>
      </header>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {showDropzone && (
        <>
          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onClick={() => fileInput.current?.click()}
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
            <svg
              className="icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            <h2>Take or upload a photo</h2>
            <p>Tap here, or drag an image right onto this box</p>
          </div>
          {phase === "error" && (
            <div className="notice error">
              <p>{error}</p>
            </div>
          )}
          <p className="hint">
            Works best on a clear, well-lit shot of the finished dish.
          </p>
        </>
      )}

      {!showDropzone && preview && (
        <div className="preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your meal" />
        </div>
      )}

      {phase === "ready" && (
        <div className="actions">
          <button className="btn-primary" onClick={() => analyze()}>
            Reverse-engineer this meal
          </button>
          <button className="btn-ghost" onClick={reset}>
            Pick another
          </button>
        </div>
      )}

      {phase === "loading" && (
        <div className="thinking">
          <span className="spinner" />
          Tasting the pixels and writing your recipe...
        </div>
      )}

      {phase === "limit" && (
        <div className="notice">
          <p>
            The shared demo key just ran out of free requests for now. You can
            keep going instantly with your own free Google AI key — it stays in
            your browser and is only sent along with this request.
          </p>
          <div className="key-row">
            <input
              type="password"
              placeholder="Paste your Gemini API key"
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && useOwnKey()}
            />
            <button className="btn-primary" onClick={useOwnKey}>
              Use my key
            </button>
          </div>
          <small>
            Grab a free one in under a minute at{" "}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
            >
              aistudio.google.com/apikey
            </a>
            . We never store it.
          </small>
        </div>
      )}

      {phase === "error" && !showDropzone && (
        <>
          <div className="notice error">
            <p>{error}</p>
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={() => analyze()}>
              Try again
            </button>
            <button className="btn-ghost" onClick={reset}>
              Start over
            </button>
          </div>
        </>
      )}

      {phase === "done" && result && (
        <>
          <Result data={result} />
          <div className="actions no-print">
            <button className="btn-primary" onClick={reset}>
              Try another meal
            </button>
            <button className="btn-ghost" onClick={() => window.print()}>
              Save recipe
            </button>
          </div>
        </>
      )}

      <footer className="colophon no-print">
        Powered by Google Gemini.
      </footer>
    </main>
  );
}
