-- CreateTable
CREATE TABLE "TryOnCheckout" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sessionIds" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerCity" TEXT,
    "customerCountry" TEXT,
    "itemSummary" TEXT,
    "totalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT,
    "recoveryUrl" TEXT,
    "completedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TryOnCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TryOnVisitor" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TryOnVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TryOnCheckout_shop_updatedAt_idx" ON "TryOnCheckout"("shop", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TryOnCheckout_shop_token_key" ON "TryOnCheckout"("shop", "token");

-- CreateIndex
CREATE UNIQUE INDEX "TryOnVisitor_shop_visitorId_key" ON "TryOnVisitor"("shop", "visitorId");
