import { NextRequest, NextResponse } from "next/server";
import { GeminiError } from "../analyze/gemini";
import { synthesizeSpeech } from "./tts";

export const runtime = "nodejs";
export const maxDuration = 60;

// Keep a lid on how much text we'll voice in one call — a whole recipe is fine,
// a novel is not.
const MAX_CHARS = 5000;

export async function POST(req: NextRequest) {
  let body: { text?: string; userKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ error: "That's too long to read." }, { status: 413 });
  }

  const key = body.userKey?.trim() || process.env.GEMINI_API_KEY;
  if (!key) {
    // No key — the client falls back to the browser voice on any non-OK reply.
    return NextResponse.json({ error: "no key", code: "NO_KEY" }, { status: 503 });
  }

  try {
    const wav = await synthesizeSpeech(text, key);
    return new NextResponse(new Uint8Array(wav), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const status = err instanceof GeminiError ? err.status : 500;
    // The client treats any failure the same way: quietly fall back to the
    // on-device voice, so a plain status is all it needs.
    return NextResponse.json({ error: "tts failed" }, { status });
  }
}
