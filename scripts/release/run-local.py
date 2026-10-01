#!/usr/bin/env python3
"""Serve the extracted portable app on loopback only."""

from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


PACKAGE_ROOT = Path(__file__).resolve().parent


class LocalAppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(PACKAGE_ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        request_path = unquote(urlsplit(path).path)
        if "\x00" in request_path:
            return str(PACKAGE_ROOT / "__not_found__")

        translated = Path(super().translate_path(request_path)).resolve()
        if translated != PACKAGE_ROOT and PACKAGE_ROOT not in translated.parents:
            return str(PACKAGE_ROOT / "__not_found__")
        return str(translated)

    def list_directory(self, path: str) -> None:
        self.send_error(404, "Directory listings are disabled")
        return None

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main() -> None:
    if not (PACKAGE_ROOT / "index.html").is_file():
        raise SystemExit("The release package is incomplete: index.html is missing.")

    server = ThreadingHTTPServer(("127.0.0.1", 0), LocalAppHandler)
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"In Falsus B50 is available at {url}", flush=True)
    print("This server is local to this computer. Press Ctrl+C to stop it.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nLocal server stopped.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
