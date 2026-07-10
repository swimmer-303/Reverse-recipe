# Claude Design prompt — modernize Reverse Recipe

Paste the following into Claude Design.

---

Modernize the UI of my Next.js app "Reverse Recipe." It's a single-page tool:
you upload or snap a photo of a meal, and an AI returns the dish name,
ingredients (name + amount), a nutrition panel (calories, protein, carbs, fat
for the whole dish), servings/prep/cook time, and numbered cooking steps. There
is one screen with these states: empty dropzone, image preview, loading,
results, a rate-limit notice with an API-key paste field, and an error notice.

Current look: warm cream background (#fbf7f0) with a soft radial gradient,
terracotta accent (#c0562b), white cards with a 1px warm border and soft shadow,
rounded corners (~16px), a system sans-serif stack, ingredients in a two-column
list, macros as four tiles, steps as a counter-numbered list. It's clean but
fairly plain.

Please redesign it to feel like a polished, modern consumer food app while
keeping it warm and appetizing — not a sterile dashboard. Specifically:

- Establish a real type system: a characterful display face for the dish name
  and headings paired with a highly legible body face. Set a clear type scale.
- Refine the palette into a cohesive system with proper light and dark themes
  (respect prefers-color-scheme). Keep the appetizing warmth; add depth with
  layered surfaces rather than flat white cards.
- Make the results screen the hero: give the dish name real presence, turn the
  nutrition panel into an elegant stat display (consider a subtle macro
  breakdown bar), and make the recipe steps feel editorial and easy to cook
  from at a glance.
- Elevate the empty state and dropzone so the first screen is inviting and
  obviously interactive, with a clear primary call to action.
- Add tasteful motion: smooth state transitions, a considered loading treatment
  (the app cycles through short status lines while the AI works), and gentle
  entrance animations for results. Keep it subtle and fast.
- Ensure it's fully responsive and genuinely great on mobile, since most users
  will photograph food on a phone.
- Keep a clean print/"save recipe" layout — hide the chrome, keep a nice recipe
  card.

Constraints: keep it as a Next.js App Router project with plain CSS (no UI
framework or Tailwind unless it's clearly worth it), no emojis anywhere (they
render inconsistently across devices), and keep the existing component structure
(`app/page.tsx`, `app/components/Result.tsx`, `app/globals.css`) so the redesign
drops in. Don't change the API or data shape.

Give me the updated globals.css and the JSX/className changes needed to match.
