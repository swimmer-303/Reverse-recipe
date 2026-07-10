// Thin wrapper around the Google Generative Language REST API.
// We deliberately avoid the SDK so the whole thing stays dependency-free
// and easy to reason about on the free tier.

const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// The shape we ask Gemini to fill in. Keeping it explicit means the model
// almost always returns something we can render without babysitting it.
const responseSchema = {
  type: "object",
  properties: {
    dishName: { type: "string" },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "string" },
        },
        required: ["name", "amount"],
      },
    },
    calories: {
      type: "object",
      properties: {
        total: { type: "integer" },
        protein: { type: "integer" },
        carbs: { type: "integer" },
        fat: { type: "integer" },
      },
      required: ["total", "protein", "carbs", "fat"],
    },
    servings: { type: "integer" },
    prepMinutes: { type: "integer" },
    cookMinutes: { type: "integer" },
    steps: {
      type: "array",
      items: { type: "string" },
    },
    notes: { type: "string" },
  },
  required: [
    "dishName",
    "confidence",
    "ingredients",
    "calories",
    "servings",
    "prepMinutes",
    "cookMinutes",
    "steps",
  ],
};

const PROMPT = `You are a chef and nutritionist looking at a photo of a finished meal.
Work out, as best you can, how somebody would recreate it from scratch.

Give:
- the most likely name of the dish
- how confident you are that you've identified it correctly
- the ingredients you'd need, with rough household amounts
- an estimate of the calories and macros for the whole dish as pictured
- the number of servings it looks like, plus prep and cook time in minutes
- clear, numbered cooking steps a home cook could actually follow

Estimate honestly. If the photo is unclear or it isn't food at all, still return
your best guess and lower the confidence. Keep the steps practical, not a wall of text.`;

export type Analysis = {
  dishName: string;
  confidence: "high" | "medium" | "low";
  ingredients: { name: string; amount: string }[];
  calories: { total: number; protein: number; carbs: number; fat: number };
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  steps: string[];
  notes?: string;
};

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function analyzeMeal(
  imageBase64: string,
  mimeType: string,
  apiKey: string
): Promise<Analysis> {
  const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: PROMPT },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // 429 is the one we care about most — it's what the free quota returns.
    throw new GeminiError(body || res.statusText, res.status);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiError("The model didn't return anything usable.", 502);
  }

  try {
    return JSON.parse(text) as Analysis;
  } catch {
    throw new GeminiError("Couldn't parse the model's response.", 502);
  }
}
