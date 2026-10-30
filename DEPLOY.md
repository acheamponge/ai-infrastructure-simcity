# Deploying AI Infrastructure SimCity to Vercel

The app is a Next.js 15 project with Prisma on Postgres and server-side agents that call
the Meta Model API (Muse and SAM 3.1), Crusoe Cloud inference as the fallback, and Tavily. It needs a host that runs Node, so GitHub Pages is out;
Vercel plus a hosted Postgres is the simplest setup. Everything below runs on free tiers.

## 1. Hosted Postgres

Create a database on [Neon](https://neon.tech) (or Supabase). Copy the **pooled** connection
string; it looks like `postgresql://user:pass@host/db?sslmode=require`.

## 2. Push the code to GitHub

```bash
gh auth login
gh repo create ai-infrastructure-simcity --private --source=. --push
```

`.env` is ignored by git, so your keys never leave the machine. `env.example` lists every
variable the app reads.

## 3. Create the Vercel project

1. On [vercel.com/new](https://vercel.com/new) import the GitHub repository. Framework is
   detected as Next.js; leave the build settings alone. The `vercel-build` script in
   `package.json` runs `prisma migrate deploy` and then `next build`, so the schema is
   applied on every deploy.
2. Under **Environment Variables** add, for Production and Preview:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the Neon connection string |
   | `MODEL_API_KEY_MUSE` | your Meta Model API key (Muse Spark, Muse Wonder, SAM 3.1, Muse Image); when set, Muse is the primary provider |
   | `CRUSOE_API_KEY` | your Crusoe inference key |
   | `CRUSOE_BASE_URL` | `https://api.inference.crusoecloud.com/v1` |
   | `CRUSOE_MODEL_RESEARCH` | `kimi` |
   | `CRUSOE_MODEL_ADVISOR` | `glm` |
   | `TAVILY_API_KEY` | your Tavily key |

3. Deploy. The first build applies the migration and the site comes up with an empty
   registry.

## 4. Seed the registry

Run the seed once from your machine against the hosted database. The seed talks to Prisma
directly, so a `DATABASE_URL` on the command line overrides the one in `.env`:

```bash
DATABASE_URL="postgresql://...neon..." npx prisma db seed
```

This inserts the 24 curated sites with their region profiles and baseline assessments.
Reload the deployed site and the atlas, boards and simulation pick them up.

## 5. Agent runs on Vercel

The discovery, enrichment and assessment routes declare `maxDuration = 300` seconds. On the
Hobby plan Vercel caps functions lower unless Fluid Compute is enabled for the project
(Settings → Functions). Enable it, or move to Pro, before running the agents in production.
Runs that exceed the cap fail with a timeout but leave the database consistent.

## Later deploys

Every push to `main` redeploys. Schema changes go through `npx prisma migrate dev --name
<change>` locally, which writes a new folder under `prisma/migrations`; the next deploy applies
it with `migrate deploy`.
