import { NextRequest, NextResponse } from "next/server";
import { analyzeMeal, GeminiError } from "./gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// Gemini caps inline image data; keep our own ceiling well under that so we
// fail politely instead of bouncing off the API.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let body: { image?: string; mimeType?: string; userKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const { image, mimeType, userKey } = body;
  if (!image || !mimeType) {
    return NextResponse.json({ error: "No image was sent." }, { status: 400 });
  }

  if (!mimeType.startsWith("image/")) {
    return NextResponse.json(
      { error: "That file doesn't look like an image." },
      { status: 400 }
    );
  }

  // base64 is ~4/3 the size of the raw bytes.
  if (image.length * 0.75 > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "That photo is a bit too large — try one under 5MB." },
      { status: 413 }
    );
  }

  // A key the visitor pasted in wins; otherwise fall back to ours.
  const key = userKey?.trim() || process.env.GEMINI_API_KEY;
  const usingOwnKey = Boolean(userKey?.trim());

  if (!key) {
    // No server key set. Rather than dead-ending, invite the visitor to bring
    // their own free key — same soft-fail path as hitting the quota.
    return NextResponse.json(
      { error: "missing", code: "NO_KEY" },
      { status: 503 }
    );
  }

  try {
    const analysis = await analyzeMeal(image, mimeType, key);
    return NextResponse.json({ analysis });
  } catch (err) {
    if (err instanceof GeminiError) {
      // Out of quota / rate limited. If they're already on their own key
      // there's nothing more we can offer, so word it differently.
      if (err.status === 429) {
        return NextResponse.json(
          {
            error: usingOwnKey
              ? "Your key just hit its rate limit. Give it a minute and try again."
              : "limit",
            code: "RATE_LIMIT",
          },
          { status: 429 }
        );
      }
      // A bad key the user pasted. Flag it so the client can drop the stored
      // key instead of retrying with it forever.
      if ((err.status === 400 || err.status === 403) && usingOwnKey) {
        return NextResponse.json(
          { error: "rejected", code: "BAD_KEY" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "We couldn't quite make out that dish. Try another photo." },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "Something went wrong on our end." },
      { status: 500 }
    );
  }
}
