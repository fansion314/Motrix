# Arch Linux x86_64

[简体中文](arch-aur.zh-CN.md)

This fork packages Motrix 2 with Arch's system `electron` and the upstream
Motrix project's pinned, prebuilt aria2 fork.
Build and install on an up-to-date Arch Linux x86_64 system. Other architectures
and distributions are not supported by this packaging workflow.

## Install

Download the `*-aur.tar.gz` asset from an
[Arch release](https://github.com/fansion314/Motrix/releases), extract it, then
choose one of these packages:

```sh
cd aur/motrix2       # Build Motrix from the tagged source
makepkg -si
```

```sh
cd aur/motrix2-bin   # Download the verified prebuilt ASAR
makepkg -si
```

The release contains complete PKGBUILDs and `.SRCINFO` files. The binary recipe
pins its ASAR SHA-256. Recipes in the repository are the release templates;
the binary checksum is finalized by Actions. The workflow does not upload to
AUR. Publishing these recipes to AUR requires the maintainer's AUR account.

Both packages install `/usr/bin/motrix` and `/usr/bin/motrix2`, a desktop entry,
and `/usr/lib/motrix2/`. They conflict with each other and other native Motrix
packages, and retain Motrix's existing user data. Updates are managed through
pacman/AUR, not the application's bundled-runtime updater.

## Appearance

In Settings → Appearance, desktop users can set the interface scale from 75%
to 200%. Linux users can also choose Automatic, Light icon or Dark icon for
the tray independently of the application theme. Save applies both preferences
immediately and preserves them across restarts. Choose Light icon on a dark panel.

## Build locally

Install `base-devel git nodejs pnpm python rust electron asar xdg-utils`,
then run in a checkout:

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 MOTRIX_SKIP_ELECTRON_REBUILD=1 \
  MOTRIX_SKIP_ENGINE_FETCH=1 pnpm install --frozen-lockfile
pnpm run build:arch
pnpm run verify:arch -- release/motrix2-2.0.0-beta.39-1-x86_64.asar
```

The build queries `/usr/bin/electron`, compiles SQLite against that runtime,
builds Motrix's native helpers with Arch's Rust toolchain, verifies the pinned
builtin plugins, and stages the runtime dependency closure. It never downloads
or bundles an Electron runtime. The existing `scripts/fetch-engine.mjs` fetches
aria2 from `scripts/engine.lock.json` and verifies both archive and binary hashes.
For beta.39 this is `motrixapp/aria2` v1.37.0-motrix.14, a static musl Linux x64
binary with SQLite persistence and task-scoped cookies. It runs on Arch without
recompilation; no separate aria2 build pipeline or system aria2 package is needed.

The single distribution ASAR contains `usr/`: an application `app.asar`, its
unpacked native modules and renderer assets, Motrix's aria2 fork and native helpers, plugin
seeds, notices, launcher, desktop entry and icon. This outer archive is an
installation payload; it is not passed directly to Electron. `makepkg` extracts
it into the package root. This preserves real filesystem paths
required by native modules and helper processes while shipping one ASAR asset.

Packages constrain Electron to the major version they were built and tested
with, and the application checks its native ABI at startup. On a new Electron
generation, rebuild `motrix2` or install a new `motrix2-bin` release. Do not
bypass pacman's dependency checks.

## Tag releases

Push a tag `arch-v<package.json version>-<pkgrel>`, for example
`arch-v2.0.0-beta.39-1`, to `fansion314/Motrix`. Increment `pkgrel` for packaging
revisions; never move published tags. The independent `arch-v` prefix avoids
the upstream `v*` multi-platform release pipeline.

Only tag pushes trigger `.github/workflows/arch-release.yml`. It uses the
official `archlinux:base` image, fully upgrades its packages, builds the source
PKGBUILD as a regular user, runs quality checks, loads SQLite with the system
Electron, and smoke-tests the real application and bundled Motrix aria2 under Xvfb.
It generates and builds the binary PKGBUILD before a separate job publishes the
ASAR, AUR recipes and `SHA256SUMS`. No AppImage, Electron runtime or pacman binary package is published. Beta versions are GitHub prereleases.

## Keeping the fork small

The Arch scripts reuse upstream engine/plugin locks, downloaders, dependency
staging and legal notices. Upstream release workflows remain unchanged. The
appearance additions are limited to settings, the appearance dialog, window
scaling and Linux tray selection. To follow an upstream release, merge its tag, resolve any
packaging contract changes, and push an Arch tag matching its package version.
Actions fills the package versions and binary checksum automatically.
