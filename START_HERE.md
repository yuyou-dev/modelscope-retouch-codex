# 安装、更新并连接魔搭精修插件

这是提供给 Codex 执行的安装入口。用户要求按本文安装或更新时，请完成以下流程，然后等待用户上传图片。不要自动选取图片或提交精修。

## 目标与边界

- 插件：`modelscope-retouch@modelscope-retouch-cloud`，本文对应版本 `0.2.1`。
- 仓库：https://github.com/yuyou-dev/modelscope-retouch-codex
- 正式路线：当前对话执行插件 HTTPS 客户端 → 魔搭托管 MCP → 云端精修 → 本地图片。
- 不需要使用者登录魔搭、填写 Token 或注册 NPM；不部署本地服务器，不修改用户已有项目。
- “连接成功”指匿名握手、工具发现及真实 ping 成功，不代表已生成精修图片，也不要求对话原生发现 MCP 工具。

## 1. 检查环境

检查 `codex --version` 和 `node --version`。需要支持 `codex plugin` 的 Codex CLI、Node.js 20+、本地执行能力和可访问 GitHub/魔搭的网络。缺少依赖时准确说明缺少哪项，按宿主权限流程处理，不声称已安装成功。

## 2. 安装或更新

依次执行：

```sh
codex plugin marketplace add yuyou-dev/modelscope-retouch-codex --ref main --json
codex plugin marketplace upgrade modelscope-retouch-cloud --json
codex plugin add modelscope-retouch@modelscope-retouch-cloud --json
```

刷新只针对这一市场，不改其他插件。`marketplace add` 若返回 alreadyAdded 仍需执行 upgrade。

从安装结果读取实际 `installedPath` 和 `version`。最低要求 0.2.1，不硬编码开发者用户名或缓存目录。读取该目录的 `skills/retouch/SKILL.md`，确认 `client.mjs`、`prompt.mjs`、`check.mjs` 存在。遵守宿主的文件与联网权限要求。

## 3. 检查连接，不提交图片

按当前系统正确引用实际路径，执行：

```sh
node "<installedPath>/check.mjs"
```

此命令仅执行 MCP 初始化、工具发现和 ping；不会读取或上传图片，也不会调用生图模型。不读取本地魔搭凭据。

成功后报告实际安装版本、连接成功和真实 ping 回执，并告诉用户：

> 魔搭精修插件已安装并通过连接检查。请上传要精修的图片，或提供图片完整本地路径；我会按固定白底提示词精修并返回图片。

若检查失败，报告具体错误，不说“连接成功”，不索取 Token。若新技能未被当前对话自动发现，可按已安装 SKILL.md 执行正式客户端；不要反复要求开关插件或启动另一个 Codex app-server 代调。

## 4. 等用户上传后再精修

收到用户授权处理的本地图片后，按已安装 SKILL.md 执行：

```sh
node "<installedPath>/client.mjs" submit "<唯一run_id>" "<可写输出目录>" "<图片绝对路径>"
```

支持 PNG/JPEG/WebP，最大 5 MiB。附件只有预览而不可读取时，说明需要可读本地文件，不替换图片。

提示词由 `prompt.mjs` 固定为原项目五行白底精修原文，云端添加原有触发词；模型为 Qwen/Qwen-Image-2.1-Turbo，LoRA 为 yuyou80/refine_jewel_qwen2.1。不要添加、改写或传入提示词，不修改源码绕过限制。

提交后保留 run_id。超时或中断时，先恢复原任务，不重复提交：

```sh
node "<installedPath>/client.mjs" resume "<原run_id>" "<原输出目录>"
```

完成标准是真实 succeeded、图片返回并通过 SHA-256 校验。查看图片后在对话中展示，提供本地图片及回执链接。不要把 ping 或 accepted 当作精修完成。

## 验证范围

0.2.0 已通过本机从 GitHub 安装后、无环境凭据客户端的白底精修往返验收。0.2.1 增加本入口和不生图的连接检查，保持相同精修流程及提示词。其他实体电脑与操作系统应以其实际安装、连接和图片测试结果为准。
