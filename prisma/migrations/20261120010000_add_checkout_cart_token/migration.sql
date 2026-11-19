ALTER TABLE "TryOnCheckout"
ADD COLUMN "cartToken" TEXT;

CREATE INDEX "TryOnCheckout_shop_cartToken_idx" ON "TryOnCheckout"("shop", "cartToken");
