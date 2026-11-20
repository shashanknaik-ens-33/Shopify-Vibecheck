const R = 80;
const CX = 100;
const CY = 100;
const WIDTH = 22;

// t runs 0 → 1 across the top half of the circle, left to right.
function point(t) {
  const phi = Math.PI * (1 - t);
  return [CX + R * Math.cos(phi), CY - R * Math.sin(phi)];
}

function arc(t0, t1) {
  const [x0, y0] = point(t0);
  const [x1, y1] = point(t1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * segments: [{ value, color, label }]  (color "hatch" draws the striped style)
 */
export default function DonutChart({ segments, centerValue, centerLabel }) {
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const gap = 0.025;

  let cursor = 0;
  const arcs = total
    ? segments
        .filter((item) => item.value > 0)
        .map((item) => {
          const span = item.value / total;
          const t0 = cursor;
          const t1 = cursor + span;
          cursor = t1;
          const pad = span > gap * 2 ? gap / 2 : 0;
          return { ...item, d: arc(t0 + pad, t1 - pad) };
        })
    : [];

  return (
    <>
      <div className="vc-donut">
        <svg viewBox="0 0 200 112" role="img" aria-label={`${centerValue} ${centerLabel}`}>
          <defs>
            <pattern
              id="vc-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="#eef1ef" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#b9c4bd" strokeWidth="2.5" />
            </pattern>
          </defs>
          <path
            d={arc(0, 1)}
            fill="none"
            stroke="#eef1ef"
            strokeWidth={WIDTH}
            strokeLinecap="round"
          />
          {arcs.map((item) => (
            <path
              key={item.label}
              d={item.d}
              fill="none"
              stroke={item.color === "hatch" ? "url(#vc-hatch)" : item.color}
              strokeWidth={WIDTH}
              strokeLinecap="round"
            />
          ))}
        </svg>
        <div className="vc-donut__center">
          <div className="vc-donut__value">{centerValue}</div>
          <div className="vc-donut__label">{centerLabel}</div>
        </div>
      </div>
      <div className="vc-legend">
        {segments.map((item) => (
          <span key={item.label}>
            <i
              style={
                item.color === "hatch"
                  ? {
                      background:
                        "repeating-linear-gradient(135deg,#b9c4bd 0 2px,#eef1ef 2px 4px)",
                    }
                  : { background: item.color }
              }
            />
            {item.label}
          </span>
        ))}
      </div>
    </>
  );
}