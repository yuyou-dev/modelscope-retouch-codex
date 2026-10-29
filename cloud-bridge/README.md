# Hosted retouch bridge

This package runs on ModelScope's hosted MCP service, not on consumer computers.
Set MODELSCOPE_TOKEN only in the host's private environment. It forwards MCP
stdio to the dedicated ModelScope Studio and returns actual upstream responses.

Requests are serialized with a 1500ms minimum interval. Discovery operations
have bounded retries for transient failures. Image submission is never retried
automatically. No credential lookup, shell invocation, or image modification
happens in the bridge.

Intended hosted command after publication:
`npx -y modelscope-jewelry-retouch-bridge@0.1.0`

Publication and anonymous hosted endpoint verification are still pending.
