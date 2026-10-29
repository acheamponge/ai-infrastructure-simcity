-- Stored satellite view and SAM masks for the dossier overlay
ALTER TABLE "RegionProfile" ADD COLUMN "measuredLayers" JSONB;
