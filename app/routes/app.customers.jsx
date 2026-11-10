import { useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getCustomerRows } from "../utils/customers.server";
import StatCard from "../components/dashboard/StatCard";
import "../styles/dashboard.css";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  return getCustomerRows(session?.shop ?? "");
}

const STATUS_LABELS = {
  purchased: { label: "Purchased", tone: "live" },
  abandoned: { label: "Abandoned", tone: "soon" },
  checkout: { label: "In checkout", tone: "proto" },
};

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return String(Math.round(amount));
  }
}

// Stops spreadsheet apps from running a cell as a formula.
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows, name) {
  const header = [
    "Status", "Date", "Order", "Customer", "Email", "Location",
    "Tried on", "Items", "Total", "Currency", "Recovery link",
  ];
  const lines = rows.map((row) =>
    [
      STATUS_LABELS[row.status]?.label ?? row.status,
      row.at.slice(0, 10), row.orderName, row.name, row.email, row.place,
      row.tried.join("; "), row.items, row.total, row.currency || "", row.recoveryUrl,
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
  link.download = `vibecheck-customers-${name}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Customers() {
  const { rows, stats, error } = useLoaderData();
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState("all");

  // Dates use the viewer's time zone, so format them after the page has loaded.
  useEffect(() => setMounted(true), []);

  const formatDate = (iso) =>
    mounted
      ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
      : iso.slice(0, 10);

  const count = (status) => rows.filter((row) => row.status === status).length;
  const visible = rows.filter((row) => filter === "all" || row.status === filter);
  const total = stats.purchased + stats.abandoned;
  const completion = total ? Math.round((stats.purchased / total) * 100) : 0;

  const chips = [
    { key: "all", label: `All ${rows.length}` },
    { key: "purchased", label: `Purchased ${count("purchased")}` },
    { key: "abandoned", label: `Abandoned ${count("abandoned")}` },
  ];

  return (
    <s-page heading="Customers" inlineSize="large">
      <div className="vc">
        <header className="vc-header">
          <div>
            <h1 className="vc-title">Customers</h1>
            <p className="vc-subtitle">
              Shoppers who tried a product on, then bought it or left at checkout.
            </p>
          </div>
          <div className="vc-actions">
            <button
              type="button"
              className="vc-btn vc-btn--outline"
              disabled={visible.length === 0}
              onClick={() => downloadCsv(visible, filter)}
            >
              Download CSV
            </button>
          </div>
        </header>

        {error ? (
          <div className="vc-alert" role="alert">{error}</div>
        ) : (
          <div className="vc-grid">
            <StatCard index={0} hero title="Purchased" value={stats.purchased} note="Last 30 days" />
            <StatCard index={1} title="Abandoned checkouts" value={stats.abandoned} note="Last 30 days" />
            <StatCard
              index={2}
              title="Abandoned value"
              value={formatMoney(stats.abandonedValue, stats.currency)}
              note="Could still be recovered"
            />
            <StatCard index={3} title="Checkout completion" value={`${completion}%`} note="Purchased vs abandoned" />

            <section className="vc-card vc-span-all" style={{ "--i": 4 }}>
              <div className="vc-card__head">
                <h2 className="vc-card__title">Customer details</h2>
              </div>

              <div className="vc-chips" role="group" aria-label="Filter customers">
                {chips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className="vc-chip"
                    aria-pressed={filter === chip.key}
                    onClick={() => setFilter(chip.key)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {visible.length === 0 ? (
                <div className="vc-empty">
                  <strong>Nobody here yet</strong>
                  Customers appear once someone uses try-on and then starts or finishes a checkout.
                </div>
              ) : (
                <div className="vc-table-wrap">
                  <table className="vc-table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Status</th>
                        <th>Location</th>
                        <th>Tried on</th>
                        <th>Items</th>
                        <th className="vc-num">Total</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row) => {
                        const status = STATUS_LABELS[row.status];
                        return (
                          <tr key={row.id}>
                            <td>
                              <div className="vc-cell-strong">{row.name || "No name yet"}</div>
                              <div className="vc-cell-sub">{row.email || "No contact details"}</div>
                            </td>
                            <td>
                              <span className={`vc-pill vc-pill--${status.tone}`}>{status.label}</span>
                              {row.recoveryUrl && row.status === "abandoned" ? (
                                <div className="vc-cell-sub">
                                  <a href={row.recoveryUrl} target="_blank" rel="noopener noreferrer">
                                    Recovery link
                                  </a>
                                </div>
                              ) : null}
                            </td>
                            <td>{row.place || "—"}</td>
                            <td>
                              <div>{row.tried.length ? row.tried.join(", ") : "—"}</div>
                              {row.method ? <div className="vc-cell-sub">{row.method}</div> : null}
                            </td>
                            <td>
                              <div>{row.items || "—"}</div>
                              {row.boughtTriedItem ? (
                                <span className="vc-pill vc-pill--live">Bought what they tried</span>
                              ) : null}
                            </td>
                            <td className="vc-num">{formatMoney(row.total, row.currency)}</td>
                            <td>
                              <div>{formatDate(row.at)}</div>
                              <div className="vc-cell-sub">{row.orderName}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="vc-note">
                A checkout counts as abandoned after an hour with no activity. Contact
                details appear only if the shopper entered them. Showing the latest 100
                of each. Only contact shoppers who have agreed to hear from you.
              </p>
            </section>
          </div>
        )}
      </div>
    </s-page>
  );
}