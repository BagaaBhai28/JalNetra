# Shared reporting

Open **Citizen lake map and reporting**, **Report to lake operator**, or **Operator sign in** on the homepage. Citizens sign in, join a mapped lake, choose a shoreline sector, and submit a photo or concern. A citizen can read their own submissions on another device after signing in. Operators see submissions for their assigned lakes and can open private photos, request live analysis, or record a review decision. An administrator can promote an enrolled citizen to operator or return that account to citizen in their assigned lake.

Supabase stores the shared records and applies role and lake restrictions. The public rehearsal remains isolated. The starter administrator must be assigned by a trusted Supabase administrator after their account is verified. Set the production Auth Site URL to the JalNetra deployment, allow the /pilot.html redirect URL, and configure custom SMTP before inviting the general public. Hosted Supabase default mail only reaches authorized team addresses. Keep email confirmation enabled. The **Forgot password?** button uses the same mail configuration and verified /pilot.html redirect.

## Vision and review

Vercel uses AI Gateway through its deployment identity, or the configured server-side OPENAI_API_KEY or AI_GATEWAY_API_KEY. JALNETRA_VISION_MODEL can override the default. Model results show visible signs and are saved separately from review decisions. Failed requests leave the report available for retry and manual review. A citizen upload automatically requests a preliminary assessment. The result is saved on the photo report for both the citizen and the operator. Operators can still request analysis for reports without a saved result. Model output can contribute to triage after a human confirms or corrects it.

A 64-bit difference hash flags visually similar recent photos for comparison. This is a candidate signal and can miss crops or match scenes with similar structure. A reviewer can mark a report as a duplicate and choose the original. The operator map uses the latest human decision for each observation within the past 48 hours. It groups confirmed or corrected evidence by shoreline sector and category, counting the most recent eligible report from each citizen. One reporting citizen starts Watch. Two distinct reporting citizens start Priority. Select a sector to inspect the supporting photos, times and readings. The separate review queue lists 25 reports per page and has a **Needs review** filter.

To evaluate classification on real imagery, prepare a permission-cleared, independently labeled PNG dataset with visible positives, ordinary negatives, and unclear images. Each manifest row provides file (relative to the manifest), quality (usable or unclear), and labels (an array of foam, algae_like_growth, and dumping). Run:

    node scripts/evaluate-vision.mjs path/to/manifest.json

The script sends those images to the configured provider and prints category precision and recall, review rate, and errors. Use only photographs authorized for processing by that provider.

## Citizen lake conditions

The signed-in citizen map displays the highest recent signal for each lake and shows individual sectors, categories and times when selected. It summarizes observations from the past seven days. The map uses verified concern, awaiting review, no visible issue in a reviewed photo and no recent information. No photos, notes or account identifiers appear in the map summary. A reviewed photo does not measure water quality.

A citizen can raise a concern from a photo assessment. The concern remains linked to that photo for operator review. The runtime uses a server-only `PILOT_ANALYSIS_WRITE_TOKEN` whose SHA-256 digest is stored in the private database configuration.

## Civic complaint draft

Select a Priority category and choose **Generate complaint draft**. The server checks the operator's lake access and recalculates eligibility. The downloadable text contains the lake, approximate sector, visible issue, evidence IDs, times and any reported readings. The operator can edit the recipient and draft before exporting. **Download draft with photos** creates a self-contained HTML file with the supporting images. Only share this file with the verified recipient.

For Devanahalli Lake, the draft suggests the [Devanahalli Town Municipal Council](https://bangalorerural.nic.in/en/public-utility/devanahalli-tmc/) as a local contact. Confirm responsibility for the specific site and issue before filing. [Karnataka Janaspandana](https://ipgrs.karnataka.gov.in/) is available as a public grievance route. The operator files the draft separately.

## Community action

Open `/community.html` to find cleanups and register as a volunteer. Community groups and organizations can create a confirmed email account and propose a drive with a lake, start time, meeting point and safety instructions. An assigned lake operator approves the proposal on the same page. The citizen homepage shows scheduled drives for the current Bengaluru date.

Before releasing the separate page, apply the community drive page migration. Organizer registration uses the existing `/pilot.html` email confirmation callback, which links back to community sign in. Run `supabase/tests/community_drive_page.sql` to check publishing permissions and Bengaluru date boundaries.

- **Cleanups.** Assigned operators publish authorised events with meeting and safety instructions. Citizens register before the event. Operators can record attendance after the start time and then complete the event.
- **Lake adoption.** Citizens submit a group and stewardship plan. Assigned operators approve, decline or end an adoption. Approved plans appear on the lake's community board.
- **Restoration.** An operator starts with a human-verified pollution photo, assigns a responsible team and records work completed. A citizen uploads a new photo from the same sector and submits it for verification in the tracker. The operator opens the private evidence and accepts or rejects it.
- **Impact.** The board counts completed cleanups, unique volunteers with recorded attendance at completed cleanups, active adoptions and restorations with accepted evidence.
- **Lake alerts.** Citizens subscribe through Community action. New standalone concerns and operator confirmations or corrections generate alerts automatically. The in-app inbox refreshes every 30 seconds while the citizen page is open and keeps unread alerts for the next visit in the same session. Lake subscriptions and read state are stored with the account.

Apply the community restoration migration to the target Supabase database before releasing the community board. Run `supabase/tests/community_restoration.sql` with a database administrator connection to verify the workflow and access rules. The test rolls back its fixtures.

## Deployment checks

The pilot migrations include the 21 mapped lakes and four reporting sectors per lake. The pilot readiness route reports the database schema version and whether vision credentials are available. Run npm test and supabase/tests/pilot_access.sql to check API handling and live database role policies. The SQL test rolls back its fixtures.
