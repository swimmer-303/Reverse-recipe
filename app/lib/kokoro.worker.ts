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

type InMsg =
  | { type: "load"; device: "webgpu" | "wasm"; dtype: "fp32" | "q8" }
  | { type: "generate"; id: number; text: string };

let ttsPromise: Promise<KokoroTTS> | null = null;

function load(device: "webgpu" | "wasm", dtype: "fp32" | "q8") {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype,
      device,
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
    load(msg.device, msg.dtype);
    return;
  }
  if (msg.type === "generate") {
    try {
      const tts = await load("wasm", "q8"); // no-op if already loading
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
