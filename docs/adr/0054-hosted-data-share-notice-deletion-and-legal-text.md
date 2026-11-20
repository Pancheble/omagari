---
status: accepted
---

# Hosted data: a clear share notice, self-serve deletion, automatic cleanup, and legal text the owner publishes

On the hosted server, branch names, changed files and their content, status lines, chat, Q&A, and debate patches of strangers' private repos sit on a server @Pancheble operates. The operator is in Korea, so the Korean Personal Information Protection Act (PIPA) applies, and GDPR may apply if people in the EU sign up. Decided on 2026-11-20 by @Pancheble (`docs/stage7-questions.md` Q4, Q5, Q6, Q11). This isn't legal advice.

- **The default share level stays `full`.** When a person shares a repo, Omagari says plainly that the content of changed files goes to this server (by its address) and that `declared` sends paths only. Self-hosted servers show the same text with their own address.
- **Self-serve deletion.** A person deletes their account in personal settings: their tokens, sessions, profile, presence, works, and settings go. Their messages stay and show as a deleted member, as on Discord. A repo's GitHub Admin removes the repo and deletes its data. A person who is a GitHub Admin of every repo in a workspace deletes the workspace (Omagari doesn't read org roles, ADR-0043).
- **Code doesn't linger.** Changed-file content and debate patches are deleted once their branch is gone or hasn't changed for 30 days. Chat stays until it's deleted.
- **The terms and privacy policy** cover the hosted server only; a self-hosting team is its own operator. An agent drafts them in English and Korean (PIPA asks for Korean) from what the server stores, why, for how long, where (Fly, Tokyo), who processes it (Fly, GitHub, GIPHY), how to delete it, and how to reach us. @Pancheble reads, edits, and publishes them on the docs site. They are the second exception to ADR-0045's "only the README has a Korean copy".
- **The operator is named.** The privacy policy names @Pancheble by real name as the person responsible, with a `privacy@` address on the domain forwarded to the existing inbox.

## Considered Options

- **`declared` by default on the hosted server**: merge runs would mostly stop working there, and servers would differ.
- **Deletion by email to the operator**: less to build, but every request is manual work for one person.
- **A lawyer's review**: costs money we don't have now. We can add it before opening wider.
- **A policy generator**: generic web-site text; the part about code would be written by hand anyway.
- **Only `@Pancheble` in the policy**: may fall short of what PIPA asks for.

## Consequences

- Deletion is real deletion in SQLite, and backups keep deleted data until they expire. The privacy policy says how long.
- The server needs a job that cleans up content and patches.
- Every legal text change goes through @Pancheble.
