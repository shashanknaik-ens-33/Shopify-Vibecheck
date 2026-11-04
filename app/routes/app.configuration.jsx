import StatusPill from "../components/dashboard/StatusPill";
import { CATEGORIES, statusKeyFor } from "../components/dashboard/status";
import "../styles/dashboard.css";

const PLANNED = [
  {
    title: "Product detection",
    text: "Add your own keywords and decide how products are matched to a category.",
  },
  {
    title: "Product overrides",
    text: "Assign a product to a category by hand, or leave it out of try-on.",
  },
  {
    title: "Lipstick shades",
    text: "Choose the product field that holds each shade colour.",
  },
];

export default function Configuration() {
  return (
    <s-page heading="Configuration" inlineSize="large">
      <div className="vc">
        <header className="vc-header">
          <div>
            <h1 className="vc-title">Configuration</h1>
            <p className="vc-subtitle">
              Decide which products get which try-on effect.
            </p>
          </div>
        </header>

        <div className="vc-grid">
          <section className="vc-card vc-span-2" style={{ "--i": 0 }}>
            <div className="vc-card__head">
              <h2 className="vc-card__title">Try-on categories</h2>
            </div>
            <ul className="vc-list">
              {CATEGORIES.map((category) => (
                <li className="vc-row" key={category.name}>
                  <span className="vc-row__icon">{category.name[0]}</span>
                  <div className="vc-row__body">
                    <div className="vc-row__title">{category.name}</div>
                    <div className="vc-row__meta">{category.description}</div>
                  </div>
                  <StatusPill status={statusKeyFor(category.name)} />
                </li>
              ))}
            </ul>
          </section>

          <section className="vc-card vc-span-2" style={{ "--i": 1 }}>
            <div className="vc-card__head">
              <h2 className="vc-card__title">Coming next</h2>
            </div>
            <ul className="vc-list">
              {PLANNED.map((item) => (
                <li className="vc-row" key={item.title}>
                  <div className="vc-row__body">
                    <div className="vc-row__title">{item.title}</div>
                    <div className="vc-row__meta" style={{ whiteSpace: "normal" }}>
                      {item.text}
                    </div>
                  </div>
                  <span className="vc-pill vc-pill--soon">Coming soon</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </s-page>
  );
}