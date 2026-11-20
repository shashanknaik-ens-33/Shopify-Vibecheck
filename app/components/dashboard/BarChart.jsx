const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const PLACEHOLDER = [58, 82, 70, 96, 64, 76, 60];

/**
 * data: null (empty state) or an array of 7 numbers; labels: 7 day letters, oldest first.
 */
export default function BarChart({ data = null, labels = DAYS, loading = false, emptyText }) {
  const empty = !data;
  const max = empty ? 100 : Math.max(...data, 1);

  return (
    <div className={`vc-bars${empty ? " vc-bars--empty" : ""}`}>
      {labels.map((day, index) => {
        const value = empty ? PLACEHOLDER[index] : data[index];
        const pct = empty ? value : value === 0 ? 24 : Math.max((value / max) * 100, 24);
        let tone = "hatch";
        if (!empty && value > 0) {
          tone = value === max ? "dark" : value / max >= 0.6 ? "mid" : "light";
        }
        return (
          <div className="vc-bars__col" key={index}>
            <div
              className={`vc-bar vc-bar--${empty ? "hatch" : tone}`}
              style={{ height: `${pct}%`, animationDelay: `${index * 60}ms` }}
              title={empty ? undefined : `${value} try-ons`}
            />
            <span className="vc-bars__day">{day}</span>
          </div>
        );
      })}
      {empty && !loading ? (
        <div className="vc-bars__empty">
          <span>{emptyText || "No try-on activity yet"}</span>
        </div>
      ) : null}
    </div>
  );
}