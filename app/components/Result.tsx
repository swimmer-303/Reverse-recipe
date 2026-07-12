import type { Analysis } from "../api/analyze/gemini";

const CONFIDENCE_LABEL: Record<Analysis["confidence"], string> = {
  high: "High confidence",
  medium: "Best guess",
  low: "Low confidence",
};

function minutes(n: number) {
  if (!n || n <= 0) return "—";
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Split the macro bar by each macro's share of calories (protein/carbs 4 kcal/g,
// fat 9 kcal/g), so the bar reflects energy contribution rather than raw grams.
function macroSplit({ protein, carbs, fat }: Analysis["calories"]) {
  const p = Math.max(protein, 0) * 4;
  const c = Math.max(carbs, 0) * 4;
  const f = Math.max(fat, 0) * 9;
  const total = p + c + f;
  if (total <= 0) return { p: "0%", c: "0%", f: "0%" };
  const pct = (v: number) => `${(v / total) * 100}%`;
  return { p: pct(p), c: pct(c), f: pct(f) };
}

export default function Result({
  data,
  image,
  wakeActive,
}: {
  data: Analysis;
  image: string | null;
  wakeActive: boolean;
}) {
  const split = macroSplit(data.calories);
  const perServing =
    data.servings > 1 && data.calories.total > 0
      ? Math.round(data.calories.total / data.servings)
      : null;

  return (
    <div className="result">
      <div className="result-bar" />

      <div className="title-row">
        {image && (
          <div className="title-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="" />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="kicker">{CONFIDENCE_LABEL[data.confidence]}</div>
          <h2 className="dish-name">{data.dishName}</h2>
        </div>
      </div>

      <div className="chips">
        <div className="chip">
          <div className="chip-label">Serves</div>
          <div className="chip-val">
            {data.servings > 0 ? data.servings : "—"}
          </div>
        </div>
        <div className="chip">
          <div className="chip-label">Prep</div>
          <div className="chip-val">{minutes(data.prepMinutes)}</div>
        </div>
        <div className="chip">
          <div className="chip-label">Cook</div>
          <div className="chip-val">{minutes(data.cookMinutes)}</div>
        </div>
      </div>

      <div className="nutri">
        <div className="nutri-top">
          <div>
            <div className="cal-num">{data.calories.total}</div>
            <div className="cal-label">Calories · whole dish</div>
            {perServing && (
              <div className="cal-per">{perServing} per serving</div>
            )}
          </div>
          <div className="macro-list">
            <div>
              <div className="macro-val p">{data.calories.protein}g</div>
              <div className="macro-label">Protein</div>
            </div>
            <div>
              <div className="macro-val c">{data.calories.carbs}g</div>
              <div className="macro-label">Carbs</div>
            </div>
            <div>
              <div className="macro-val f">{data.calories.fat}g</div>
              <div className="macro-label">Fat</div>
            </div>
          </div>
        </div>
        <div className="macro-bar">
          <div className="macro-seg p" style={{ width: split.p }} />
          <div className="macro-seg c" style={{ width: split.c }} />
          <div className="macro-seg f" style={{ width: split.f }} />
        </div>
      </div>

      <ul className="ingredients">
        <li className="section-label">Ingredients</li>
        {data.ingredients.map((ing, i) => (
          <li className="ingredient" key={i}>
            <div className="ing-name">{ing.name}</div>
            <div className="ing-amt">{ing.amount}</div>
          </li>
        ))}
      </ul>

      <div className="method">
        <div className="section-label">Method</div>
        <ol className="method-list">
          {data.steps.map((step, i) => (
            <li className="step" key={i}>
              <span className="step-num">{i + 1}</span>
              <p className="step-text">{step}</p>
            </li>
          ))}
        </ol>
        {data.notes && <p className="notes">{data.notes}</p>}
      </div>

      <div className="cook-foot" data-noprint>
        <span className="cook-dot" />
        <span>
          {wakeActive
            ? "Screen will stay awake while you cook"
            : "AI estimates from one photo — a starting point, not gospel"}
        </span>
      </div>

      <p className="disclaimer">
        Nutrition and steps are estimated by AI from a single photo.
      </p>
    </div>
  );
}
