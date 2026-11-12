import { useEffect, useState } from "react";
import { formatMoney } from "./CustomerTable";

const OUTCOMES = {
  purchased: { label: "Purchased", tone: "live" },
  abandoned: { label: "Abandoned checkout", tone: "soon" },
  checkout: { label: "In checkout", tone: "proto" },
  browsed: { label: "Browsed only", tone: "off" },
};

const ORIGINS = {
  order: "From their order",
  checkout: "From checkout",
  account: "Logged-in customer",
};

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows, name) {
  const header = [
    "Date", "Visitor", "Customer", "Email", "Location",
    "Tried on", "How", "Outcome", "Total", "Currency", "Order",
  ];
  const lines = rows.map((row) =>
    [
      row.at, row.visitor, row.name, row.email, row.place,
      row.tried.join("; "), row.method, OUTCOMES[row.outcome].label,
      row.total, row.currency || "", row.orderName,
    ]
      .map(csvCell)
      .join(",")
  );
  const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vibecheck-sessions-${name}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Every try-on session with the shopper's details where they are known.
export default function SessionTable({ rows, error }) {
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => setMounted(true), []);

  const formatWhen = (iso) =>
    mounted
      ? new Date(iso).toLocaleString(undefined, {
          day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
        })
      : iso.slice(0, 10);

  const known = (row) => Boolean(row.name || row.email);
  const filters = {
    all: () => true,
    identified: known,
    anonymous: (row) => !known(row),
    purchased: (row) => row.outcome === "purchased",
    abandoned: (row) => row.outcome === "abandoned",
  };
  const countOf = (key) => rows.filter(filters[key]).length;
  const visible = rows.filter(filters[filter]);

  const chips = [
    ["all", "All"],
    ["identified", "Identified"],
    ["anonymous", "Anonymous"],
    ["purchased", "Purchased"],
    ["abandoned", "Abandoned"],
  ];

  return (
    <>
      <div className="vc-card__head">
        <h2 className="vc-card__title">Try-on sessions</h2>
        <button
          type="button"
          className="vc-btn vc-btn--outline"
          disabled={visible.length === 0}
          onClick={() => downloadCsv(visible, filter)}
        >
          Download CSV
        </button>
      </div>

      {error ? (
        <div className="vc-alert" role="alert">{error}</div>
      ) : (
        <>
          <div className="vc-chips" role="group" aria-label="Filter sessions">
            {chips.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="vc-chip"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label} {countOf(key)}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="vc-empty">
              <strong>No sessions in this view</strong>
              Sessions appear here as shoppers use try-on on your store.
            </div>
          ) : (
            <div className="vc-table-wrap">
              <table className="vc-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Customer</th>
                    <th>Tried on</th>
                    <th>Outcome</th>
                    <th className="vc-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const outcome = OUTCOMES[row.outcome];
                    return (
                      <tr key={row.id}>
                        <td>
                          <div>{formatWhen(row.at)}</div>
                          <div className="vc-cell-sub">Visitor {row.visitor}</div>
                        </td>
                        <td>
                          {known(row) ? (
                            <>
                              <div className="vc-cell-strong">{row.name || row.email}</div>
                              {row.name && row.email ? (
                                <div className="vc-cell-sub">{row.email}</div>
                              ) : null}
                              <div className="vc-cell-sub">
                                {[row.place, ORIGINS[row.origin]].filter(Boolean).join(" · ")}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="vc-cell-strong">Anonymous visitor</div>
                              <div className="vc-cell-sub">Not logged in, no checkout details</div>
                            </>
                          )}
                        </td>
                        <td>
                          <div>{row.tried.length ? row.tried.join(", ") : "—"}</div>
                          <div className="vc-cell-sub">
                            {row.method}
                            {row.shade ? " · tried a shade" : ""}
                          </div>
                        </td>
                        <td>
                          <span className={`vc-pill vc-pill--${outcome.tone}`}>{outcome.label}</span>
                          {row.orderName ? <div className="vc-cell-sub">{row.orderName}</div> : null}
                        </td>
                        <td className="vc-num">
                          {row.total ? formatMoney(row.total, row.currency) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="vc-note">
            Names and emails appear only when a shopper was logged in to your store or
            entered them at checkout. Everyone else stays anonymous. Showing the latest
            100 sessions from the last 30 days.
          </p>
        </>
      )}
    </>
  );
}