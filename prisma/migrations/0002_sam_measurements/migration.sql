-- Site measurements from SAM 3.1 over satellite imagery
ALTER TABLE "RegionProfile" ADD COLUMN "measuredBuiltHa" DOUBLE PRECISION,
  ADD COLUMN "measuredOpenHa" DOUBLE PRECISION,
  ADD COLUMN "measuredWaterHa" DOUBLE PRECISION,
  ADD COLUMN "measuredWaterNearM" DOUBLE PRECISION,
  ADD COLUMN "measuredSolarHa" DOUBLE PRECISION,
  ADD COLUMN "measuredSpanM" DOUBLE PRECISION,
  ADD COLUMN "measuredBy" TEXT,
  ADD COLUMN "measuredAt" TIMESTAMP(3);
