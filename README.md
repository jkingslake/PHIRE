# PHIRE
The POLAR Henry Ice Rise expedition: planning, mapping, analysis, website

## Book

This repo contains a [MyST](https://mystmd.org) Jupyter Book, built and deployed to GitHub Pages automatically on every push to `main` (see [.github/workflows/deploy-book.yml](.github/workflows/deploy-book.yml)), at https://jkingslake.github.io/PHIRE/.

Every pull request also gets its own preview deployment (see [.github/workflows/preview-book.yml](.github/workflows/preview-book.yml)), posted as a comment on the PR, at `https://jkingslake.github.io/PHIRE/pr-preview/pr-<number>/`. Previews are removed automatically when the PR is closed.

Both workflows deploy to the `gh-pages` branch, so this repo's GitHub Pages settings must be set to **Deploy from a branch** → `gh-pages` / `(root)` (not "GitHub Actions"), and **Settings → Actions → General → Workflow permissions** must be set to "Read and write permissions".

To build it locally:

```bash
conda env create -f environment.yml
conda activate phire
npm install -g mystmd
myst build --html
```

Then open `_build/html/index.html`, or run `myst start` for a live-reloading dev server.

The scroll story in [story/](story/README.md) is plain static HTML, not a MyST page. After `myst build`, both workflows copy it into `_build/html/story/` (without its `node_modules`, `video`, `scripts`, npm files, README and SCRIPT), so it is served at https://jkingslake.github.io/PHIRE/story/ and in each PR preview.

**Notebooks are not re-run in CI.** They read local data (Quantarctica, DELORES radar files, WorldView imagery) that isn't in the repo, so the site shows the outputs saved in each `.ipynb`. Re-run a notebook locally and commit it to update what the site shows.

