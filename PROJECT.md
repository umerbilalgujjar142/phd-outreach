# PhD Professor Outreach Automation — Final Project Brief
_Single source of truth for Claude Code. Read this file fully before writing any code._

---

## 1. Owner Context
- Muhammad Umer Bilal — Senior React Native / Full Stack Developer (Node.js, NestJS), 6+ years experience, based in Dubai, UAE
- MS Computer Networks & Security, NUCES-FAST, Islamabad — 2021–2023, CGPA 2.92/4.0 (73.80%)
- Thesis/paper (unpublished): "Dynamic Allocation of Window Size for Detection of Low-Rate DDoS Attacks" — ML-based (RNN, MLP, LSTM, Random Forest, ADT) low-rate DDoS detection, evaluated on UNSW-NB15
- Actively building AppSec/pentesting skills (PortSwigger Web Security Academy, Burp Suite), targeting eJPT then OSCP
- Works full-time — automation must require near-zero daily manual effort
- Goal: find and contact professors worldwide for PhD admission + funding, running locally on his always-on work machine, at effectively $0 ongoing cost

## 2. Hard Constraints
- **No paid cloud hosting.** Runs on Umer's own always-on local machine via Docker Compose.
- **No GitHub Actions / ephemeral CI schedulers** — needs a persistent process for Redis/BullMQ.
- **No Anthropic API key, no payment method added to Anthropic.** Personalization uses the Claude Code CLI authenticated with Umer's existing Claude.ai subscription login — not an API key.
- **No daily manual babysitting** — self-healing scheduling (check "last run" timestamp, catch up rather than requiring an exact clock time).
- Gmail API is free at this volume (5–8 emails/day) — no cost concern.
- **No filtering toward "elite"/top-ranked universities anywhere.** Priority is admission + funding probability only, explicitly not prestige. Cast a wide net.

## 3. Tech Stack (final)
- **Backend:** NestJS (Node.js)
- **Database:** PostgreSQL (relational — professor ↔ university ↔ status ↔ dates, needs filtering/querying)
- **Queue:** Redis + BullMQ, worker concurrency = 1 (sequential job processing)
- **Scheduling:** `@nestjs/schedule` cron decorators + Postgres "last run" timestamp check for self-healing catch-up
- **Email:** Gmail API via OAuth2 (Desktop app credential type; scopes `gmail.send`, `gmail.readonly`)
- **Personalization:** shells out to Claude Code CLI (`claude -p "..."`) via Node `child_process` — subscription-based, zero extra billing
- **Excel export:** `exceljs`, generated on demand from Postgres (Postgres is the real source of truth)
- **Scraping:** Axios + Cheerio for static aggregator pages. (A Playwright headless-Chromium service is kept for future JS-rendered sites, but no active source currently uses it — the university faculty crawler that relied on it was removed; see Section 8, Step 1.)

### Rejected alternatives (do not re-litigate)
- Google Apps Script — weak scraping, 6-min execution cap, clunky AI calls
- GitHub Actions — ephemeral runners don't fit persistent Redis/BullMQ queue
- Cloud VPS (Oracle Free Tier etc.) — unnecessary once Umer confirmed his own machine stays on 24/7
- Anthropic API key — requires payment method; Claude Code CLI subscription login solves this at $0

## 4. Local Machine Reliability
- Machine stays on permanently (no lid-close sleep, no shutdown) — confirmed by Umer
- Docker Compose services use `restart: unless-stopped` for crash/reboot recovery
- Self-healing "last run" catch-up check built anyway as a safety net
- Minor open item: confirm office network/IT doesn't restrict background Docker processes (low risk, standard HTTPS/443 traffic only)

## 5. Timezone Reference (UAE-based sending)
| Region | Their morning | UAE equivalent | Fit |
|---|---|---|---|
| Sweden/Norway/Denmark/France/Belgium/Austria/Poland/Ireland (CET/CEST) | ~9 AM | ~11 AM–12 PM | Perfect |
| UK | ~9 AM | ~1 PM | Fine |
| US/Canada (East) | ~9 AM | ~5–6 PM | Fine |
| Australia | ~9 AM | ~2–3 AM | Awkward, lowest-priority batch anyway — not engineered around |

No complex per-country send windows needed — self-healing catch-up naturally lands sends in UAE evening/daytime, aligning with Europe's morning (top priority region).

## 6. Target Countries — Priority Weighting (NOT ranking-based)
No filtering by university prestige. Priority = realistic admission + funding availability only.

**Tier 1 (highest weight — funded/professor-driven PhD hiring model):**
Sweden, Norway, Denmark, Belgium, France, Austria, Ireland

**Tier 2 (secondary weight):**
Italy (funded spots via national competitive exam — more bureaucratic), Poland (growing doctoral-school stipend system, lower cost of living, verify lab quality individually)

