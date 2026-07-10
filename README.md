# Reverse Recipe

Take a photo of any meal and get back the ingredients, a calorie and macro
estimate, and a step-by-step recipe to recreate it at home. Point-and-shoot
food, reverse-engineered.

Built with Next.js and Google Gemini. No database, no accounts, no tracking —
the photo goes straight to the model and the result comes straight back.

## How it works

1. You upload or snap a photo. It's resized in the browser so uploads stay small.
2. A single API route sends the image to Gemini with a structured schema.
3. Gemini returns the dish name, ingredients, nutrition, and cooking steps.
4. The result renders as a printable recipe card.

## Running locally

```bash
npm install
cp .env.example .env        # then paste your key in
npm run dev
```

Get a free Gemini API key at https://aistudio.google.com/apikey and add it to
`.env`:

```
GEMINI_API_KEY=your_key_here
```

## Deploying to Vercel

Push the repo to GitHub, import it in Vercel, and add `GEMINI_API_KEY` under
**Settings → Environment Variables**. That's the whole setup.

## Staying free

The app runs on Gemini's free tier. If the shared key hits its daily quota, the
app doesn't just error out — it invites the visitor to paste in their own free
key, which is kept in their browser and only ever sent alongside their own
request. Nothing is stored server-side.

## Notes on accuracy

Every number here is an estimate from a single photo. It's a genuinely useful
starting point for a shopping list or a rough calorie count, but it isn't a
substitute for a scale or a nutrition label.
