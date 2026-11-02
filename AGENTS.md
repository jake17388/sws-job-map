# Repository Guide

## Map

- `src/backend/`: ordered Google Apps Script modules; edit these, not generated `Code.js`.
- `src/frontend/`: source HTML, CSS, and browser JavaScript; edit these, not generated `index.html`.
- `tests/`: Node test-runner coverage for backend and frontend behavior.
- `scripts/`: build and syntax-check scripts.
- `.github/workflows/`: CI, Apps Script deployment, and GitHub Pages deployment.

## Commands

- Focused test: `node --test tests/<name>.test.mjs`
- Full verification: `npm run check`
- Coverage: `npm run test:coverage`
- Build generated artifacts: `npm run build`

## Conventions

- Backend modules execute in one Apps Script global namespace and are concatenated in filename order.
- Keep Calendar and Sheet writes idempotent and protected by the script lock when concurrent calls could duplicate data.
- `version.json` is the client-visible release version checked by the PWA.