**Tier 3 (smaller batch — formal committee-based admissions):**
UK, Canada, US — for the US, target mid-tier state universities with active security/networking labs, not T20 CS programs

**Tier 4 (smallest batch):**
Australia — stricter GPA floors typically apply

**Excluded for now:** Ukraine — active war conditions affect university operations, safety, visa processing, funding stability. Revisit if situation changes.

Suggested daily send-quota weighting (tune later based on real reply-rate data): ~50% Tier 1 / 15% Tier 2 / 25% Tier 3 / 10% Tier 4

## 7. Research Matching — Broad OR-Match Logic
A professor qualifies if they match **any single Tier 1 tag** — no combination/intersection required (deliberate correction from an earlier narrower "2+ tags must overlap" design that wrongly excluded single-focus professors).

**Tier 1 tags (core, any one qualifies):**
Cybersecurity (general), Network security, Intrusion detection / anomaly detection, Application security (AppSec), Cloud security, Machine learning / AI, Malware analysis, Cryptography, IoT security, Digital forensics, Penetration testing / offensive security, Security operations / threat intelligence, Privacy engineering / data privacy, Distributed systems security, DevSecOps

**Tier 2 tags (adjacent, lower priority fallback, not excluded):**
Data science / big data, Software engineering with security/reliability angle, Blockchain security, Wireless/mobile network security

Store matched tag(s) per professor row so results can be sorted/filtered by match strength.

Note: "OpSec" as a literal search term returns almost nothing — use academic labels instead: "security operations," "threat intelligence," "human factors in security."

## 8. Pipeline — Only Step 4 Uses Claude

| # | Step | Uses Claude? | Implementation |
|---|------|:---:|---|
| 1 | Discovery — scan EURAXESS, AcademicTransfer, jobs.ac.uk | No | Axios/Cheerio scraper modules, one per source. (A Playwright university-faculty crawler was built and later removed: raw Hipolabs seeding hit community colleges/art schools, faculty pages list people not open positions, and it produced 0 qualifying leads. Job boards are position-centric and cover the need. `PlaywrightService` is retained, dormant, for future heavy scraping.) |
| 2 | Matching/filtering against research tags (Section 7) | No | Tag OR-match logic |
| 3 | Dedup + store | No | Postgres, unique key = email or name+university hash |
| 4 | **Personalize — write 2–3 tailored opening sentences per professor** | **Yes** | Node `child_process` shells out to `claude -p` with professor's research info + Umer's paper/CV summary |
| 5 | Assemble full email | No | Fixed template + Claude's personalized snippet + attachments |
| 6 | Send (rate-limited, 5–8/day max — anti-spam-flag mechanism) | No | Gmail API, BullMQ rate limiter |
| 7 | Track status | No | Postgres update |
| 8 | Check replies | No | Gmail API search/read. Vacation/out-of-office auto-responders (RFC 3834 `Auto-Submitted`, vendor headers, "Automatic reply" subjects) are ignored so they don't get mistaken for a genuine reply and cancel the follow-up |
| 9 | Follow-up (14 days no reply) | No | Date logic, loops back to Step 4 for that professor only |
| 10 | Export Excel snapshot on demand | No | `exceljs` reading from Postgres |

