# Product

## Register

product

## Users

agent-passport first serves Kane, local-first agent operators, small private-deployment teams, and AI workflow teams that need one resident agent to keep a stable identity, recover from local evidence, and expose auditable runtime decisions.

Users are usually in an operational context: creating or restoring a Passport, checking whether the current agent can continue running, reviewing recovery evidence, rotating credentials, or deciding whether constrained execution should stay locked.

## Product Purpose

agent-passport is a single-machine, local-first, recoverable, auditable Agent Runtime. It gives an agent a stable local identity, long-term preferences and memory, recovery baselines, constrained execution boundaries, and evidence that can be inspected when something goes wrong.

The product does not promise a perfect global agent protocol in the Alpha phase. Success means one resident agent can exist on one machine, recover from local notes and evidence, be taken over by a human when needed, and leave traceable records for critical decisions.

## Surface Scope

agent-passport is a desktop web product for browser-based internal use. It does not ship a native mobile app or a dedicated mobile web version in the Alpha scope.

Narrow viewport support is defensive only: prevent obvious layout breakage in small browser windows, not optimize for a phone-first product experience. Product, UI, QA, and release decisions should use desktop/laptop web as the primary target.

## Brand Personality

Calm, precise, and operational.

The interface should feel like a trusted internal control room: clear enough for repeated use, serious without being theatrical, and restrained enough that status, risk, and next action stay more important than visual decoration.

## Anti-references

Do not present agent-passport as a generic SaaS landing page, a crypto-style identity protocol, a decorative AI dashboard, or an app that claims OpenNeed owns the model runtime.

Avoid button piles, fake entry points, marketing claims, oversized decorative metrics, and any wording that blurs the fixed boundary: memory stability engine owns model base/local inference/memory compression/stability, agent-passport owns continuous identity/recovery/audit, and openneed is only an app or compatibility consumer.

## Design Principles

1. Truth before polish: pages must reflect the real runtime, security posture, and recovery state rather than optimistic copy.
2. Two-entry simplicity: first-time users choose between creating a Passport or logging in/restoring one.
3. Desktop web first: design for long-running browser sessions on laptop/desktop screens, not for a standalone phone UI.
4. Operational grouping: entered pages should group actions by task, such as identity, recovery, evidence, runtime truth, and low-frequency maintenance.
5. Local-first confidence: the UI should make local identity, recovery materials, and audit boundaries visible without making the user read implementation details.
6. Compatibility is labeled: historical OpenNeed naming may appear only as compatibility or legacy context, never as the model or identity substrate.

## Accessibility & Inclusion

Target WCAG AA for contrast, keyboard access, focus visibility, and readable form labels. Motion must respect reduced-motion preferences. The product should remain usable in long internal browser sessions, especially on laptop and desktop web viewports where operators need to scan status quickly under pressure.
