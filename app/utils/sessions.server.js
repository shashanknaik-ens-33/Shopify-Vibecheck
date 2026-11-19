import prisma from "../db.server";

const DAY = 24 * 60 * 60 * 1000;
const ABANDON_AFTER_MS = 60 * 60 * 1000;
const idsOf = (value) => String(value || "").split(",").filter(Boolean);

// One row per try-on session in the last 30 days, with the shopper's identity when known
// (from their order, their checkout, or because they were logged in to the store).
export async function getSessionRows(shop) {
  if (!shop) return { rows: [], error: null };

  try {
    const now = Date.now();
    const since = new Date(now - 30 * DAY);
    const cutoff = now - ABANDON_AFTER_MS;

    const [events, orders, checkouts] = await Promise.all([
      prisma.tryOnEvent.findMany({
        where: { shop, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 5000,
        select: {
          sessionId: true,
          visitorId: true,
          event: true,
          productTitle: true,
          createdAt: true,
        },
      }),
      prisma.tryOnOrder.findMany({
        where: { shop, createdAt: { gte: since } },
        take: 300,
      }),
      prisma.tryOnCheckout.findMany({
        where: { shop, updatedAt: { gte: since } },
        orderBy: { updatedAt: "desc" },
        take: 300,
      }),
    ]);

    const sessions = new Map();
    for (const row of events) {
      const entry = sessions.get(row.sessionId) ?? {
        sessionId: row.sessionId,
        visitorId: row.visitorId,
        last: row.createdAt,
        products: new Set(),
        camera: false,
        photo: false,
        shade: false,
      };
      if (row.createdAt > entry.last) entry.last = row.createdAt;
      if (
        row.productTitle &&
        (row.event === "tryon_opened" || row.event === "shade_selected")
      ) {
        entry.products.add(row.productTitle);
      }
      if (row.event === "camera_started") entry.camera = true;
      if (row.event === "photo_uploaded") entry.photo = true;
      if (row.event === "shade_selected") entry.shade = true;
      sessions.set(row.sessionId, entry);
    }

    const list = [...sessions.values()]
      .sort((a, b) => b.last - a.last)
      .slice(0, 100);

    const visitors = list.length
      ? await prisma.tryOnVisitor.findMany({
          where: { shop, visitorId: { in: [...new Set(list.map((s) => s.visitorId))] } },
        })
      : [];
    const visitorById = new Map(visitors.map((v) => [v.visitorId, v]));

    const orderBySession = new Map();
    for (const order of orders) {
      idsOf(order.sessionIds).forEach((id) => orderBySession.set(id, order));
    }
    const checkoutBySession = new Map();
    for (const checkout of checkouts) {
      idsOf(checkout.sessionIds).forEach((id) => {
        if (!checkoutBySession.has(id)) checkoutBySession.set(id, checkout);
      });
    }

    const rows = list.map((entry) => {
      const order = orderBySession.get(entry.sessionId);
      const checkout = checkoutBySession.get(entry.sessionId);
      const visitor = visitorById.get(entry.visitorId);

      let outcome = "browsed";
      let source = null;
      if (order) {
        outcome = "purchased";
        source = order;
      } else if (checkout) {
        outcome = checkout.completedAt
          ? "purchased"
          : checkout.updatedAt.getTime() < cutoff
            ? "abandoned"
            : "checkout";
        source = checkout;
      }

      // Identity: order, then checkout, then logged-in account.
      let name = source?.customerName || "";
      let email = source?.customerEmail || "";
      let origin = source && (name || email) ? (order ? "order" : "checkout") : "";
      if (!name && !email && (visitor?.customerName || visitor?.customerEmail)) {
        name = visitor.customerName || "";
        email = visitor.customerEmail || "";
        origin = "account";
      }

      return {
        id: entry.sessionId,
        visitor: entry.visitorId.slice(0, 6),
        at: entry.last.toISOString(),
        tried: [...entry.products],
        method:
          entry.camera && entry.photo
            ? "Camera and photo"
            : entry.camera
              ? "Camera"
              : entry.photo
                ? "Photo"
                : "Opened only",
        shade: entry.shade,
        outcome,
        name,
        email,
        origin,
        place: source
          ? [source.customerCity, source.customerCountry].filter(Boolean).join(", ")
          : "",
        total: source ? source.totalPrice : 0,
        currency: source?.currency ?? null,
        orderName: order?.orderName || (checkout?.completedAt ? "Order placed" : ""),
        items: order?.itemSummary || checkout?.itemSummary || "",
      };
    });

    return { rows, error: null };
  } catch (error) {
    console.error("Vibecheck: could not read sessions", error);
    return { rows: [], error: "Session details are temporarily unavailable." };
  }
}
