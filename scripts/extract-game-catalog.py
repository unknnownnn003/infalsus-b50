"""Read current In Falsus Addressables data and emit a temporary B50 source snapshot.

The game installation is opened read-only. This tool writes only to the explicit
temporary output directory inside the B50 project. It decodes jackets in memory
and writes only 320x320 WebP derivatives; it never exports an original texture.
"""

from __future__ import annotations

import argparse
import ctypes
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
from typing import Any, Iterable

try:
    import UnityPy
    from PIL import Image, ImageOps
except ImportError as exc:  # pragma: no cover - depends on maintenance environment
    raise SystemExit("The game extractor requires UnityPy and Pillow; install scripts/requirements-game-catalog.txt.") from exc


UINT_MAX = 0xFFFFFFFF
UNICODE_FLAG = 0x80000000
DYNAMIC_FLAG = 0x40000000
CLEAR_FLAGS_MASK = 0x3FFFFFFF
CATALOG_MAGIC = 0x0DE38942
DIFFICULTIES = {1: (0, "MIN"), 2: (1, "EVO"), 4: (2, "ULT"), 8: (3, "FBD")}
APP_ID = "3971950"


class CatalogFormatError(ValueError):
    """Raised when the local Addressables catalog is malformed or unsupported."""


class ExtractionError(RuntimeError):
    """Raised when current game metadata cannot be resolved without guessing."""


@dataclass(frozen=True)
class CatalogKey:
    key: str
    location_offsets: tuple[int, ...]


@dataclass(frozen=True)
class CatalogLocation:
    offset: int
    primary_key: str | None
    internal_id: str | None
    provider_id: str | None
    dependency_set_offset: int
    resource_type: str | None


