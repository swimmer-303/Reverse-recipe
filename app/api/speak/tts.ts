// Gemini native text-to-speech. Unlike the browser's Web Speech API (which is
// stuck with whatever robotic voice the device ships), this returns genuinely
// natural neural audio from the same Generative Language API — and the same key
// — that powers the meal analysis.

import { GeminiError } from "../analyze/gemini";

// Dedicated preview TTS model. It's separate from the text/vision Flash model,
// so this one is pinned rather than aliased.
const MODEL = "gemini-2.5-flash-preview-tts";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// A warm, friendly prebuilt voice that suits reading a recipe aloud.
const VOICE = "Sulafat";

// A light natural-language style cue nudges the delivery toward a real person
// talking a cook through the steps rather than a flat announcer.
const STYLE =
  "Read this aloud in a warm, friendly, natural voice, like a home cook " +
  "talking a friend through a recipe. Relaxed and clear, unhurried:\n\n";

// Wrap raw signed-16-bit little-endian mono PCM in a minimal WAV container so
// any browser can play it straight from an <audio> element.
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

// Gemini reports the sample rate in the mime type, e.g.
// "audio/L16;codec=pcm;rate=24000". Default to 24k if it's ever missing.
function rateFromMime(mime: string | undefined): number {
  const m = mime?.match(/rate=(\d+)/);
  return m ? parseInt(m[1], 10) : 24000;
}

export async function synthesizeSpeech(
  text: string,
  apiKey: string
): Promise<Buffer> {
  const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: STYLE + text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: VOICE },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new GeminiError(body || res.statusText, res.status);
  }

  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: { data?: string } }) => p?.inlineData?.data
  );
  const b64: string | undefined = part?.inlineData?.data;
  if (!b64) {
    throw new GeminiError("No audio came back from the model.", 502);
  }

  const pcm = Buffer.from(b64, "base64");
  const sampleRate = rateFromMime(part?.inlineData?.mimeType);
  return pcmToWav(pcm, sampleRate);
}
