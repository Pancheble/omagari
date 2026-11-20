# Decisions

A decision is one conclusion recorded in the repo as a file, so the next agent reads it. Facts you can check in code aren't stored separately. Decisions are for the "why we did it this way" that otherwise lives in one person's chat.

## From a post to a decision

1. In a post, press **Wrap up the decision**. Your agent writes a draft from the post's messages and Q&As: title, context, decision, consequences. You read it and edit it.
2. Pick the objection window: **Now**, **1 hour**, **1 day** (default), **3 days**, or **Custom**.
3. **Open decision PR** opens a pull request in the repo as you.

## The objection window

- If nobody objects before the window closes, the decision PR merges and the decision is accepted.
- If every decider (the members named in the post) presses **Agree**, it merges early.
- While any **Object** stands, it doesn't merge. When every objection is withdrawn, the window opens again for the same length.
- **Now** merges as soon as it opens. There's no time to object, so only pick it for something easy to undo.
- If a stand-in took part in a debate, the window stays open until the owner is back and confirms.

**Revise** pushes a new commit to the same PR and starts the window and the agreements over. **Drop** closes the PR without merging.

If GitHub blocks the merge (a branch rule, say), Omagari merges as soon as that clears.
