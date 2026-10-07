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

    def test_family_balancing_preserves_confidence_and_equalizes_family_totals(self):
        with tempfile.TemporaryDirectory() as temporary:
            rows = [sample("a1", "many", "train", 1), sample("a2", "many", "train", 2),
                    sample("at", "many", "train", 3, weight=0.15, kind="teacher"),
                    sample("b", "one", "train", 4)]
            manifest = self.prepare(rows, temporary)
            import array
            factors = array.array("f")
            factors.frombytes((Path(manifest["folder"]) / "train.family.f32").read_bytes())
            self.assertAlmostEqual(sum(factors[i] * rows[i]["weight"] for i in range(3)), factors[3], places=6)
            self.assertAlmostEqual(factors[2] * 0.15 / factors[0], 0.15, places=7)
            self.assertEqual(manifest["familyWeights"]["train"]["families"], 2)

    def test_corrupt_family_weights_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            rows = [sample("a", "loss", "train", 1)]
            manifest = self.prepare(rows, temporary)
            binary = Path(manifest["folder"]) / "train.family.f32"
            content = bytearray(binary.read_bytes())
            content[0] ^= 1
            binary.write_bytes(content)
            with self.assertRaisesRegex(ValueError, "family weights checksum mismatch"):
                self.prepare(rows, temporary)

    def test_perspective_swap_is_involution(self):
        features = list(range(32))
        other = trainer.opposite_features(features)
        self.assertEqual(trainer.opposite_features(other), features)
        self.assertEqual(other[28], -features[28])
        self.assertEqual(other[29], features[29])

    def test_atomic_save_retries_transient_reader_locks_without_removing_old_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "state.json"
            destination.write_text('{"old":true}', encoding="utf-8")
            real_replace, calls = trainer.os.replace, 0

            def locked(source, target):
                nonlocal calls
                calls += 1
                if calls <= 2:
                    self.assertEqual(json.loads(destination.read_text()), {"old": True})
                    raise PermissionError(trainer.errno.EACCES, "simulated Windows reader lock")
                return real_replace(source, target)

            with mock.patch.object(trainer.os, "replace", side_effect=locked), mock.patch.object(trainer.time, "sleep"):
                trainer.atomic_json(destination, {"new": True})
            self.assertEqual(calls, 3)
            self.assertEqual(json.loads(destination.read_text()), {"new": True})

    def test_atomic_save_permanent_lock_preserves_old_and_pending_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "state.json"
            destination.write_text('{"old":true}', encoding="utf-8")
            with mock.patch.object(trainer.os, "replace", side_effect=PermissionError(trainer.errno.EACCES, "persistent lock")), mock.patch.object(trainer.time, "sleep"):
                with self.assertRaises(PermissionError):
                    trainer.atomic_json(destination, {"new": True})
            self.assertEqual(json.loads(destination.read_text()), {"old": True})
            pending = list(destination.parent.glob("state.json.tmp-*"))
            self.assertEqual(len(pending), 1)
            self.assertEqual(json.loads(pending[0].read_text()), {"new": True})


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
                row = sample(str(i), split + "-synthetic-family-" + str(i % 5), split, 0,
                             weight=0.15 if i % 7 == 0 else 1, kind="teacher" if i % 7 == 0 else "terminal")
                row["features"], row["target"] = features, features[0] - features[12]
                rows.append(row)
            final_test = sample("final-test", "unopened-final-family", "test", 0)
            final_test["features"] = final_test["target"] = "final-test must never be read by trainer"
            rows.append(final_test)
            data = folder / "synthetic.jsonl"
            data.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

            def settings(name, resume=False):
                target = folder / name
                return SimpleNamespace(data=str(data), output=str(target / "model.json"),
                    checkpoint=str(target / "checkpoint.pt"), device="cpu", epochs=3, batch_size=16,
                    hidden_size=16, learning_rate=0.005, weight_decay=0.0001, scale=600, seed=42,
                    max_seconds=30, checkpoint_every=100, stop_file=str(folder / "stop"),
                    resume=resume, init_model=None, family_balance=1.0, early_stop_patience=10,
                    early_stop_min_delta=0.00001, min_epochs=2, diagnostic_samples=12)

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
            self.assertEqual(baseline["diagnostics"], resumed["diagnostics"])
            self.assertEqual(baseline["training"]["bestEpoch"], resumed["training"]["bestEpoch"])
            self.assertEqual(resumed["diagnostics"]["train"]["samples"], 12)
            self.assertEqual(resumed["training"]["excludedTestSamples"], 1)

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

    def test_warm_start_expansion_preserves_function_with_changed_normalization(self):
        torch = self.torch
        torch.manual_seed(79)
        original = trainer.network(torch, 16)
        old = {"normalization": {"mean": [0.0] * 32, "scale": [1.0] * 32}}
        exported = trainer.export_model(original, old, 16, 600, {})
        changed = {"mean": [j / 10 for j in range(32)], "scale": [0.5 + j / 40 for j in range(32)]}
        expanded = trainer.network(torch, 32)
        trainer.load_export(torch, expanded, exported, changed)
        features = torch.randn(20, 32)
        with torch.no_grad():
            a = original(features)
            b = expanded((features - torch.tensor(changed["mean"])) / torch.tensor(changed["scale"]))
        self.assertLess((a - b).abs().max().item(), 1e-6)
        self.assertEqual(expanded[2].weight[:, 16:].abs().sum().item(), 0)
        with self.assertRaisesRegex(ValueError, "cannot shrink"):
            trainer.load_export(torch, trainer.network(torch, 8), exported)

    def test_validation_reports_balanced_and_original_confidence_objectives(self):
        torch = self.torch
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            rows = [sample("train", "train", "train", 0),
                    sample("v1", "many", "validation", 0, target=1),
                    sample("v2", "many", "validation", 0, target=1),
                    sample("v3", "one", "validation", 0, target=0)]
            data = folder / "synthetic.jsonl"
            data.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            stop = trainer.StopController(20, None)
            manifest = trainer.prepare_data(data, folder / "cache", stop)
            mapped = trainer.mapped_rows(torch, manifest, "validation")
            families = trainer.mapped_family_weights(torch, manifest, "validation")
            model = trainer.network(torch, 16)
            mean, scale = (torch.tensor(manifest["normalization"][key]) for key in ("mean", "scale"))
            metrics = trainer.validate(torch, model, mapped, mean, scale, 16, "cpu", stop, families, 1.0)
            # Identical zero features equal their perspective swap, forcing
            # exactly zero antisymmetric value independently of model weights.
            self.assertAlmostEqual(metrics["all"], 0.5)
            self.assertAlmostEqual(metrics["unbalancedAll"], 2 / 3)

    def test_warm_start_validation_baseline_is_kept_and_patience_resumes(self):
        torch = self.torch
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            rows = [sample(str(i), "family-" + str(i), "train" if i < 12 else "validation", i / 10) for i in range(16)]
            data = folder / "synthetic.jsonl"
            data.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            torch.manual_seed(26)
            original = trainer.network(torch, 16)
            initial = trainer.export_model(original, {"normalization": {"mean": [0.0] * 32, "scale": [1.0] * 32}}, 16, 400, {})
            initial_file = folder / "initial.json"
            initial_file.write_text(json.dumps(initial), encoding="utf-8")

            def settings(name, resume=False):
                target = folder / name
                return SimpleNamespace(data=str(data), output=str(target / "model.json"),
                    checkpoint=str(target / "checkpoint.pt"), device="cpu", epochs=8, batch_size=12,
                    hidden_size=16, learning_rate=0.01, weight_decay=0.0001, scale=600, seed=42,
                    max_seconds=30, checkpoint_every=100, stop_file=str(folder / "stop"),
                    resume=resume, init_model=str(initial_file), family_balance=1.0,
                    early_stop_patience=2, early_stop_min_delta=0.001, min_epochs=3, diagnostic_samples=4)

            baseline_metrics = {"all": 0.1, "terminal": 0.1, "teacher": None, "unbalancedAll": 0.1}
            worse_metrics = {**baseline_metrics, "all": 0.2}
            with mock.patch.object(trainer, "validate", side_effect=[baseline_metrics] + [worse_metrics] * 3):
                uninterrupted = trainer.train_command(settings("baseline"))
            self.assertEqual(uninterrupted["status"], "completed")
            self.assertEqual(uninterrupted["stopReason"], "validation-early-stop")
            self.assertEqual(uninterrupted["training"]["epochsCompleted"], 3)
            self.assertTrue(uninterrupted["training"]["selectedBaseline"])
            self.assertEqual(uninterrupted["training"]["initEvaluationScale"], 400)
            self.assertEqual(uninterrupted["diagnostics"]["validation"]["maximumAbsoluteScoreChange"], 0)
            original_step = torch.optim.AdamW.step

            def stop_after_update(optimizer, *args, **kwargs):
                value = original_step(optimizer, *args, **kwargs)
                (folder / "stop").write_text("test interruption", encoding="utf-8")
                return value

            with mock.patch.object(trainer, "validate", return_value=baseline_metrics), mock.patch.object(torch.optim.AdamW, "step", stop_after_update):
                interrupted = trainer.train_command(settings("resumed"))
            self.assertEqual(interrupted["status"], "interrupted")
            (folder / "stop").unlink()
            with mock.patch.object(trainer, "validate", return_value=worse_metrics):
                resumed = trainer.train_command(settings("resumed", resume=True))
            self.assertEqual(resumed["training"], uninterrupted["training"])
            self.assertEqual(resumed["modelId"], uninterrupted["modelId"])
            exported = json.loads(Path(resumed["model"]).read_text(encoding="utf-8"))
            for features in ([0.0] * 32, [i / 5 for i in range(32)]):
                self.assertAlmostEqual(trainer.json_inference(initial, features), trainer.json_inference(exported, features), places=6)


if __name__ == "__main__":
    unittest.main(verbosity=2)