class BinaryCatalog:
    """Small read-only reader for Addressables catalog v2/v3 asset locations.

    This is the B50 maintenance subset of the catalog reader already used by
    Rhythm Archive tooling. It resolves only named GameObject metadata assets,
    their jacket Material GUIDs, and each selected AssetBundle dependency.
    """

    def __init__(self, path: Path):
        self.path = path
        self.data = path.read_bytes()
        self._locations: dict[int, CatalogLocation] = {}
        self._header = self._read_header()
        self.keys = self._read_keys()

    def _check(self, offset: int, size: int = 1) -> None:
        if offset < 0 or size < 0 or offset + size > len(self.data):
            raise CatalogFormatError(f"catalog offset {offset}..{offset + size} is outside {len(self.data)} bytes")

    def _u32(self, offset: int) -> int:
        self._check(offset, 4)
        return struct.unpack_from("<I", self.data, offset)[0]

    def _read_header(self) -> tuple[int, ...]:
        self._check(0, 32)
        header = struct.unpack_from("<ii6I", self.data, 0)
        if header[0] & 0xFFFFFFFF != CATALOG_MAGIC:
            raise CatalogFormatError(f"unexpected Addressables catalog magic 0x{header[0] & 0xFFFFFFFF:08x}")
        if header[1] not in (2, 3):
            raise CatalogFormatError(f"unsupported Addressables catalog version {header[1]}")
        return header

    def _array_bytes(self, offset: int) -> bytes:
        if offset == UINT_MAX:
            return b""
        if offset < 4:
            raise CatalogFormatError(f"invalid array offset {offset}")
        size = self._u32(offset - 4)
        self._check(offset, size)
        return self.data[offset : offset + size]

    def _u32_array(self, offset: int) -> tuple[int, ...]:
        payload = self._array_bytes(offset)
        if len(payload) % 4:
            raise CatalogFormatError(f"u32 array at {offset} has {len(payload)} bytes")
        if not payload:
            return ()
        return struct.unpack_from(f"<{len(payload) // 4}I", payload, 0)

    def _read_bytes_string(self, offset: int, encoding: str) -> str:
        if offset < 4:
            raise CatalogFormatError(f"invalid string offset {offset}")
        size = self._u32(offset - 4)
        self._check(offset, size)
        try:
            return self.data[offset : offset + size].decode(encoding)
        except UnicodeDecodeError as exc:
            raise CatalogFormatError(f"invalid {encoding} string at {offset}") from exc

    def _read_dynamic_string(self, offset: int, separator: str) -> str:
        parts: list[str] = []
        seen: set[int] = set()
        while offset != UINT_MAX:
            if offset in seen:
                raise CatalogFormatError("dynamic string chain contains a cycle")
            seen.add(offset)
            self._check(offset, 8)
            string_id, next_id = struct.unpack_from("<2I", self.data, offset)
            part = self.read_string(string_id)
            if part is not None:
                parts.append(part)
            offset = next_id & CLEAR_FLAGS_MASK if next_id != UINT_MAX else UINT_MAX
        return separator.join(reversed(parts))

    def read_string(self, identifier: int, separator: str = "") -> str | None:
        if identifier == UINT_MAX:
            return None
        if separator and identifier & DYNAMIC_FLAG:
            return self._read_dynamic_string(identifier & CLEAR_FLAGS_MASK, separator)
        is_unicode = bool(identifier & UNICODE_FLAG)
        offset = identifier & CLEAR_FLAGS_MASK if is_unicode else identifier
        return self._read_bytes_string(offset, "utf-16-le" if is_unicode else "ascii")

    def _type_name(self, offset: int) -> str | None:
        if offset == UINT_MAX:
            return None
        self._check(offset, 8)
        assembly_id, class_id = struct.unpack_from("<2I", self.data, offset)
        assembly = self.read_string(assembly_id, ".")
        class_name = self.read_string(class_id, ".")
        if class_name and assembly:
            return f"{class_name} [{assembly}]"
        return class_name or assembly

    def _object_string(self, offset: int) -> str | None:
        if offset == UINT_MAX:
            return None
        self._check(offset, 8)
        _type_offset, object_id = struct.unpack_from("<2I", self.data, offset)
        self._check(object_id, 8)
        string_id, separator_code = struct.unpack_from("<I H", self.data, object_id)
        return self.read_string(string_id, chr(separator_code) if separator_code else "/")

    def _read_keys(self) -> tuple[CatalogKey, ...]:
        payload = self._array_bytes(self._header[2])
        if len(payload) % 8:
            raise CatalogFormatError(f"key array has {len(payload)} bytes, not a multiple of 8")
        entries: list[CatalogKey] = []
        for index in range(0, len(payload), 8):
            key_id, locations_id = struct.unpack_from("<2I", payload, index)
            key = self._object_string(key_id)
            if key is not None:
                entries.append(CatalogKey(key, self._u32_array(locations_id)))
        return tuple(entries)

    def location(self, offset: int) -> CatalogLocation:
        if offset in self._locations:
            return self._locations[offset]
        self._check(offset, 28)
        primary_id, internal_id, provider_id, dependency_set, _dependency_hash, _extra_data, type_id = struct.unpack_from(
            "<4I i 2I", self.data, offset
        )
        location = CatalogLocation(
            offset=offset,
            primary_key=self.read_string(primary_id, "/"),
            internal_id=self.read_string(internal_id, "/"),
            provider_id=self.read_string(provider_id, "."),
            dependency_set_offset=dependency_set,
            resource_type=self._type_name(type_id),
        )
        self._locations[offset] = location
        return location

    def locations_for_key(self, key: str) -> tuple[CatalogLocation, ...]:
        for entry in self.keys:
            if entry.key == key:
                return tuple(self.location(offset) for offset in entry.location_offsets)
        return ()

    def iter_locations(self) -> Iterable[CatalogLocation]:
        seen: set[int] = set()
        for entry in self.keys:
            for offset in entry.location_offsets:
                if offset not in seen:
                    seen.add(offset)
                    yield self.location(offset)

    def dependencies(self, location: CatalogLocation) -> tuple[CatalogLocation, ...]:
        return tuple(self.location(offset) for offset in self._u32_array(location.dependency_set_offset))


_MISSING = object()


def _text(value: Any, field: str = "text") -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ExtractionError(f"{field} must be a string")
    return value.strip()


def _value(value: Any, default: Any = None) -> Any:
    if isinstance(value, dict):
        if "Value" in value:
            return value["Value"]
        if "value" in value:
            return value["value"]
    return default if value is None else value


def _source_integer(value: Any, field: str, default: Any = _MISSING) -> int:
    raw = _value(value, default)
    if raw is _MISSING:
        raise ExtractionError(f"{field} is missing")
    if type(raw) is not int:
        raise ExtractionError(f"{field} must be an integer")
    return raw


