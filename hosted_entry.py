"""Runs inside the ModelScope hosted MCP container, never on consumers' PCs."""
import os


def main():
    if not os.environ.get("MODELSCOPE_TOKEN"):
        raise RuntimeError("MODELSCOPE_TOKEN must be configured in the hosting environment")
    from server import mcp
    mcp.run(transport="stdio")
