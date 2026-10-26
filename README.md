# AI Infrastructure SimCity

A playable world for siting AI data centers, backed by a live registry and a
set of research and advisory agents.

- **Simulation** (`/`): spin the globe, pick any of the modeled regions or any
  tracked real site (amber diamonds), spec a facility with a GPU fleet mix
  (H100, B200, GB300, next-gen) and a people-versus-robots crew, break ground,
  and dive into a navigable 3D site. Every rack in every row carries its
  servers as they are installed; busways, liquid-cooling loops, CDUs, PDUs,
  CRAH units, chillers, cooling towers, generators and the electrical room
  arrive with the fit-out. Once live, technicians and inspection robots walk
  the aisles. Any rack can be opened; a thermal view shows the heat.
- **Registry and dossiers** (`/atlas`, `/sites/[id]`): every current and
  announced facility the agents have found, with sources, a region profile,
  a deterministic estimate, an energy what-if mixer and the advisor's verdict.
- **Advisor** issues go / conditional / no-go and writes a **build plan**
  (supply mix, hardware, crew, automation, phasing, community commitments)
  that opens directly in the simulation with one click.
- **Executive, Policy and Investor** views recompute the whole portfolio in
  the browser from sliders: crew and automation, carbon price and transmission
  headroom, power price, firmness, GPU-hour rates and discount rate.

## Stack

- Next.js 15 (App Router, TypeScript), Tailwind 4, Recharts, Leaflet, three.js
- Prisma 6 on Postgres
- Crusoe Cloud inference (OpenAI-compatible): Kimi for research and extraction,
  GLM 5.3 for the advisor; Tavily for web search

## Run it

```bash
# 1. Postgres (any Postgres 14+ works; this starts one in Docker on port 5433)
docker run -d --name atlas-pg -e POSTGRES_USER=atlas -e POSTGRES_PASSWORD=atlas \
  -e POSTGRES_DB=atlas -p 5433:5432 postgres:16-alpine

# 2. Dependencies and schema
npm install
npm run db:generate
npm run db:push

# 3. Curated starting registry (24 well-reported campuses)
npm run db:seed

# 4. Dev server on http://localhost:3100
npm run dev
```

Copy `env.example` to `.env` and set `CRUSOE_API_KEY` and `TAVILY_API_KEY` to
put the agents in live mode. Model hints (`kimi`, `glm`) are resolved against
the endpoint's `/v1/models` list at first use; set exact ids with
`CRUSOE_MODEL_RESEARCH` and `CRUSOE_MODEL_ADVISOR` if you prefer. Without the
keys the app runs in **fixture mode**: discovery returns sample records,
enrichment keeps country priors, and the advisor writes a templated narrative
and plan around the deterministic verdict. The header shows which mode is on.

`DATABASE_URL` defaults to the Docker container above when unset.

## Pages

| Route | What it does |
|---|---|
| `/` | The simulation. `?site=<id>` focuses a tracked site; `&plan=<assessmentId>` loads the advisor's plan and breaks ground |
| `/overview` | Headline counts, audience entry points, how a verdict is produced |
| `/atlas` | Map and sortable table with live filters by status, verdict, country, size and text |
| `/sites/[id]` | Dossier: sources, region profile, estimate, what-if mixer, scenarios, verdict, build plan |
| `/sites/new` | Register a proposal by hand |
| `/executive` | Portfolio board with crew, automation and GPU sliders applied across all sites |
| `/policy` | Impact board with country chips, carbon price and transmission sliders |
| `/investor` | IRR / NPV board with power, firmness, GPU price and discount sliders |
| `/agents` | Discovery console and the full run log |
| `/methodology` | Every coefficient, floor and assumption |

## Agents

- **Discovery** (`src/lib/agents/discover.ts`): Kimi proposes search queries,
  Tavily runs them, Kimi extracts structured records with source numbers.
- **Enrichment** (`src/lib/agents/enrich.ts`): targeted searches on power
  price, grid carbon and headroom, interconnection, labor, land, water,
  population and sentiment; writes sourced values into the region profile.
- **Advisor** (`src/lib/agents/assess.ts`): the engine searches eleven energy
  mixes against the viability floors and fixes the verdict; GLM 5.3 writes the
  rationale, conditions, risks, a brief per audience and the build plan.

Every run is recorded in `AgentRun` with its log, output, model and tokens.

## Model and simulation

`src/lib/model/estimate.ts` is the engine; `energy.ts`, `hardware.ts` and
`regions.ts` hold the coefficients and priors; `optimize.ts` the floors and the
mix search. `src/sim/` is the simulation: `sim.js` (globe, economy, events,
scoring), `site3d.js` (three.js campus, data hall, electrical room, thermal
view). Real sites enter the sim as regions built from their profile, scaled to
their first 150 MW phase. These are screening-grade numbers, not engineering or
investment advice.

## Maintenance scripts

```bash
npx tsx scripts/reestimate.ts   # recompute every scenario after a model change
npx tsx scripts/assess-all.ts   # run the advisor on every baseline
```

## Deploying

See [DEPLOY.md](DEPLOY.md) for hosting on Vercel with a hosted Postgres.
