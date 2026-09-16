# Changesets

Semantic versioning and the changelog (D-041).

A change that affects released behavior adds a changeset:

```bash
pnpm changeset
```

Nothing here is published to a registry. Every package is `private: true` and the product
is a privately hosted application, not a distributed package. Changesets is used for
version identity and an automated changelog — the `release` workflow opens a version pull
request and does not publish.

A change that affects no released behavior — tooling, docs, a refactor, a test — needs no
changeset.
