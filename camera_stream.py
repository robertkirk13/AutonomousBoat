#!/usr/bin/env python3
"""MJPEG streaming server for the Pi Camera.

Serves frames from the Pi CSI camera as an MJPEG stream over HTTP.
Designed for Raspberry Pi Zero 2W with picamera2.

Usage:
    python3 camera_stream.py [--port 8554] [--width 640] [--height 480] [--fps 15]
"""

import argparse
import io
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

from picamera2 import Picamera2
from picamera2.encoders import MJPEGEncoder
from picamera2.outputs import FileOutput

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("camera_stream")


class StreamingOutput(io.BufferedIOBase):
    """Thread-safe buffer that holds the latest JPEG frame."""

    def __init__(self):
        self.frame = None
        self.condition = threading.Condition()

    def write(self, buf):
        with self.condition:
            self.frame = buf
            self.condition.notify_all()
        return len(buf)


class StreamHandler(BaseHTTPRequestHandler):
    """HTTP handler that serves MJPEG stream and a simple index page."""

    output: StreamingOutput  # set on the class before server starts

    def do_GET(self):
        if self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<html><body><img src='/stream' /></body></html>")
        elif self.path == "/stream":
            self.send_response(200)
            self.send_header("Age", "0")
            self.send_header("Cache-Control", "no-cache, private")
            self.send_header("Pragma", "no-cache")
            self.send_header(
                "Content-Type", "multipart/x-mixed-replace; boundary=FRAME"
            )
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            try:
                while True:
                    with self.output.condition:
                        self.output.condition.wait()
                        frame = self.output.frame
                    self.wfile.write(b"--FRAME\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode())
                    self.wfile.write(frame)
                    self.wfile.write(b"\r\n")
            except Exception:
                pass  # client disconnected
        elif self.path == "/snapshot":
            with self.output.condition:
                self.output.condition.wait()
                frame = self.output.frame
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(frame)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(frame)
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        log.debug(format, *args)


def main():
    parser = argparse.ArgumentParser(description="Pi Camera MJPEG Streamer")
    parser.add_argument("--port", type=int, default=8554, help="HTTP port (default 8554)")
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--fps", type=int, default=15)
    args = parser.parse_args()

    output = StreamingOutput()

    picam2 = Picamera2()
    config = picam2.create_video_configuration(
        main={"size": (args.width, args.height), "format": "RGB888"},
        controls={"FrameRate": args.fps},
    )
    picam2.configure(config)
    picam2.start_recording(MJPEGEncoder(), FileOutput(output))
    log.info("Camera started: %dx%d @ %d fps", args.width, args.height, args.fps)

    StreamHandler.output = output
    server = HTTPServer(("0.0.0.0", args.port), StreamHandler)
    log.info("Streaming on http://0.0.0.0:%d/stream", args.port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        picam2.stop_recording()
        server.server_close()
        log.info("Stopped")


if __name__ == "__main__":
    main()
