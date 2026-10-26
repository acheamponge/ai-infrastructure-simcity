-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('OPERATIONAL', 'CONSTRUCTION', 'PLANNED', 'PROPOSED');

-- CreateEnum
CREATE TYPE "RunKind" AS ENUM ('DISCOVER', 'ENRICH', 'ASSESS');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('GO', 'CONDITIONAL', 'NO_GO');

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operator" TEXT,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "city" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "status" "SiteStatus" NOT NULL,
    "capacityMw" DOUBLE PRECISION,
    "itMw" DOUBLE PRECISION,
    "announcedAt" TIMESTAMP(3),
    "expectedOnline" TEXT,
    "energyNotes" TEXT,
    "description" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "curated" BOOLEAN NOT NULL DEFAULT false,
    "discoveredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionProfile" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "powerPriceKwh" DOUBLE PRECISION NOT NULL,
    "gridCarbonG" DOUBLE PRECISION NOT NULL,
    "gridLeadMonths" DOUBLE PRECISION NOT NULL,
    "gridHeadroomMw" DOUBLE PRECISION NOT NULL,
    "gridReliability" DOUBLE PRECISION NOT NULL,
    "laborPool" INTEGER NOT NULL,
    "wageUsdH" DOUBLE PRECISION NOT NULL,
    "landIndex" DOUBLE PRECISION NOT NULL,
    "sentiment" DOUBLE PRECISION NOT NULL,
    "climate" TEXT NOT NULL,
    "waterStress" TEXT NOT NULL,
    "solar" DOUBLE PRECISION NOT NULL,
    "wind" DOUBLE PRECISION NOT NULL,
    "geothermal" BOOLEAN NOT NULL DEFAULT false,
    "flareGas" BOOLEAN NOT NULL DEFAULT false,
    "populationNear" INTEGER,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "enrichedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "energyMix" JSONB NOT NULL,
    "estimate" JSONB NOT NULL,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "economic" DOUBLE PRECISION NOT NULL,
    "environment" DOUBLE PRECISION NOT NULL,
    "community" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "risks" JSONB NOT NULL DEFAULT '[]',
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "personas" JSONB NOT NULL DEFAULT '{}',
    "plan" JSONB,
    "model" TEXT NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "kind" "RunKind" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "log" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "model" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegionProfile_siteId_key" ON "RegionProfile"("siteId");

-- AddForeignKey
ALTER TABLE "RegionProfile" ADD CONSTRAINT "RegionProfile_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

