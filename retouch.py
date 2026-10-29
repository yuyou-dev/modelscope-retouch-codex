"""Small persistent, single-process ModelScope retouch worker. No UI."""
import asyncio
import base64
import hashlib
import io
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx
from PIL import Image
from mcp.types import ImageContent

MODEL = 'Qwen/Qwen-Image-2.1-Turbo'
LORA = 'yuyou80/refine_jewel_qwen2.1'
API = 'https://api-inference.modelscope.cn'
LIMIT = 5 * 1024 * 1024
ROOT = Path(os.environ.get('RETOUCH_DATA_DIR', '/tmp/minimal-retouch'))
TASKS = set()
# A restarted process must never silently resubmit an interrupted inference.
if ROOT.exists():
    for saved in ROOT.glob('*/receipt.json'):
        data = json.loads(saved.read_text())
        if data.get('status') in ('accepted', 'submitting', 'running', 'downloading'):
            data['status'] = 'interrupted'
            saved.write_text(json.dumps(data, ensure_ascii=False))


def folder(run_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', run_id):
        raise ValueError('Invalid run_id')
    return ROOT / run_id


def save(path, data):
    temp = path / 'receipt.tmp'
    temp.write_text(json.dumps(data, ensure_ascii=False))
    temp.replace(path / 'receipt.json')


def read(run_id):
    return json.loads((folder(run_id) / 'receipt.json').read_text())


def validate_image(data):
    if not data or len(data) > LIMIT:
        raise ValueError('Image must be at most 5 MiB')
    with Image.open(io.BytesIO(data)) as im:
        if im.format not in ('PNG', 'JPEG', 'WEBP') or getattr(im, 'n_frames', 1) != 1:
            raise ValueError('Expected static PNG/JPEG/WebP')
        if im.width * im.height > 16 * 1024 * 1024:
            raise ValueError('Image exceeds 16 MP')
        im.load()
        return Image.MIME[im.format], [im.width, im.height]


def output_url(value):
    url = urlparse(value)
    host = url.hostname or ''
    allowed = host == 'modelscope.cn' or host.endswith('.modelscope.cn') or host == 'modelscope.ai' or host.endswith('.modelscope.ai') or re.fullmatch(r'modelscope(?:-[a-z0-9-]+)?\.oss(?:-[a-z0-9-]+)?\.aliyuncs\.com', host)
    if url.scheme != 'https' or not allowed or url.username or url.password or url.port:
        raise ValueError('Unexpected provider output URL')
    return value


async def worker(run_id, image, prompt):
    path = folder(run_id)
    receipt = read(run_id)
    token = os.environ['MODELSCOPE_TOKEN']
    try:
        async with httpx.AsyncClient(timeout=90, follow_redirects=False) as client:
            # Never automatically retry a submission: an ambiguous response may have created a task.
            receipt['status'] = 'submitting'
            save(path, receipt)
            response = await client.post(API + '/v1/images/generations', headers={
                'Authorization': 'Bearer ' + token, 'X-ModelScope-Async-Mode': 'true'}, json={
                'model': MODEL, 'loras': LORA, 'prompt': '精修图片中的饰品\n' + prompt,
                'size': '1024x1024', 'image_url': [image]})
            response.raise_for_status()
            task_id = response.json().get('task_id', '')
            if not re.fullmatch(r'[-\w]{1,160}', task_id):
                raise ValueError('Missing provider task ID')
            receipt.update(provider_task_id=task_id, status='running')
            save(path, receipt)
            for _ in range(120):
                await asyncio.sleep(5)
                response = await client.get(API + '/v1/tasks/' + task_id, headers={
                    'Authorization': 'Bearer ' + token, 'X-ModelScope-Task-Type': 'image_generation'})
                if response.status_code in (429, 502, 503, 504):
                    continue
                response.raise_for_status()
                data = response.json()
                status = data.get('task_status')
                if status == 'SUCCEED':
                    # Persist success before downloading; never poll a consumed successful task again.
                    url = output_url(data['output_images'][0])
                    receipt.update(status='downloading', provider_status=status, output_url=url)
                    save(path, receipt)
                    async with client.stream('GET', url) as result:
                        result.raise_for_status()
                        chunks, size = [], 0
                        async for chunk in result.aiter_bytes():
                            size += len(chunk)
                            if size > LIMIT:
                                raise ValueError('Output exceeds 5 MiB')
                            chunks.append(chunk)
                    raw = b''.join(chunks)
                    mime, dimensions = validate_image(raw)
                    (path / 'result.bin').write_bytes(raw)
                    receipt.update(status='succeeded', output_sha256=hashlib.sha256(raw).hexdigest(),
                                   output_bytes=len(raw), output_mime=mime, output_dimensions=dimensions,
                                   completed_at=datetime.now(timezone.utc).isoformat())
                    save(path, receipt)
                    return
                if status in ('FAILED', 'CANCELED', 'CANCELLED'):
                    receipt.update(status='failed', provider_status=status)
                    save(path, receipt)
                    return
            receipt.update(status='poll_timeout')
    except Exception as error:
        receipt['status'] = 'submission_uncertain' if receipt['status'] == 'submitting' else 'failed'
        receipt['error_type'] = type(error).__name__
        if isinstance(error, httpx.HTTPStatusError):
            receipt['http_status'] = error.response.status_code
    save(path, receipt)


async def retouch_submit(run_id: str, image_base64: str, instruction: str) -> dict:
    """Upload a PNG/JPEG/WebP (base64, <=5 MiB) and submit one real retouch job. Reuse run_id to avoid duplicates."""
    path = folder(run_id)
    if not os.environ.get('MODELSCOPE_TOKEN'):
        raise ValueError('Server inference credential not configured')
    if not instruction.strip() or len(instruction) > 6000 or len(image_base64) > 7 * 1024 * 1024:
        raise ValueError('Invalid instruction or image size')
    raw = base64.b64decode(image_base64, validate=True)
    mime, dimensions = validate_image(raw)
    digest = hashlib.sha256(raw).hexdigest()
    fingerprint = hashlib.sha256((digest + '\n' + instruction).encode()).hexdigest()
    if (path / 'receipt.json').exists():
        receipt = read(run_id)
        if receipt['request_sha256'] != fingerprint:
            raise ValueError('run_id already used for a different request')
        return receipt
    ROOT.mkdir(parents=True, exist_ok=True)
    if len(list(ROOT.iterdir())) >= 20:
        raise ValueError('Minimal test storage full (20 runs)')
    path.mkdir()
    receipt = dict(run_id=run_id, receipt_id=str(uuid.uuid4()), service='modelscope-minimal-mcp',
                   status='accepted', model=MODEL, lora=LORA, input_sha256=digest,
                   input_bytes=len(raw), input_dimensions=dimensions, request_sha256=fingerprint,
                   created_at=datetime.now(timezone.utc).isoformat())
    save(path, receipt)
    task = asyncio.create_task(worker(run_id, f'data:{mime};base64,{image_base64}', instruction))
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)
    return receipt


def retouch_status(run_id: str) -> dict:
    """Read the saved cloud receipt, provider task ID and input/output hashes. Does not submit inference."""
    return read(run_id)


def retouch_result(run_id: str) -> ImageContent:
    """Return the actual retouched image as an MCP image content block after success."""
    receipt = read(run_id)
    if receipt['status'] != 'succeeded':
        raise ValueError('Result not ready; query retouch_status')
    raw = (folder(run_id) / 'result.bin').read_bytes()
    return ImageContent(type='image', mimeType=receipt['output_mime'], data=base64.b64encode(raw).decode())
