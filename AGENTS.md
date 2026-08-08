你的所有游戏剧本、图片、立绘都应该放在 game 文件夹下
对引擎本身的修改放在 WebGal 下，打包/发布相关在 apps 下
引擎官方的文档在WebGAL_Doc下，我们如果修改了引擎，文档应放在Custom_Doc下
可视化编辑器在WebGAL_Terre下
game.example里是引擎带的示例游戏，可以参考代码

默认可视化编辑器会在`~/.webgal_terre`下管理游戏项目，不过我们给设置到当前文件夹下的 game 了

## 同步上游更新

WebGal/ 和 WebGAL_Terre/ 是 vendored 的上游仓库（OpenWebGAL/WebGAL、OpenWebGAL/WebGAL_Terre），没有独立 git 历史。同步上游版本统一用脚本：

- `pnpm upstream:check <dir>` 查看上游新版本与潜在冲突（只读）
- `pnpm upstream:audit <dir>` 审计本地相对上游 base 的全部改动（只读）
- `pnpm upstream:sync <dir> <ref>` 应用 base→ref 的上游补丁（三方合并，冲突留标记人工解决）
- 解决冲突 + `pnpm install && pnpm check` 验证后 `pnpm upstream:sync <dir> <ref> --accept` 更新 base

配置在 `upstream.lock.json`（上游地址、当前 base、exclude 清单）。exclude 里的路径是刻意不 vendor 的（如 `.github/`、electron/android 打包包、`packages/webgal/public/game/`——它是指向 game/ 的 symlink，千万不能让上游补丁写进去）。上游克隆/补丁缓存在 `.upstream/`（已 gitignore）。