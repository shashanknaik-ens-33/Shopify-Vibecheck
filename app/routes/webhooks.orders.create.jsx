import { authenticate } from "../shopify.server";
import db from "../db.server";

// Runs for every new order. It only stores orders whose cart carries a
// Vibecheck try-on session id (set by the storefront extension).

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
        // This order finished a checkout, so it is no longer abandoned.
    if (payload?.checkout_token) {
      await db.tryOnCheckout.updateMany({
        where: { shop, token: String(payload.checkout_token) },
        data: { completedAt: new Date() },
      });
    }
    const attributes = Array.isArray(payload?.note_attributes)
      ? payload.note_attributes
      : [];
    const raw = attributes.find((item) => item?.name === "vibecheck_session")?.value;
    let sessionIds = String(raw || "")
      .split(",")
      .map((id) => id.trim().slice(0, 64))
      .filter(Boolean)
      .slice(0, 5);

    // Some order payloads omit cart attributes. The checkout webhook has
    // already captured the try-on sessions, so use its token as a fallback.
    if (!sessionIds.length && payload?.checkout_token) {
      const checkout = await db.tryOnCheckout.findFirst({
        where: { shop, token: String(payload.checkout_token) },
        select: { sessionIds: true },
      });
      sessionIds = String(checkout?.sessionIds || "")
        .split(",")
        .map((id) => id.trim().slice(0, 64))
        .filter(Boolean)
        .slice(0, 5);
    }

    // Accelerated checkout can omit cart attributes. Product form properties
    // carry the session through that path when the shopper bought a product
    // after opening try-on.
    if (!sessionIds.length) {
      const propertyValues = (payload?.line_items ?? []).flatMap((item) => {
        if (Array.isArray(item?.properties)) {
          return item.properties
            .filter((property) => property?.name === "_vibecheck_session")
            .map((property) => property.value);
        }
        const value = item?.properties?._vibecheck_session;
        return value ? [value] : [];
      });
      sessionIds = propertyValues
        .flatMap((value) => String(value || "").split(","))
        .map((id) => id.trim().slice(0, 64))
        .filter(Boolean)
        .slice(0, 5);
    }

    if (!sessionIds.length && payload?.cart_token) {
      const checkout = await db.tryOnCheckout.findFirst({
        where: { shop, cartToken: String(payload.cart_token) },
        select: { sessionIds: true },
      });
      sessionIds = String(checkout?.sessionIds || "")
        .split(",")
        .map((id) => id.trim().slice(0, 64))
        .filter(Boolean)
        .slice(0, 5);
    }

    if (sessionIds.length) {
      // Only count sessions we actually recorded for this shop.
      const known = await db.tryOnEvent.findMany({
        where: { shop, sessionId: { in: sessionIds } },
        select: { sessionId: true, event: true, productId: true },
      });

      if (known.length) {
        const triedProducts = new Set(
          known
            .filter((row) => row.event === "tryon_opened" && row.productId)
            .map((row) => String(row.productId))
        );
        const boughtProducts = (payload.line_items ?? []).map((item) =>
          String(item.product_id)
        );
        const boughtTriedItem = boughtProducts.some((id) => triedProducts.has(id));
        const customer = payload.customer ?? {};
        const address =
          payload.shipping_address ?? payload.billing_address ?? customer.default_address ?? {};
        const customerName =
          [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
          [address.first_name, address.last_name].filter(Boolean).join(" ") ||
          null;

        const data = {
          shop,
          orderId: String(payload.id),
          orderName: payload.name ? String(payload.name) : null,
          customerId: customer.id ? String(customer.id) : null,
          customerName,
          customerEmail: payload.email || customer.email || null,
          customerCity: address.city ? String(address.city) : null,
          customerCountry: address.country ? String(address.country) : null,
          itemSummary:
            (payload.line_items ?? [])
              .map((item) => item.title)
              .filter(Boolean)
              .join(", ")
              .slice(0, 300) || null,
          totalPrice: Number.parseFloat(payload.total_price) || 0,
          currency: payload.currency ? String(payload.currency) : null,
          sessionIds: [...new Set(known.map((row) => row.sessionId))].join(","),
          boughtTriedItem,
        };

        await db.tryOnOrder.upsert({
          where: { shop_orderId: { shop, orderId: data.orderId } },
          create: data,
          update: data,
        });
      }
    }
  } catch (error) {
    console.error("Vibecheck: could not record try-on order", error);
    return new Response(null, { status: 500 });
  }

  return new Response();
};
