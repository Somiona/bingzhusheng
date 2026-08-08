# 秉烛生

This repository contains the game, its WebGAL engine fork, and WebGAL Terre editor in one pnpm workspace.

## First run

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm repo:setup
pnpm dev
```

`pnpm repo:setup` installs no packages. It hydrates Git LFS files, creates the game links, and points Terre at this repository's ignored `.terre` data directory.

## Main commands

- `pnpm dev` — editor plus watched custom engine
- `pnpm check` — repository audit, type checks, and tests
- `pnpm build` — self-contained web game in `WebGal/packages/webgal/dist`
- `pnpm preview` — preview the web build
- `pnpm package:desktop` — package the current desktop platform
- `pnpm package:android` — build an Android package
- `pnpm check:ios` — compile the iOS simulator target
- `pnpm mobile:init [android|ios]` — regenerate ignored Capacitor native projects

The canonical game is always `game/`. Engine builds, Terre previews, and native packages are generated from it.

Pushes to `main` deploy the web build to GitHub Pages. A `v*` tag publishes unsigned Windows/macOS packages and a debug-signed Android APK; iOS is compiled in CI but not released until signing is configured.