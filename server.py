"""Independent MCP connectivity and real retouch test. No UI."""
import os
import hmac
import uvicorn
from starlette.middleware.base import BaseHTTPMiddleware
import re
import uuid
from datetime import datetime, timezone

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from starlette.responses import JSONResponse

BUILD_VERSION = "0.3.1"
INSTANCE_ID = str(uuid.uuid4())
mcp = FastMCP(
    "modelscope-minimal-mcp",
    instructions="Use retouch_submit, retouch_status and retouch_result for a real image round trip.",
    host=os.environ.get("HOST", "0.0.0.0"),
    port=int(os.environ.get("PORT", "7860")),
    stateless_http=True,
    json_response=True,
    max_request_body_size=8 * 1024 * 1024,
)


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False,
                                     idempotentHint=False, openWorldHint=False))
def ping(run_id: str) -> dict:
    """Return a newly generated server receipt for a synthetic connectivity test ID."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", run_id):
        raise ValueError("run_id must contain 1–80 ASCII letters, digits, underscores or hyphens")
    return {
        "run_id": run_id,
        "receipt_id": str(uuid.uuid4()),
        "server_time": datetime.now(timezone.utc).isoformat(),
        "build_version": BUILD_VERSION,
        "instance_id": INSTANCE_ID,
        "service": "modelscope-minimal-mcp",
    }


@mcp.custom_route("/health", methods=["GET"])
async def health(request):
    return JSONResponse({"status": "ok", "service": "modelscope-minimal-mcp",
                         "build_version": BUILD_VERSION})


from retouch import retouch_submit, retouch_status, retouch_result
mcp.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=True))(retouch_submit)
mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False))(retouch_status)
mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False))(retouch_result)

def create_app():
    app = mcp.streamable_http_app()

    async def require_operator(request, call_next):
        # The public Studio must not let other callers spend the operator's inference quota.
        if request.url.path.startswith("/mcp"):
            expected = os.environ.get("MODELSCOPE_TOKEN", "")
            supplied = request.headers.get("x-mcp-operator-token", "")
            if not expected or not hmac.compare_digest(supplied, expected):
                return JSONResponse({"error": "unauthorized"}, status_code=401)
            # This service returns JSON and never sends unsolicited events.
            # A long-lived GET occupies a Studio gateway invocation needlessly.
            if request.method == "GET":
                return JSONResponse({"error": "server_events_not_supported"},
                                    status_code=405, headers={"Allow": "POST"})
        return await call_next(request)

    app.add_middleware(BaseHTTPMiddleware, dispatch=require_operator)
    return app


if __name__ == "__main__":
    uvicorn.run(create_app(), host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "7860")))
