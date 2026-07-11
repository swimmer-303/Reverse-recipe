// Web Worker that runs the Kokoro neural TTS model fully on-device (WebAssembly
// or WebGPU) so synthesis never blocks the UI thread. The model weights (~80MB
// quantized) download once from the Hugging Face CDN and are cached by the
// browser for every visit after.

import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";

// Always fetch weights from the hub, not a local /models path.
env.allowLocalModels = false;

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart"; // warm, natural American voice (highest-graded)

// Run on the WASM backend with q8 weights. This is the combination the model
// authors document and validate: q8 (int8) ops are NOT reliably supported on
// the WebGPU backend and produce garbled, unintelligible audio there, so we do
// not use WebGPU. WASM+q8 is a touch slower but sounds correct everywhere, and
// keeps the download small (~80MB).
const DEVICE = "wasm";
const DTYPE = "q8";

type InMsg =
  | { type: "load" }
  | { type: "generate"; id: number; text: string };

let ttsPromise: Promise<KokoroTTS> | null = null;

function load() {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: DTYPE,
      device: DEVICE,
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p?.status === "progress" && typeof p.progress === "number") {
          postMessage({ type: "progress", progress: p.progress });
        }
      },
    });
    ttsPromise
      .then(() => postMessage({ type: "ready" }))
      .catch((e) =>
        postMessage({ type: "fatal", message: String(e?.message || e) })
      );
  }
  return ttsPromise;
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === "load") {
    load();
    return;
  }
  if (msg.type === "generate") {
    try {
      const tts = await load(); // no-op if already loading
      const audio = await tts.generate(msg.text, { voice: VOICE });
      const wav = audio.toWav(); // ArrayBuffer
      postMessage({ type: "result", id: msg.id, wav }, { transfer: [wav] });
    } catch (err) {
      postMessage({
        type: "error",
        id: msg.id,
        message: String((err as Error)?.message || err),
      });
    }
  }
};
