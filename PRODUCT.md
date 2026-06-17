# Product

## Register

product

## Users

agent-passport first serves Kane, local-first agent operators, small private-deployment teams, and AI workflow teams that need one resident agent to keep a stable identity, recover from local evidence, and expose auditable runtime decisions.

Users are usually in an operational context: downloading the local app, creating or restoring a Passport on their own machine, checking whether the current agent can continue running, reviewing recovery evidence, rotating credentials, or deciding whether constrained execution should stay locked.

## Product Purpose

agent-passport is a single-machine, local-first, recoverable, auditable Agent Runtime. It gives an agent a stable local identity, long-term preferences and memory, recovery baselines, constrained execution boundaries, and evidence that can be inspected when something goes wrong.

The product does not promise a perfect global agent protocol in the Alpha phase. Success means one resident agent can exist on one machine, recover from local notes and evidence, be taken over by a human when needed, and leave traceable records for critical decisions.

## Surface Scope

agent-passport has two distinct surfaces in the Alpha scope:

1. Public website: a download, trust, legal, and filing entry for `agent-passport.cn`. It should not expose engineering maintenance pages, token forms, or create/login/recovery operator flows as normal user actions.
2. Local desktop software or local embedded web UI: the real product surface for creating a Passport, logging in or restoring one, checking recovery evidence, reviewing audit state, and handling maintenance.

Production public deployments must run with `AGENT_PASSPORT_SURFACE_MODE=public`. Local desktop or operator builds use the default `local` mode so the embedded workspace pages remain available.

It does not ship a native mobile app or a dedicated mobile web version in the Alpha scope. Narrow viewport support is defensive only: prevent obvious layout breakage in small browser windows, not optimize for a phone-first product experience.

## Brand Personality

Calm, precise, and operational.

The interface should feel like a trusted internal control room: clear enough for repeated use, serious without being theatrical, and restrained enough that status, risk, and next action stay more important than visual decoration.

## Anti-references

Do not present agent-passport as a generic SaaS landing page, a crypto-style identity protocol, a decorative AI dashboard, or an app that claims OpenNeed owns the model runtime.

Avoid button piles, fake entry points, marketing claims, oversized decorative metrics, and any wording that blurs the fixed boundary: memory stability engine owns model base/local inference/memory compression/stability, agent-passport owns continuous identity/recovery/audit, and openneed is only an app or compatibility consumer.

## Design Principles

1. Truth before polish: pages must reflect the real runtime, security posture, and recovery state rather than optimistic copy.
2. Public simplicity: the public website exists to download the local app and show trust, legal, ICP, and public-security filing information.
3. Local two-entry simplicity: inside the local app, first-time users choose between creating a Passport or logging in/restoring one.
4. Desktop first: design for laptop/desktop use, not for a standalone phone UI.
5. Operational grouping: local entered pages should group actions by task, such as identity, recovery, evidence, runtime truth, and low-frequency maintenance.
6. Local-first confidence: the UI should make local identity, recovery materials, and audit boundaries visible without making the user read implementation details.
7. Compatibility is labeled: historical OpenNeed naming may appear only as compatibility or legacy context, never as the model or identity substrate.

## Accessibility & Inclusion

Target WCAG AA for contrast, keyboard access, focus visibility, and readable form labels. Motion must respect reduced-motion preferences. The product should remain usable in long internal browser sessions, especially on laptop and desktop web viewports where operators need to scan status quickly under pressure.
