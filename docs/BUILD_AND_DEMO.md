# Build and demo plan

[Repository home](../README.md) · [Architecture](ARCHITECTURE.md) · [Interface](INTERFACE.md)

## Eight-hour build

| Elapsed time | Developer A | Developer B | Exit check |
|---|---|---|---|
| 0:00–0:30 | Agree on storage and API shapes. | Agree on screen flow and sample responses. | Both developers work from the same contract. |
| 0:30–2:00 | Set up SQLite, seed zones and build upload validation. | Build report form, preview and bundled zone map. | A submitted photo receives a persistent report ID. |
| 2:00–3:30 | Connect the live model and replay adapter. Add limits, timeout and validation. | Build results and zone detail panels from fixtures. | The first foam photo shows Watch. |
| 3:30–4:30 | Build evidence times, grouping and deduplication. | Connect the map and evidence panel to the API. | A second distinct foam photo raises priority. |
| 4:30–5:30 | Implement complaint eligibility and draft storage. | Wire draft review, edit and export. | The core path works end to end. |
| 5:30–6:45 | Test errors, retries, duplicates and persistence. | Verify on the presentation device and rehearse offline replay. | Tests cover live and replay scenarios. |
| 6:45–8:00 | Fix blockers and freeze the build. | Run the script twice and record a backup if there is time. | The laptop can run the complete demo. |

If the build is running late, prioritise photo intake, the bundled zone map, evidence grouping and plain-text complaint export. Category filters, map tiles and manual review controls can follow the demo.

## Acceptance checklist

- [ ] A foam photo at North Inlet starts Watch and shows its model evidence.
- [ ] A second distinct foam image in North Inlet inside the active window makes the category a Priority hotspot.
- [ ] An identical normalized photo appears in history and adds zero to the count.
- [ ] Foam at South Bank and algae-like growth at North Inlet each form their own groups.
- [ ] Low-quality imagery, invalid model output and timeout save the report in Needs review.
- [ ] Retrying a submission preserves its report ID. Restarting the app preserves saved reports.
- [ ] An expired observation falls out of current counts and remains in history.
- [ ] Eligible drafting includes the correct source report IDs and timestamps. An ineligible draft request gets a clear rejection.
- [ ] Replay works with Wi-Fi off and cannot affect the live dataset.

## Run a rehearsal

Start with `node src/server.js --rehearsal` and open `http://127.0.0.1:3000`. Click **Start rehearsal**, submit **Foam from a second view** at North Inlet, and export the draft from the hotspot. Submit **Obscured view** to exercise review. **Restart rehearsal** clears only the in-memory scenario.

Run the automated suite with `node --test`.

## Three-minute demo

| Time | Action |
|---|---|
| 0:00–0:25 | Introduce the problem and open the map with a seeded Watch report at North Inlet. |
| 0:25–1:05 | Upload a distinct second foam photo. Point to the visible cue and the report’s time and location. |
| 1:05–1:40 | Open the priority marker and compare the two evidence cards. Explain the grouping rule. |
| 1:40–2:15 | Generate the complaint, show both report IDs and download the draft. |
| 2:15–2:45 | Show an unclear report in Needs review and the unchanged hotspot count. |
| 2:45–3:00 | Close with the pilot goal of validating the triage rule and civic routing. |

Developer B drives the screens. Developer A explains the model decision and grouping logic. Prepare two distinct photos with permission to display and one unclear photo. Use clearly labelled simulation data or captured model responses in offline mode, and reset only the demonstration dataset between runs.
