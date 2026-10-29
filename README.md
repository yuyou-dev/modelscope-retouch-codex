# 魔搭珠宝精修 · Codex 插件

GitHub 分发插件，魔搭托管 HTTPS MCP 与独立精修后端。使用者不需要魔搭账号或 Token，不需要 NPM 账号。插件本地图片适配器需要 Node.js 20+。

## 安装

```sh
codex plugin marketplace add yuyou-dev/modelscope-retouch-codex --ref main --json
codex plugin add modelscope-retouch@modelscope-retouch-cloud --json
```

安装后在 Codex 中启用插件。只有对话实际发现 `retouch_submit` 等工具后才可调用；如果当前对话工具列表没有刷新，需要重新加载插件或打开新对话。

示例：上传图片或提供图片绝对路径，说“使用魔搭精修这张戒指，保留造型和背景，去除划痕并优化金属反光”。

## 链路

Codex 插件读取指定图片 → 魔搭匿名 HTTPS MCP → 魔搭 Studio 精修服务 → Qwen 图像编辑 → MCP 返回真实图片。

- 匿名入口：`https://mcp.api-inference.modelscope.net/a4e36be807c842/mcp`
- 托管条目：https://modelscope.cn/mcp/servers/yuyou80/codex-retouch-https
- 模型：`Qwen/Qwen-Image-2.1-Turbo`
- 精修 LoRA：`yuyou80/refine_jewel_qwen2.1`
- 工具：`ping`、`retouch_submit`、`retouch_status`、`retouch_result`

凭据仅配置在魔搭云端。消费者插件不读取环境中的魔搭 Token，不调用本地凭据存储，不传 Authorization。图像提交不自动重试；使用同一个 run_id 查询和恢复任务，避免重复推理。

## 验证范围

2026-10-29：云端条目已通过托管检测，部署返回 `auth_required: false`。无凭据客户端已完成初始化和四工具发现。安装后当前对话原生精修与图片返回仍在验收中；不要把云端发现成功当作完整插件验收。

本仓库为独立工程，无 UI，不依赖原精修项目目录。`cloud-bridge/` 是早期未发布的排查包，当前 HTTPS 路线不使用它，不需要注册或发布 NPM。根目录 Python 包为后端源码；消费者只安装 `plugins/` 中的插件。
