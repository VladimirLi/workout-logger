# Branch protection

**Status:** Not applied. No GitHub remote exists. This is the target configuration, not a
description of reality — see [external-gates.md](external-gates.md), G-1.

Until this ruleset is active, the workflows in `.github/workflows/` are advisory and "CI is
authoritative" ([ADR-0006](adr/0006-ci-is-the-authoritative-gate.md)) is documented intent
rather than an enforced fact.

## Target ruleset on `main` (R-026)

| Rule | Value | Why |
|---|---|---|
| Pull requests only | required | No direct push, including by the owner |
| Required status checks | `verify`, `codeql`, `secret scan (full history)`, `dependency review` | The gate suite |
| Strict status checks | on | A check must have run against the current head |
| Dismiss stale reviews | on | Any new commit invalidates the verdict (R-025) |
| Required review approvals | 1 | The independent agent reviewer (D-034) |
| Linear history | required | A merge commit hides which commit was attested |
| Signed commits | required | Provenance of authorship |
| Force push | blocked | History is evidence |
| Deletion | blocked | |
| Bypass actors | **none** | A routine bypass actor is the whole ruleset, undone |

`dependency review` is required after the repository becomes public, where GitHub provides it
without GitHub Advanced Security.

## Applying it

These commands are recorded, not run. An agent must not create remote resources.

```bash
# Verify what is currently configured.
gh api repos/{owner}/{repo}/rulesets

# Apply a ruleset from a JSON body matching the table above.
gh api --method POST repos/{owner}/{repo}/rulesets \
  --input .github/ruleset-main.json

# Confirm it is active rather than evaluate-only.
gh api repos/{owner}/{repo}/rulesets --jq '.[] | {name, enforcement}'
```

`enforcement` must read `active`. A ruleset in `evaluate` mode reports violations and permits
the merge anyway, which is indistinguishable from no protection when someone is in a hurry.

## Agent principals

Once the ruleset is active, the review approval required above must come from the independent
review agent's own credential, and the merge from a service that holds neither the implementer's
nor the reviewer's identity (R-023). Until separate identities exist (gate G-9), a single
principal satisfies the ruleset mechanically without satisfying its intent. That gap is real
and is recorded here rather than papered over.
