---
name: Krillin Chatgpt
description: A separate signal-review tool preserving the Krillin scanner's visual identity.
colors:
  accent: "#3D34C9"
  accent-ink: "#FFFFFF"
  accent-soft: "#E9E8FB"
  background: "#F3F4F8"
  surface: "#FFFFFF"
  surface-secondary: "#F7F8FB"
  sunken: "#EDEFF5"
  ink: "#14161F"
  ink-secondary: "#444A5C"
  muted: "#62697E"
  line: "#E1E4EC"
  line-strong: "#CFD3DE"
  long: "#0D7A59"
  long-soft: "#DFF3EC"
  short: "#BE3448"
  short-soft: "#FBE6E9"
  warning: "#9C5B00"
  warning-soft: "#FBEFD9"
  accent-dark: "#8F89FF"
  accent-ink-dark: "#0E1016"
  accent-soft-dark: "#24234A"
  background-dark: "#0E1016"
  surface-dark: "#161922"
  surface-secondary-dark: "#1B1F2A"
  sunken-dark: "#12151D"
  ink-dark: "#E7E9F0"
  ink-secondary-dark: "#B9BECC"
  muted-dark: "#989EB0"
  line-dark: "#262A37"
  line-strong-dark: "#343948"
  long-dark: "#3FCB98"
  long-soft-dark: "#15302A"
  short-dark: "#FF6F83"
  short-soft-dark: "#3A1C24"
  warning-dark: "#F0AC43"
  warning-soft-dark: "#3A2B12"
typography:
  display:
    fontFamily: '"Archivo", "Arial Narrow", system-ui, sans-serif'
    fontSize: "23px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "0.01em"
  title:
    fontFamily: '"Archivo", "Arial Narrow", system-ui, sans-serif'
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 600
  data:
    fontFamily: '"JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace'
    fontSize: "12px"
    fontWeight: 400
rounded:
  panel: "10px"
  control: "6px"
  chip: "4px"
spacing:
  compact: "8px"
  standard: "16px"
  page: "20px"
  group: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "38px"
  chip-neutral:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.chip}"
    padding: "3px 6px"
---

# Design System: Krillin Chatgpt

## Overview

This document describes the implemented page in this directory. The original scanner is the visual reference: cool neutral surfaces, a violet action accent, compact data, and the existing Archivo, Public Sans, and JetBrains Mono font families. This is an extension of that identity, not a replacement visual system for the repository.

The page is a tool for scanning and reading signal evidence. Functional hierarchy comes from headings, dividers, data alignment, and selection states. It does not add a promotional hero, illustration, or decorative metric dashboard. The user's original scanner remains a separate page.

## Colors

The light and dark token pairs above reproduce the scanner's palette roles. The operating-system color preference selects the dark palette. Secondary text uses the values in this page's stylesheet, which are slightly stronger than the original scanner's muted text.

### Primary

Violet marks the scan action, links, focus rings, and the selected feed. Its soft counterpart marks selected rows and feed counts. Inactive elements remain neutral.

### Neutral

The page background surrounds white or dark raised-tone working surfaces. Secondary and sunken tones identify table headers, hover states, and small counts. Lines divide sections and rows; the stronger line separates evidence blocks and controls. Ink, secondary ink, and muted text carry the information hierarchy.

### Semantic states

Green identifies long direction or qualified state. Red identifies short direction, rejected state, and errors. Amber identifies research or warning state. Soft semantic backgrounds accompany their matching text colors. Direction and qualification remain written labels; color alone never supplies their meaning.

## Typography

Archivo carries the product name and section titles. Public Sans carries labels, descriptions, controls, and ordinary prose. JetBrains Mono is reserved for numeric data, dates, and measurements. The existing Google Fonts source is retained with the original fallback families.

The product name uses the display role above, reducing to (20px) on small screens. Section titles use the title role. Ordinary prose uses the body role; compact descriptions and data tables use (11–12.5px). Controls use (13px) semibold text. Numeric measurements use tabular numerals.

Fixed sizes preserve the scanner's working density. Copy wraps within its panel; explanatory notes have bounded line length. There is no fluid hero typography.

## Layout

The working canvas has a maximum width of (1480px), with desktop page gutters of (20px). The header separates the page title from the link to the original scanner. Scan controls and their live status form the next working row.

The primary workspace pairs the signal feed with an idea-detail pane in two columns, separated by (18px). Historical and forward evidence appear as two separate columns below it. At (1050px) and below, both areas become a single column. The signal list is bounded and scrollable rather than stretching the page indefinitely.

At (600px) and below, page gutters reduce to (12px), the title becomes smaller, and settings become a single column. Evidence tables scroll in their own keyboard-focusable regions, bounded to a maximum height of (420px). Sticky column headings remain visible as rows scroll. Rule metadata wraps; accepted and rejected comparisons remain adjacent. Section breaks use margins and divider lines rather than repeated cards.

## Elevation & Depth

This page uses no drop shadows. Tone and a single border distinguish the feed and detail panes from the page background. Inner content is divided by lines rather than additional framed cards. Selection and hover introduce tonal changes; there are no glass surfaces or decorative blur effects.

## Shapes

Working panes have gently curved corners using the panel radius. Buttons, input fields, and table frames use the control radius. Small chips and counts use the chip radius. These are compact rounded rectangles, not oversized pills.

The three short colored lines next to the title preserve the incumbent scanner's brand mark. No additional icon library is introduced.

## Components

### Buttons and inputs

The primary scan button uses the violet accent; secondary actions use a neutral surface and border. Hover changes the neutral surface or the primary button's brightness. Pressed neutral controls use the sunken tone. Disabled controls reduce opacity and lose the pointer cursor. Focus uses an accent outline (2px), offset by (3px).

Native number fields, a select, and checkboxes retain browser behavior. Settings inputs have a neutral surface, single border, and control-radius corners. Coarse-pointer devices receive control heights of at least (44px). Invalid numeric fields use the red border treatment.

### Feed navigation and rows

Feeds are native buttons. The current feed has a violet bottom rule and matching text; its small count uses the soft accent tone. The controller exposes selection through `aria-pressed`. Rows use the entire button as their click target; hover and selection use neutral or soft accent surfaces.

### Tables and evidence

Tables use compact headings, row dividers, and separate scrollable containers. Column headings stay at the top of the bounded table region; every row remains accessible by scrolling. Headings, chips, counts, and supporting sample labels use at least (11px). Historical and forward evidence have their own headings and source notes. The displayed schema separates setup, timeframe, closed count, open count, mean R, profit factor, and recent mean R. Blank evidence uses explanatory text rather than fabricated samples.

### Status, errors, and empty states

The scan status is a polite live region. Progress uses a native progress element with an accent fill; its width change uses a short (180ms) ease-out transition. Error text sits on a soft red surface and uses an alert role. The initial feed explains how to start; the initial detail pane explains what selecting an idea reveals.

Settings use native disclosure instead of a modal. The observation log is a bounded list. Export is a direct secondary action. Reduced-motion preferences disable transitions.

## Do's and Don'ts

- **Do** preserve the incumbent font families, semantic color roles, and compact scanner density.
- **Do** retain visible labels alongside colored direction and qualification states.
- **Do** keep historical evidence visually distinct from forward observations.
- **Do** keep keyboard focus visible and native controls operable.
- **Don't** restyle the original scanner when editing this page.
- **Don't** add a new palette, promotional hero, decorative metrics, or unrelated illustration.
- **Don't** turn signal grades into a visual confidence badge.
- **Don't** fill empty feeds or evidence tables with invented live signals or performance claims.
