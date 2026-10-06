"""Meaningful trainer contract checks; GPU jobs are intentionally separate."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("omok_train", Path(__file__).with_name("train.py"))
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)


def sample(sample_id, family, split, feature, target=1, weight=1, kind="terminal"):
    return {"schemaVersion": 1, "rulesId": trainer.RULES_ID, "featureVersion": trainer.FEATURE_VERSION,
            "sampleId": sample_id, "familyId": family, "split": split,
            "features": [feature] * 32, "target": target, "weight": weight, "labelType": kind}


class DataContract(unittest.TestCase):
    def prepare(self, rows, temporary):
        path = Path(temporary) / "input.jsonl"
        path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
        return trainer.prepare_data(path, Path(temporary) / "cache", trainer.StopController(20, None))

    def test_normalization_uses_train_only_and_test_is_never_mapped(self):
        with tempfile.TemporaryDirectory() as temporary:
            test = sample("test", "final-family", "test", 10000)
            test["features"], test["target"] = "deliberately unopened", "deliberately unopened"
            manifest = self.prepare([sample("a", "a-family", "train", 2), sample("b", "b-family", "train", 4),
                                     sample("v", "v-family", "validation", 1000), test], temporary)
            self.assertEqual(manifest["normalization"]["mean"], [3.0] * 32)
            self.assertEqual(manifest["normalization"]["scale"], [1.0] * 32)
            self.assertFalse((Path(manifest["folder"]) / "test.f32").exists())
            self.assertEqual(manifest["counts"], {"train": 2, "validation": 1, "test": 1})

    def test_same_family_cannot_leak_into_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "family leaks"):
                self.prepare([sample("a", "same-loss", "train", 1), sample("b", "same-loss", "validation", 2)], temporary)

    def test_same_position_cannot_leak_even_between_different_families(self):
        with tempfile.TemporaryDirectory() as temporary:
            a, b = sample("a", "family-a", "train", 1), sample("b", "family-b", "validation", 2)
            a["positionKey"] = b["positionKey"] = "canonical-board-with-side-and-first-player"
            with self.assertRaisesRegex(ValueError, "Position leaks"):
                self.prepare([a, b], temporary)

    def test_preparation_resumes_its_binary_cursor_and_deduplication(self):
        class StopAfterTwoRows:
            calls = 0

            def reason(self):
                self.calls += 1
                return "test-stop" if self.calls >= 3 else None

        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            rows = [sample("a", "a", "train", 1), sample("b", "b", "train", 3),
                    sample("a", "a", "train", 1), sample("c", "c", "validation", 100), sample("d", "d", "train", 5)]
            data = folder / "input.jsonl"
            data.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            with self.assertRaisesRegex(InterruptedError, "test-stop"):
                trainer.prepare_data(data, folder / "resumed-cache", StopAfterTwoRows())
            resumed = trainer.prepare_data(data, folder / "resumed-cache", trainer.StopController(20, None))
            uninterrupted = trainer.prepare_data(data, folder / "baseline-cache", trainer.StopController(20, None))
            self.assertEqual(resumed["counts"], {"train": 3, "validation": 1, "test": 0})
            self.assertEqual(resumed["duplicatesIgnored"], 1)
            self.assertEqual(resumed["normalization"], uninterrupted["normalization"])
            self.assertEqual(resumed["binaryHashes"], uninterrupted["binaryHashes"])

    def test_repeated_append_sample_is_not_extra_experience(self):
        with tempfile.TemporaryDirectory() as temporary:
            row = sample("a", "loss", "train", 1, kind="teacher", weight=0.15)
            manifest = self.prepare([row, row], temporary)
            self.assertEqual(manifest["counts"]["train"], 1)
            self.assertEqual(manifest["duplicatesIgnored"], 1)
            self.assertEqual(manifest["labelTypes"]["train"]["teacher"], 1)

    def test_rules_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            wrong = sample("a", "loss", "train", 1)
            wrong["rulesId"] = "standard-renju"
            with self.assertRaisesRegex(ValueError, "rule set"):
                self.prepare([wrong], temporary)

    def test_corrupt_prepared_binary_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            rows = [sample("a", "loss", "train", 1)]
            manifest = self.prepare(rows, temporary)
            binary = Path(manifest["folder"]) / "train.f32"
            content = bytearray(binary.read_bytes())
            content[0] ^= 1
            binary.write_bytes(content)
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                self.prepare(rows, temporary)

    def test_perspective_swap_is_involution(self):
        features = list(range(32))
        other = trainer.opposite_features(features)
        self.assertEqual(trainer.opposite_features(other), features)
        self.assertEqual(other[28], -features[28])
        self.assertEqual(other[29], features[29])


class NetworkContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.torch = trainer.torch_runtime()
        except RuntimeError:
            raise unittest.SkipTest("PyTorch runtime is not installed")

    def test_cpu_mid_epoch_resume_preserves_optimizer_rng_and_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            rows = []
            for i in range(80):
                split = "train" if i < 64 else "validation"
                features = [((i * 17 + j * 11) % 101) / 101 for j in range(32)]
                row = sample(str(i), "synthetic-family-" + str(i), split, 0)
                row["features"], row["target"] = features, features[0] - features[12]
                rows.append(row)
            data = folder / "synthetic.jsonl"
            data.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

            def settings(name, resume=False):
                target = folder / name
                return SimpleNamespace(data=str(data), output=str(target / "model.json"),
                    checkpoint=str(target / "checkpoint.pt"), device="cpu", epochs=3, batch_size=16,
                    hidden_size=16, learning_rate=0.005, weight_decay=0.0001, scale=600, seed=42,
                    max_seconds=30, checkpoint_every=100, stop_file=str(folder / "stop"),
                    resume=resume, init_model=None)

            baseline = trainer.train_command(settings("baseline"))
            original_step = self.torch.optim.AdamW.step
            steps = 0

            def stop_after_two(optimizer, *args, **kwargs):
                nonlocal steps
                value = original_step(optimizer, *args, **kwargs)
                steps += 1
                if steps == 2:
                    (folder / "stop").write_text("test interruption", encoding="utf-8")
                return value

            with mock.patch.object(self.torch.optim.AdamW, "step", stop_after_two):
                interrupted = trainer.train_command(settings("resumed"))
            self.assertEqual(interrupted["status"], "interrupted")
            self.assertEqual(interrupted["training"]["updates"], 2)
            (folder / "stop").unlink()
            resumed = trainer.train_command(settings("resumed", resume=True))
            self.assertEqual(resumed["status"], "completed")
            self.assertEqual(resumed["training"]["updates"], 12)
            a, b = [json.loads(Path(report["model"]).read_text(encoding="utf-8")) for report in (baseline, resumed)]
            self.assertEqual(a["layers"], b["layers"])
            self.assertEqual(a["modelId"], b["modelId"])
            self.assertLessEqual(resumed["parity"]["maxAbsoluteError"], 1e-5)
            self.assertFalse(resumed["device"]["trainedOnCuda"])

    def test_warm_start_adjusts_changed_normalization_without_changing_function(self):
        torch = self.torch
        torch.manual_seed(97)
        original = trainer.network(torch, 16)
        old = {"normalization": {"mean": [0.0] * 32, "scale": [1.0] * 32}}
        exported = trainer.export_model(original, old, 16, 600, {})
        changed = {"mean": [j / 10 for j in range(32)], "scale": [0.5 + j / 40 for j in range(32)]}
        warm = trainer.network(torch, 16)
        trainer.load_export(torch, warm, exported, changed)
        features = torch.randn(10, 32)
        with torch.no_grad():
            a = original(features)
            b = warm((features - torch.tensor(changed["mean"])) / torch.tensor(changed["scale"]))
        self.assertLess((a - b).abs().max().item(), 1e-6)

    def test_training_objective_matches_antisymmetric_engine_value(self):
        torch = self.torch
        torch.manual_seed(21)
        model = trainer.network(torch, 16)
        features = torch.randn(6, 32)
        other = torch.tensor([trainer.opposite_features(row) for row in features.tolist()])
        mean, scale = torch.randn(32), torch.rand(32) + 0.3
        with torch.no_grad():
            a = trainer.effective_prediction(torch, model, features, mean, scale)
            b = trainer.effective_prediction(torch, model, other, mean, scale)
        self.assertTrue(torch.allclose(a, -b, atol=1e-7, rtol=0))


if __name__ == "__main__":
    unittest.main(verbosity=2)
