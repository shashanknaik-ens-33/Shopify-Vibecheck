import prisma from "../db.server";

// Public endpoint the try-on page posts to. Everything is validated and the
// response is always empty, so it reveals nothing to anyone probing it.

const EVENTS = new Set([
  "tryon_opened",
  "camera_started",
  "photo_uploaded",
  "shade_selected",
  "customer_identified",
]);
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const installedCache = new Map(); // shop -> expiry timestamp
const hits = new Map(); // shop -> { count, resetAt }

const clip = (value, max) =>
  typeof value === "string" ? value.slice(0, max) : "";

async function isInstalled(shop) {
  const cachedUntil = installedCache.get(shop);
  if (cachedUntil && cachedUntil > Date.now()) return true;

  const session = await prisma.session.findFirst({
    where: { shop },
    select: { id: true },
  });
  if (session) installedCache.set(shop, Date.now() + 5 * 60 * 1000);
  return Boolean(session);
}

function withinLimit(shop) {
  const now = Date.now();
  const entry = hits.get(shop);
  if (!entry || entry.resetAt < now) {
    hits.set(shop, { count: 1, resetAt: now + 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 300;
}

export async function action({ request }) {
  if (request.method !== "POST") return new Response(null, { status: 405 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const shop = clip(body?.shop, 100).toLowerCase();
  const event = clip(body?.event, 40);
  const sessionId = clip(body?.sessionId, 64);
  const visitorId = clip(body?.visitorId, 64);

  const valid =
    SHOP_RE.test(shop) && EVENTS.has(event) && sessionId && visitorId;

  if (valid && withinLimit(shop) && (await isInstalled(shop))) {
    if (event === "customer_identified") {
      // A logged-in store customer was using try-on: remember who this visitor is.
      const customerId = clip(body?.customerId, 40).split("/").pop();
      if (customerId) {
        const fields = {
          customerId,
          customerName: clip(body?.customerName, 120) || null,
          customerEmail: clip(body?.customerEmail, 160) || null,
        };
        try {
          await prisma.tryOnVisitor.upsert({
            where: { shop_visitorId: { shop, visitorId } },
            create: { shop, visitorId, ...fields },
            update: fields,
          });
        } catch (error) {
          console.error("Vibecheck: could not save visitor", error);
        }
      }
    } else {
      const productId = clip(body?.productId, 80).split("/").pop() || null;
      const productTitle = clip(body?.productTitle, 200) || null;

      try {
        await prisma.tryOnEvent.create({
          data: { shop, event, sessionId, visitorId, productId, productTitle },
        });
      } catch (error) {
        console.error("Vibecheck: could not save try-on event", error);
      }
    }
  }

  return new Response(null, { status: 204 });
}

export const loader = () => new Response(null, { status: 405 });