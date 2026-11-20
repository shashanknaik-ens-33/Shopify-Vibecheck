import { ArrowUpRight, Check } from "./Icons";

export default function StatCard({ title, value, note, hero = false, onOpen, index = 0 }) {
  return (
    <div
      className={`vc-card vc-stat${hero ? " vc-stat--hero" : ""}`}
      style={{ "--i": index }}
    >
      <div className="vc-stat__top">
        <span className="vc-stat__label">{title}</span>
        {onOpen ? (
          <button
            type="button"
            className="vc-arrow"
            aria-label={`Show ${title}`}
            onClick={onOpen}
          >
            <ArrowUpRight />
          </button>
        ) : null}
      </div>
      <div className="vc-stat__value">{value}</div>
      {note ? (
        <div className="vc-stat__note">
          <span className="vc-tick">
            <Check />
          </span>
          {note}
        </div>
      ) : null}
    </div>
  );
}