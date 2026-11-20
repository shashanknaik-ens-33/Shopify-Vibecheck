// Browser-side tracker used by the try-on page (camera-test.jsx).
// It only records shoppers on a real storefront: the shop is read from the page
// that embeds the try-on. Merchant tests from the dashboard are never counted.

const ENDPOINT = "/api/track";
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

let sessionId = "";
let currentProduct = {};
let cachedShop;
let announced = false;
let listening = false;

function uid() {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function getSessionId() {
  if (!sessionId) sessionId = uid();
  return sessionId;
}

function getVisitorId() {
  try {
    let id = localStorage.getItem("vc_vid");
    if (!id) {
      id = uid();
      localStorage.setItem("vc_vid", id);
    }
    return id;
  } catch {
    return getSessionId();
  }
}

function detectShop() {
  if (cachedShop !== undefined) return cachedShop;
  let found = "";

  try {
    const host = new URL(document.referrer).hostname;
    if (SHOP_RE.test(host)) found = host.toLowerCase();
  } catch {}

  if (!found) {
    try {
      const origins = window.location.ancestorOrigins;
      for (let i = 0; i < (origins?.length || 0); i += 1) {
        const host = new URL(origins[i]).hostname;
        if (SHOP_RE.test(host)) {
          found = host.toLowerCase();
          break;
        }
      }
    } catch {}
  }

  if (!found) {
    const fromQuery = new URLSearchParams(window.location.search).get("shop") || "";
    if (SHOP_RE.test(fromQuery)) found = fromQuery.toLowerCase();
  }

  cachedShop = found;
  return found;
}

function send(payload) {
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon(
      ENDPOINT,
      new Blob([body], { type: "application/json" })
    );
    if (sent) return;
  }

  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function trackTryOn(event, product) {
  if (typeof window === "undefined") return;

  try {
    if (product) currentProduct = { id: product.id, title: product.title };

    const shop = detectShop();
    if (!shop) return;

    // Let the storefront page remember this session on the cart, so a later
    // order can be linked back to this try-on.
    if (!announced) {
      announced = true;
      window.parent?.postMessage(
        { type: "VIBECHECK_SESSION", sessionId: getSessionId() },
        "*"
      );
    }

    send({
      event,
      shop,
      sessionId: getSessionId(),
      visitorId: getVisitorId(),
      productId: currentProduct.id ? String(currentProduct.id) : "",
      productTitle: currentProduct.title || "",
    });
  } catch {
    // Tracking must never break the try-on.
  }
}

// If the shopper is logged in to the store, the storefront page tells us who they are.
if (typeof window !== "undefined" && !listening) {
  listening = true;
  window.addEventListener("message", (event) => {
    try {
      if (event.source !== window.parent) return;
      const data = event.data;
      const customer =
        data?.type === "VIBECHECK_CUSTOMER"
          ? data
          : data?.type === "VIBECHECK_DATA"
            ? data.customer
            : null;
      if (!customer?.id && !customer?.customerId) return;

      const shop = detectShop();
      if (!shop) return;

      send({
        event: "customer_identified",
        shop,
        sessionId: getSessionId(),
        visitorId: getVisitorId(),
        customerId: String(customer.id || customer.customerId).slice(0, 40),
        customerName: String(
          customer.customerName ||
            [customer.firstName, customer.lastName].filter(Boolean).join(" ")
        ).slice(0, 120),
        customerEmail: String(customer.email || customer.customerEmail || "").slice(0, 160),
      });
    } catch {
      // Ignore anything unexpected.
    }
  });
}
