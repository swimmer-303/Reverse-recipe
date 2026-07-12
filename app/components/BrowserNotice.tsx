"use client";

import { useEffect, useState } from "react";

const DISMISSED = "rr.browser-notice-dismissed";

// True only for real Google Chrome. Edge, Opera, Samsung Internet and friends
// are all Chromium too, but they don't all ship the same speech-recognition and
// WebAssembly behaviour this app leans on, so they still get the nudge.
function isGoogleChrome(): boolean {
  const nav = navigator as Navigator & {
    userAgentData?: { brands?: Array<{ brand: string }> };
  };
  const brands = nav.userAgentData?.brands;
  if (brands?.length) {
    return brands.some((b) => b.brand === "Google Chrome");
  }
  const ua = navigator.userAgent;
  const chromium = /Chrome|CriOS/.test(ua);
  const impostor = /Edg|OPR|OPT|SamsungBrowser|Brave|Vivaldi|YaBrowser/.test(ua);
  return chromium && !impostor;
}

export default function BrowserNotice() {
  const [show, setShow] = useState(false);

  // Runs after hydration — the server has no idea what browser this is, so
  // deciding during render would mismatch.
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED) === "1";
    } catch {}
    if (!dismissed && !isGoogleChrome()) setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {}
  };

  return (
    <div className="browser-notice" role="status" data-noprint>
      <span className="browser-notice-icon" aria-hidden="true">
        <svg
          width="16"
          height="16"
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
      </span>
      <p className="browser-notice-text">
        <strong>Google Chrome is highly recommended</strong> for Reverse Recipe.
        The natural read-aloud voice and hands-free cook mode may not work in
        this browser.
      </p>
      <button
        className="browser-notice-close"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
