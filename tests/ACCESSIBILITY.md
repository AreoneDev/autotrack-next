# Accessibility verification

The suite uses synthetic accounts and the loopback HTTP double from `TESTING.md`. It never changes a real account or production record. `npm run test:a11y` runs the accessibility subset; `npm run test:e2e` and the existing CI job include it automatically in Chromium, Firefox, WebKit and mobile Chromium. Full axe JSON (including incomplete checks), screenshots and failed traces are attached to the Playwright report and uploaded by CI.

| Case | Risk and design | Expected behavior |
| --- | --- | --- |
| A11Y-01 | Login state partitions (password, registration, email link, error); keyboard transition | Selected mode is exposed; Email → Password → Submit follows DOM order; Enter submits; errors are alerts |
| A11Y-02 | Representative populated pages and disclosure states | Leads, Dashboard, Agenda and Analytics have one main landmark and h1, distinct titles, named navigation and current page; skip link focuses main; collapsed links keep names; notifications expose expanded state and close on Escape |
| A11Y-03 | Modal transition and first/last focus boundaries | Create and brief dialogs receive initial focus, isolate the background, contain Tab/Shift+Tab, close on Escape and restore the trigger |
| A11Y-04 | Detail, task edit, lead edit and delete confirmation states | Forms and contextual actions have names; delete initially focuses Cancel; Escape cancels and restores focus |
| A11Y-05 | Calendar day/week and month boundary values | One day is in Tab order; Left/Right move one day, Up/Down one week, retaining focus across months; dates and task counts can be read |
| A11Y-AC-01 / UI-VEH | Combobox state transitions, selection and custom-input partitions | Arrow keys highlight options, Enter selects without submitting, Escape/Tab dismiss; active option is exposed; custom trim remains possible |

Axe checks WCAG 2 A/AA, WCAG 2.1 A/AA, WCAG 2.2 AA and best-practice tagged rules without exclusions or disabled rules. Every detected violation fails the test, regardless of impact. Coverage includes login modes, an error, populated pages, expanded notifications, collapsed navigation, create/brief/delete dialogs and detail/task/lead editors. CI uses the same tests on PRs and main. Passing automated scans is not a WCAG conformance claim.

Implemented behavior includes visible keyboard focus, reduced-motion support, native modal background isolation, contextual icon/action names, associated form labels, named vehicle groups, readable calendar dates, and a text table alternative for each rendered analytics trend chart. Native selects keep browser keyboard behavior; custom vehicle comboboxes support ArrowUp/Down, Enter, Escape and Tab. Calendar month buttons remain ordinary Tab stops.

Manual checks still required: NVDA with Chrome/Firefox and VoiceOver with Safari for actual spoken output, reading order, route announcements, announcements during task saves and virtual-cursor navigation; 200%/400% zoom and narrow-viewport reflow; touch assistive technology; forced colors; and a broader audit of all failure/empty/long-content states. Mobile Chromium is a browser viewport/emulation run, not a real Android screen reader. JSDOM only shims dialog methods; browser tests establish modal focus behavior. Axe incomplete findings require human review. Real email delivery, Supabase RLS and deployment runtime are outside this synthetic suite.

Sources: [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing), [W3C native dialog technique](https://www.w3.org/WAI/WCAG22/Techniques/html/H102). Next.js guidance was read from the installed `node_modules/next/dist/docs/03-architecture/accessibility.md` and the installed layout/metadata guides before implementation.

## Validation record (2026-11-02)

Local Windows verification: ESLint, TypeScript and 31 Jest suites / 289 tests passed. The four-project browser regression run passed 71/72 cases; the remaining Windows WebKit skip-navigation case passed after giving the skip link an explicit normal (`tabIndex=0`) tab stop. Its retest covers all four primary pages, the skip action, collapsed navigation and notifications. No browser-specific shortcut, skipped case, rule exclusion or retry masks the behavior.

[Initial PR CI run](https://github.com/AreoneDev/autotrack-next/actions/runs/41576351939) passed all 289 Jest tests and all 72 Playwright cases (20 accessibility cases) on Ubuntu/Node.js 24, including the production build. The [PR checks](https://github.com/AreoneDev/autotrack-next/pull/6/checks) track validation of subsequent commits and are required before merge. Main CI is checked again after merging. CI has no deployment job or configured deployment target in the repository; a successful build alone does not verify a deployed service.
