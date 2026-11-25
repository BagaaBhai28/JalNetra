# Shared reporting

Open **Sign in for shared lake reporting** on the homepage. Citizens sign in, join a mapped lake, choose a shoreline sector, and submit a photo or concern. A citizen can read their own submissions on another device after signing in. Operators see submissions for their assigned lakes and can open private photos, request live analysis, or record a review decision. An administrator can promote an enrolled citizen to operator or return that account to citizen in their assigned lake.

Supabase stores the shared records and applies role and lake restrictions. The public rehearsal remains isolated. The starter administrator must be assigned by a trusted Supabase administrator after their account is verified. Set the production Auth Site URL to the JalNetra deployment, allow the /pilot.html redirect URL, and configure custom SMTP before inviting the general public. Hosted Supabase default mail only reaches authorized team addresses. Keep email confirmation enabled.

## Vision and review

Vercel uses AI Gateway through its deployment identity, or the configured server-side OPENAI_API_KEY or AI_GATEWAY_API_KEY. JALNETRA_VISION_MODEL can override the default. Model results show visible signs and are saved separately from review decisions. Failed requests leave the report available for retry and manual review. The operator initiates analysis on demand. Model output can contribute to triage after a human confirms or corrects it.

A 64-bit difference hash flags visually similar recent photos for comparison. This is a candidate signal and can miss crops or match scenes with similar structure. A reviewer can mark a report as a duplicate and choose the original. The dashboard identifies corroboration within its latest 25 reports by category and sector, up to 48 hours old, counting each reporter once and excluding dismissed or duplicate evidence.

To evaluate classification on real imagery, prepare a permission-cleared, independently labeled PNG dataset with visible positives, ordinary negatives, and unclear images. Each manifest row provides file (relative to the manifest), quality (usable or unclear), and labels (an array of foam, algae_like_growth, and dumping). Run:

    node scripts/evaluate-vision.mjs path/to/manifest.json

The script sends those images to the configured provider and prints category precision and recall, review rate, and errors. Use only photographs authorized for processing by that provider.

## Deployment checks

The pilot migrations include the 21 mapped lakes and four reporting sectors per lake. The pilot readiness route reports the database schema version and whether vision credentials are available. Run npm test and supabase/tests/pilot_access.sql to check API handling and live database role policies. The SQL test rolls back its fixtures.
