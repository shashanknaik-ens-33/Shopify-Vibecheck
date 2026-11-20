import prisma from "../db.server";

const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const LAST_SYNC = new Map();
const SYNC_INTERVAL_MS = 60 * 1000;

const splitIds = (value) =>
  String(value || "")
    .split(",")
    .map((id) => id.trim().slice(0, 64))
    .filter(Boolean)
    .slice(0, 5);

const ORDER_QUERY = `#graphql
  query VibecheckRecentOrders {
    orders(first: 100, sortKey: CREATED_AT, reverse: true) {
      nodes {
        legacyResourceId
        name
        createdAt
        email
        customer {
          legacyResourceId
          firstName
          lastName
          email
        }
        shippingAddress {
          firstName
          lastName
          city
          country
        }
        billingAddress {
          firstName
          lastName
          city
          country
        }
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        customAttributes {
          key
          value
        }
        lineItems(first: 100) {
          nodes {
            title
            product {
              legacyResourceId
            }
            customAttributes {
              key
              value
            }
          }
        }
      }
    }
  }
`;

export async function findMatchingTryOnSessions(shop, productIds, orderAt) {
  const uniqueProductIds = [...new Set(productIds.map(String).filter(Boolean))];
  if (!shop || uniqueProductIds.length === 0) return [];

  const at = orderAt instanceof Date ? orderAt : new Date(orderAt);
  if (Number.isNaN(at.getTime())) return [];

  const events = await prisma.tryOnEvent.findMany({
    where: {
      shop,
      event: "tryon_opened",
      productId: { in: uniqueProductIds },
      createdAt: {
        gte: new Date(at.getTime() - MATCH_WINDOW_MS),
        lte: at,
      },
    },
    select: { sessionId: true, productId: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // Pick the closest prior try-on for each product in the order.
  const sessionsByProduct = new Map();
  for (const event of events) {
    if (!sessionsByProduct.has(event.productId)) {
      sessionsByProduct.set(event.productId, event.sessionId);
    }
  }
  return [...new Set(sessionsByProduct.values())].slice(0, 5);
}

function sessionIdsForOrder(order) {
  const orderAttribute = order.customAttributes?.find(
    (attribute) => attribute.key === "vibecheck_session"
  )?.value;
  const lineAttributes = (order.lineItems?.nodes || []).flatMap((item) =>
    (item.customAttributes || [])
      .filter((attribute) => attribute.key === "_vibecheck_session")
      .map((attribute) => attribute.value)
  );
  return [orderAttribute, ...lineAttributes].flatMap(splitIds).slice(0, 5);
}

export async function syncRecentTryOnOrders(admin, shop) {
  if (!admin || !shop) return;
  const now = Date.now();
  if ((LAST_SYNC.get(shop) || 0) > now - SYNC_INTERVAL_MS) return;
  LAST_SYNC.set(shop, now);

  try {
    const response = await admin.graphql(ORDER_QUERY);
    const result = await response.json();
    if (result.errors?.length) {
      throw new Error(result.errors.map((item) => item.message).join("; "));
    }

    const since = now - 30 * 24 * 60 * 60 * 1000;
    const recentOrders = (result.data?.orders?.nodes || []).filter(
      (order) => new Date(order.createdAt).getTime() >= since
    );

    for (const order of recentOrders) {
      const lineItems = order.lineItems?.nodes || [];
      const boughtProducts = lineItems
        .map((item) => item.product?.legacyResourceId)
        .filter(Boolean)
        .map(String);
      let sessionIds = sessionIdsForOrder(order);

      if (!sessionIds.length) {
        sessionIds = await findMatchingTryOnSessions(
          shop,
          boughtProducts,
          new Date(order.createdAt)
        );
      }
      if (!sessionIds.length) continue;

      const known = await prisma.tryOnEvent.findMany({
        where: { shop, sessionId: { in: sessionIds } },
        select: { sessionId: true, event: true, productId: true },
      });
      if (!known.length) continue;

      const triedProducts = new Set(
        known
          .filter((event) => event.event === "tryon_opened" && event.productId)
          .map((event) => String(event.productId))
      );
      const address = order.shippingAddress || order.billingAddress || {};
      const customer = order.customer || {};
      const customerName =
        [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
        [address.firstName, address.lastName].filter(Boolean).join(" ") ||
        null;
      const data = {
        shop,
        orderId: String(order.legacyResourceId),
        orderName: order.name || null,
        customerId: customer.legacyResourceId
          ? String(customer.legacyResourceId)
          : null,
        customerName,
        customerEmail: order.email || customer.email || null,
        customerCity: address.city || null,
        customerCountry: address.country || null,
        itemSummary:
          lineItems.map((item) => item.title).filter(Boolean).join(", ").slice(0, 300) || null,
        totalPrice: Number.parseFloat(order.totalPriceSet?.shopMoney?.amount) || 0,
        currency: order.totalPriceSet?.shopMoney?.currencyCode || null,
        sessionIds: [...new Set(known.map((event) => event.sessionId))].join(","),
        boughtTriedItem: boughtProducts.some((id) => triedProducts.has(id)),
        createdAt: new Date(order.createdAt),
      };

      await prisma.tryOnOrder.upsert({
        where: { shop_orderId: { shop, orderId: data.orderId } },
        create: data,
        update: data,
      });
    }
  } catch (error) {
    LAST_SYNC.delete(shop);
    console.error("Vibecheck: could not sync recent try-on orders", error);
  }
}
