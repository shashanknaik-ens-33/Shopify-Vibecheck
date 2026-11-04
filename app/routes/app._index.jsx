import { useRef, useState } from "react";
import {
  Link,
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { authenticate } from "../shopify.server";
import { classifyProduct } from "../utils/product-classifier.server";
import StatCard from "../components/dashboard/StatCard";
import StatusPill from "../components/dashboard/StatusPill";
import BarChart from "../components/dashboard/BarChart";
import DonutChart from "../components/dashboard/DonutChart";
import { Camera, Plus, Refresh } from "../components/dashboard/Icons";
import { CATEGORIES, STATUS, statusKeyFor } from "../components/dashboard/status";
import "../styles/dashboard.css";

const PRODUCTS_QUERY = `#graphql
  query VibecheckProducts($cursor: String) {
    products(first: 50, sortKey: TITLE, after: $cursor) {
      nodes {
        id
        title
        handle
        productType
        tags
        status
        featuredImage {
          url
          altText
        }
        metafields(first: 20) {
          nodes {
            namespace
            key
            value
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const MAX_PAGES = 5; // up to 250 products

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";

  try {
    const nodes = [];
    let cursor = null;
    let hasNextPage = true;
    let page = 0;

    while (hasNextPage && page < MAX_PAGES) {
      const response = await admin.graphql(PRODUCTS_QUERY, {
        variables: { cursor },
      });
      const result = await response.json();

      if (result.errors?.length) {
        return {
          products: [],
          truncated: false,
          shop,
          error: result.errors.map((item) => item.message).join("; "),
        };
      }

      const connection = result.data?.products;
      nodes.push(...(connection?.nodes ?? []));
      hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
      cursor = connection?.pageInfo?.endCursor ?? null;
      page += 1;
    }

    const products = nodes.map((product) => ({
      ...product,
      ...classifyProduct(product),
    }));

    return { products, truncated: hasNextPage, error: null, shop };
  } catch (error) {
    return {
      products: [],
      truncated: false,
      shop,
      error:
        error instanceof Error
          ? error.message
          : "Unable to load Shopify products.",
    };
  }
}

const FILTERS = ["all", "live", "prototype", "soon", "unsupported"];

export default function Home() {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { products, error, truncated, shop } = useLoaderData();
  const [filter, setFilter] = useState("all");
  const productsRef = useRef(null);

  // Unchanged: reads the shade metafield so the try-on page can preview it.
  function getProductShade(product) {
    const metafields = product.metafields?.nodes ?? [];

    const preferredKeys = [
      "custom.lipstick_shade",
      "custom.lipstick_color",
      "custom.lipstick_colour",
      "custom.lip_color",
      "custom.lip_colour",
      "custom.shade",
    ];

    const usable = metafields.filter(
      (field) => field?.value && String(field.value).trim()
    );

    const preferred = usable.find((field) =>
      preferredKeys.includes(`${field.namespace}.${field.key}`.toLowerCase())
    );

    if (preferred) return String(preferred.value).trim();

    const fallback = usable.find((field) => {
      const key = `${field.namespace}.${field.key}`.toLowerCase();
      return /shade|lipstick_color|lipstick_colour|lip_color|lip_colour/.test(key);
    });

    return fallback ? String(fallback.value).trim() : "";
  }

  // Unchanged: opens the working try-on page for a product.
  function openTryOn(product) {
    if (product.category === "Unsupported") return;

    const params = new URLSearchParams({
      id: product.id,
      title: product.title,
      category: product.category,
      handle: product.handle,
      image: product.featuredImage?.url || "",
      shade: getProductShade(product),
    });

    window.open(
      `/camera-test?${params.toString()}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  const items = products.map((product) => ({
    ...product,
    status: statusKeyFor(product.category),
  }));

  const countStatus = (key) => items.filter((item) => item.status === key).length;
  const total = items.length;
  const live = countStatus("live");
  const prototype = countStatus("prototype");
  const soon = countStatus("soon");
  const unsupported = countStatus("unsupported");
  const matched = total - unsupported;
  const livePct = total ? Math.round((live / total) * 100) : 0;

  const visible = items.filter((item) => filter === "all" || item.status === filter);

  const shopName = shop ? shop.replace(".myshopify.com", "") : "your store";
  const themeEditorUrl = shop
    ? `https://admin.shopify.com/store/${shopName}/themes/current/editor?context=apps`
    : null;

  function showStatus(key) {
    setFilter(key);
    productsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const chipLabel = (key) =>
    key === "all"
      ? `All ${total}`
      : `${STATUS[key].label} ${countStatus(key)}`;

  return (
    <s-page heading="Home" inlineSize="large">
      <div className="vc">
        <header className="vc-header">
          <div>
            <h1 className="vc-title">Dashboard</h1>
            <p className="vc-subtitle">
              Welcome back, {shopName}. Manage virtual try-on for your catalog.
            </p>
          </div>
          <div className="vc-actions">
            <button
              type="button"
              className="vc-btn vc-btn--primary"
              onClick={() => navigate("/camera-test")}
            >
              <Plus /> Open try-on
            </button>
            <button
              type="button"
              className="vc-btn vc-btn--outline"
              onClick={() => revalidator.revalidate()}
              disabled={revalidator.state === "loading"}
            >
              <Refresh />
              {revalidator.state === "loading" ? "Syncing…" : "Sync products"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="vc-alert" role="alert">
            Unable to load products: {error}. Check product access permissions
            and reauthorize the app if required.
          </div>
        ) : (
          <div className="vc-grid">
            <StatCard
              index={0}
              hero
              title="Total products"
              value={total}
              note={`${matched} matched to a try-on category`}
              onOpen={() => showStatus("all")}
            />
            <StatCard
              index={1}
              title="Live try-on"
              value={live}
              note="Lipstick"
              onOpen={() => showStatus("live")}
            />
            <StatCard
              index={2}
              title="Prototype"
              value={prototype}
              note="Glasses"
              onOpen={() => showStatus("prototype")}
            />
            <StatCard
              index={3}
              title="Coming soon"
              value={soon}
              note="Headbands and clothing"
              onOpen={() => showStatus("soon")}
            />

            <section className="vc-card vc-span-2" style={{ "--i": 4 }}>
              <div className="vc-card__head">
                <h2 className="vc-card__title">Try-ons this week</h2>
                <Link to="/app/analytics" className="vc-link">
                  View analytics
                </Link>
              </div>
              {/* Pass real numbers here (7 values, Sunday first) once event tracking exists. */}
              <BarChart
                data={null}
                emptyText="No try-on activity yet. Sessions will appear here once tracking is switched on."
              />
            </section>

            <section className="vc-card" style={{ "--i": 5 }}>
              <div className="vc-card__head">
                <h2 className="vc-card__title">Quick test</h2>
              </div>
              <p className="vc-quick__big">Try it on yourself</p>
              <p className="vc-quick__sub">
                Open the live camera page to see exactly what your customers
                will see.
              </p>
              <button
                type="button"
                className="vc-btn vc-btn--primary vc-btn--wide"
                onClick={() => navigate("/camera-test")}
              >
                <Camera /> Open try-on
              </button>
            </section>

            <section className="vc-card" style={{ "--i": 6 }}>
              <div className="vc-card__head">
                <h2 className="vc-card__title">Categories</h2>
                <Link to="/app/configuration" className="vc-link">
                  Configure
                </Link>
              </div>
              <ul className="vc-list">
                {CATEGORIES.map((category) => {
                  const key = statusKeyFor(category.name);
                  const count = items.filter(
                    (item) => item.category === category.name
                  ).length;
                  return (
                    <li className="vc-row" key={category.name}>
                      <span
                        className={`vc-row__icon${
                          key === "soon"
                            ? " vc-row__icon--soon"
                            : key === "prototype"
                              ? " vc-row__icon--proto"
                              : ""
                        }`}
                      >
                        {category.name[0]}
                      </span>
                      <div className="vc-row__body">
                        <div className="vc-row__title">{category.name}</div>
                        <div className="vc-row__meta">
                          {count} {count === 1 ? "product" : "products"}
                        </div>
                      </div>
                      <StatusPill status={key} />
                    </li>
                  );
                })}
              </ul>
            </section>

            <section
              className="vc-card vc-span-2"
              style={{ "--i": 7 }}
              ref={productsRef}
            >
              <div className="vc-card__head">
                <h2 className="vc-card__title">Products</h2>
              </div>

              <div className="vc-chips" role="group" aria-label="Filter products">
                {FILTERS.filter((key) => key === "all" || countStatus(key) > 0).map(
                  (key) => (
                    <button
                      key={key}
                      type="button"
                      className="vc-chip"
                      aria-pressed={filter === key}
                      onClick={() => setFilter(key)}
                    >
                      {chipLabel(key)}
                    </button>
                  )
                )}
              </div>

              {truncated ? (
                <p className="vc-note">Showing the first {total} products.</p>
              ) : null}

              {total === 0 ? (
                <div className="vc-empty">
                  <strong>No products yet</strong>
                  Add products in Shopify, then press Sync products.
                </div>
              ) : visible.length === 0 ? (
                <div className="vc-empty">No products in this view.</div>
              ) : (
                <ul className="vc-list vc-scroll">
                  {visible.map((product) => (
                    <li className="vc-row" key={product.id}>
                      {product.featuredImage?.url ? (
                        <img
                          className="vc-thumb"
                          src={product.featuredImage.url}
                          alt={product.featuredImage.altText || product.title}
                          loading="lazy"
                        />
                      ) : (
                        <span className="vc-thumb" />
                      )}
                      <div className="vc-row__body">
                        <div className="vc-row__title">{product.title}</div>
                        <div className="vc-row__meta">{product.category}</div>
                      </div>
                      <StatusPill status={product.status} />
                      <button
                        type="button"
                        className="vc-btn vc-btn--ghost"
                        disabled={product.category === "Unsupported"}
                        onClick={() => openTryOn(product)}
                      >
                        Try on
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="vc-card" style={{ "--i": 8 }}>
              <div className="vc-card__head">
                <h2 className="vc-card__title">Catalog coverage</h2>
              </div>
              <DonutChart
                centerValue={`${livePct}%`}
                centerLabel="of products live"
                segments={[
                  { label: "Live", value: live, color: "#0a3622" },
                  { label: "In development", value: prototype + soon, color: "#2f9e5f" },
                  { label: "Not supported", value: unsupported, color: "hatch" },
                ]}
              />
            </section>

            <section className="vc-card vc-dark" style={{ "--i": 9 }}>
              <div>
                <div className="vc-card__head">
                  <h2 className="vc-card__title">Storefront</h2>
                </div>
                <p className="vc-dark__text">
                  Add the Vibecheck block to your product page in the theme
                  editor so customers can try products on.
                </p>
              </div>
              {themeEditorUrl ? (
                <a
                  className="vc-btn vc-btn--light vc-btn--wide"
                  href={themeEditorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open theme editor
                </a>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </s-page>
  );
}