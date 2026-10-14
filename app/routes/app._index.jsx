
import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(`
      query VibecheckProducts {
        products(first: 50, sortKey: TITLE) {
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
        }
      }
    `);

    const result = await response.json();

    if (result.errors?.length) {
      return {
        products: [],
        error: result.errors.map((item) => item.message).join("; "),
      };
    }

    const products = (result.data?.products?.nodes ?? []).map(
      (product) => {
        const normalize = (value) =>
          String(value ?? "")
            .toLowerCase()
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const title = normalize(product.title);
        const productType = normalize(product.productType);
        const tags = (product.tags ?? []).map(normalize);
        const searchableText = [title, productType, ...tags].join(" ");

        let category = "Unsupported";
        let effectReady = false;

        if (
          /\b(lipsticks?|lip gloss(?:es)?|lipgloss(?:es)?|lip tints?|lip stains?|lip colors?|lip colours?)\b/.test(
            searchableText
          )
        ) {
          category = "Lipstick";
        } else if (
          /\b(headbands?|hair bands?|alice bands?|head wraps?)\b/.test(
            searchableText
          )
        ) {
          category = "Headbands";
        } else if (
          /\b(glasses|eyeglasses|sunglasses|spectacles|eyewear|optical frames?|reading glasses)\b/.test(
            searchableText
          )
        ) {
          category = "Glasses";
          effectReady = true;
        } else if (
          /\b(t shirts?|tshirts?|tees|shirts?|tops|blouses|dresses|hoodies|sweatshirts|jackets|coats|sweaters|jeans|trousers|pants|shorts|skirts|leggings|jumpsuits|rompers|cardigans)\b/.test(
            searchableText
          )
        ) {
          category = "Clothing";
        }

        return {
          ...product,
          category,
          effectReady,
        };
      }
    );

    return { products, error: null };
  } catch (error) {
    return {
      products: [],
      error:
        error instanceof Error
          ? error.message
          : "Unable to load Shopify products.",
    };
  }
}

