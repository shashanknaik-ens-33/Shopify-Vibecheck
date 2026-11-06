-- CreateTable
CREATE TABLE "TryOnEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "productId" TEXT,
    "productTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TryOnEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TryOnOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "totalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT,
    "sessionIds" TEXT NOT NULL,
    "boughtTriedItem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TryOnOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TryOnEvent_shop_createdAt_idx" ON "TryOnEvent"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "TryOnOrder_shop_createdAt_idx" ON "TryOnOrder"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TryOnOrder_shop_orderId_key" ON "TryOnOrder"("shop", "orderId");
