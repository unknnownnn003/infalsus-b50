"""Focused tests for fail-closed source validation and Addressables lookup."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys
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
