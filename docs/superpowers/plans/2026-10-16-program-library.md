# Program Library Implementation Plan

**Goal:** Public example/program navigation with owner-only cloud management and reliable startup.

**Architecture:** Static sidebar and dialogs call the existing emulator through a small bridge. A Vercel function stores individual program documents in private Blob storage and exposes public reads plus authenticated mutations.

**Tech stack:** Existing HTML/CSS/JavaScript, Node.js, @vercel/blob, Node test runner, Playwright.

**Spec:** ../specs/2026-10-16-program-library.md

## Constraints

- Preserve existing direct paste and same-name file popup behavior.
- Only owner sessions may mutate cloud programs; source listings are public.
- Built-in examples work without cloud configuration.
- No credentials in source, browser code, fixtures, logs, or committed files.
- No database service requiring uptime maintenance.

## Tasks

1. Add failing server tests for unauthorized writes, same-origin checks, session handling, validation, throttling, upload, conditional edits, and deletion. Implement one Vercel API and private Blob adapter. Verify using an in-memory Blob implementation and document real configuration.
2. Add six source examples, startup configuration, the left program panel, and owner login/edit/delete dialogs. Reuse the existing DOS file-opening routine through an explicit bridge. Test public navigation and cloud management using mocked HTTP responses, then retain the existing emulator paste regression.
3. Replace the startup F5 timer with a configured initial program. Verify fresh and slower startup screenshots, file opening, mobile layout, and API cache exclusion in the service worker.
4. Run all focused checks, inspect the complete diff, and report the local result and any cloud setup still required. Do not publish or claim real cloud integration without the owner's configured service.
