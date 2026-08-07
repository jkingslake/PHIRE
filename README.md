# PHIRE
The POLAR Henry Ice Rise expedition: planning, mapping, analysis, website

## Book

This repo contains a [MyST](https://mystmd.org) Jupyter Book, built and deployed to GitHub Pages automatically on every push to `main` (see [.github/workflows/deploy-book.yml](.github/workflows/deploy-book.yml)).

To build it locally:

```bash
conda env create -f environment.yml
conda activate phire
npm install -g mystmd
myst build --html --execute
```

Then open `_build/html/index.html`, or run `myst start` for a live-reloading dev server.

