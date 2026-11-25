import { authenticate } from "../shopify.server";
import db from "../db.server";

// Handles checkouts/create and checkouts/update. Only checkouts that carry a
// Vibecheck try-on session id (set on the cart by the storefront extension) are kept.

const clip = (value, max) => {
  const text = value == null ? "" : String(value).trim();
  return text ? text.slice(0, max) : null;
};

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const token = clip(payload?.token ?? payload?.id, 80);
    const attributes = Array.isArray(payload?.note_attributes) ? payload.note_attributes : [];
    const raw = attributes.find((item) => item?.name === "vibecheck_session")?.value;
    const propertyValues = (payload?.line_items ?? []).flatMap((item) => {
      if (Array.isArray(item?.properties)) {
        return item.properties
          .filter((property) => property?.name === "_vibecheck_session")
          .map((property) => property.value);
      }
      const value = item?.properties?._vibecheck_session;
      return value ? [value] : [];
    });

    // Some checkout paths omit cart note attributes but preserve the product
    // form property attached by the storefront extension.
    const sessionIds = [raw, ...propertyValues]
      .filter(Boolean)
      .flatMap((value) => String(value).split(","))
      .map((id) => id.trim().slice(0, 64))
      .filter(Boolean)
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .slice(0, 5);

    if (token && sessionIds.length) {
      // Only keep sessions we actually recorded for this shop.
      const known = await db.tryOnEvent.findMany({
        where: { shop, sessionId: { in: sessionIds } },
        select: { sessionId: true },
      });

      if (known.length) {
        const customer = payload.customer ?? {};
        const address =
          payload.shipping_address ?? payload.billing_address ?? customer.default_address ?? {};
        const fullName =
          [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
          [address.first_name, address.last_name].filter(Boolean).join(" ") ||
          "";

        const data = {
          shop,
          token,
          cartToken: clip(payload.cart_token, 100),
          sessionIds: [...new Set(known.map((row) => row.sessionId))].join(","),
          customerId: clip(customer.id, 40),
          customerName: clip(fullName, 120),
          customerEmail: clip(payload.email || customer.email, 160),
          customerCity: clip(address.city, 80),
          customerCountry: clip(address.country, 80),
          itemSummary: clip(
            (payload.line_items ?? []).map((item) => item.title).filter(Boolean).join(", "),
            300
          ),
          totalPrice: Number.parseFloat(payload.total_price) || 0,
          currency: clip(payload.currency || payload.presentment_currency, 10),
          recoveryUrl: clip(payload.abandoned_checkout_url, 600),
        };

        // Never reset a completed checkout back to open if events arrive out of order.
        const update = { ...data };
        if (payload.completed_at) update.completedAt = new Date(payload.completed_at);
        const create = { ...update };

        await db.tryOnCheckout.upsert({
          where: { shop_token: { shop, token } },
          create,
          update,
        });
      }
    }
  } catch (error) {
    console.error("Vibecheck: could not record checkout", error);
    return new Response(null, { status: 500 });
  }

  return new Response();
};
