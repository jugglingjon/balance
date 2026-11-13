# Balance

Yoga pose balance simulator: Vite + three.js + vanilla JS modules + SCSS.

## Workflow

- Develop on the session's working branch, not directly on `main`.
- When a dev task, phase or feature is complete (built, checked and pushed to the
  working branch), ask the user through a question dialog (AskUserQuestion) whether
  to merge it into `main`. Do not merge without that approval, and ask again each time.
- Merging to `main` publishes the site: `.github/workflows/deploy.yml` builds every
  push and deploys `main` to GitHub Pages at https://jugglingjon.github.io/balance/.
  After merging, confirm the deploy run succeeded.

## Commands

- `npm run dev` – local dev server
- `npm run build` – production build to `dist/`
