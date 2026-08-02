-- Add weightGrams to Product (nullable for existing rows)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "weightGrams" INTEGER;

-- Add weightGramsSnapshot to OrderItem (nullable for legacy orders)
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "weightGramsSnapshot" INTEGER;

-- Add totalWeightGrams and additionalRiderIds to Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "totalWeightGrams" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "additionalRiderIds" TEXT[] NOT NULL DEFAULT '{}';
