---
status: accepted
---

# User docs on a VitePress site on GitHub Pages, built from `dev` until the first release

Omagari had no user docs, only the README and two long pages (`docs/setup.md`, `docs/server.md`). @Pancheble asked for a GitBook-style site on 2026-11-19 (#334): a sidebar, the page, a table of contents, and search. Decided on 2026-11-20 by @Pancheble in #334.

- **VitePress**, from `site/` in the repo. It has the sidebar, the on-page outline, and search (MiniSearch, in the browser) built in, with no outside service. Its pages are plain Markdown. It has its own `package.json` and lockfile in `site/`, outside the npm workspaces, so the app's build and dependencies don't change.
- **GitHub Pages at `omagari-dev.github.io/omagari`**, deployed by `.github/workflows/docs.yml`. Pull requests only build it.
- **English only.** ADR-0045 stays: only the README has a Korean copy.
- **It follows `dev` until the first release.** Before then, `main` and npm `latest` don't hold the install that the docs describe (ADR-0048), so the docs say `npm i -g omagari@next`. At the first release, the workflow and the `github-pages` environment switch to `main`.
- **`docs/setup.md` and `docs/server.md` moved to the site** (`site/setup.md`, `site/server.md`), and the old paths point there. `docs/` keeps the internal docs: the product and implementation docs, ADRs, and the stage logs. The in-app help links open the site.

## Considered Options

- **Starlight (Astro)**: the same features (search with Pagefind), but it brings in Astro as one more tool.
- **Docusaurus**: the official search is Algolia DocSearch, an outside service you apply for. Local search is a community plugin. Its versioned docs aren't needed yet, and it's the heaviest.
- **GitBook.com**: hosted outside the repo and outside GitHub Pages. The free open-source plan takes an application, and sources disagree on whether it has a custom domain.

## Sources

- [VitePress search](https://vitepress.dev/reference/default-theme-search)
- [Starlight site search](https://starlight.astro.build/guides/site-search)
- [Docusaurus search](https://docusaurus.io/docs/search)
- [GitBook pricing](https://gitbook.com/pricing/)
