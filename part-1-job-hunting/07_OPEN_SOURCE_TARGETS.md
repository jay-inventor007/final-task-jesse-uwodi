# 1.4 Open Source Targets & Edge Project Strategy

## 1. Five Vetted Open Source Issues / Targets

Targeting projects actively used in Jesse's tech stack (Expo, Supabase, TanStack Query, Zod):

| # | Project | Focus Area | Why This Fits | Target Action |
|---|---|---|---|---|
| 1 | **Supabase JS / PostgREST** | Client Types & Filter Ergonomics | Deep PostgreSQL & Supabase experience | Improve error messages on typed RPC calls and edge authentication token refreshes. |
| 2 | **TanStack Query (React Query)** | React Native Mutation Rollback Docs | Deep experience with optimistic updates | Add comprehensive example demonstrating offline mutation cancellation on Android. |
| 3 | **Expo / React Native Community** | FlashList / Gesture Handler Types | Core mobile tech stack | Submit PR improving TypeScript definitions on animated list re-renders. |
| 4 | **Paystack Node SDK / Community Libraries** | Webhook Signature Verification Types | Directly built in `paystack-subscription-engine` | Provide type definitions for webhook payloads including dispute and charge event invariants. |
| 5 | **Zod Schema Validation** | Error Map Formatting Guides | Server validation invariant | Improve documentation and localized error map helpers for REST APIs. |

---

## 2. Chosen Edge Project: `paystack-proration-engine` (npm Library)

### What it is
A zero-dependency, mathematically proven TypeScript library that calculates exact subscription upgrades, downgrades, and seat expansions in **integer minor units (kobo/cents)** with zero floating-point drift.

### Key Features
- **Deterministic Integer Math:** Prevents fractional currency rounding errors (`0.1 + 0.2` float imprecision).
- **SaaS Billing Invariants:** Calculates unused credit from previous tiers, prorates remaining billing period days, and computes net due balances.
- **Full Unit Test Suite:** Includes the 8 mandatory test cases covering instant upgrade, downgrade credit rollover, mid-cycle seat additions, and renewal grace periods.
- **Documentation & Benchmarks:** Comprehensive README with interactive CodeSandbox and architecture rationale.