def _source_number(value: Any, field: str, default: Any = _MISSING) -> float:
    raw = _value(value, default)
    if raw is _MISSING:
        raise ExtractionError(f"{field} is missing")
    if type(raw) not in (int, float):
        raise ExtractionError(f"{field} must be a number")
    try:
        number = float(raw)
    except (OverflowError, TypeError, ValueError) as exc:
        raise ExtractionError(f"{field} must be a finite number") from exc
    if not math.isfinite(number):
        raise ExtractionError(f"{field} must be a finite number")
    return number


def _source_available(value: Any, field: str, default: Any = _MISSING) -> bool:
    raw = _value(value, default)
    if raw is _MISSING:
        raise ExtractionError(f"{field} is missing")
    if type(raw) is bool:
        return raw
    if type(raw) is int and raw in (0, 1):
        return bool(raw)
    raise ExtractionError(f"{field} must be a boolean or integer 0/1")


def _chart_available(chart_id: str, value: Any, field: str) -> bool:
    return _source_available(value, field, default=0 if not chart_id else _MISSING)


def _mapping_lookup(mapping: Any, identifier: int, field: str) -> str | None:
    if mapping is None:
        return None
    if not isinstance(mapping, dict):
        raise ExtractionError(f"{field} must be an object")
    ids = mapping.get("Ids", [])
    values = mapping.get("IdValues", [])
    strings = mapping.get("IdStr", [])
    if ids is None:
        ids = []
    if values is None:
        values = []
    if strings is None:
        strings = []
    if not isinstance(ids, list) or not isinstance(values, list) or not isinstance(strings, list):
        raise ExtractionError(f"{field} arrays must be lists")
    for index, item in enumerate(ids):
        mapped_id = _source_integer(item, f"{field}.Ids[{index}]")
        if mapped_id != identifier:
            continue
        if index < len(values) and isinstance(values[index], dict):
            english = _text(values[index].get("English"), f"{field}.IdValues[{index}].English")
            if english:
                return english
        if index < len(strings):
            fallback = _text(strings[index], f"{field}.IdStr[{index}]")
            if fallback:
                return fallback
    return None


def _sha256_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _safe_child(root: Path, name: str) -> Path:
    if Path(name).name != name or not name.lower().endswith(".bundle"):
        raise ExtractionError(f"unsafe bundle name in the Addressables catalog: {name!r}")
    path = (root / name).resolve(strict=True)
    try:
        path.relative_to(root.resolve(strict=True))
    except ValueError as exc:
        raise ExtractionError("an Addressables bundle resolves outside the game bundle directory") from exc
    if not path.is_file():
        raise ExtractionError("an Addressables bundle is missing")
    return path


class UnityBundleResolver:
    """Load only catalog-selected bundles and resolve asset references in memory."""

    def __init__(self, bundle_root: Path, catalog: BinaryCatalog):
        self.bundle_root = bundle_root
        self.catalog = catalog
        self.environments: dict[str, Any] = {}
        self.used_bundles: set[str] = set()

    def environment(self, bundle_name: str) -> Any:
        if bundle_name not in self.environments:
            self.environments[bundle_name] = UnityPy.load(str(_safe_child(self.bundle_root, bundle_name)))
        return self.environments[bundle_name]

    def resolve(self, location: CatalogLocation) -> tuple[Any, str]:
        if not location.internal_id:
            raise ExtractionError("an Addressables asset location has no internal ID")
        exact_matches: dict[tuple[str, str], tuple[Any, str]] = {}
        path_matches: dict[tuple[str, str], tuple[Any, str]] = {}
        for dependency in self.catalog.dependencies(location):
            primary = dependency.primary_key or ""
            bundle_name = primary.split("/", 1)[0]
            if not bundle_name.lower().endswith(".bundle"):
                continue
            environment = self.environment(bundle_name)
            if location.internal_id in environment.container:
                exact_matches[(bundle_name, location.internal_id)] = (environment.container[location.internal_id], bundle_name)
                continue
            for key, value in environment.container.items():
                if _addressable_path_matches(key, location.internal_id):
                    path_matches[(bundle_name, key)] = (value, bundle_name)

        candidates = exact_matches if exact_matches else path_matches
        if len(candidates) == 1:
            value, bundle_name = next(iter(candidates.values()))
            self.used_bundles.add(bundle_name)
            return value.deref(), bundle_name
        if len(candidates) > 1:
            label = "exact" if exact_matches else "path"
            raise ExtractionError(f"an Addressables {label} asset path resolves to multiple bundle objects")
        raise ExtractionError(f"could not resolve Addressables asset {location.primary_key!r}")


