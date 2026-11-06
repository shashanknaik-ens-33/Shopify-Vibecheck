import { useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getAnalyticsSummary } from "../utils/analytics.server";
import StatCard from "../components/dashboard/StatCard";
import BarChart from "../components/dashboard/BarChart";
import DonutChart from "../components/dashboard/DonutChart";
import { bucketLastSevenDays, timeAgo } from "../components/dashboard/chart-data";
import "../styles/dashboard.css";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  return getAnalyticsSummary(session?.shop ?? "");
}

const EVENT_LABELS = {
  tryon_opened: "Opened try-on",
  camera_started: "Started the camera",
  photo_uploaded: "Uploaded a photo",
  shade_selected: "Tried a shade",
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

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

export default function Analytics() {
  const data = useLoaderData();
  const [week, setWeek] = useState(null);
  const [now, setNow] = useState(null);

  // Day buckets and "x min ago" depend on the viewer's clock, so they run in the browser.
  useEffect(() => {
    setWeek(bucketLastSevenDays(data.weekTimes));
    setNow(Date.now());
  }, [data.weekTimes]);

  const { sessions, visitors, cameraSessions, photoSessions, shadeSessions } = data;
  const inputTotal = cameraSessions + photoSessions;
  const topMax = Math.max(...data.topProducts.map((item) => item.count), 1);

  return (
    <s-page heading="Analytics" inlineSize="large">
      <div className="vc">
        <header className="vc-header">
          <div>
            <h1 className="vc-title">Analytics</h1>
            <p className="vc-subtitle">
              How shoppers use virtual try-on on your storefront. Totals cover
              the last 30 days.
            </p>
          </div>
        </header>

        {data.error ? (
          <div className="vc-alert" role="alert">
            {data.error}
          </div>
        ) : (
          <div className="vc-grid">
            <StatCard
              index={0}
              hero
              title="Try-on sessions"
              value={sessions}
              note="Last 30 days"
            />
            <StatCard index={1} title="Unique visitors" value={visitors} note="Last 30 days" />
            <StatCard index={2} title="Camera sessions" value={cameraSessions} note="Last 30 days" />
            <StatCard index={3} title="Photo uploads" value={photoSessions} note="Last 30 days" />

            <StatCard
              index={4}
              hero
              title="Orders after try-on"
              value={data.orders}
              note="Last 30 days"
            />
            <StatCard
              index={5}
              title="Purchase rate"
              value={`${pct(data.orders, sessions)}%`}
              note="Orders per try-on session"
            />
            <StatCard
              index={6}
              title="Revenue"
              value={formatMoney(data.revenue, data.currency)}
              note="From try-on shoppers"
            />
            <StatCard
              index={7}
              title="Bought what they tried"
              value={data.boughtTried}
              note="Orders with the tried product"
            />

            <section className="vc-card vc-span-2" style={{ "--i": 8 }}>
              <div className="vc-card__head">
                <h2 className="vc-card__title">Try-ons, last 7 days</h2>
              </div>
              <BarChart
                data={week && data.hasData ? week.counts : null}
                labels={week ? week.labels : undefined}
                loading={!week}
                emptyText="No try-on activity yet. Sessions appear here once shoppers use try-on on your store."
              />
            </section>

            <section className="vc-card" style={{ "--i": 9 }}>
              <div className="vc-card__head">
                <h2 className="vc-card__title">Engagement</h2>
              </div>
              <DonutChart
                centerValue={`${pct(shadeSessions, sessions)}%`}
                centerLabel="tried a shade"
                segments={[
                  { label: "Tried a shade", value: shadeSessions, color: "#0a3622" },
                  { label: "Browsed only", value: Math.max(sessions - shadeSessions, 0), color: "hatch" },
                ]}
              />
            </section>

            <section className="vc-card" style={{ "--i": 10 }}>
              <div className="vc-card__head">
                <h2 className="vc-card__title">Camera or photo</h2>
              </div>
              {inputTotal === 0 ? (
                <div className="vc-empty">No sessions yet.</div>
              ) : (
                <ul className="vc-list">
                  {[
                    { label: "Live camera", value: cameraSessions },
                    { label: "Photo upload", value: photoSessions },
                  ].map((item) => (
                    <li className="vc-row" key={item.label}>
                      <div className="vc-row__body">
                        <div className="vc-row__title">{item.label}</div>
                        <div className="vc-meter">
                          <span style={{ width: `${pct(item.value, inputTotal)}%` }} />
                        </div>
                      </div>
                      <span className="vc-count">{pct(item.value, inputTotal)}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="vc-card vc-span-2" style={{ "--i": 11 }}>
              <div className="vc-card__head">
                <h2 className="vc-card__title">Top products</h2>
              </div>
              {data.topProducts.length === 0 ? (
                <div className="vc-empty">
                  <strong>No try-on activity yet</strong>
                  Your most-tried products will be listed here.
                </div>
              ) : (
                <ul className="vc-list">
                  {data.topProducts.map((item) => (
                    <li className="vc-row" key={item.id}>
                      <div className="vc-row__body">
                        <div className="vc-row__title">{item.title}</div>
                        <div className="vc-meter">
                          <span style={{ width: `${pct(item.count, topMax)}%` }} />
                        </div>
                      </div>
                      <span className="vc-count">{item.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="vc-card vc-span-2" style={{ "--i": 12 }}>
              <div className="vc-card__head">
                <h2 className="vc-card__title">Recent activity</h2>
              </div>
              {data.recent.length === 0 ? (
                <div className="vc-empty">Nothing yet.</div>
              ) : (
                <ul className="vc-list">
                  {data.recent.map((item, index) => (
                    <li className="vc-row" key={`${item.at}-${index}`}>
                      <span className="vc-dot" />
                      <div className="vc-row__body">
                        <div className="vc-row__title">
                          {EVENT_LABELS[item.event] ?? item.event}
                        </div>
                        <div className="vc-row__meta">{item.title || "Product"}</div>
                      </div>
                      <span className="vc-row__meta">
                        {now ? timeAgo(item.at, now) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </s-page>
  );
}