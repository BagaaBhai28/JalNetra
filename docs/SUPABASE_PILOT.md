# Supabase pilot backend

The field-pilot backend uses Supabase Postgres, Auth identities, and a private evidence bucket. Keep demonstration sessions on the existing Vercel Blob workflow. No pilot lakes or accounts are seeded.

## Application connection

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the Vercel project and redeploy. The Vercel handler uses the publishable key for the readiness check and forwards signed-in users' access tokens for report reads. Supabase row-level security limits the records returned. A service-role key is unnecessary for these routes.

| Route | Behavior |
|---|---|
| `GET /api/pilot/status` | Confirms the application can reach the expected schema version. The response contains no pilot reports. |
| `GET /api/pilot/reports` | Requires a Supabase access token and returns up to 25 reports visible to that account. |

The database grants enrolled citizens insert access through the authenticated Supabase Data API. Store normalized PNG evidence in the private `jalnetra-pilot-evidence` bucket under `<user-id>/<photo-id>.png` before creating the report. An operator can read evidence referenced by a visible report in an assigned lake. Citizens can read their own reports while enrolled. Lake, zone, and membership provisioning should be done by an authorized administrator.

The public web form continues to use rehearsal data. Pilot sign-in, intake screens, and the shared operator dashboard are tracked in issues #9 and #10.

## Schema changes

The applied SQL lives under `supabase/migrations`. Keep database changes in version control, review migrations before applying them, and verify the project target whenever deploying them. The database migration and Vercel deployment are separate release steps.
