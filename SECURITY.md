# Security Policy

## Status of this software

Koreth is **pre-beta, unaudited, and not production-ready**. It has not been through an
external security review. Nothing in this repository, or in the protocol it indexes,
should be relied on to hold value or to report correct data. Do not deploy it or build
on it under the assumption that it is safe.

## Supported versions

Only `main` is supported. Older commits, tags and branches receive no fixes.

## Reporting a vulnerability

Please report security issues privately, through GitHub's private vulnerability
reporting: open the **Security** tab of this repository and use **Report a
vulnerability**. That is the primary — and only — reporting channel.

Please do **not** open a public issue or pull request for a suspected vulnerability.
A public report discloses the problem before there is a fix.

What helps in a report: what the issue is, which component is affected, how to
reproduce it, and what an attacker gets out of it.

## What belongs here, and what does not

This repository is an indexer. Use the private channel for anything that affects the
security of the protocol or of the infrastructure that runs it.

Findings about **indexed data correctness** — a wrong balance, a missing entity, a
stale or mis-scaled value, a handler that skips an event — are not security reports.
They are bugs, and they belong in a normal public issue, where they can be discussed
and reproduced openly.

## What to expect

Responses are best effort. There is **no service level agreement** on
acknowledgement or on a fix, and **there is no bug bounty programme** — reports are
not rewarded.
