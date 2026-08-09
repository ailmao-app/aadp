# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities **privately**, not through a public issue.

Use GitHub's private reporting form:
<https://github.com/ailmao-app/aadp/security/advisories/new>

Please include, where you can:

- the affected version(s) of `ail-aadp`;
- the smallest reproduction you have (a failing test or a short script is ideal);
- what an attacker or a mistaken caller gains — disclosure, bypass of a limit,
  request forgery, and so on;
- whether the issue needs a specific deployment shape (a shared traversal
  budget, an authenticated resource, a redirecting server, ...).

We aim to acknowledge a report within 7 days. If a report turns out not to be a
vulnerability, we will say so and explain why rather than leaving it open.

Please give us a reasonable window to publish a fix before disclosing publicly.

## Supported versions

Fixes land on the latest minor release line. Older lines are not backported
unless a specific advisory says otherwise.

| Version | Supported |
|---|---|
| `1.3.x` | Yes |
| `< 1.3` | No |

## What is in scope

This package is a protocol client, server runtime and validator. In-scope
examples:

- a client that fetches a URL its configured URL/DNS policy should have blocked;
- credentials, results or in-flight requests crossing between callers or
  configurations that should be isolated;
- a validator accepting a document that violates a released schema, or rejecting
  one that conforms;
- a bypass of a declared limit (response size, redirect count, traversal budget);
- server runtime emitting a document that fails its own schema, or leaking a
  record the resource did not intend to publish.

Out of scope:

- the security of a *publisher's* deployment or the truthfulness of published
  data — schema validity has never implied factual truth, authenticity or
  authorization (see each module's specification);
- vulnerabilities only reachable by passing deliberately malicious values from
  the same trusted process that already controls the client;
- denial of service through resource limits a caller configured themselves.

## Disclosure

Fixed issues are documented in `CHANGELOG.md` under a `Security` heading, with
the affected version range, the conditions required to trigger the issue, and a
workaround for consumers who cannot upgrade immediately. Where the issue affects
a published release, a GitHub Security Advisory is published for it.
