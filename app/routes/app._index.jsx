import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { classifyProduct } from "../utils/product-classifier.server";

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
  const { admin } = await authenticate.admin(request);

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

    return { products, truncated: hasNextPage, error: null };
  } catch (error) {
    return {
      products: [],
      truncated: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to load Shopify products.",
    };
  }
}

const CATEGORIES = [
  { name: "Glasses", description: "Live face tracking and frame overlay", live: true },
  { name: "Lipstick", description: "Lip tracking and shade preview", live: false },
  { name: "Headbands", description: "Forehead tracking and accessory overlay", live: false },
  { name: "Clothing", description: "Garment preview", live: false },
];

const FILTERS = ["All", "Glasses", "Lipstick", "Headbands", "Clothing", "Unsupported"];

export default function Home() {
  const navigate = useNavigate();
  const { products, error, truncated } = useLoaderData();
  const [filter, setFilter] = useState("All");

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

  const countFor = (name) =>
    products.filter((product) => product.category === name).length;

  const matched = products.length - countFor("Unsupported");

  const filteredProducts = products.filter(
    (product) => filter === "All" || product.category === filter
  );

  const headline =
    products.length === 0
      ? "No products to show yet"
      : `${matched} of ${products.length} products can be tried on`;

  const setup = [
    { label: "Products connected", done: !error && products.length > 0 },
    { label: "Products matched to a category", done: matched > 0 },
    { label: "Settings saved to your store", done: false, note: "Coming soon" },
  ];

  return (
    <s-page heading="Home">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/camera-test")}
      >
        Test live glasses
      </s-button>

      {error ? (
        <s-banner tone="critical">
          Unable to load products: {error}. Check product access permissions
          and reauthorize the app if required.
        </s-banner>
      ) : (
        <>
          <s-section>
            <s-stack direction="block" gap="small">
              <s-heading>{headline}</s-heading>
              <s-text color="subdued">
                Vibecheck reads your product titles, types and tags to choose
                the right virtual try-on for each item.
              </s-text>
            </s-stack>
          </s-section>

          <s-section heading="Try-on categories">
            <s-stack direction="block" gap="base">
              {CATEGORIES.map((category, index) => (
                <s-stack key={category.name} direction="block" gap="base">
                  {index > 0 ? <s-divider /> : null}
                  <s-stack direction="inline" gap="base" alignItems="center">
                    <s-stack direction="block" gap="small">
                      <s-text type="strong">{category.name}</s-text>
                      <s-text color="subdued">{category.description}</s-text>
                    </s-stack>
                    <s-spacer />
                    <s-text color="subdued">
                      {countFor(category.name)}{" "}
                      {countFor(category.name) === 1 ? "product" : "products"}
                    </s-text>
                    <s-badge tone={category.live ? "success" : "neutral"}>
                      {category.live ? "Live prototype" : "Coming soon"}
                    </s-badge>
                  </s-stack>
                </s-stack>
              ))}
            </s-stack>
          </s-section>

          <s-section heading="Products">
            <s-stack direction="inline" gap="small">
              {FILTERS.map((item) => (
                <s-button
                  key={item}
                  variant={filter === item ? "primary" : "secondary"}
                  onClick={() => setFilter(item)}
                >
                  {item === "All" ? `All ${products.length}` : `${item} ${countFor(item)}`}
                </s-button>
              ))}
            </s-stack>

            {truncated ? (
              <s-banner tone="info">
                Showing the first {products.length} products.
              </s-banner>
            ) : null}

            {products.length === 0 ? (
              <s-banner tone="info">
                No products were returned. Add products in Shopify or check
                product access permissions.
              </s-banner>
            ) : filteredProducts.length === 0 ? (
              <s-banner tone="info">No products in this category.</s-banner>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Product</s-table-header>
                  <s-table-header>Category</s-table-header>
                  <s-table-header>Try-on</s-table-header>
                  <s-table-header>Action</s-table-header>
                </s-table-header-row>

                <s-table-body>
                  {filteredProducts.map((product) => (
                    <s-table-row key={product.id}>
                      <s-table-cell>
                        <s-stack direction="inline" gap="base" alignItems="center">
                          {product.featuredImage?.url ? (
                            <s-thumbnail
                              src={product.featuredImage.url}
                              alt={product.featuredImage.altText || product.title}
                              size="small"
                            />
                          ) : null}
                          <s-stack direction="block" gap="small">
                            <s-text type="strong">{product.title}</s-text>
                            <s-text color="subdued">
                              {product.productType || "No product type"}
                            </s-text>
                          </s-stack>
                        </s-stack>
                      </s-table-cell>

                      <s-table-cell>{product.category}</s-table-cell>

                      <s-table-cell>
                        {product.effectReady ? (
                          <s-badge tone="success">Prototype</s-badge>
                        ) : product.category === "Unsupported" ? (
                          <s-badge tone="neutral">Not supported</s-badge>
                        ) : (
                          <s-badge tone="warning">Coming soon</s-badge>
                        )}
                      </s-table-cell>

                      <s-table-cell>
                        <s-button
                          disabled={product.category === "Unsupported"}
                          onClick={() => openTryOn(product)}
                        >
                          Try on
                        </s-button>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-section>
        </>
      )}

      <s-section slot="aside" heading="Setup">
        <s-stack direction="block" gap="base">
          {setup.map((item) => (
            <s-stack key={item.label} direction="inline" gap="small" alignItems="center">
              <s-text>{item.label}</s-text>
              <s-spacer />
              <s-badge tone={item.done ? "success" : "neutral"}>
                {item.done ? "Done" : item.note || "To do"}
              </s-badge>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}