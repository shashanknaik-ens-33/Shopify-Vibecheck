import { authenticate } from "../shopify.server";
import db from "../db.server";

// Shopify's required privacy webhooks: customers/data_request, customers/redact, shop/redact.

const BLANK = {
  customerId: null,
  customerName: null,
  customerEmail: null,
  customerCity: null,
  customerCountry: null,
};

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const kind = String(topic).toLowerCase().replace(/[_/]/g, "");
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    if (kind === "customersredact") {
      const customerId = payload?.customer?.id ? String(payload.customer.id) : null;
      const email = payload?.customer?.email ? String(payload.customer.email) : null;
      const orderIds = (payload?.orders_to_redact ?? []).map(String);

      const orderMatch = [];
      const checkoutMatch = [];
      if (customerId) {
        orderMatch.push({ customerId });
        checkoutMatch.push({ customerId });
      }
      if (email) {
        orderMatch.push({ customerEmail: email });
        checkoutMatch.push({ customerEmail: email });
      }
      if (orderIds.length) orderMatch.push({ orderId: { in: orderIds } });

      if (orderMatch.length) {
        await db.tryOnOrder.updateMany({ where: { shop, OR: orderMatch }, data: BLANK });
      }
      if (checkoutMatch.length) {
        await db.tryOnCheckout.updateMany({
          where: { shop, OR: checkoutMatch },
          data: { ...BLANK, recoveryUrl: null },
        });
      }
    } else if (kind === "shopredact") {
      await db.tryOnOrder.deleteMany({ where: { shop } });
      await db.tryOnCheckout.deleteMany({ where: { shop } });
      await db.tryOnEvent.deleteMany({ where: { shop } });
      await db.session.deleteMany({ where: { shop } });
    }
    // customers/data_request: Vibecheck only holds what the order or checkout
    // contained (name, email, city, country). Send it to the merchant if they ask.
  } catch (error) {
    console.error("Vibecheck: could not process compliance webhook", error);
  }

  return new Response();
};