"""Focused tests for fail-closed source validation and Addressables lookup."""

from importlib.util import module_from_spec, spec_from_file_location
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = spec_from_file_location("b50_game_catalog_extractor", ROOT / "scripts" / "extract-game-catalog.py")
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load the game catalog extractor module")
EXTRACTOR = module_from_spec(SPEC)
sys.modules[SPEC.name] = EXTRACTOR
SPEC.loader.exec_module(EXTRACTOR)


class FakeDependency:
    def __init__(self, bundle_name: str):
        self.primary_key = bundle_name


class FakeCatalog:
    def __init__(self, bundle_names: list[str]):
        self._dependencies = [FakeDependency(name) for name in bundle_names]

    def dependencies(self, _location):
        return self._dependencies


class FakeReference:
    def __init__(self, value):
        self.value = value

    def deref(self):
        return self.value


class ExtractorSourceValidationTests(unittest.TestCase):
    def test_source_integer_accepts_exact_integers_and_wrappers(self):
        self.assertEqual(EXTRACTOR._source_integer({"Value": 3}, "songId"), 3)
        self.assertEqual(EXTRACTOR._source_integer(None, "placeholder", default=0), 0)

    def test_source_integer_rejects_bool_float_and_string_coercion(self):
        for value in (True, 2.5, "2"):
            with self.subTest(value=value):
                with self.assertRaises(EXTRACTOR.ExtractionError):
                    EXTRACTOR._source_integer(value, "difficulty")

    def test_source_text_rejects_non_strings(self):
        self.assertEqual(EXTRACTOR._text("  chart-id  ", "chartId"), "chart-id")
        with self.assertRaises(EXTRACTOR.ExtractionError):
            EXTRACTOR._text(42, "chartId")

    def test_availability_and_rating_reject_malformed_numeric_coercions(self):
        self.assertTrue(EXTRACTOR._source_available(1, "Available"))
        self.assertFalse(EXTRACTOR._source_available(False, "Available"))
        self.assertEqual(EXTRACTOR._source_number(12, "Rating"), 12.0)
        for value, validator, field in (
            (1.0, EXTRACTOR._source_available, "Available"),
            (True, EXTRACTOR._source_number, "Rating"),
            ("12", EXTRACTOR._source_number, "Rating"),
        ):
            with self.subTest(value=value, field=field):
                with self.assertRaises(EXTRACTOR.ExtractionError):
                    validator(value, field)

    def test_non_placeholder_chart_requires_explicit_availability(self):
        self.assertTrue(EXTRACTOR._chart_available("chart0", 1, "Available"))
        self.assertFalse(EXTRACTOR._chart_available("", None, "Available"))
        with self.assertRaises(EXTRACTOR.ExtractionError):
            EXTRACTOR._chart_available("chart0", None, "Available")

    def test_project_write_boundary_allows_project_and_rejects_game_or_traversal(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            game = root / "game"
            game.mkdir()
            self.assertEqual(EXTRACTOR._resolve_write_target(root / "tmp" / "out.bin", root, (game,)), root / "tmp" / "out.bin")
            for target in (game, game / "nested" / "out.bin", root / ".." / "escape.bin"):
                with self.subTest(target=target):
                    with self.assertRaises(EXTRACTOR.ExtractionError):
                        EXTRACTOR._resolve_write_target(target, root, (game,))

    def test_content_fingerprint_ignores_absolute_path_and_file_times(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            left = root / "drive-d" / "metadata.bundle"
            right = root / "drive-e" / "metadata.bundle"
            left.parent.mkdir()
            right.parent.mkdir()
            left.write_bytes(b"same input bytes")
            right.write_bytes(b"same input bytes")
            os.utime(left, ns=(1_000_000_000, 2_000_000_000))
            os.utime(right, ns=(8_000_000_000, 9_000_000_000))
            logical_inputs_left = {"bundle:metadata.bundle": left}
            logical_inputs_right = {"bundle:metadata.bundle": right}
            self.assertEqual(
                EXTRACTOR._content_fingerprint(logical_inputs_left),
                EXTRACTOR._content_fingerprint(logical_inputs_right),
            )
            right.write_bytes(b"changed input bytes")
            self.assertNotEqual(
                EXTRACTOR._content_fingerprint(logical_inputs_left),
                EXTRACTOR._content_fingerprint(logical_inputs_right),
            )

    def test_catalog_rows_have_explicit_song_and_chart_order(self):
        songs = [
            {"songId": 9, "charts": [{"difficultyIndex": 3, "chartId": "z"}, {"difficultyIndex": 1, "chartId": "b"}, {"difficultyIndex": 1, "chartId": "a"}]},
            {"songId": 2, "charts": [{"difficultyIndex": 0, "chartId": "min"}]},
        ]
        EXTRACTOR._sort_catalog_rows(songs)
        self.assertEqual([song["songId"] for song in songs], [2, 9])
        self.assertEqual(
            [(chart["difficultyIndex"], chart["chartId"]) for chart in songs[1]["charts"]],
            [(1, "a"), (1, "b"), (3, "z")],
        )

    def test_webp_encoding_is_repeatable_and_strips_image_metadata(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            first_path = root / "first.webp"
            second_path = root / "second.webp"
            image = EXTRACTOR.Image.new("RGBA", (480, 360))
            pixels = image.load()
            for y in range(image.height):
                for x in range(image.width):
                    pixels[x, y] = (x % 256, y % 256, (x * 17 + y * 31) % 256, 255)
            first = EXTRACTOR._write_webp(image, first_path, project_root=root)
            second = EXTRACTOR._write_webp(image, second_path, project_root=root)
            self.assertEqual(first["sha256"], second["sha256"])
            self.assertEqual(first_path.read_bytes(), second_path.read_bytes())
            with EXTRACTOR.Image.open(first_path) as encoded:
                self.assertEqual(encoded.size, (320, 320))
                self.assertEqual(encoded.getexif(), {})


class AddressablesResolutionTests(unittest.TestCase):
    def test_path_matching_keeps_component_order_and_repetition(self):
        matches = EXTRACTOR._addressable_path_matches
        self.assertTrue(matches(r"Assets\\release\\SongData.asset", "release/SongData.asset"))
        self.assertFalse(matches("Assets/A/B/C.asset", "Assets/B/A/C.asset"))
        self.assertFalse(matches("Assets/A/B/A.asset", "Assets/A/A/B.asset"))
        self.assertFalse(matches("Assets/other/SongData.asset", "SongData.asset"))

    def test_rejects_reordered_path_even_when_a_single_container_key_exists(self):
        resolver = EXTRACTOR.UnityBundleResolver(Path("."), FakeCatalog(["game.bundle"]))
        resolver.environment = lambda _name: SimpleNamespace(container={
            "Assets/B/A/C.asset": FakeReference("wrong-object"),
        })
        location = SimpleNamespace(internal_id="Assets/A/B/C.asset", primary_key="release/Test.asset")
        with self.assertRaisesRegex(EXTRACTOR.ExtractionError, "could not resolve"):
            resolver.resolve(location)

    def test_rejects_ambiguous_ordered_suffix_matches_across_bundles(self):
        resolver = EXTRACTOR.UnityBundleResolver(Path("."), FakeCatalog(["one.bundle", "two.bundle"]))
        environments = {
            "one.bundle": SimpleNamespace(container={"A/release/SongData.asset": FakeReference("one")}),
            "two.bundle": SimpleNamespace(container={"B/release/SongData.asset": FakeReference("two")}),
        }
        resolver.environment = lambda name: environments[name]
        location = SimpleNamespace(internal_id="release/SongData.asset", primary_key="release/SongData.asset")
        with self.assertRaisesRegex(EXTRACTOR.ExtractionError, "multiple bundle objects"):
            resolver.resolve(location)

    def test_exact_internal_id_wins_over_a_path_alias(self):
        resolver = EXTRACTOR.UnityBundleResolver(Path("."), FakeCatalog(["game.bundle"]))
        resolver.environment = lambda _name: SimpleNamespace(container={
            "Assets/release/SongData.asset": FakeReference("exact-object"),
            "Other/release/SongData.asset": FakeReference("alias-object"),
        })
        location = SimpleNamespace(internal_id="Assets/release/SongData.asset", primary_key="release/SongData.asset")
        resolved, bundle_name = resolver.resolve(location)
        self.assertEqual(resolved, "exact-object")
        self.assertEqual(bundle_name, "game.bundle")


if __name__ == "__main__":
    unittest.main()