export default function Index() {
  const navigate = useNavigate();
  const { products, error } = useLoaderData();

  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [uploadEnabled, setUploadEnabled] = useState(true);
  const [autoDetect, setAutoDetect] = useState(true);
  const [filter, setFilter] = useState("All");

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
      preferredKeys.includes(
        `${field.namespace}.${field.key}`.toLowerCase()
      )
    );

    if (preferred) return String(preferred.value).trim();

    const fallback = usable.find((field) => {
      const key = `${field.namespace}.${field.key}`.toLowerCase();

      return (
        /shade|lipstick_color|lipstick_colour|lip_color|lip_colour/.test(
          key
        )
      );
    });

    return fallback ? String(fallback.value).trim() : "";
  }

  function openTryOn(product) {
    if (!autoDetect || product.category === "Unsupported") return;

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

  const filteredProducts = products.filter((product) => {
    if (!autoDetect) {
      return filter === "All" || filter === "Unsupported";
    }

    return filter === "All" || product.category === filter;
  });

  const detectedCount = autoDetect
    ? products.filter((product) => product.category !== "Unsupported").length
    : 0;

  const unsupportedCount = autoDetect
    ? products.filter((product) => product.category === "Unsupported").length
    : products.length;

  const categories = [
    {
      icon: "👓",
      name: "Glasses",
      description: "Live face tracking and glasses overlay",
      status: "Prototype working",
    },
    {
      icon: "💄",
      name: "Lipstick",
      description: "Lip tracking and shade preview",
      status: "Effect in development",
    },
    {
      icon: "🎀",
      name: "Headbands",
      description: "Forehead tracking and accessory overlay",
      status: "Effect in development",
    },
    {
      icon: "👕",
      name: "Clothing",
      description: "Clothing preview and garment overlay",
      status: "Effect in development",
    },
  ];

  const settings = [
    {
      title: "Live camera",
      description: "Allow customers to use their camera.",
      checked: cameraEnabled,
      change: setCameraEnabled,
    },
    {
      title: "Upload photo",
      description: "Allow customers to upload a photo.",
      checked: uploadEnabled,
      change: setUploadEnabled,
    },
    {
      title: "Automatic product detection",
      description: "Classify products using titles, product types and tags.",
      checked: autoDetect,
      change: setAutoDetect,
    },
  ];

  return (
    <s-page heading="Vibecheck Dashboard">
      <s-section>
        <s-box padding="large" borderRadius="large" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>Virtual try-on, made for your store</s-heading>
            <s-paragraph>
              Detect products from your Shopify catalog and prepare the
              appropriate virtual try-on experience.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={() => navigate("/camera-test")}
              >
                Test live glasses
              </s-button>
              <s-button onClick={() => navigate("/app/additional")}>
                More app tools
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Your product catalog">
        {error ? (
          <s-banner tone="critical">
            Unable to load products: {error}. Check product access permissions
            and reauthorize the app if required.
          </s-banner>
        ) : (
          <>
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))"
              gap="base"
            >
              <s-grid-item>
                <s-box padding="base" border="base" borderRadius="large">
                  <s-heading>Total products loaded</s-heading>
                  <s-text>{products.length}</s-text>
                </s-box>
              </s-grid-item>
              <s-grid-item>
                <s-box padding="base" border="base" borderRadius="large">
                  <s-heading>Categories detected</s-heading>
                  <s-text>{detectedCount}</s-text>
                </s-box>
              </s-grid-item>
              <s-grid-item>
                <s-box padding="base" border="base" borderRadius="large">
                  <s-heading>Unsupported products</s-heading>
                  <s-text>{unsupportedCount}</s-text>
                </s-box>
              </s-grid-item>
            </s-grid>

            <s-stack direction="inline" gap="base">
              {[
                "All",
                "Glasses",
                "Lipstick",
                "Headbands",
                "Clothing",
                "Unsupported",
              ].map((item) => (
                <s-button
                  key={item}
                  variant={filter === item ? "primary" : "secondary"}
                  onClick={() => setFilter(item)}
                >
                  {item}
                </s-button>
              ))}
            </s-stack>

            {!autoDetect && (
              <s-banner tone="info">
                Automatic detection is disabled. Products are shown as
                unclassified until you enable detection again.
              </s-banner>
            )}

            {products.length === 0 ? (
              <s-banner tone="info">
                No products were returned. Check your Shopify catalog and
                product access permissions.
              </s-banner>
            ) : filteredProducts.length === 0 ? (
              <s-banner tone="info">
                No products match this filter.
              </s-banner>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Product</s-table-header>
                  <s-table-header>Product type</s-table-header>
                  <s-table-header>Detected category</s-table-header>
                  <s-table-header>Try-on status</s-table-header>
                  <s-table-header>Action</s-table-header>
                </s-table-header-row>

                <s-table-body>
                  {filteredProducts.map((product) => (
                    <s-table-row key={product.id}>
                      <s-table-cell>
                        <s-stack
                          direction="inline"
                          gap="base"
                          align="center"
                        >
                          {product.featuredImage?.url ? (
                            <s-thumbnail
                              src={product.featuredImage.url}
                              alt={
                                product.featuredImage.altText || product.title
                              }
                              size="small"
                            />
                          ) : null}
                          <s-stack direction="block" gap="small">
                            <s-text>{product.title}</s-text>
                            <s-text>{product.status}</s-text>
                          </s-stack>
                        </s-stack>
                      </s-table-cell>

                      <s-table-cell>
                        {product.productType || "Not set"}
                      </s-table-cell>

                      <s-table-cell>
                        {autoDetect ? product.category : "Unclassified"}
                      </s-table-cell>

                      <s-table-cell>
                        {!autoDetect
                          ? "Detection disabled"
                          : product.effectReady
                            ? "Glasses prototype"
                            : product.category === "Unsupported"
                              ? "Not supported"
                              : "Effect in development"}
                      </s-table-cell>

                      <s-table-cell>
                        <s-button
                          variant="primary"
                          disabled={
                            !autoDetect ||
                            product.category === "Unsupported"
                          }
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
          </>
        )}
      </s-section>

      <s-section heading="Try-on categories">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
          gap="base"
        >
          {categories.map((category) => (
            <s-grid-item key={category.name}>
              <s-box padding="base" border="base" borderRadius="large">
                <s-stack direction="block" gap="small">
                  <s-heading>
                    {category.icon} {category.name}
                  </s-heading>
                  <s-paragraph>{category.description}</s-paragraph>
                  <s-badge
                    color={category.name === "Glasses" ? "success" : "warning"}
                  >
                    {category.status}
                  </s-badge>
                </s-stack>
              </s-box>
            </s-grid-item>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Try-on settings">
        <s-stack direction="block" gap="base">
          {settings.map((setting) => (
            <s-box
              key={setting.title}
              padding="base"
              border="base"
              borderRadius="large"
            >
              <s-stack direction="inline" gap="base" align="center">
                <s-stack direction="block" gap="small">
                  <s-heading>{setting.title}</s-heading>
                  <s-paragraph>{setting.description}</s-paragraph>
                </s-stack>
                <s-spacer />
                <s-switch
                  checked={setting.checked}
                  onChange={(event) =>
                    setting.change(event.currentTarget.checked)
                  }
                />
              </s-stack>
            </s-box>
          ))}
        </s-stack>

        <s-banner tone="info">
          These settings currently live in the dashboard session only. They
          are not yet saved or connected to the storefront extension.
        </s-banner>
      </s-section>

      <s-section heading="Development status">
        <s-banner tone="success">
          MediaPipe face tracking and the basic glasses prototype are available
          on the camera test page.
        </s-banner>
        <s-banner tone="info">
          Detection uses product titles, product types and tags. Lipstick,
          headband and clothing effects are still in development.
        </s-banner>
      </s-section>

      <s-section slot="aside" heading="Development roadmap">
        <s-unordered-list>
          <s-list-item>
            Improve glasses alignment and add real product assets.
          </s-list-item>
          <s-list-item>
            Connect detected products to their matching try-on effects.
          </s-list-item>
          <s-list-item>
            Develop lipstick, headband and clothing overlays.
          </s-list-item>
          <s-list-item>
            Save dashboard settings and connect the storefront.
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
