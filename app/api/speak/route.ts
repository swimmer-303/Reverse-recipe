import { NextRequest, NextResponse } from "next/server";
import { synthesizeSpeech } from "./edge-tts";

export const runtime = "nodejs";
export const maxDuration = 30;

// Keep a lid on how much we'll voice in one call — a whole recipe is fine.
const MAX_CHARS = 5000;

export async function POST(req: NextRequest) {
  let body: { text?: string };
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

  try {
    const mp3 = await synthesizeSpeech(text);
    return new NextResponse(new Uint8Array(mp3), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    // Any failure (endpoint changed, network, timeout) — the client quietly
    // falls back to the on-device browser voice.
    return NextResponse.json({ error: "tts unavailable" }, { status: 502 });
  }
}
