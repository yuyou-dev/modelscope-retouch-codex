# ModelScope jewelry retouch MCP

Independent hosted MCP backend for a portable Codex plugin. No UI.

Model: `Qwen/Qwen-Image-2.1-Turbo` with `yuyou80/refine_jewel_qwen2.1`.
Tools: `ping`, `retouch_submit`, `retouch_status`, `retouch_result`.

The backend runs on ModelScope with the operator's `MODELSCOPE_TOKEN` stored
only in the hosting environment. Do not put tokens in this repository or a
consumer plugin. Images are submitted only when a user requests retouching.

## Status

Backend package prepared. Anonymous hosted endpoint and portable plugin are
under validation. This repository does not yet promise install-and-use access.

## Hosted command

Install this package on the hosting platform and execute
`modelscope-jewelry-retouch-mcp` using stdio. Consumers will connect over HTTPS
to the hosted endpoint, once its anonymous access has been verified.
