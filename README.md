# 魔搭珠宝精修 · Codex 插件

版本 0.2.0：GitHub 分发插件，Codex 技能调用插件内的 HTTPS 客户端，魔搭云端完成精修并返回真实图片。使用者无需魔搭账号、Token 或 NPM 账号；需要 Codex CLI、Node.js 20+ 和可用网络。

## 安装与使用

一句话安装指南：在已安装 Codex CLI 和 Node.js 20+ 的电脑运行下方命令，启用“魔搭精修”插件，提供图片并说“使用魔搭精修这张图”，即可按固定白底提示词提交精修。

```sh
codex plugin marketplace add yuyou-dev/modelscope-retouch-codex --ref main --json
codex plugin add modelscope-retouch@modelscope-retouch-cloud --json
```

在 Codex 中启用插件后打开新对话。提供本机可读取的图片附件或绝对路径，发送：

> 使用魔搭精修这张图片，沿用固定白底提示词和 LoRA，完成后返回图片和真实回执。

[完整使用手册](使用手册.md)

## 工作方式

Codex 技能 → 本地 `client.mjs` 读取图片 → 魔搭匿名 HTTPS MCP → 魔搭 Studio 精修服务 → 模型与 LoRA → 客户端取回图片、校验哈希并保存 → Codex 展示。

当前正式路线不依赖对话原生发现 `retouch_submit` 工具，不启动另一个 Codex app-server 代调。技能以实际安装目录定位客户端，没有开发者机器路径依赖。

- 匿名入口：`https://mcp.api-inference.modelscope.net/a4e36be807c842/mcp`
- 托管条目：https://modelscope.cn/mcp/servers/yuyou80/codex-retouch-https
- 模型：`Qwen/Qwen-Image-2.1-Turbo`
- LoRA：`yuyou80/refine_jewel_qwen2.1`
- 客户端固定原项目五行白底提示词，提交命令没有自定义提示词参数。后端添加原有触发词 `精修图片中的饰品`。

凭据仅配置在云端；客户端不读取魔搭 Token、不访问本地凭据存储、不传 Authorization。原图会上传至魔搭处理。支持 PNG/JPEG/WebP，单张最多 5 MiB。

## 客户端命令

以下 `<插件目录>` 指实际安装位置，输出目录应位于当前用户可写的工作区。

```sh
node "<插件目录>/client.mjs" submit RUN_ID OUTPUT_DIR ABS_IMAGE_PATH
node "<插件目录>/client.mjs" resume RUN_ID OUTPUT_DIR
```

同一任务必须保留同一 run_id。提交超时先 resume 查询，不自动换 ID 重提。只有真实 succeeded、取回图片且哈希匹配才算完成。

## 验证范围

2026-10-30 已完成开发目录 HTTPS 客户端白底银戒指精修往返，输入输出哈希一致。0.2.0 GitHub 发布后的隔离安装验收正在进行；跨操作系统、另一台实体电脑和任意图片效果不能据此保证。

本仓库独立运行，无 UI，不依赖或修改原精修项目目录。`cloud-bridge/` 为早期未发布的排查包，当前路线不使用它，无需注册或发布 NPM。
