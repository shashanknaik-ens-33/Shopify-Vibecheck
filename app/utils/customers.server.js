import prisma from "../db.server";

const DAY = 24 * 60 * 60 * 1000;
// A checkout with no activity for this long counts as abandoned.
const ABANDON_AFTER_MS = 60 * 60 * 1000;

const idsOf = (value) => String(value || "").split(",").filter(Boolean);

// Purchased and abandoned-checkout shoppers who used try-on first.
export async function getCustomerRows(shop) {
  const empty = {
    rows: [],
    stats: { purchased: 0, abandoned: 0, abandonedValue: 0, currency: null },
    error: null,
  };
  if (!shop) return empty;

  try {
    const now = Date.now();
    const since = new Date(now - 30 * DAY);
    const cutoff = new Date(now - ABANDON_AFTER_MS);

    const [orders, checkouts, purchased, abandoned] = await Promise.all([
      prisma.tryOnOrder.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.tryOnCheckout.findMany({
        where: { shop, completedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      prisma.tryOnOrder.count({ where: { shop, createdAt: { gte: since } } }),
      prisma.tryOnCheckout.aggregate({
        where: { shop, completedAt: null, updatedAt: { gte: since, lt: cutoff } },
        _count: { _all: true },
        _sum: { totalPrice: true },
      }),
    ]);

    const sessionIds = [
      ...new Set([
        ...orders.flatMap((row) => idsOf(row.sessionIds)),
        ...checkouts.flatMap((row) => idsOf(row.sessionIds)),
      ]),
    ];

    const events = sessionIds.length
      ? await prisma.tryOnEvent.findMany({
          where: { shop, sessionId: { in: sessionIds } },
          select: { sessionId: true, event: true, productTitle: true },
        })
      : [];

    const bySession = new Map();
    for (const row of events) {
      const entry = bySession.get(row.sessionId) ?? {
        products: new Set(),
        camera: false,
        photo: false,
      };
      if (
        row.productTitle &&
        (row.event === "tryon_opened" || row.event === "shade_selected")
      ) {
        entry.products.add(row.productTitle);
      }
      if (row.event === "camera_started") entry.camera = true;
      if (row.event === "photo_uploaded") entry.photo = true;
      bySession.set(row.sessionId, entry);
    }

    const summarize = (sessionIdString) => {
      const tried = new Set();
      let camera = false;
      let photo = false;
      for (const id of idsOf(sessionIdString)) {
        const entry = bySession.get(id);
        if (!entry) continue;
        entry.products.forEach((title) => tried.add(title));
        camera = camera || entry.camera;
        photo = photo || entry.photo;
      }
      return {
        tried: [...tried],
        method: camera && photo ? "Camera and photo" : camera ? "Camera" : photo ? "Photo" : "",
      };
    };

    const orderRows = orders.map((row) => ({
      id: `o-${row.id}`,
      status: "purchased",
      orderName: row.orderName || "",
      name: row.customerName || "",
      email: row.customerEmail || "",
      place: [row.customerCity, row.customerCountry].filter(Boolean).join(", "),
      items: row.itemSummary || "",
      ...summarize(row.sessionIds),
      total: row.totalPrice,
      currency: row.currency,
      boughtTriedItem: row.boughtTriedItem,
      recoveryUrl: "",
      at: row.createdAt.toISOString(),
    }));

    const checkoutRows = checkouts.map((row) => ({
      id: `c-${row.id}`,
      status: row.updatedAt < cutoff ? "abandoned" : "checkout",
      orderName: "",
      name: row.customerName || "",
      email: row.customerEmail || "",
      place: [row.customerCity, row.customerCountry].filter(Boolean).join(", "),
      items: row.itemSummary || "",
      ...summarize(row.sessionIds),
      total: row.totalPrice,
      currency: row.currency,
      boughtTriedItem: false,
      recoveryUrl: row.recoveryUrl || "",
      at: row.updatedAt.toISOString(),
    }));

    const rows = [...orderRows, ...checkoutRows].sort((a, b) => (a.at < b.at ? 1 : -1));

    return {
      rows,
      stats: {
        purchased,
        abandoned: abandoned._count._all,
        abandonedValue: abandoned._sum.totalPrice ?? 0,
        currency: orders[0]?.currency ?? checkouts[0]?.currency ?? null,
      },
      error: null,
    };
  } catch (error) {
    console.error("Vibecheck: could not read customers", error);
    return { ...empty, error: "Customer details are temporarily unavailable." };
  }
}