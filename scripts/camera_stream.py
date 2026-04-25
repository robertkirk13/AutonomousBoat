#!/usr/bin/env python3
"""HLS streaming server for the Pi Camera.

Encodes the Pi CSI camera as H.264 via the VideoCore HW encoder and
packages as low-latency HLS using ffmpeg. Serves the playlist + segments
over HTTP on the same port the previous MJPEG server used, so callers
(CameraView in the dashboard, cloudflared upstream) only need to swap
their URL.

Settings come from the firmware-managed env file
(/etc/default/camera-stream) just like the old MJPEG server; CLI flags
still win for ad-hoc testing.

Endpoints:
    GET /                -> simple HTML viewer (uses hls.js from CDN)
    GET /hls/stream.m3u8 -> HLS playlist
    GET /hls/<seg>.ts    -> HLS media segment
    GET /snapshot        -> single JPEG frame
"""

import argparse
import io
import logging
import os
import shutil
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingMixIn

from picamera2 import Picamera2
from picamera2.encoders import H264Encoder
from picamera2.outputs import FfmpegOutput
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("camera_stream")

HLS_DIR = Path("/tmp/camera-stream-hls")
PLAYLIST_NAME = "stream.m3u8"

INDEX_HTML = b"""<!doctype html>
<html><head><title>boat camera</title>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
<style>body{margin:0;background:#000;}video{width:100vw;height:100vh;object-fit:contain;}</style>
</head><body>
<video id=v autoplay muted playsinline controls></video>
<script>
  var v=document.getElementById('v'),src='/hls/stream.m3u8';
  if(window.Hls&&Hls.isSupported()){var h=new Hls({lowLatencyMode:true,liveSyncDuration:2,liveMaxLatencyDuration:5});h.loadSource(src);h.attachMedia(v);}
  else if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=src;}
</script>
</body></html>"""


def estimate_bitrate(width: int, height: int, fps: int) -> int:
    """Rough bits-per-pixel-per-frame heuristic, capped for cellular use."""
    raw = int(width * height * fps * 0.08)
    return max(250_000, min(4_000_000, raw))


class StreamHandler(BaseHTTPRequestHandler):
    """HTTP handler that serves HLS files plus a snapshot endpoint."""

    picam2: Picamera2  # set on the class before server starts
    snapshot_lock: threading.Lock  # serializes capture_array calls

    def _send_file(self, path: Path, content_type: str, cache: str = "no-cache"):
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(INDEX_HTML)))
            self.end_headers()
            self.wfile.write(INDEX_HTML)
            return

        if self.path == "/hls/stream.m3u8":
            self._send_file(HLS_DIR / PLAYLIST_NAME, "application/vnd.apple.mpegurl")
            return

        if self.path.startswith("/hls/") and self.path.endswith(".ts"):
            # Strip /hls/ prefix; reject path traversal.
            name = self.path[len("/hls/"):]
            if "/" in name or ".." in name:
                self.send_error(400)
                return
            self._send_file(HLS_DIR / name, "video/mp2t", cache="public, max-age=3")
            return

        if self.path == "/snapshot":
            try:
                with self.snapshot_lock:
                    arr = self.picam2.capture_array("main")
                buf = io.BytesIO()
                Image.fromarray(arr).save(buf, format="JPEG", quality=85)
                jpeg = buf.getvalue()
            except Exception as e:
                log.warning("Snapshot failed: %s", e)
                self.send_error(500)
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(jpeg)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            try:
                self.wfile.write(jpeg)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        self.send_error(404)

    def log_message(self, format, *args):
        log.debug(format, *args)


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Thread-per-request — HLS clients fetch playlist + segments concurrently."""

    daemon_threads = True
    allow_reuse_address = True


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        log.warning("Ignoring non-integer %s=%r; using default %d", name, raw, default)
        return default


def _wait_for_playlist(timeout_s: float = 10.0) -> bool:
    """Block until ffmpeg has written the first playlist + segment."""
    deadline = time.monotonic() + timeout_s
    playlist = HLS_DIR / PLAYLIST_NAME
    while time.monotonic() < deadline:
        if playlist.exists() and playlist.stat().st_size > 0:
            # Also wait for at least one .ts segment so the first GET succeeds.
            if any(p.suffix == ".ts" for p in HLS_DIR.iterdir()):
                return True
        time.sleep(0.1)
    return False


def main():
    parser = argparse.ArgumentParser(description="Pi Camera HLS Streamer")
    parser.add_argument("--port", type=int, default=_env_int("CAMERA_PORT", 8554))
    parser.add_argument("--width", type=int, default=_env_int("CAMERA_WIDTH", 640))
    parser.add_argument("--height", type=int, default=_env_int("CAMERA_HEIGHT", 480))
    parser.add_argument("--fps", type=int, default=_env_int("CAMERA_FPS", 15))
    parser.add_argument(
        "--bitrate",
        type=int,
        default=_env_int("CAMERA_BITRATE", 0),
        help="H.264 bitrate in bits/sec; 0 = auto from resolution+fps",
    )
    args = parser.parse_args()

    bitrate = args.bitrate or estimate_bitrate(args.width, args.height, args.fps)

    # Wipe stale segments — old playlists confuse hls.js on reload.
    if HLS_DIR.exists():
        shutil.rmtree(HLS_DIR, ignore_errors=True)
    HLS_DIR.mkdir(parents=True, exist_ok=True)

    picam2 = Picamera2()
    config = picam2.create_video_configuration(
        main={"size": (args.width, args.height), "format": "RGB888"},
        controls={"FrameRate": args.fps},
    )
    picam2.configure(config)

    # iperiod=fps -> one keyframe per second; required for short HLS segments.
    encoder = H264Encoder(bitrate=bitrate, repeat=True, iperiod=args.fps)

    # FfmpegOutput passes the camera's H.264 NAL stream into ffmpeg's stdin
    # and we hand ffmpeg the output args. -c:v copy avoids re-encoding (the
    # VideoCore HW encoder already produced H.264). delete_segments keeps
    # disk use bounded; omit_endlist marks the playlist as live.
    ffmpeg_args = (
        f"-loglevel warning -c:v copy "
        f"-f hls "
        f"-hls_time 1 "
        f"-hls_list_size 5 "
        f"-hls_segment_filename {HLS_DIR}/seg%05d.ts "
        f"-hls_flags delete_segments+omit_endlist+independent_segments "
        f"{HLS_DIR}/{PLAYLIST_NAME}"
    )
    ffmpeg_output = FfmpegOutput(ffmpeg_args)

    picam2.start_recording(encoder, ffmpeg_output)
    log.info(
        "Camera started: %dx%d @ %d fps, bitrate=%d kbps",
        args.width, args.height, args.fps, bitrate // 1000,
    )

    if not _wait_for_playlist():
        log.warning("Playlist did not appear within timeout — clients may see 404 briefly")

    StreamHandler.picam2 = picam2
    StreamHandler.snapshot_lock = threading.Lock()
    server = ThreadedHTTPServer(("0.0.0.0", args.port), StreamHandler)
    log.info("Serving HLS on http://0.0.0.0:%d/hls/%s", args.port, PLAYLIST_NAME)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            picam2.stop_recording()
        except Exception:
            pass
        server.server_close()
        log.info("Stopped")


if __name__ == "__main__":
    main()
