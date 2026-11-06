// Browser-side tracker used by the try-on page (camera-test.jsx).
// It only records shoppers on a real storefront: the shop is read from the page
// that embeds the try-on. Merchant tests from the dashboard are never counted.

const ENDPOINT = "/api/track";
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

let sessionId = "";
let currentProduct = {};
let cachedShop;
let announced = false;

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

    const body = JSON.stringify({
      event,
      shop,
      sessionId: getSessionId(),
      visitorId: getVisitorId(),
      productId: currentProduct.id ? String(currentProduct.id) : "",
      productTitle: currentProduct.title || "",
    });

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
  } catch {
    // Tracking must never break the try-on.
  }
}