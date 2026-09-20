# Arch Linux x86_64

[English](arch-aur.md)

本分支使用 Arch 系统的 `electron`，并捆绑 Motrix 上游锁定的 aria2 fork 预构建程序。
请在完整更新的 Arch Linux x86_64 系统上构建、安装；此打包流程不支持其他架构或发行版。

## 安装

从 [Arch Release](https://github.com/fansion314/Motrix/releases) 下载
`*-aur.tar.gz`，解压后选择其中一个包：

```sh
cd aur/motrix2       # 从标签对应的源码构建 Motrix
makepkg -si
```

```sh
cd aur/motrix2-bin   # 下载已验证的预构建 ASAR
makepkg -si
```

Release 包含完整的 PKGBUILD 和 `.SRCINFO`，二进制包配方固定 ASAR 的 SHA-256。
仓库内的配方是发布模板，二进制校验和由 Actions 最终填写。此工作流不上传 AUR；
发布到 AUR 需要维护者的 AUR 账号。

两种包均安装 `/usr/bin/motrix`、`/usr/bin/motrix2`、桌面入口及 `/usr/lib/motrix2/`，
互相冲突，也与其他原生 Motrix 包冲突，并沿用现有 Motrix 用户数据。
更新由 pacman/AUR 管理，应用不会使用捆绑运行时的自动更新流程。

## 本地构建

安装 `base-devel git nodejs pnpm python rust electron asar xdg-utils`，
然后在源码目录执行：

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 MOTRIX_SKIP_ELECTRON_REBUILD=1 \
  MOTRIX_SKIP_ENGINE_FETCH=1 pnpm install --frozen-lockfile
pnpm run build:arch
pnpm run verify:arch -- release/motrix2-2.0.0-beta.39-1-x86_64.asar
```

构建会查询 `/usr/bin/electron` 的版本，针对该运行时编译 SQLite，使用 Arch Rust
工具链编译 Motrix 辅助程序，验证固定版本的内置插件，并收集应用运行依赖。
流程不会下载或捆绑 Electron 运行时。已有的 `scripts/fetch-engine.mjs` 按照
`scripts/engine.lock.json` 下载 aria2，并验证压缩包与可执行文件的 SHA-256。
beta.39 锁定 `motrixapp/aria2` v1.37.0-motrix.14，提供静态链接 musl 的 Linux x64
预构建程序，支持 SQLite 持久化和任务独立 Cookie。它可以直接在 Arch 运行，
无需重新编译，也无需新增 aria2 构建流水线或安装系统 aria2 包。

单个发行 ASAR 包含 `usr/` 安装目录：应用 `app.asar`、解包的原生模块和界面资源、
Motrix aria2 fork 和辅助程序、内置插件、许可声明、启动器、桌面入口与图标。
外层 ASAR 是安装载荷，不能直接交给 Electron 启动。`makepkg` 将它解包至软件包根目录。这样既保留原生模块和辅助进程所需的真实文件路径，
也能以一个 ASAR 文件分发应用。

软件包依赖限定在实际构建、测试所用的 Electron 主版本，应用启动时还会检查原生 ABI。
Electron 主版本更新后，请重新构建 `motrix2` 或安装新版 `motrix2-bin`，不要绕过
pacman 的依赖检查。

## 标签发布

向 `fansion314/Motrix` 推送 `arch-v<package.json version>-<pkgrel>` 标签，例如
`arch-v2.0.0-beta.39-1`。打包修订递增 `pkgrel`，不要移动已发布的标签。
独立的 `arch-v` 前缀可避免触发上游 `v*` 多平台发布流程。

`.github/workflows/arch-release.yml` 仅响应标签推送。它使用官方 `archlinux:base`
镜像，完整更新系统包，以普通用户构建源码 PKGBUILD，运行质量检查，使用系统 Electron
加载 SQLite，并在 Xvfb 下验证实际应用及捆绑的 Motrix aria2。生成并构建二进制 PKGBUILD 后，
独立发布任务才上传 ASAR、AUR 配方及 `SHA256SUMS`。不会发布 AppImage、Electron 运行时或 pacman 二进制包。Beta 版本标记为 GitHub 预发布。

## 保持轻量分叉

Arch 脚本复用上游的引擎和插件锁文件、下载器、依赖收集及许可生成逻辑，
不修改应用源码和上游发布工作流。跟进官方更新时，合并对应的上游标签，
处理可能变化的打包接口，再推送与应用版本匹配的 Arch 标签。
Actions 会自动填写软件包版本及二进制校验和。
