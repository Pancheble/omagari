# Hosted server incident plan

Internal plan for the hosted server (`app.omagari.org`, ADR-0052). It covers two cases: the server is down, and personal data may have leaked. Decided in ADR-0055 and ADR-0054 (`docs/stage7-questions.md` Q10, Q11).

## Who acts

The **operator** is @Pancheble. They get the Upptime issue, the restore-drill failure notice, and any report from a member. Nobody else has deploy or data access yet, so there is no on-call rotation. If the operator is unreachable for more than 24 hours during an incident, nothing in this plan changes; the operator still owns it.

- Operator contact: GitHub `@Pancheble` (issues and private vulnerability reports, see [SECURITY.md](../SECURITY.md))
- Privacy contact (published in the privacy policy): `privacy@[DOMAIN — placeholder, domain not bought yet]`, forwarded to the operator's inbox
- Responsible person named in the privacy policy: `[OPERATOR REAL NAME — placeholder, to be published by the operator]` (Q11)

## Case 1: the server is down

1. **Detect.** Upptime checks the health endpoint every few minutes and opens an issue in the status repo when it fails. That issue notifies the operator.
2. **Check Fly.** Run `fly status -a <app>` and `fly logs -a <app>`. Check whether the machine is stopped, failing health checks, or out of memory or disk on the volume.
3. **Post on the status page.** Within 30 minutes of confirming the outage, post a short note on `status.omagari.org` saying the server is down, what is affected, and that we're looking into it. Keep the text general; don't describe internal weak spots.
4. **Fix or restore.**
   - If the machine is stuck, restart it. If that fails, redeploy the last good image.
   - If the database is lost or corrupt, restore from the Litestream replica (see [Restore](#restore) below).
5. **Confirm.** The health endpoint responds, a test sign-in works, and the status page goes back to operational.
6. **Write it up.** Add a short note to the status issue with the cause and the time of outage. If the outage lasted more than a few hours, add a line to the next release notes.

### Restore

The database is replicated by Litestream to the backup bucket. Volume snapshots are the second copy.

1. Stop the app's machine so it doesn't write to the old file.
2. Restore the latest replica to a new path on the volume, using `litestream restore`.
3. Start the machine with the restored file, then run the health check.
4. Check the restored data by hand: a known workspace loads and recent chat is present.
5. Record the time gap between the last replica write and the restore point, and put it in the write-up.

If the bucket is unreachable, fall back to the newest volume snapshot. Snapshots are kept 5 days (ADR-0042), so data older than that is lost. Say so on the status page.

The monthly restore drill (ADR-0055) runs the same steps in CI. If the drill fails, treat it as a backup incident: check that the replica is current before the next outage happens.

## Case 2: personal data may have leaked

"May have leaked" counts. Start the clock when the operator first learns of it, not when the cause is known.

### Step 1: stop the leak (immediately)

- Revoke the affected tokens and sessions, or rotate the key used to encrypt tokens (ADR-0053) if it may be exposed.
- Take the affected endpoint or feature offline if the leak comes from it.
- Keep the evidence: logs, the database state, and the commit or deploy involved. Don't delete anything to "clean up".

### Step 2: note it on the status page (within 24 hours)

Post a general note: that a security incident happened, that the leak is contained, and that affected people will be contacted. Don't name the weakness, the data counts, or individual accounts.

### Step 3: email affected workspaces' admins (within 72 hours)

- Identify the affected workspaces from the logs. Email the GitHub admins of each affected workspace. Say what was exposed, when, what we did, and what they should do.
- Send within 72 hours of when the operator became aware. If the full picture isn't known yet, send what is known now and follow up.
- If a person's chat or repo content may have been exposed to someone outside the workspace, tell that person too.
- Sender: the privacy address. Draft in English and Korean.

### Step 4: report to the authorities

Korea (PIPA):

- The controller reports to the Personal Information Protection Commission (개인정보보호위원회) or the designated agency, KISA, within 72 hours after learning of the leak, in writing (Enforcement Decree Article 40). The PIPC guidance says a report is required when 1,000 or more people's data leaked, when sensitive or unique identifiers leaked, or when an outside party gained illegal access to the personal data processing system. Report through KISA's portal (brss.pipc.go.kr) and state whether data subjects were notified.
- If the cause isn't known in time, report what is known and send the rest in phases.
- Failing to report can be fined up to KRW 30 million (PIPA Article 75(2)).
- Sources: [PIPC, leak reporting page](https://www.pipc.go.kr/np/default/page.do?mCode=D030040000); [law.go.kr, PIPA](https://www.law.go.kr/법령/개인정보보호법). **Open check:** the statute and decree text did not load when this plan was written. Before the first real incident, the operator must check Article 34 and Enforcement Decree Article 40 on law.go.kr, including the data-subject notice deadline, and correct this section if needed.

EU (GDPR), if any EU person's data is affected:

- Art. 33(1): notify the supervisory authority without undue delay and, where feasible, within 72 hours of becoming aware. Give reasons if later. Notification is not needed if the breach is unlikely to risk people's rights and freedoms, but document the decision either way (Art. 33(5)).
- Art. 34(1): tell the affected people without undue delay when the breach is likely to be high risk. Exceptions are in Art. 34(3).
- Art. 33(2): a processor must tell the controller without undue delay. Fly and GitHub are processors for the server's data; note the same for them.
- Source: [GDPR Art. 33](https://gdpr-info.eu/art-33-gdpr/) and [GDPR Art. 34](https://gdpr-info.eu/art-34-gdpr/) (third-party mirror; check against [EUR-Lex, Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj) before relying on exact wording).

### Step 5: after the incident

- Write a short internal post-mortem: timeline, cause, what data, who was told, what changed.
- Keep the record for the period the privacy policy says.
- Update this plan if a step didn't work.

## Public wording

Public notes stay general: what happened, what's affected in general terms, what we did, and what people should do. The repo is public, so don't write exploit details, file paths, or weak spots here or on the status page.

## Related

- [SECURITY.md](../SECURITY.md) — how to report a vulnerability
- ADR-0052 hosted beta, ADR-0053 GitHub App and encrypted tokens, ADR-0054 data and deletion, ADR-0055 operations
