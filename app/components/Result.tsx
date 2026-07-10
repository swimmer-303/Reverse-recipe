import type { Analysis } from "../api/analyze/gemini";

function totalTime(a: Analysis) {
  const t = (a.prepMinutes || 0) + (a.cookMinutes || 0);
  if (t <= 0) return null;
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function Result({ data }: { data: Analysis }) {
  const time = totalTime(data);

  return (
    <div className="result">
      <div className="dish-head">
        <h2>{data.dishName}</h2>
        <span className={`confidence ${data.confidence}`}>
          {data.confidence} confidence
        </span>
      </div>
      <div className="meta-row">
        {data.servings > 0 && (
          <span>
            <strong>{data.servings}</strong>{" "}
            {data.servings === 1 ? "serving" : "servings"}
          </span>
        )}
        {data.prepMinutes > 0 && (
          <span>
            <strong>{data.prepMinutes} min</strong> prep
          </span>
        )}
        {data.cookMinutes > 0 && (
          <span>
            <strong>{data.cookMinutes} min</strong> cook
          </span>
        )}
        {time && (
          <span>
            <strong>{time}</strong> total
          </span>
        )}
      </div>

      <div className="card">
        <h3>Nutrition, whole dish</h3>
        <div className="macros">
          <div className="macro">
            <span className="val">{data.calories.total}</span>
            <span className="lbl">calories</span>
          </div>
          <div className="macro">
            <span className="val">{data.calories.protein}g</span>
            <span className="lbl">protein</span>
          </div>
          <div className="macro">
            <span className="val">{data.calories.carbs}g</span>
            <span className="lbl">carbs</span>
          </div>
          <div className="macro">
            <span className="val">{data.calories.fat}g</span>
            <span className="lbl">fat</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Ingredients</h3>
        <ul className="ingredients">
          {data.ingredients.map((ing, i) => (
            <li key={i}>
              <span>{ing.name}</span>
              <span className="amt">{ing.amount}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>How to make it</h3>
        <ol className="steps">
          {data.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {data.notes && <p className="notes">{data.notes}</p>}
      </div>

      <p className="disclaimer">
        These are AI estimates from a single photo, so treat the numbers as a
        starting point rather than gospel.
      </p>
    </div>
  );
}
