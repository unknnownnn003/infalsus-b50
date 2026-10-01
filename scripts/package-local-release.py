#!/usr/bin/env python3
"""Create a deterministic portable ZIP and SHA-256 file for a version tag."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIST_ROOT = PROJECT_ROOT / "dist"
LOCAL_ROOT = PROJECT_ROOT / ".local"
RELEASE_ROOT = LOCAL_ROOT / "release"
RELEASE_FILES = (
    (Path("scripts/release/run-local.py"), Path("run-local.py")),
    (Path("scripts/release/run-local.cmd"), Path("run-local.cmd")),
    (Path("scripts/release/run-local.sh"), Path("run-local.sh")),
    (Path("scripts/release/RUN-LOCALLY.txt"), Path("RUN-LOCALLY.txt")),
)
VERSION_PATTERN = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
FIXED_ZIP_TIME = (2020, 1, 1, 0, 0, 0)


def is_within(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def require_directory(path: Path, label: str, *, must_exist: bool) -> Path:
    if path.is_symlink():
        raise ValueError(f"{label} must not be a symlink: {path}")
    if not path.exists():
        if must_exist:
            raise ValueError(f"{label} is missing: {path}")
        path.mkdir()
    if not path.is_dir():
        raise ValueError(f"{label} must be a directory: {path}")
    resolved = path.resolve(strict=True)
    if not is_within(resolved, PROJECT_ROOT):
        raise ValueError(f"{label} resolves outside the project: {path}")
    return resolved


def list_dist_files() -> list[Path]:
    dist_root = require_directory(DIST_ROOT, "Build output", must_exist=True)
    files: list[Path] = []
    for current, directories, filenames in os.walk(dist_root, followlinks=False):
        current_path = Path(current)
        for name in directories:
            candidate = current_path / name
            if candidate.is_symlink() or not candidate.is_dir():
                raise ValueError(f"Build output contains a non-directory or symlink: {candidate}")
        for name in filenames:
            candidate = current_path / name
            if candidate.is_symlink() or not candidate.is_file():
                raise ValueError(f"Build output contains a non-regular file or symlink: {candidate}")
            resolved = candidate.resolve(strict=True)
            if not is_within(resolved, dist_root):
                raise ValueError(f"Build output file resolves outside dist: {candidate}")
            files.append(candidate)

    relative_names = {file.relative_to(dist_root).as_posix() for file in files}
    required = {
        "index.html",
        "favicon.svg",
        "catalog/songlist.json",
        "catalog/generated-manifest.json",
    }
    missing = sorted(required - relative_names)
    if missing:
        raise ValueError("Build output is missing required files: " + ", ".join(missing))
    return sorted(files, key=lambda file: file.relative_to(dist_root).as_posix())


def make_zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=FIXED_ZIP_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    mode = 0o755 if name.endswith(".sh") else 0o644
    info.external_attr = (stat.S_IFREG | mode) << 16
    info.flag_bits |= 0x800
    return info


def write_entry(archive: zipfile.ZipFile, name: str, content: bytes) -> None:
    archive.writestr(make_zip_info(name), content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def package_release(tag: str) -> tuple[Path, Path]:
    if VERSION_PATTERN.fullmatch(tag) is None:
        raise ValueError("Tag must use vMAJOR.MINOR.PATCH, for example v0.2.0.")

    package_json = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
    version = package_json.get("version")
    if version != tag[1:]:
        raise ValueError(f"Tag {tag} does not match package.json version {version!r}.")

    dist_root = require_directory(DIST_ROOT, "Build output", must_exist=True)
    dist_files = list_dist_files()

    require_directory(LOCAL_ROOT, "Local output root", must_exist=False)
    release_root = require_directory(RELEASE_ROOT, "Release output directory", must_exist=False)

    release_sources: list[tuple[Path, Path]] = []
    for source_relative, package_relative in RELEASE_FILES:
        source_path = PROJECT_ROOT / source_relative
        if source_path.is_symlink() or not source_path.is_file():
            raise ValueError(f"Release launcher input is missing or not a regular file: {source_path}")
        resolved_source = source_path.resolve(strict=True)
        if not is_within(resolved_source, PROJECT_ROOT):
            raise ValueError(f"Release launcher input resolves outside the project: {source_path}")
        release_sources.append((source_path, package_relative))

    archive_name = f"infalsus-b50-{tag}.zip"
    archive_path = release_root / archive_name
    checksum_path = release_root / f"{archive_name}.sha256"
    for output_path in (archive_path, checksum_path):
        if output_path.is_symlink():
            raise ValueError(f"Release output must not be a symlink: {output_path}")
        if output_path.parent.resolve(strict=True) != release_root:
            raise ValueError(f"Release output resolves outside the release directory: {output_path}")
        if output_path.exists():
            raise FileExistsError(f"Refusing to overwrite an existing release output: {output_path}")

    top_level = f"infalsus-b50-{tag}"
    with zipfile.ZipFile(archive_path, mode="x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in dist_files:
            relative = file.relative_to(dist_root).as_posix()
            entry_name = str(PurePosixPath(top_level) / relative)
            write_entry(archive, entry_name, file.read_bytes())
        for source_path, package_relative in release_sources:
            entry_name = str(PurePosixPath(top_level) / package_relative.as_posix())
            write_entry(archive, entry_name, source_path.read_bytes())

    with zipfile.ZipFile(archive_path, mode="r") as archive:
        corrupt_entry = archive.testzip()
    if corrupt_entry is not None:
        raise ValueError(f"ZIP integrity check failed at {corrupt_entry}.")

    checksum = sha256_file(archive_path)
    with checksum_path.open("xb") as checksum_file:
        checksum_file.write(f"{checksum}  {archive_name}\n".encode("ascii"))
    return archive_path, checksum_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True, help="Version tag matching package.json, such as v0.2.0")
    args = parser.parse_args()

    try:
        archive_path, checksum_path = package_release(args.tag)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Release package failed: {error}", file=sys.stderr)
        return 1

    print(f"Created {archive_path.relative_to(PROJECT_ROOT)}")
    print(f"Created {checksum_path.relative_to(PROJECT_ROOT)}")
    print(f"ZIP size: {archive_path.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
