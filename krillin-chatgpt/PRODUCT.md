# Krillin Chatgpt

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The repository owner uses the scanner to understand signal quality and review a smaller set of crypto trade ideas. Historical success, failure, and consistency matter before trading automation.

## Product Purpose

Provide a separate scanner with truthful alert timing, valid trade plans, grouped ideas, a positive historical confluence filter, visible evidence and frozen forward observation.

## Operating Context

This is a static browser application alongside the original GitHub Pages scanner. Public Binance USDT-M market data powers both signal generation and forward paper evaluation. Scanning runs while this page is open. Each browser stores its own observation log.

## Capabilities and Constraints

- The original scanner, strategy engine, archives, and replay workflow remain unchanged.
- The separate page is named Krillin Chatgpt.
- Qualification uses 76 positive historical confluence combinations with at least 100 closed plans, 10 symbols and 20 signal dates. Matching sampled nonpositive combinations are excluded.
- Ratings range from 10 to 1 by descending historical mean-R rank. They express relative historical performance, not confidence. Exact mean R sorts ties.
- Preserve raw observations, decisions, upgrades, and rejected candidates for later comparison.
- Historical results are exploratory and separate from forward observations.
- The user's planning defaults are a $5,000 account and 2% complete-plan risk.
- No exchange credentials, order submission, or external messages are part of this scanner.

## Evidence on Hand

The frozen confluence evidence uses 45,247 archived signals at commit ad5485ce88bb2f7ae9c3154ef4679d1119f4e57f. It covers 306 replay days, September 1, 2025–May 28, 2026 and August 29–October 3, 2026; May 29–August 28 is missing. Outcomes are evaluated through October 4, 00:00 UTC. Rankings were selected retrospectively and cannot be treated as unseen validation. The ongoing backfill does not silently change the frozen policy.

## Product Principles

Preserve the original. Make time and data provenance explicit. Avoid false precision and retrospective confidence. Keep raw evidence auditable. Use readable, accessible controls.
