import prisma from "../db.server";

const DAY = 24 * 60 * 60 * 1000;

// Timestamps of try-on opens in the last 7 days (the browser buckets them by day).
export async function getRecentTryOnTimes(shop) {
  if (!shop) return [];
  try {
    const rows = await prisma.tryOnEvent.findMany({
      where: {
        shop,
        event: "tryon_opened",
        createdAt: { gte: new Date(Date.now() - 7 * DAY) },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    return rows.map((row) => row.createdAt.toISOString());
  } catch (error) {
    console.error("Vibecheck: could not read analytics", error);
    return [];
  }
}

export async function getAnalyticsSummary(shop) {
  const empty = {
    sessions: 0,
    visitors: 0,
    cameraSessions: 0,
    photoSessions: 0,
    shadeSessions: 0,
    orders: 0,
    revenue: 0,
    currency: null,
    boughtTried: 0,
    topProducts: [],
    recent: [],
    weekTimes: [],
    hasData: false,
    error: null,
  };
  if (!shop) return empty;

  try {
    const now = Date.now();
    const rows = await prisma.tryOnEvent.findMany({
      where: { shop, createdAt: { gte: new Date(now - 30 * DAY) } },
      select: {
        event: true,
        sessionId: true,
        visitorId: true,
        productId: true,
        productTitle: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20000,
    });

    const orderRows = await prisma.tryOnOrder.findMany({
      where: { shop, createdAt: { gte: new Date(now - 30 * DAY) } },
      select: { totalPrice: true, currency: true, boughtTriedItem: true },
      take: 5000,
    });

    const sessions = new Set();
    const visitors = new Set();
    const camera = new Set();
    const photo = new Set();
    const shade = new Set();
    const products = new Map();
    const weekTimes = [];
    const weekStart = now - 7 * DAY;

    for (const row of rows) {
      sessions.add(row.sessionId);
      visitors.add(row.visitorId);
      if (row.event === "camera_started") camera.add(row.sessionId);
      if (row.event === "photo_uploaded") photo.add(row.sessionId);
      if (row.event === "shade_selected") shade.add(row.sessionId);

      if (row.event === "tryon_opened") {
        if (row.createdAt.getTime() >= weekStart) {
          weekTimes.push(row.createdAt.toISOString());
        }
        if (row.productId) {
          const entry = products.get(row.productId) ?? {
            id: row.productId,
            title: row.productTitle || "Product",
            count: 0,
          };
          entry.count += 1;
          products.set(row.productId, entry);
        }
      }
    }

    return {
      orders: orderRows.length,
      revenue: orderRows.reduce((sum, row) => sum + row.totalPrice, 0),
      currency: orderRows.find((row) => row.currency)?.currency ?? null,
      boughtTried: orderRows.filter((row) => row.boughtTriedItem).length,
      sessions: sessions.size,
      visitors: visitors.size,
      cameraSessions: camera.size,
      photoSessions: photo.size,
      shadeSessions: shade.size,
      topProducts: [...products.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      recent: rows.slice(0, 8).map((row) => ({
        event: row.event,
        title: row.productTitle || "",
        at: row.createdAt.toISOString(),
      })),
      weekTimes,
      hasData: rows.length > 0 || orderRows.length > 0,
      error: null,
    };
  } catch (error) {
    console.error("Vibecheck: could not read analytics", error);
    return { ...empty, error: "Analytics are temporarily unavailable." };
  }
}