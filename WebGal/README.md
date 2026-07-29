# WebGAL-Chefe

This repository is the working tree for FurryFur INC's rebranded WebGAL engine and the game **秉烛生**.

## What lives where

- `packages/webgal/src/` contains the engine code.
- `packages/webgal/public/game/` contains your game content, scripts, templates, and assets.
- `packages/parser/` contains the WebGAL script parser.
- `packages/server/` contains the local runtime server for packaged builds.

## Working on the engine

Install dependencies:

```bash
yarn install
```

Run the engine locally:

```bash
yarn dev
```

Build the web bundle:

```bash
yarn build
```

The engine layer is everything outside the game folder. That is where UI, runtime behavior, packaging, and deployment automation should be changed when you are updating WebGAL-Chefe itself.

## Working on the game

Put all game-specific content in `packages/webgal/public/game/`.

Recommended entry points:

- `config.txt` for project settings.
- `start.txt` for the first scene.
- `scene/` for story scripts.
- `background/`, `figure/`, `bgm/`, `vocal/`, and `video/` for assets.
- `template/` for the game UI template and CSS.

The deploy demo page publishes the built game page, so whatever is in the game folder becomes the player-facing experience.

## Release and deployment

- `.github/workflows/deploy-demo-page.yml` publishes the built game page to GitHub Pages.
- `.github/workflows/release.yml` and `.github/workflows/release-beta.yml` package release archives from the built web app.
- `release-to-terre.sh` copies the built output into the Terre template workspace.

## License

The engine code remains under MPL-2.0. Game content under `packages/webgal/public/game/` is maintained by FurryFur INC.
