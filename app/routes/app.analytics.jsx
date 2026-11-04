import StatCard from "../components/dashboard/StatCard";
import BarChart from "../components/dashboard/BarChart";
import "../styles/dashboard.css";

export default function Analytics() {
  return (
    <s-page heading="Analytics" inlineSize="large">
      <div className="vc">
        <header className="vc-header">
          <div>
            <h1 className="vc-title">Analytics</h1>
            <p className="vc-subtitle">
              See how customers use virtual try-on on your store.
            </p>
          </div>
        </header>

        <div className="vc-grid">
          <StatCard index={0} hero title="Try-on sessions" value="—" />
          <StatCard index={1} title="Unique visitors" value="—" />
          <StatCard index={2} title="Camera sessions" value="—" />
          <StatCard index={3} title="Photo uploads" value="—" />

          <section className="vc-card vc-span-2" style={{ "--i": 4 }}>
            <div className="vc-card__head">
              <h2 className="vc-card__title">Try-ons this week</h2>
            </div>
            <BarChart
              data={null}
              emptyText="No try-on activity yet. Sessions will appear here once tracking is switched on."
            />
          </section>

          <section className="vc-card vc-span-2" style={{ "--i": 5 }}>
            <div className="vc-card__head">
              <h2 className="vc-card__title">Top products</h2>
            </div>
            <div className="vc-empty">
              <strong>No try-on activity yet</strong>
              Once customers start trying products on, your most-tried products
              will be listed here.
            </div>
          </section>
        </div>
      </div>
    </s-page>
  );
}