def _addressable_path_parts(value: str) -> tuple[str, ...]:
    if not isinstance(value, str):
        raise ExtractionError("an Addressables object path must be a string")
    return tuple(part.casefold() for part in re.split(r"[/\\]+", value) if part)


def _addressable_path_matches(container_path: str, internal_id: str) -> bool:
    """Match exact ordered paths or a multi-component ordered suffix, never a set of segments."""
    container_parts = _addressable_path_parts(container_path)
    target_parts = _addressable_path_parts(internal_id)
    if not container_parts or not target_parts:
        return False
    if container_parts == target_parts:
        return True
    shorter, longer = (container_parts, target_parts) if len(container_parts) <= len(target_parts) else (target_parts, container_parts)
    return len(shorter) >= 2 and longer[-len(shorter):] == shorter


def _find_asset_location(catalog: BinaryCatalog, primary_key: str, type_suffix: str) -> CatalogLocation:
    matches = [
        location
        for location in catalog.iter_locations()
        if location.primary_key == primary_key and (location.resource_type or "").split(" [", 1)[0].endswith(type_suffix)
    ]
    if len(matches) != 1:
        raise ExtractionError(f"expected one {type_suffix} asset at {primary_key}; found {len(matches)}")
    return matches[0]


def _find_material_location(catalog: BinaryCatalog, guid: str) -> CatalogLocation:
    matches = [
        location
        for location in catalog.locations_for_key(guid)
        if (location.resource_type or "").split(" [", 1)[0].endswith("Material")
    ]
    if len(matches) != 1:
        raise ExtractionError(f"expected one jacket Material for Addressables GUID {guid}; found {len(matches)}")
    return matches[0]


def _material_image(resolver: UnityBundleResolver, catalog: BinaryCatalog, guid: str) -> tuple[Any, str]:
    material_location = _find_material_location(catalog, guid)
    material_object, bundle_name = resolver.resolve(material_location)
    if material_object is None or material_object.type.name != "Material":
        raise ExtractionError(f"Addressables GUID {guid} did not resolve to a Material")
    material = material_object.read()
    texture_envs = dict(material.m_SavedProperties.m_TexEnvs)
    main_texture = texture_envs.get("_MainTex")
    if main_texture is None or main_texture.m_Texture.m_PathID == 0:
        raise ExtractionError(f"Material {material.m_Name!r} has no _MainTex")
    texture_object = main_texture.m_Texture.deref()
    if texture_object is None or texture_object.type.name != "Texture2D":
        raise ExtractionError(f"Material {material.m_Name!r} _MainTex is not a Texture2D")
    texture = texture_object.read()
    image = texture.image
    if image is None or image.width <= 0 or image.height <= 0:
        raise ExtractionError(f"Material {material.m_Name!r} has no decodable image")
    return image.convert("RGBA"), bundle_name


