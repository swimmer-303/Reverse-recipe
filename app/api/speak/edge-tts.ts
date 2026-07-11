// Free neural text-to-speech via Microsoft Edge's online voices — the same
// "Read Aloud" service the Edge browser uses. It needs no API key and costs
// nothing, and the voices (Azure Neural) sound genuinely human.
//
// Caveat: this is an UNOFFICIAL endpoint (not a documented public API), so
// Microsoft can change or gate it at any time. The client treats any failure
// here as a signal to fall back to the on-device browser voice, so a break
// degrades gracefully rather than dead-ending.

import { createHash, randomUUID } from "crypto";
import WebSocket from "ws";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
  `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const WIN_EPOCH = 11644473600;

// A warm, friendly voice that suits reading a recipe to someone.
const VOICE = "en-US-JennyNeural";
// Slightly under default pace so cooking steps are easy to follow.
const RATE = "-4%";
const PITCH = "+0Hz";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

// Microsoft added a rolling security token (Sec-MS-GEC): the SHA-256 of the
// current time (as Windows file-time ticks, rounded down to 5 minutes) joined
// with the trusted client token. This mirrors the reference implementation.
function secMsGec(): string {
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300; // round down to the nearest 5 minutes
  ticks *= 1e7; // seconds -> 100-nanosecond intervals
  const str = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  return createHash("sha256").update(str).digest("hex").toUpperCase();
}

function dateToString(): string {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ` +
    `${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:` +
    `${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ssml(text: string): string {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' " +
    "xml:lang='en-US'>" +
    `<voice name='${VOICE}'>` +
    `<prosody pitch='${PITCH}' rate='${RATE}' volume='+0%'>` +
    escapeXml(text) +
    "</prosody></voice></speak>"
  );
}

// Pull the MP3 payload out of a binary frame. Layout:
//   [2-byte big-endian header length][header text][audio bytes]
function extractAudio(buf: Buffer): Buffer | null {
  if (buf.length < 2) return null;
  const headerLength = buf.readUInt16BE(0);
  const header = buf.toString("utf8", 2, 2 + headerLength);
  if (!header.includes("Path:audio")) return null;
  return buf.subarray(2 + headerLength);
}

export function synthesizeSpeech(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const connectId = randomUUID().replace(/-/g, "");
    const url =
      `${WSS_URL}&Sec-MS-GEC=${secMsGec()}` +
      `&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}` +
      `&ConnectionId=${connectId}`;

    const ws = new WebSocket(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.9",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
    });

    const chunks: Buffer[] = [];
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {}
      reject(err);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      if (!chunks.length) reject(new Error("No audio returned."));
      else resolve(Buffer.concat(chunks));
    };

    // Don't let a stalled socket hang the serverless function.
    const timer = setTimeout(() => fail(new Error("TTS timed out.")), 20000);

    ws.on("open", () => {
      const ts = dateToString();
      ws.send(
        `X-Timestamp:${ts}\r\n` +
          "Content-Type:application/json; charset=utf-8\r\n" +
          "Path:speech.config\r\n\r\n" +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: "false",
                    wordBoundaryEnabled: "false",
                  },
                  outputFormat: OUTPUT_FORMAT,
                },
              },
            },
          })
      );
      ws.send(
        `X-RequestId:${connectId}\r\n` +
          "Content-Type:application/ssml+xml\r\n" +
          `X-Timestamp:${ts}\r\n` +
          "Path:ssml\r\n\r\n" +
          ssml(text)
      );
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const audio = extractAudio(data);
        if (audio && audio.length) chunks.push(audio);
      } else {
        // Text control frame — the only one we care about ends the turn.
        if (data.toString("utf8").includes("Path:turn.end")) finish();
      }
    });

    ws.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    ws.on("close", () => finish());
  });
}