## 9. Database Schema — Professor Tracker (core table)
Fields: `professor_name`, `university`, `country`, `department_lab`, `email`, `matched_tags` (array), `source`, `match_reason`, `funding_type`, `application_deadline`, `status` (enum: not_contacted / applied / emailed / follow_up_sent / replied / rejected / interview / accepted — `applied` = manually applied via the position's portal, used for no-email apply-link listings that are never auto-emailed), `date_discovered`, `date_emailed`, `followup_date`, `reply_notes`

Reference Excel version of this schema already exists: `PhD_Professor_Tracker.xlsx` (dropdown validation for status/country included) — usable as the schema blueprint.

## 10. Gmail API Setup
1. console.cloud.google.com → create new project (e.g. "phd-outreach")
2. APIs & Services → Library → enable "Gmail API"
3. APIs & Services → Credentials → Create Credentials → OAuth client ID
4. Configure OAuth consent screen — "External," add Umer's Gmail as test user (keeps it private/unpublished)
5. Create OAuth client ID, type "Desktop app" → download Client ID + Secret JSON → goes in `.env`
6. First run opens browser → log in once → approve scopes `gmail.send` + `gmail.readonly` → generates refresh token
7. Refresh token reused automatically thereafter
- Free at this volume, no cost concern

## 11. Claude Code CLI Setup
1. `npm install -g @anthropic-ai/claude-code` (requires Node.js)
2. Run `claude` inside the project folder
3. **Log in with existing Claude.ai subscription account — NOT an API key** (explicit choice to avoid billing)
4. Claude Code reads this `PROJECT.md` automatically as project context once pointed at it
5. Personalize step: Node's `child_process` shells out to `claude -p "<prompt>"`, captures text output
6. Worth checking support.claude.com for any headless/scripted usage-limit specifics under a subscription plan — expected non-issue at 5–10 short calls/day, not independently confirmed with current numbers

## 12. Build Order
1. `docker-compose.yml` (Postgres + Redis, `restart: unless-stopped`) — confirm it boots
2. Tracker module + Postgres schema (Section 9) — insert test row, confirm DB write + Excel export end to end
3. Discovery module for ONE source first — EURAXESS (cleanest structure) — validate data quality before adding others
4. Personalize module — test against real rows from step 3, confirm `claude -p` shell-out works
5. Send module — **test by sending to Umer's own email first**, before any real professor
6. Reply + follow-up modules last, once sending is proven safe and rate-limited correctly

## 13. Application Documents — Status & Folder
All documents live in one folder: `PhD_Outreach_Docs/`. This is what gets attached to outreach emails (CV + writing sample always; degree/transcript/reference letters when a specific professor/university requests them).

| File | What it is | Status |
|---|---|---|
| `Umer_Bilal_Academic_CV.pdf` | Rebuilt academic-style CV (2 full pages) — leads with research profile/education/thesis, includes Future Research Interests and Conferences/Leadership sections, named references with real emails. Photo, passport number, DOB removed (not expected/can bias academic review internationally). | ✅ Ready — primary CV to send |
| `Umer_Bilal_CV_Europass.pdf` | Original Europass-format CV (job-style, leads with work experience) | Superseded — kept for reference only, not sent to professors |
| `Umer_Bilal_Masters_Degree_Attested.pdf` | MS degree certificate, HEC + UAE MOFA attested | ✅ Ready |
| `Umer_Bilal_English_Medium_Certificate.pdf` | Letter confirming MS was taught in English (usable in place of an English test for some universities) | ⚠️ Dated 2024 — needs genuine reissue from NUCES (Sumayya Iqbal, Academic Officer) before use. **Do not alter the date on the existing file — this would be document falsification.** Draft a reissue request email to NUCES instead. |
| `Umer_Bilal_RefLetter_DrQaisarShafi.pdf` | Recommendation from thesis supervisor, Dr. Qaisar Shafi (qaisar.shafi@nu.edu.pk) | ✅ Ready |
| `Umer_Bilal_RefLetter_DrSubhanUllah.pdf` | Recommendation from course instructor, Subhan Ullah, PhD (suban.ullah@nu.edu.pk) | ✅ Ready |
| `Umer_Bilal_RefLetter_HinaBinteHaq.pdf` | Recommendation from course instructor, Hina Binte Haq (hina.haq@nu.edu.pk) | ✅ Ready |
| `Umer_Bilal_DDoS_Paper_WritingSample.pdf` | Full paper draft (originally mislabeled "Research Proposal" — renamed for accuracy; it's evidence of research ability, not a forward-looking proposal) | ✅ Usable as writing sample. Note: earlier review of this paper found placeholder/incomplete results sections in one version — confirm the version used going forward has real experimental numbers before wide distribution. |
| `Umer_Bilal_Motivation_Letter_TEMPLATE.pdf` | Rebuilt motivation letter — fixed content is genuine prose; one paragraph is intentionally left as a placeholder (marked in red) because it must be written per-professor by the automation's Personalize step (Section 8, Step 4) — not filled in manually by Umer. | ✅ Base template ready — placeholder paragraph filled automatically per professor at send time |
| `Umer_Bilal_Motivation_Letter_DRAFT.pdf` | Original generic motivation letter | Superseded — kept for reference only |

**Pending action (Umer, not code):** send a reissue request to NUCES for the English-medium certificate with a current date. Offer to draft this email stands.

**Ethical/legal boundary respected:** Claude declined to alter the date on the official English-medium certificate, since this would constitute falsifying a university-issued document. This applies to any future request of the same kind — do not alter dates, signatures, or content on official issued documents (degree certificates, attestations, reference letters). Reissue through the original issuing authority is the only legitimate path.

## 14. Open Items / Things Only Umer Can Do
- [ ] Confirm Node.js version on target machine
- [ ] Confirm Docker Desktop installed
- [ ] Complete Gmail API setup (Section 10)
- [ ] Install and log into Claude Code CLI with subscription (Section 11)
- [ ] Quick check with office IT/network policy re: background Docker processes
- [ ] Request reissued English-medium certificate from NUCES (current date)
- [ ] Optional: notify the three references (Dr. Shafi, Dr. Ullah, Hina Binte Haq) that professors may contact them directly, since their real emails are now listed in the CV

## 15. Status
Architecture fully locked. All application documents reviewed, renamed, and organized in `PhD_Outreach_Docs/`. Academic CV and motivation letter template rebuilt and finalized. Ready to scaffold the actual NestJS repo — begin at Section 12, Step 1.