def _jacket_guid(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    material = value.get("JacketLargeMaterial")
    if not isinstance(material, dict):
        return None
    guid = _text(material.get("m_AssetGUID"), "JacketLargeMaterial.m_AssetGUID")
    return guid or None


def _build_jacket_maps(song_data: dict[str, Any]) -> tuple[dict[int, str], dict[str, str]]:
    by_song: dict[int, str] = {}
    song_rows = song_data.get("songIdJacketMaterials", [])
    chart_rows = song_data.get("chartIdJacketMaterials", [])
    if song_rows is None:
        song_rows = []
    if chart_rows is None:
        chart_rows = []
    if not isinstance(song_rows, list) or not isinstance(chart_rows, list):
        raise ExtractionError("SongData jacket maps must be lists")
    for index, row in enumerate(song_rows):
        if not isinstance(row, dict):
            raise ExtractionError(f"songIdJacketMaterials[{index}] must be an object")
        song_id = _source_integer(row.get("SongId"), f"songIdJacketMaterials[{index}].SongId", default=-1)
        guid = _jacket_guid(row)
        if song_id < 1 or guid is None:
            continue
        previous = by_song.get(song_id)
        if previous is not None and previous != guid:
            raise ExtractionError(f"song {song_id} has conflicting song-level jacket materials")
        by_song[song_id] = guid

    by_chart: dict[str, str] = {}
    for index, row in enumerate(chart_rows):
        if not isinstance(row, dict):
            raise ExtractionError(f"chartIdJacketMaterials[{index}] must be an object")
        chart_id = _text(row.get("ChartId"), f"chartIdJacketMaterials[{index}].ChartId")
        guid = _jacket_guid(row)
        if not chart_id or guid is None:
            continue
        previous = by_chart.get(chart_id)
        if previous is not None and previous != guid:
            raise ExtractionError(f"chart {chart_id} has conflicting jacket materials")
        by_chart[chart_id] = guid
    return by_song, by_chart


def _write_webp(image: Any, destination: Path) -> dict[str, Any]:
    rgba = image.convert("RGBA")
    pixel_hash = sha256(rgba.tobytes()).hexdigest()
    key_payload = f"{rgba.width}x{rgba.height}:{pixel_hash}".encode("ascii")
    key = sha256(key_payload).hexdigest()
    target = ImageOps.fit(
        rgba,
        (320, 320),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    target.save(destination, format="WEBP", quality=90, method=6, exact=True)
    content = destination.read_bytes()
    if content[:4] != b"RIFF" or content[8:12] != b"WEBP":
        raise ExtractionError("Pillow did not produce a WebP jacket thumbnail")
    with Image.open(destination) as decoded:
        if decoded.format != "WEBP" or decoded.size != (320, 320):
            raise ExtractionError("Pillow produced a jacket thumbnail with an invalid format or dimensions")
        decoded.verify()
    return {
        "key": key,
        "sha256": sha256(content).hexdigest(),
        "width": 320,
        "height": 320,
        "sizeBytes": len(content),
    }


def _real_game_data_root(value: Path) -> tuple[Path, Path]:
    root = value.expanduser().resolve(strict=True)
    if (root / "StreamingAssets" / "aa" / "catalog.bin").is_file():
        return root, root.parent
    candidates = [
        path
        for path in root.iterdir()
        if path.is_dir() and (path / "StreamingAssets" / "aa" / "catalog.bin").is_file()
    ]
    if len(candidates) != 1:
        raise ExtractionError("game root must identify one Unity data directory with StreamingAssets/aa/catalog.bin")
    data_root = candidates[0].resolve(strict=True)
    return data_root, root


def _steam_build_id(install_root: Path) -> str | None:
    for parent in install_root.parents:
        manifest = parent / f"appmanifest_{APP_ID}.acf"
        if not manifest.is_file():
            continue
        content = manifest.read_text(encoding="utf-8", errors="replace")
        match = re.search(r'"buildid"\s+"([0-9]+)"', content)
        if match:
            return match.group(1)
    return None


def _require_last_access_updates_disabled() -> None:
    """Fail before game-file access if Windows may update LastAccessTime on reads."""
    if os.name != "nt":
        return
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\FileSystem",
            0,
            winreg.KEY_READ,
        ) as key:
            value, value_type = winreg.QueryValueEx(key, "NtfsDisableLastAccessUpdate")
            key_last_write = winreg.QueryInfoKey(key)[2]
    except (ImportError, OSError) as exc:
        raise ExtractionError(
            "cannot verify the Windows Last Access Time policy; refusing to read the game installation"
        ) from exc
    if value_type != winreg.REG_DWORD:
        raise ExtractionError(
            "the Windows Last Access Time policy is not a REG_DWORD; refusing to read the game installation"
        )
    if value not in (1, 3):
        raise ExtractionError(
            "Windows Last Access Time updates are enabled or system-managed; refusing to read game files "
            "because the operating system may change their access timestamps"
        )
    try:
        get_tick_count = ctypes.windll.kernel32.GetTickCount64
        get_tick_count.restype = ctypes.c_ulonglong
        uptime_ms = int(get_tick_count())
        if uptime_ms <= 0:
            raise OSError("GetTickCount64 returned an invalid uptime")
        boot_time = datetime.now(timezone.utc) - timedelta(milliseconds=uptime_ms)
        registry_epoch = datetime(1601, 1, 1, tzinfo=timezone.utc)
        registry_last_write = registry_epoch + timedelta(microseconds=int(key_last_write) // 10)
    except (AttributeError, OSError, OverflowError, TypeError, ValueError) as exc:
        raise ExtractionError(
            "cannot verify that the disabled Last Access Time policy was active at system boot; refusing to read the game installation"
        ) from exc
    if registry_last_write >= boot_time - timedelta(seconds=2):
        raise ExtractionError(
            "the Last Access Time policy changed after system boot or is too close to boot to verify; "
            "restart Windows before reading the game installation"
        )


def _validate_output_root(output_root: Path, project_root: Path) -> Path:
    local_root = project_root / ".local"
    expected = local_root / "game-catalog"
    if local_root.is_symlink() or not local_root.is_dir():
        raise ExtractionError("the .local directory must be a regular project directory")
    if output_root.is_symlink() or expected.is_symlink():
        raise ExtractionError("the temporary output directory cannot be a symbolic link")
    requested_absolute = Path(os.path.abspath(output_root))
    expected_absolute = Path(os.path.abspath(expected))
    if os.path.normcase(str(requested_absolute)) != os.path.normcase(str(expected_absolute)):
        raise ExtractionError("temporary extraction output must be exactly the ignored .local/game-catalog directory")
    try:
        output_root.relative_to(project_root)
    except ValueError as exc:
        raise ExtractionError("temporary extraction output must stay inside the B50 project") from exc
    if not output_root.is_dir():
        raise ExtractionError("the extractor output directory must be created by the B50 generator")
    marker = output_root / ".b50-game-extractor-owned"
    if marker.is_symlink() or not marker.is_file():
        raise ExtractionError("temporary output is missing its B50 ownership marker")
    if marker.read_text(encoding="utf-8") != "infalsus-b50-game-extraction-v1\n":
        raise ExtractionError("temporary output has an unknown ownership marker")
    entries = list(output_root.iterdir())
    if len(entries) != 1 or entries[0].name != marker.name:
        raise ExtractionError("temporary output must be empty before extraction starts")
    return output_root


def extract(game_root: Path, output_root: Path) -> dict[str, Any]:
    project_root = Path(__file__).resolve().parents[1]
    output_root = _validate_output_root(output_root, project_root)
    _require_last_access_updates_disabled()
    data_root, install_root = _real_game_data_root(game_root)
    catalog_path = data_root / "StreamingAssets" / "aa" / "catalog.bin"
    settings_path = data_root / "StreamingAssets" / "aa" / "settings.json"
    bundle_root = data_root / "StreamingAssets" / "aa" / "StandaloneWindows64"
    output_root = output_root.resolve(strict=True)
    try:
        output_root.relative_to(data_root)
    except ValueError:
        pass
    else:
        raise ExtractionError("temporary extraction output cannot be inside the read-only game installation")

    catalog = BinaryCatalog(catalog_path)
    resolver = UnityBundleResolver(bundle_root, catalog)
    song_location = _find_asset_location(catalog, "release/SongData.asset", "SongData")
    mapping_location = _find_asset_location(catalog, "release/DynamicStringMapping.asset", "DynamicStringMapping")
    song_object, _ = resolver.resolve(song_location)
    mapping_object, _ = resolver.resolve(mapping_location)
    song_data = song_object.read_typetree()
    mapping_data = mapping_object.read_typetree()
    if not isinstance(song_data, dict) or not isinstance(mapping_data, dict):
        raise ExtractionError("SongData or DynamicStringMapping did not decode to an object")

    jacket_by_song, jacket_by_chart = _build_jacket_maps(song_data)
    output_jackets = output_root / "jackets"
    output_jackets.mkdir()
    resolved_jackets = output_jackets.resolve(strict=True)
    if resolved_jackets.parent != output_root.resolve(strict=True):
        raise ExtractionError("jacket scratch directory resolves outside the owned extraction directory")
    image_sources: dict[str, dict[str, Any]] = {}
    source_hashes: dict[str, str] = {"catalog.bin": _sha256_file(catalog_path)}
    image_by_guid: dict[str, str] = {}
    if settings_path.is_file():
        source_hashes["settings.json"] = _sha256_file(settings_path)
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
    else:
        settings = {}

    title_mapping = mapping_data.get("songIdTitleTypeMapping")
    artist_mapping = mapping_data.get("songIdArtistTypeMapping")
    songs: list[dict[str, Any]] = []
    skipped_empty_placeholders = 0
    chart_rows = 0
    available_chart_rows = 0

    def jacket_source(guid: str) -> str:
        cached_key = image_by_guid.get(guid)
        if cached_key is not None:
            return cached_key
        image, bundle_name = _material_image(resolver, catalog, guid)
        bundle_path = _safe_child(bundle_root, bundle_name)
        source_hashes["bundle:" + bundle_name] = _sha256_file(bundle_path)
        temporary_path = output_jackets / "pending.webp"
        source = _write_webp(image, temporary_path)
        image_path = output_jackets / (source["key"] + ".webp")
        if image_path.exists():
            if _sha256_file(image_path) != source["sha256"]:
                raise ExtractionError("two jacket sources normalize to the same key but different WebP bytes")
            temporary_path.unlink()
        else:
            temporary_path.replace(image_path)
        image_sources.setdefault(source["key"], source)
        image_by_guid[guid] = source["key"]
        return source["key"]

    all_song_info = song_data.get("allSongInfo", _MISSING)
    if all_song_info is _MISSING:
        raise ExtractionError("SongData.allSongInfo is missing")
    if not isinstance(all_song_info, list):
        raise ExtractionError("SongData.allSongInfo must be a list")
    if not all_song_info:
        raise ExtractionError("SongData.allSongInfo cannot be empty")
    for info_index, info in enumerate(all_song_info):
        if not isinstance(info, dict):
            raise ExtractionError("SongData.allSongInfo contains a non-object row")
        song_id = _source_integer(info.get("Id"), f"SongData.allSongInfo[{info_index}].Id", default=-1)
        base_name = _text(info.get("BaseName"), f"SongData.allSongInfo[{info_index}].BaseName")
        if "ChartInfos" not in info:
            raise ExtractionError(f"SongData.allSongInfo[{info_index}].ChartInfos is missing")
        raw_charts = info.get("ChartInfos")
        if not isinstance(raw_charts, list):
            raise ExtractionError(f"SongData.allSongInfo[{info_index}].ChartInfos must be a list")
        if song_id == 0 and not base_name:
            for chart_index, row in enumerate(raw_charts):
                if not isinstance(row, dict):
                    raise ExtractionError(f"empty song placeholder chart {chart_index} must be an object")
                chart_id = _text(row.get("Id"), f"empty song placeholder chart {chart_index}.Id")
                available = _chart_available(chart_id, row.get("Available"), f"empty song placeholder chart {chart_index}.Available")
                flag = _source_integer(row.get("Difficulty"), f"empty song placeholder chart {chart_index}.Difficulty", default=0)
                rating = _source_number(row.get("Rating"), f"empty song placeholder chart {chart_index}.Rating", default=0)
                if chart_id or available or flag != 0 or rating != 0:
                    raise ExtractionError("an empty song placeholder contains chart data")
            skipped_empty_placeholders += 1
            continue
        if song_id < 1 or not base_name:
            raise ExtractionError("SongData contains a song row without a valid songId and baseName")

        title = _mapping_lookup(title_mapping, song_id, "songIdTitleTypeMapping") or base_name
        artist = _mapping_lookup(artist_mapping, song_id, "songIdArtistTypeMapping")
        song_row: dict[str, Any] = {"songId": song_id, "baseName": base_name, "title": title, "charts": []}
        if artist:
            song_row["artist"] = artist

        song_guid = jacket_by_song.get(song_id)
        song_key = None
        if song_guid is not None:
            song_key = jacket_source(song_guid)
            song_row["jacketSourceKey"] = song_key

        for chart in raw_charts:
            if not isinstance(chart, dict):
                raise ExtractionError(f"song {song_id} contains a non-object ChartInfos row")
            chart_id = _text(chart.get("Id"), f"chart in song {song_id}.Id")
            chart_label = chart_id or "<placeholder>"
            available = _chart_available(chart_id, chart.get("Available"), f"chart {chart_label}.Available")
            flag = _source_integer(chart.get("Difficulty"), f"chart {chart_label}.Difficulty", default=0 if not chart_id else -1)
            rating = _source_number(chart.get("Rating"), f"chart {chart_label}.Rating", default=0 if not chart_id else -1)
            if not chart_id:
                if available or flag != 0 or rating != 0:
                    raise ExtractionError(f"song {song_id} has a non-placeholder chart row without chartId")
                continue
            difficulty = DIFFICULTIES.get(flag)
            if difficulty is None:
                raise ExtractionError(f"chart {chart_id} has unsupported difficulty flag {flag}")
            if rating < 0:
                raise ExtractionError(f"chart {chart_id} has an invalid Rating")
            chart_row: dict[str, Any] = {
                "difficultyIndex": difficulty[0],
                "difficulty": difficulty[1],
                "chartId": chart_id,
                "available": available,
                "rating": int(rating) if rating.is_integer() else rating,
            }
            level_indicator = _text(chart.get("LevelSectionIndicator"), f"chart {chart_id}.LevelSectionIndicator")
            designer = _text(chart.get("DisplayChartDesigner"), f"chart {chart_id}.DisplayChartDesigner")
            if level_indicator:
                chart_row["levelIndicator"] = level_indicator
            if designer:
                chart_row["designer"] = designer

            chart_guid = jacket_by_chart.get(chart_id, song_guid)
            if chart_guid is not None:
                chart_row["jacketSourceKey"] = jacket_source(chart_guid)
            elif song_key is not None:
                chart_row["jacketSourceKey"] = song_key
            song_row["charts"].append(chart_row)
            chart_rows += 1
            available_chart_rows += int(available)

        song_row["charts"].sort(key=lambda row: (row["difficultyIndex"], row["chartId"]))
        songs.append(song_row)

    songs.sort(key=lambda row: row["songId"])
    if len({row["songId"] for row in songs}) != len(songs):
        raise ExtractionError("SongData contains duplicate non-placeholder songIds")
    if len({chart["chartId"] for row in songs for chart in row["charts"]}) != chart_rows:
        raise ExtractionError("SongData contains duplicate chartIds")
    if sum(len(row["charts"]) for row in songs) != chart_rows:
        raise ExtractionError("SongData chart count is inconsistent")

    for bundle_name in sorted(resolver.used_bundles):
        source_hashes["bundle:" + bundle_name] = _sha256_file(_safe_child(bundle_root, bundle_name))
    # AssetBundle hashes are content hashes; the fingerprint contains no local path or timestamp.
    fingerprint_input = json.dumps(source_hashes, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")
    fingerprint = sha256(fingerprint_input).hexdigest()
    source: dict[str, Any] = {"fingerprint": fingerprint}
    commit_id = _text(song_data.get("CommitId"), "SongData.CommitId")
    if commit_id:
        source["gameDataCommitId"] = commit_id
    build_id = _steam_build_id(install_root)
    if build_id:
        source["steamBuildId"] = build_id
    addressables_version = _text(settings.get("m_AddressablesVersion"), "settings.m_AddressablesVersion")
    if addressables_version:
        source["addressablesVersion"] = addressables_version

    payload = {
        "schemaVersion": 1,
        "source": source,
        "songs": songs,
        "jacketSources": sorted(image_sources.values(), key=lambda row: row["key"]),
        "audit": {
            "songDataCommitId": commit_id or None,
            "songSlots": len(song_data.get("allSongInfo", []) or []),
            "skippedEmptyPlaceholders": skipped_empty_placeholders,
            "songs": len(songs),
            "charts": chart_rows,
            "availableCharts": available_chart_rows,
            "jacketImages": len(image_sources),
        },
    }
    (output_root / "extracted.json").write_text(
        json.dumps(payload, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return payload["audit"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        summary = extract(args.game_root, args.output)
    except (CatalogFormatError, ExtractionError, OSError, ValueError, KeyError, TypeError) as exc:
        print(f"game catalog extraction failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
