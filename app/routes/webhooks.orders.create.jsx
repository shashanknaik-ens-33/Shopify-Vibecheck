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

    const sessionIds = String(raw || "")
      .split(",")
      .map((id) => id.trim().slice(0, 64))
      .filter(Boolean)
      .slice(0, 5);

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

        const data = {
          shop,
          orderId: String(payload.id),
          orderName: payload.name ? String(payload.name) : null,
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
    // Always answer 200 so Shopify doesn't keep retrying a bad payload.
    console.error("Vibecheck: could not record try-on order", error);
  }

  return new Response();
};