# Makani Media consultation backend

This Worker receives consultation requests at `POST /api/consultation` and stores them in Cloudflare D1.

## 1. Create the D1 database

From the `worker` directory:

```bash
npx wrangler@latest login
npx wrangler@latest d1 create makani-media --location=wnam
```

Copy the returned database ID.

## 2. Create the Wrangler config

Copy the example file:

```bash
cp wrangler.example.toml wrangler.toml
```

Replace `REPLACE_WITH_D1_DATABASE_ID` with the D1 database ID returned above.

## 3. Apply the schema

```bash
npx wrangler@latest d1 execute makani-media --remote --file=./migrations/0001_initial.sql
```

## 4. Deploy the Worker

```bash
npx wrangler@latest deploy
```

## 5. Route the site API to this Worker

Configure the production site so `/api/consultation` is handled by this Worker. If the Worker is deployed on a separate hostname instead, update the form's fetch URL in `schedule-consultation.html`.

## Data model

- `contacts`: one durable client record per email address
- `projects`: each consultation/project request linked to a contact
- `ai_activity`: future Gemini summaries, recommendations, and response drafts

The Worker stores both structured fields and the original submission JSON. AI output is intentionally stored separately so it never replaces the client's source data.

## Next phase

After D1 storage is verified, add:

1. Gemini API analysis of new projects
2. AI output persistence to `ai_activity`
3. Gmail draft creation for human review
4. Optional admin lead dashboard
