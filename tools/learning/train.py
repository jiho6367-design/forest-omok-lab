#!/usr/bin/env python3
"""Local, bounded GPU training for the house-rule value evaluator.

Rules and features belong to the JS generator. This program never reconstructs
Gomoku rules, changes engine source, promotes candidates, or evaluates test data.
Only JSON weights are exported for the standalone HTML engine.
"""
from __future__ import annotations

import argparse
import array
import errno
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import random
import signal
import sqlite3
import sys
import time

SCHEMA_VERSION = 1
RULES_ID = "15x15-exact5-both33-v1"
FEATURE_VERSION = "house32-v1"
INPUT_SIZE = 32
ROW_SIZE = INPUT_SIZE + 3  # Features, target, weight, terminal/teacher kind.


def digest_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp-" + str(os.getpid()))
    with temporary.open("w", encoding="utf-8", newline="\n") as dest:
        json.dump(value, dest, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        dest.write("\n")
        dest.flush()
        os.fsync(dest.fileno())
    replace_saved_file(temporary, path)


def replace_saved_file(temporary: Path, destination: Path) -> None:
    """Keep the prior durable file when Windows briefly locks a reader."""
    for attempt in range(12):
        try:
            os.replace(temporary, destination)
            return
        except OSError as error:
            transient = error.errno in (errno.EACCES, errno.EPERM, errno.EBUSY) or getattr(error, "winerror", None) in (5, 32, 33)
            if not transient or attempt == 11:
                raise
            time.sleep(min(0.01 * (attempt + 1), 0.1))


def emit(value) -> None:
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def torch_runtime():
    try:
        import torch
    except ImportError as error:
        raise RuntimeError("PyTorch is unavailable in this Python environment. Use the project's configured GPU venv.") from error
    return torch


def finite_number(value, description: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(description + " must be a finite number")
    return float(value)


def device_info(torch, requested: str) -> dict:
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable to this PyTorch build; GPU training was not performed. No CPU fallback was used.")
    result = {"pythonVersion": platform.python_version(), "torchVersion": torch.__version__,
              "cudaVersion": torch.version.cuda, "device": requested, "trainedOnCuda": False}
    if requested == "cuda":
        prop = torch.cuda.get_device_properties(0)
        result.update(name=prop.name, computeCapability=list(torch.cuda.get_device_capability(0)),
                      totalMemoryBytes=prop.total_memory, compiledArchitectures=torch.cuda.get_arch_list())
    else:
        result.update(name=platform.processor() or "CPU", computeCapability=None, totalMemoryBytes=None)
    return result


def network(torch, hidden_size: int):
    return torch.nn.Sequential(torch.nn.Linear(INPUT_SIZE, hidden_size), torch.nn.ReLU(),
                               torch.nn.Linear(hidden_size, 1), torch.nn.Tanh())


class StopController:
    def __init__(self, seconds: float, stop_file: Path | None):
        self.started = time.monotonic()
        self.deadline = self.started + seconds
        self.stop_file = stop_file
        self.signal_received = False
        signal.signal(signal.SIGINT, self._signal)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, self._signal)

    def _signal(self, *_):
        self.signal_received = True

    def reason(self) -> str | None:
        if self.signal_received:
            return "signal"
        if self.stop_file and self.stop_file.exists():
            return "stop-file"
        if time.monotonic() >= self.deadline:
            return "time-limit"
        return None


def prepare_data(path: Path, cache_dir: Path, stop: StopController) -> dict:
    """Stream JSONL into CPU-mapped float32 matrices; never map test rows.

    Generator snapshots must stay immutable during a training run. SQLite keeps
    de-duplication, family splits, byte cursor and normalization statistics on
    disk. A stopped preparation can continue without restarting the JSONL scan.
    """
    data_hash = digest_file(path)
    # Keep nested Windows experiment paths below common path limits. The full
    # hash remains checked in both the partial and completed manifests.
    folder = cache_dir / (data_hash[:24] + "-p3")
    manifest_path = folder / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("datasetHash") != data_hash or manifest.get("featureVersion") != FEATURE_VERSION:
            raise ValueError("Prepared data identity changed")
        for split in ("train", "validation"):
            binary = folder / (split + ".f32")
            if binary.stat().st_size != manifest["counts"][split] * ROW_SIZE * 4:
                raise ValueError("Prepared data size mismatch: " + split)
            if digest_file(binary) != manifest["binaryHashes"][split]:
                raise ValueError("Prepared data checksum mismatch: " + split)
            family = folder / (split + ".family.f32")
            if family.stat().st_size != manifest["counts"][split] * 4 or digest_file(family) != manifest["binaryHashes"][split + "Family"]:
                raise ValueError("Prepared family weights checksum mismatch: " + split)
        manifest["folder"] = str(folder)
        return manifest
    folder.mkdir(parents=True, exist_ok=True)
    database = sqlite3.connect(folder / "preparation.sqlite")
    database.execute("PRAGMA journal_mode=WAL")
    database.execute("PRAGMA synchronous=FULL")
    # Allow an approximately 64 MiB page cache; keep transaction durability unchanged.
    database.execute("PRAGMA cache_size=-65536")
    database.execute("CREATE TABLE IF NOT EXISTS samples (id TEXT PRIMARY KEY)")
    database.execute("CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, split TEXT NOT NULL)")
    database.execute("CREATE TABLE IF NOT EXISTS positions (id TEXT PRIMARY KEY, split TEXT NOT NULL)")
    database.execute("CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    database.execute("CREATE TABLE IF NOT EXISTS family_rows (split TEXT NOT NULL, row_index INTEGER NOT NULL, family TEXT NOT NULL, weight REAL NOT NULL, PRIMARY KEY(split,row_index))")
    database.execute("CREATE TABLE IF NOT EXISTS family_totals (family TEXT PRIMARY KEY, split TEXT NOT NULL, weight REAL NOT NULL)")
    stored = database.execute("SELECT value FROM metadata WHERE id=1").fetchone()
    state = json.loads(stored[0]) if stored else {
        "datasetHash": data_hash, "offset": 0, "lines": 0, "counts": {"train": 0, "validation": 0, "test": 0},
        "labelTypes": {split: {"terminal": 0, "teacher": 0} for split in ("train", "validation", "test")},
        "sums": [0.0] * INPUT_SIZE, "squares": [0.0] * INPUT_SIZE, "duplicatesIgnored": 0}
    if state.get("datasetHash") != data_hash:
        database.close()
        raise ValueError("Partial prepared data full hash differs")
    counts, kinds, sums, squares = state["counts"], state["labelTypes"], state["sums"], state["squares"]
    files, current_paths = {}, {}
    for split in ("train", "validation"):
        temporary, final = folder / (split + ".f32.tmp"), folder / (split + ".f32")
        current = temporary if temporary.exists() else final if final.exists() else temporary
        expected_size = counts[split] * ROW_SIZE * 4
        if expected_size and (not current.exists() or current.stat().st_size < expected_size):
            database.close()
            raise ValueError("Incomplete prepared data is missing committed bytes: " + split)
        files[split] = current.open("r+b" if current.exists() else "w+b")
        # Discard bytes from an append whose DB checkpoint never committed.
        files[split].truncate(expected_size)
        files[split].seek(expected_size)
        current_paths[split] = current
    buffers = {split: array.array("f") for split in files}
    last_progress = time.monotonic()

    def commit_progress():
        nonlocal last_progress
        for split, dest in files.items():
            buffers[split].tofile(dest)
            buffers[split] = array.array("f")
            dest.flush()
            os.fsync(dest.fileno())
        # Binary writes reach disk before their cursor and sample IDs commit.
        database.execute("INSERT OR REPLACE INTO metadata VALUES (1, ?)",
                         (json.dumps(state, allow_nan=False, separators=(",", ":")),))
        database.commit()
        if time.monotonic() - last_progress >= 10:
            emit({"event": "prepare", "lines": state["lines"], "counts": counts})
            last_progress = time.monotonic()

    try:
        with path.open("rb") as source:
            source.seek(state["offset"])
            while True:
                if stop.reason():
                    commit_progress()
                    raise InterruptedError("Data preparation stopped: " + str(stop.reason()))
                binary_line = source.readline()
                if not binary_line:
                    break
                state["lines"] += 1
                state["offset"] = source.tell()
                line = binary_line.decode("utf-8-sig" if state["lines"] == 1 else "utf-8")
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                    if not isinstance(row, dict):
                        raise ValueError("Sample must be an object")
                    sample_id = row.get("sampleId")
                    if sample_id is not None:
                        if not isinstance(sample_id, str) or not sample_id or len(sample_id) > 256:
                            raise ValueError("Invalid sampleId")
                        if database.execute("SELECT 1 FROM samples WHERE id=?", (sample_id,)).fetchone():
                            state["duplicatesIgnored"] += 1
                            continue
                        database.execute("INSERT INTO samples VALUES (?)", (sample_id,))
                    if row.get("schemaVersion") != SCHEMA_VERSION or row.get("rulesId") != RULES_ID or row.get("featureVersion") != FEATURE_VERSION:
                        raise ValueError("Unsupported schema, rule set or feature version")
                    split, family = row.get("split"), row.get("familyId")
                    if split not in counts:
                        raise ValueError("split must be train, validation or test")
                    if not isinstance(family, str) or not family:
                        raise ValueError("familyId is required")
                    prior_family = database.execute("SELECT split FROM families WHERE id=?", (family,)).fetchone()
                    if prior_family and prior_family[0] != split:
                        raise ValueError("Record family leaks across splits: " + family)
                    if not prior_family:
                        database.execute("INSERT INTO families VALUES (?,?)", (family, split))
                    position_key = row.get("positionKey")
                    if position_key is not None:
                        if not isinstance(position_key, str) or not position_key or len(position_key) > 256:
                            raise ValueError("Invalid positionKey")
                        prior_position = database.execute("SELECT split FROM positions WHERE id=?", (position_key,)).fetchone()
                        if prior_position and prior_position[0] != split:
                            raise ValueError("Position leaks across splits: " + position_key)
                        if not prior_position:
                            database.execute("INSERT INTO positions VALUES (?,?)", (position_key, split))
                    counts[split] += 1
                    if split == "test":
                        # Intentionally do not inspect its features or target.
                        if state["lines"] % 4096 == 0:
                            commit_progress()
                        continue
                    features = row.get("features")
                    if not isinstance(features, list) or len(features) != INPUT_SIZE:
                        raise ValueError("features must contain exactly 32 numbers")
                    features = [finite_number(x, "feature") for x in features]
                    if any(abs(x) > 1e6 for x in features):
                        raise ValueError("Feature exceeds supported finite range")
                    target = finite_number(row.get("target"), "target")
                    weight = finite_number(row.get("weight", 1), "weight")
                    kind = row.get("labelType", "terminal")
                    if not -1 <= target <= 1 or not 0 < weight <= 100:
                        raise ValueError("target must be in [-1,1] and weight in (0,100]")
                    if kind not in ("terminal", "teacher"):
                        raise ValueError("labelType must be terminal or teacher")
                    kinds[split][kind] += 1
                    buffers[split].extend(features + [target, weight, float(kind == "teacher")])
                    database.execute("INSERT INTO family_rows VALUES (?,?,?,?)", (split, counts[split] - 1, family, weight))
                    database.execute("INSERT INTO family_totals VALUES (?,?,?) ON CONFLICT(family) DO UPDATE SET weight=weight+excluded.weight", (family, split, weight))
                    if split == "train":
                        for j, value in enumerate(features):
                            sums[j] += value
                            squares[j] += value * value
                    if state["lines"] % 4096 == 0:
                        commit_progress()
                except (ValueError, TypeError, OverflowError) as error:
                    raise ValueError(f"Invalid data at line {state['lines']}: {error}") from error
        commit_progress()
        family_counts = dict(database.execute("SELECT split, COUNT(*) FROM families GROUP BY split"))
        family_summary = {}
        for split in files:
            totals = database.execute("SELECT COUNT(*), SUM(weight), MIN(weight), MAX(weight) FROM family_totals WHERE split=?", (split,)).fetchone()
            count, total, minimum, maximum = totals
            average = total / count if count else 1.0
            family_summary[split] = {"families": count, "totalConfidenceWeight": total or 0.0,
                                     "minimumFamilyWeight": minimum, "maximumFamilyWeight": maximum}
            # One mmap float per row keeps family balancing independent of GPU
            # memory size. Confidence ratios within a family are unchanged.
            temporary = folder / (split + ".family.f32.tmp")
            with temporary.open("wb") as dest:
                query = database.execute("SELECT r.row_index,t.weight FROM family_rows r JOIN family_totals t ON t.family=r.family WHERE r.split=? ORDER BY r.row_index", (split,))
                written = 0
                while True:
                    if stop.reason():
                        raise InterruptedError("Family preparation stopped: " + str(stop.reason()))
                    chunk = query.fetchmany(4096)
                    if not chunk:
                        break
                    if any(index != written + offset for offset, (index, _) in enumerate(chunk)):
                        raise ValueError("Prepared family row order differs")
                    array.array("f", [average / weight for _, weight in chunk]).tofile(dest)
                    written += len(chunk)
                if written != counts[split]:
                    raise ValueError("Prepared family row count differs")
                dest.flush()
                os.fsync(dest.fileno())
            replace_saved_file(temporary, folder / (split + ".family.f32"))
    finally:
        database.close()
        for dest in files.values():
            dest.close()
    if sys.byteorder != "little":
        raise RuntimeError("This float32 cache requires a little-endian host")
    if not counts["train"]:
        raise ValueError("No training samples; no model was trained")
    if digest_file(path) != data_hash:
        raise ValueError("Dataset changed during preparation; freeze the cycle dataset first")
    mean = [x / counts["train"] for x in sums]
    scale = [max(0.0, squares[j] / counts["train"] - mean[j] ** 2) ** 0.5 for j in range(INPUT_SIZE)]
    scale = [x if x >= 1e-6 else 1.0 for x in scale]
    hashes = {}
    for split in files:
        final = folder / (split + ".f32")
        if current_paths[split] != final:
            replace_saved_file(current_paths[split], final)
        hashes[split] = digest_file(final)
        hashes[split + "Family"] = digest_file(folder / (split + ".family.f32"))
    manifest = {"schemaVersion": SCHEMA_VERSION, "preparationVersion": 3, "datasetHash": data_hash, "rulesId": RULES_ID,
                "featureVersion": FEATURE_VERSION, "inputSize": INPUT_SIZE, "rowSize": ROW_SIZE,
                "counts": counts, "labelTypes": kinds, "duplicatesIgnored": state["duplicatesIgnored"],
                "families": {split: family_counts.get(split, 0) for split in counts},
                "familyWeights": family_summary,
                "normalization": {"mean": mean, "scale": scale}, "binaryHashes": hashes}
    atomic_json(manifest_path, manifest)
    manifest["folder"] = str(folder)
    return manifest


def mapped_rows(torch, manifest: dict, split: str):
    count = manifest["counts"][split]
    if not count:
        return torch.empty((0, ROW_SIZE), dtype=torch.float32)
    return torch.from_file(str(Path(manifest["folder"]) / (split + ".f32")), shared=False,
                           size=count * ROW_SIZE, dtype=torch.float32).view(count, ROW_SIZE)


def mapped_family_weights(torch, manifest: dict, split: str):
    count = manifest["counts"][split]
    if not count:
        return torch.empty(0, dtype=torch.float32)
    return torch.from_file(str(Path(manifest["folder"]) / (split + ".family.f32")), shared=False,
                           size=count, dtype=torch.float32)


def resident_training_data(torch, rows, families, device: str):
    """Keep bounded datasets on CUDA instead of copying every tiny batch.

    The mapped CPU copies remain the authoritative source for diagnostics and
    exports. Large datasets, or devices with little free memory, use the prior
    mapped path. Residency is execution state, never checkpoint identity/state.
    """
    needed = sum(value.numel() * value.element_size() for value in (*rows, *families))
    if device != "cuda":
        return rows, families, {"mode": "mapped-cpu", "residentBytes": 0}
    free, _ = torch.cuda.mem_get_info()
    # Current 100k-row cycles need about 14 MiB; leave most GPU memory available
    # to the model, optimizer, desktop, and any concurrent inference workload.
    if needed > min(256 * 1024 * 1024, free // 4):
        return rows, families, {"mode": "mapped-cpu", "residentBytes": 0, "reason": "memory-budget"}
    copied_rows, copied_families = [], []
    try:
        copied_rows = [value.to(device) for value in rows]
        copied_families = [value.to(device) for value in families]
    except torch.cuda.OutOfMemoryError:
        # Free only these optional allocations; keep the original mapped path.
        copied_rows.clear()
        copied_families.clear()
        return rows, families, {"mode": "mapped-cpu", "residentBytes": 0, "reason": "allocation-failed"}
    return copied_rows, copied_families, {"mode": "resident-cuda", "residentBytes": needed}


def read_model(path: Path) -> dict:
    model = json.loads(path.read_text(encoding="utf-8"))
    if model.get("schemaVersion") != 1 or model.get("kind") != "forest-value-mlp" or model.get("rulesId") != RULES_ID or model.get("featureVersion") != FEATURE_VERSION:
        raise ValueError("Unsupported exported model identity")
    if model.get("inputSize") != INPUT_SIZE or model.get("activation") != "relu" or model.get("outputActivation") != "tanh":
        raise ValueError("Unsupported network shape or activation")
    hidden = model.get("hiddenSize")
    if not isinstance(hidden, int) or not 1 <= hidden <= 64:
        raise ValueError("Invalid hiddenSize")
    for key in ("mean", "scale"):
        values = model.get("normalization", {}).get(key)
        if not isinstance(values, list) or len(values) != INPUT_SIZE:
            raise ValueError("Invalid normalization " + key)
        for value in values:
            finite_number(value, "normalization")
            if key == "scale" and value <= 0:
                raise ValueError("Normalization scale must be positive")
    layers = model.get("layers")
    if not isinstance(layers, list) or len(layers) != 2:
        raise ValueError("Expected two dense layers")
    for layer, width, height in zip(layers, (INPUT_SIZE, hidden), (hidden, 1)):
        if len(layer.get("weights", [])) != height or len(layer.get("bias", [])) != height:
            raise ValueError("Layer output dimensions differ")
        for weights in layer["weights"]:
            if len(weights) != width:
                raise ValueError("Layer input dimensions differ")
            for value in weights:
                finite_number(value, "weight")
        for value in layer["bias"]:
            finite_number(value, "bias")
    if not 0 < finite_number(model.get("scale"), "model scale") <= 600:
        raise ValueError("Invalid model evaluation scale")
    return model


def json_inference(model: dict, features: list[float]) -> float:
    values = [(x - m) / s for x, m, s in zip(features, model["normalization"]["mean"], model["normalization"]["scale"])]
    for index, layer in enumerate(model["layers"]):
        outputs = []
        for weights, bias in zip(layer["weights"], layer["bias"]):
            value = bias
            for weight, x in zip(weights, values):
                value += weight * x
            outputs.append(max(0.0, value) if index == 0 else math.tanh(value))
        values = outputs
    return values[0]


def opposite_features(features: list[float]) -> list[float]:
    """Exact perspective swap for the frozen house32-v1 feature definition."""
    return features[12:24] + features[:12] + [features[25], features[24], features[27], features[26],
                                             -features[28], features[29], features[31], features[30]]


def effective_prediction(torch, model, features, mean, scale):
    order = getattr(model, "_forest_perspective_order", None)
    if order is None or order.device != features.device:
        order = torch.tensor(list(range(12, 24)) + list(range(12)) + [25, 24, 27, 26, 28, 29, 31, 30],
                             dtype=torch.int64, device=features.device)
        # Plain execution cache, deliberately not a state_dict buffer. Creating
        # a CUDA index from a Python list for every batch is a blocking copy.
        model._forest_perspective_order = order
    other = features.index_select(1, order)
    other[:, 28] *= -1
    combined = torch.cat((features, other), dim=0)
    values = model((combined - mean) / scale).flatten()
    return (values[:len(features)] - values[len(features):]) * 0.5


def load_export(torch, model, exported: dict, normalization: dict | None = None) -> None:
    previous_hidden = exported["hiddenSize"]
    if model[0].out_features < previous_hidden:
        raise ValueError("Warm-start cannot shrink hidden size; explicitly start a new candidate")
    with torch.no_grad():
        first, output = exported["layers"]
        model[0].weight[:previous_hidden].copy_(torch.tensor(first["weights"], device=model[0].weight.device))
        model[0].bias[:previous_hidden].copy_(torch.tensor(first["bias"], device=model[0].bias.device))
        # Added units retain initialized feature weights but contribute zero
        # until training learns them. Expansion preserves the old function.
        model[2].weight.zero_()
        model[2].weight[:, :previous_hidden].copy_(torch.tensor(output["weights"], device=model[2].weight.device))
        model[2].bias.copy_(torch.tensor(output["bias"], device=model[2].bias.device))
        if normalization:
            # Keep the prior function unchanged when the new train-only
            # normalization changes. Subsequent updates learn new experience.
            old_mean = torch.tensor(exported["normalization"]["mean"], device=model[0].weight.device)
            old_scale = torch.tensor(exported["normalization"]["scale"], device=model[0].weight.device)
            new_mean = torch.tensor(normalization["mean"], device=model[0].weight.device)
            new_scale = torch.tensor(normalization["scale"], device=model[0].weight.device)
            old_weights = model[0].weight.detach().clone()
            model[0].bias.add_(old_weights @ ((new_mean - old_mean) / old_scale))
            model[0].weight.mul_(new_scale / old_scale)


def export_model(model, manifest: dict, hidden: int, scale: float, training: dict) -> dict:
    result = {"schemaVersion": 1, "kind": "forest-value-mlp", "rulesId": RULES_ID,
              "featureVersion": FEATURE_VERSION, "inputSize": INPUT_SIZE, "hiddenSize": hidden,
              "activation": "relu", "outputActivation": "tanh", "inference": "antisymmetric", "scale": scale,
              "normalization": manifest["normalization"],
              "layers": [{"weights": layer.weight.detach().cpu().tolist(), "bias": layer.bias.detach().cpu().tolist()}
                         for layer in (model[0], model[2])]}
    identity = hashlib.sha256(json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    result["modelId"] = "mlp-" + identity
    result["training"] = training
    return result


def parity_report(torch, exported: dict, raw_features: list[list[float]]) -> dict:
    cpu = network(torch, exported["hiddenSize"])
    load_export(torch, cpu, exported)
    cpu.eval()
    mean, scale = (torch.tensor(exported["normalization"][key]) for key in ("mean", "scale"))
    with torch.no_grad():
        outputs = cpu((torch.tensor(raw_features) - mean) / scale).flatten().tolist()
    cases = []
    for features, actual in zip(raw_features, outputs):
        expected = json_inference(exported, features)
        effective = (expected - json_inference(exported, opposite_features(features))) * 0.5
        cases.append({"features": features, "expectedValue": expected, "expectedScore": expected * exported["scale"],
                      "expectedEffectiveValue": effective, "expectedEffectiveScore": effective * exported["scale"],
                      "torchCpuValue": actual, "absoluteError": abs(actual - expected)})
    maximum = max((row["absoluteError"] for row in cases), default=0.0)
    if maximum > 1e-5:
        raise ValueError("Exported JSON and PyTorch CPU inference differ: " + str(maximum))
    return {"schemaVersion": 1, "modelId": exported["modelId"], "featureVersion": FEATURE_VERSION,
            "tolerance": 1e-5, "maxAbsoluteError": maximum, "passed": True, "cases": cases,
            "scope": "JSON double inference vs PyTorch CPU; JS engine must check these same raw-feature fixtures separately"}


def validate(torch, model, rows, mean, scale, batch: int, device: str, stop: StopController,
             family_weights=None, family_balance: float = 0.0):
    if not len(rows):
        return None
    names = ("all", "terminal", "teacher", "unbalancedAll")
    # Float64 accumulation retains the old Python-double sum of float32 batch
    # reductions while avoiding eight device synchronizations per batch.
    totals = torch.zeros((len(names), 2), dtype=torch.float64, device=device)
    model.eval()
    with torch.no_grad():
        for start in range(0, len(rows), batch):
            if stop.reason():
                model.train()
                return None  # An incomplete validation is not a selection result.
            raw = rows[start:start + batch].to(device)
            predicted = effective_prediction(torch, model, raw[:, :INPUT_SIZE], mean, scale)
            squared, weights = (predicted - raw[:, INPUT_SIZE]) ** 2, raw[:, INPUT_SIZE + 1]
            unbalanced = torch.stack(((squared * weights).sum(), weights.sum()))
            if family_balance:
                weights = weights * family_weights[start:start + batch].to(device).pow(family_balance)
            balanced = torch.stack(((squared * weights).sum(), weights.sum()))
            by_kind = []
            for name, kind in (("terminal", 0), ("teacher", 1)):
                mask = raw[:, INPUT_SIZE + 2] == kind
                # Fixed-size masked reductions avoid CUDA nonzero/indexing
                # synchronization and still report None for an absent kind.
                kind_weights = weights * mask
                by_kind.append(torch.stack(((squared * kind_weights).sum(), kind_weights.sum())))
            totals.add_(torch.stack((balanced, *by_kind, unbalanced)))
    model.train()
    return {name: total / weight if weight else None for name, (total, weight) in zip(names, totals.cpu().tolist())}


def diagnostic_indices(torch, count: int, maximum: int):
    used = min(count, maximum)
    if not used:
        return torch.empty(0, dtype=torch.int64)
    return torch.tensor([i * (count - 1) // max(1, used - 1) for i in range(used)], dtype=torch.int64)


def diagnostic_values(torch, model, rows, indices, mean, scale, device: str):
    if not len(indices):
        return []
    with torch.no_grad():
        raw = rows.index_select(0, indices).to(device)
        return effective_prediction(torch, model, raw[:, :INPUT_SIZE], mean, scale).cpu().tolist()


def diagnostic_report(torch, model, rows, before: dict, mean, scale, device: str, evaluation_scale: float):
    indices = torch.tensor(before["indices"], dtype=torch.int64)
    after = diagnostic_values(torch, model, rows, indices, mean, scale, device)
    if not after:
        return {"samples": 0}
    values = torch.tensor(after, dtype=torch.float64)
    original = torch.tensor(before["values"], dtype=torch.float64)
    delta = (values - original).abs()
    raw = rows.index_select(0, indices)
    terminal = raw[:, INPUT_SIZE + 2] == 0
    result = {"samples": len(after), "meanValue": values.mean().item(), "stdValue": values.std(unbiased=False).item(),
              "minimumValue": values.min().item(), "maximumValue": values.max().item(),
              "meanAbsoluteScore": values.abs().mean().item() * evaluation_scale,
              "meanAbsoluteScoreChange": delta.mean().item() * evaluation_scale,
              "maximumAbsoluteScoreChange": delta.max().item() * evaluation_scale,
              "saturatedFraction": (values.abs() >= 0.98).double().mean().item(),
              "terminalSamples": int(terminal.sum().item())}
    if terminal.any():
        outcomes = raw[terminal, INPUT_SIZE].double()
        nonzero = outcomes != 0
        result["terminalSignAccuracy"] = (values[terminal][nonzero].sign() == outcomes[nonzero].sign()).double().mean().item() if nonzero.any() else None
    return result


def check_command(args) -> dict:
    torch = torch_runtime()
    info = device_info(torch, args.device)
    torch.set_num_threads(2)
    torch.manual_seed(17)
    model = network(torch, 16).to(args.device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.002)
    features = torch.randn(args.batch_size, INPUT_SIZE, device=args.device)
    targets = torch.tanh(features[:, 0] - features[:, 1]).reshape(-1, 1)
    before = model[0].weight.detach().clone()
    if args.device == "cuda":
        torch.cuda.reset_peak_memory_stats()
    started = time.monotonic()
    last_loss, completed = None, 0
    for _ in range(args.iterations):
        if time.monotonic() - started > args.max_seconds:
            break
        optimizer.zero_grad(set_to_none=True)
        loss = torch.nn.functional.mse_loss(model(features), targets)
        if not torch.isfinite(loss).item():
            raise RuntimeError("Non-finite forward/backward result")
        loss.backward()
        optimizer.step()
        last_loss, completed = loss.item(), completed + 1
    if args.device == "cuda":
        torch.cuda.synchronize()
    elapsed = time.monotonic() - started
    changed = bool(torch.any(model[0].weight.detach() != before).item())
    if not completed or not changed:
        raise RuntimeError("No successful parameter update in device check")
    info.update(status="passed", actualForwardBackward=True, weightChanged=changed, finite=True,
                trainedOnCuda=args.device == "cuda",
                iterations=completed, finalLoss=last_loss, elapsedSeconds=elapsed,
                samplesPerSecond=completed * args.batch_size / max(elapsed, 1e-6),
                peakAllocatedBytes=torch.cuda.max_memory_allocated() if args.device == "cuda" else None,
                peakReservedBytes=torch.cuda.max_memory_reserved() if args.device == "cuda" else None)
    if args.out:
        atomic_json(Path(args.out), info)
    return info


def train_command(args) -> dict:
    family_balance = getattr(args, "family_balance", 0.0)
    early_stop_patience = getattr(args, "early_stop_patience", 0)
    early_stop_min_delta = getattr(args, "early_stop_min_delta", 0.0)
    min_epochs = getattr(args, "min_epochs", 1)
    diagnostic_samples = getattr(args, "diagnostic_samples", 512)
    stop = StopController(args.max_seconds, Path(args.stop_file) if args.stop_file else None)
    timing_started = time.perf_counter()
    timings = {name: 0.0 for name in (
        "runtimeInit", "prepareData", "mappedDataAndCudaLoad", "modelInitOrResume",
        "baselineValidation", "baselineDiagnostics", "trainAndControl", "epochValidation",
        "checkpoint", "finalSynchronization", "diagnosticsExportParity")}

    def measured(name, operation, *arguments):
        started = time.perf_counter()
        failure = None
        try:
            return operation(*arguments)
        except Exception as error:
            failure = error
            raise
        finally:
            timings[name] += (time.perf_counter() - started) * 1000
            if failure is not None:
                failure.performance = timing_report()

    def timing_report():
        return {"schemaVersion": 1, "wallMs": (time.perf_counter() - timing_started) * 1000,
                "stagesMs": dict(timings),
                "scope": "Host wall time for this invocation, including existing CUDA waits; not device kernel time. "
                         "Train/control excludes separately measured validation and checkpoint calls. "
                         "No per-batch timers or additional CUDA synchronization; final report publication is excluded."}

    torch = torch_runtime()
    device = device_info(torch, args.device)
    torch.set_num_threads(2)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    if args.device == "cuda":
        torch.cuda.manual_seed_all(args.seed)
        torch.cuda.reset_peak_memory_stats()
    timings["runtimeInit"] = (time.perf_counter() - timing_started) * 1000
    output, checkpoint = Path(args.output), Path(args.checkpoint)
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest = measured("prepareData", prepare_data, Path(args.data), output.parent / ".train-cache", stop)
    loading_started = time.perf_counter()
    train_rows, validation_rows = (mapped_rows(torch, manifest, split) for split in ("train", "validation"))
    train_family, validation_family = (mapped_family_weights(torch, manifest, split) for split in ("train", "validation"))
    execution_rows, execution_families, storage = resident_training_data(
        torch, (train_rows, validation_rows), (train_family, validation_family), args.device)
    execution_train, execution_validation = execution_rows
    execution_train_family, execution_validation_family = execution_families
    device["dataStorage"] = storage
    timings["mappedDataAndCudaLoad"] = (time.perf_counter() - loading_started) * 1000
    model_started = time.perf_counter()
    model = network(torch, args.hidden_size).to(args.device)
    warm_start, warm_start_scale = None, None
    if args.init_model and not args.resume:
        prior = read_model(Path(args.init_model))
        load_export(torch, model, prior, manifest["normalization"])
        warm_start = prior["modelId"]
        warm_start_scale = prior["scale"]
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=args.weight_decay)
    generator = torch.Generator().manual_seed(args.seed)
    identity = {"datasetHash": manifest["datasetHash"], "rulesId": RULES_ID, "featureVersion": FEATURE_VERSION,
                "inputSize": INPUT_SIZE, "hiddenSize": args.hidden_size, "batchSize": args.batch_size,
                "seed": args.seed, "learningRate": args.learning_rate, "weightDecay": args.weight_decay,
                "scale": args.scale, "normalization": manifest["normalization"],
                "familyBalance": family_balance, "earlyStopPatience": early_stop_patience,
                "earlyStopMinDelta": early_stop_min_delta, "minEpochs": min_epochs,
                "diagnosticSamples": diagnostic_samples,
                "objective": "antisymmetric-confidence-family-mse-v2", "trainerHash": digest_file(Path(__file__)),
                "runtime": {"torchVersion": str(torch.__version__), "device": args.device, "cudaVersion": torch.version.cuda}}
    epoch, cursor, updates, samples_seen = 0, 0, 0, 0
    permutation, best_state, best_metric, history = None, None, None, []
    baseline_validation, best_epoch, patience_metric, stale_epochs = None, None, None, 0
    early_stopped, baseline_diagnostics = False, {}
    previous_elapsed = 0.0
    if args.resume:
        saved = torch.load(checkpoint, map_location="cpu", weights_only=True)
        if saved.get("schemaVersion") != 1 or saved.get("identity") != identity:
            raise ValueError("Checkpoint data/model/config identity differs; start a new candidate")
        model.load_state_dict(saved["modelState"])
        optimizer.load_state_dict(saved["optimizerState"])
        for state in optimizer.state.values():
            for key, value in state.items():
                if isinstance(value, torch.Tensor):
                    state[key] = value.to(args.device)
        epoch, cursor, updates = saved["epoch"], saved["cursor"], saved["updates"]
        samples_seen, permutation = saved["samplesSeen"], saved["permutation"]
        generator.set_state(saved["generatorState"])
        torch.set_rng_state(saved["torchRngState"])
        random.setstate(saved["pythonRngState"])
        if args.device == "cuda" and saved.get("cudaRngState"):
            torch.cuda.set_rng_state_all(saved["cudaRngState"])
        best_state, best_metric, history = saved["bestState"], saved["bestMetric"], saved["history"]
        baseline_validation, best_epoch = saved["baselineValidation"], saved["bestEpoch"]
        patience_metric, stale_epochs = saved["patienceMetric"], saved["staleEpochs"]
        early_stopped, baseline_diagnostics = saved["earlyStopped"], saved["baselineDiagnostics"]
        previous_elapsed, warm_start = saved["elapsedSeconds"], saved.get("warmStartModelId")
        warm_start_scale = saved["initEvaluationScale"]
    mean, scale = (torch.tensor(manifest["normalization"][key], device=args.device) for key in ("mean", "scale"))
    timings["modelInitOrResume"] = (time.perf_counter() - model_started) * 1000
    training_timing_started = time.perf_counter()
    training_start, current_loss, run_updates = time.monotonic(), None, 0
    last_loss, execution_permutation = None, None
    before_training = model[0].weight.detach().cpu().clone()
    initial_samples_seen = samples_seen
    reason = None
    if not args.resume:
        baseline_validation = measured("baselineValidation", validate, torch, model, execution_validation,
                                       mean, scale, args.batch_size, args.device, stop,
                                       execution_validation_family, family_balance)
        if baseline_validation:
            best_metric = patience_metric = baseline_validation["all"]
            best_epoch = 0
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
        diagnostics_started = time.perf_counter()
        for split, rows in (("train", train_rows), ("validation", validation_rows)):
            indices = diagnostic_indices(torch, len(rows), diagnostic_samples)
            baseline_diagnostics[split] = {"indices": indices.tolist(),
                "values": diagnostic_values(torch, model, rows, indices, mean, scale, args.device)}
        timings["baselineDiagnostics"] += (time.perf_counter() - diagnostics_started) * 1000

    def write_checkpoint(status):
        nonlocal current_loss
        if last_loss is not None:
            current_loss = last_loss.item()
        checkpoint.parent.mkdir(parents=True, exist_ok=True)
        temporary = checkpoint.with_name(checkpoint.name + ".tmp-" + str(os.getpid()))
        saved = {"schemaVersion": 1, "identity": identity, "modelState": model.state_dict(),
                 "optimizerState": optimizer.state_dict(), "epoch": epoch, "cursor": cursor,
                 "updates": updates, "samplesSeen": samples_seen, "permutation": permutation,
                 "generatorState": generator.get_state(), "torchRngState": torch.get_rng_state(),
                 "pythonRngState": random.getstate(),
                 "cudaRngState": torch.cuda.get_rng_state_all() if args.device == "cuda" else None,
                 "bestState": best_state, "bestMetric": best_metric, "history": history,
                 "baselineValidation": baseline_validation, "bestEpoch": best_epoch,
                 "patienceMetric": patience_metric, "staleEpochs": stale_epochs,
                 "earlyStopped": early_stopped, "baselineDiagnostics": baseline_diagnostics,
                 "elapsedSeconds": previous_elapsed + time.monotonic() - training_start,
                 "warmStartModelId": warm_start, "status": status}
        saved["initEvaluationScale"] = warm_start_scale
        torch.save(saved, temporary)
        with temporary.open("r+b") as flushable:
            os.fsync(flushable.fileno())
        replace_saved_file(temporary, checkpoint)

    def save_checkpoint(status):
        return measured("checkpoint", write_checkpoint, status)

    model.train()
    try:
        while epoch < args.epochs and not early_stopped:
            reason = stop.reason()
            if reason:
                break
            if permutation is None:
                permutation = torch.randperm(len(train_rows), generator=generator)
                cursor = 0
            if execution_permutation is None:
                # Preserve the CPU generator/permutation in checkpoints. Only
                # its execution copy follows the resident training matrix.
                execution_permutation = permutation.to(execution_train.device)
            while cursor < len(train_rows):
                reason = stop.reason()
                if reason:
                    break
                selected = permutation[cursor:cursor + args.batch_size]
                execution_selected = execution_permutation[cursor:cursor + args.batch_size]
                raw = execution_train.index_select(0, execution_selected).to(args.device)
                optimizer.zero_grad(set_to_none=True)
                predicted = effective_prediction(torch, model, raw[:, :INPUT_SIZE], mean, scale)
                weights, targets = raw[:, INPUT_SIZE + 1], raw[:, INPUT_SIZE]
                if family_balance:
                    weights = weights * execution_train_family.index_select(0, execution_selected).to(args.device).pow(family_balance)
                loss = ((predicted - targets) ** 2 * weights).sum() / weights.sum()
                loss.backward()
                grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0, error_if_nonfinite=False)
                # Check loss and gradient norm together before any optimizer
                # update, retaining both rejection conditions with one sync.
                if not (torch.isfinite(loss.detach()) & torch.isfinite(grad_norm)).item():
                    if not torch.isfinite(loss.detach()).item():
                        raise RuntimeError("Training produced non-finite loss")
                    raise RuntimeError("Training produced non-finite gradient norm")
                optimizer.step()
                last_loss = loss.detach()
                cursor += len(selected)
                samples_seen += len(selected)
                updates += 1
                run_updates += 1
                if updates % args.checkpoint_every == 0:
                    save_checkpoint("running")
                    emit({"event": "checkpoint", "epoch": epoch, "cursor": cursor, "updates": updates, "loss": current_loss})
            if reason:
                break
            metrics = measured("epochValidation", validate, torch, model, execution_validation,
                               mean, scale, args.batch_size, args.device, stop,
                               execution_validation_family, family_balance)
            if stop.reason():
                reason = stop.reason()
                break
            if metrics and (best_metric is None or metrics["all"] < best_metric):
                best_metric = metrics["all"]
                best_epoch = epoch + 1
                best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            if metrics:
                if patience_metric is None or metrics["all"] < patience_metric - early_stop_min_delta:
                    patience_metric, stale_epochs = metrics["all"], 0
                else:
                    stale_epochs += 1
            current_loss = last_loss.item() if last_loss is not None else current_loss
            history.append({"epoch": epoch + 1, "updates": updates, "lastBatchLoss": current_loss,
                            "validation": metrics})
            epoch += 1
            cursor, permutation = 0, None
            execution_permutation = None
            early_stopped = bool(metrics and early_stop_patience and epoch >= min_epochs and stale_epochs >= early_stop_patience)
            save_checkpoint("running")
            emit({"event": "epoch", **history[-1]})
        if early_stopped:
            reason = "validation-early-stop"
        status = "completed" if epoch >= args.epochs or early_stopped else "interrupted"
        save_checkpoint(status)
    except BaseException:
        save_checkpoint("error")
        raise
    if args.device == "cuda":
        measured("finalSynchronization", torch.cuda.synchronize)
    elapsed = time.monotonic() - training_start
    training_timing_ms = (time.perf_counter() - training_timing_started) * 1000
    timings["trainAndControl"] = max(0.0, training_timing_ms - sum(timings[name] for name in (
        "baselineValidation", "baselineDiagnostics", "epochValidation", "checkpoint", "finalSynchronization")))
    if not updates:
        report = {"status": "interrupted", "stopReason": reason, "updates": 0, "checkpoint": str(checkpoint),
                  "modelExported": False, "datasetHash": manifest["datasetHash"], "device": device,
                  "note": "No training updates completed; no candidate model was exported", "performance": timing_report()}
        atomic_json(Path(str(output) + ".training.json"), report)
        return report
    export_started = time.perf_counter()
    changed = bool(torch.any(model[0].weight.detach().cpu() != before_training).item())
    if best_state:
        model.load_state_dict(best_state)
    diagnostics = {split: diagnostic_report(torch, model, rows, baseline_diagnostics[split], mean, scale,
                                             args.device, args.scale)
                   for split, rows in (("train", train_rows), ("validation", validation_rows))}
    diagnostics["scope"] = "Bounded deterministic train/validation value samples; score changes do not prove different search decisions or playing strength. Final-test data were not opened."
    training = {"datasetHash": manifest["datasetHash"], "trainerHash": identity["trainerHash"],
                "updates": updates, "epochsCompleted": epoch,
                "status": status, "stopReason": reason, "trainSamples": manifest["counts"]["train"],
                "validationSamples": manifest["counts"]["validation"], "excludedTestSamples": manifest["counts"]["test"],
                "validationMse": best_metric, "selection": "best-completed-validation" if best_state else "latest-no-completed-validation",
                "baselineValidation": baseline_validation, "bestEpoch": best_epoch, "selectedBaseline": best_epoch == 0,
                "baselineKind": "warm-start-model" if warm_start else "seeded-initial-network",
                "exportUsesTrainedEpoch": best_epoch is None or best_epoch > 0,
                "familyBalance": family_balance, "earlyStopPatience": early_stop_patience,
                "earlyStopMinDelta": early_stop_min_delta, "minEpochs": min_epochs,
                "earlyStopped": early_stopped,
                "warmStartModelId": warm_start, "initModelId": warm_start, "device": args.device,
                "initEvaluationScale": warm_start_scale,
                "trainedOnCuda": args.device == "cuda" and updates > 0,
                "scope": "Learned value candidate; regression loss does not establish playing-strength improvement"}
    exported = export_model(model, manifest, args.hidden_size, args.scale, training)
    indices = sorted({0, len(train_rows) // 4, len(train_rows) // 2, 3 * len(train_rows) // 4, len(train_rows) - 1})
    fixtures = [train_rows[i, :INPUT_SIZE].tolist() for i in indices]
    parity = parity_report(torch, exported, fixtures)
    device.update(peakAllocatedBytes=torch.cuda.max_memory_allocated() if args.device == "cuda" else None,
                  peakReservedBytes=torch.cuda.max_memory_reserved() if args.device == "cuda" else None,
                  elapsedSeconds=elapsed, samplesPerSecond=(samples_seen - initial_samples_seen) / max(elapsed, 1e-6), updates=updates,
                  samplesProcessedThisRun=samples_seen - initial_samples_seen, updatesThisRun=run_updates,
                  trainedOnCuda=args.device == "cuda" and run_updates > 0,
                  actualForwardBackward=run_updates > 0, finite=True, weightChanged=changed,
                  totalRunSeconds=time.monotonic() - stop.started)
    report = {"status": status, "stopReason": reason, "modelExported": True, "model": str(output),
              "modelId": exported["modelId"], "checkpoint": str(checkpoint), "dataset": str(Path(args.data)),
              "datasetHash": manifest["datasetHash"], "counts": manifest["counts"], "families": manifest["families"],
              "labelTypes": manifest["labelTypes"], "duplicatesIgnored": manifest["duplicatesIgnored"],
              "familyWeights": manifest["familyWeights"], "diagnostics": diagnostics,
              "training": training, "history": history, "device": device, "parity": {"passed": True, "maxAbsoluteError": parity["maxAbsoluteError"]},
              "evaluationBoundary": "No final-test metrics or automatic adoption; engine arena must decide candidate adoption"}
    atomic_json(output, exported)
    atomic_json(Path(str(output) + ".parity.json"), parity)
    timings["diagnosticsExportParity"] = (time.perf_counter() - export_started) * 1000
    report["performance"] = timing_report()
    atomic_json(Path(str(output) + ".training.json"), report)
    return report


def verify_export_command(args) -> dict:
    torch = torch_runtime()
    exported = read_model(Path(args.model))
    if args.fixtures:
        fixtures = json.loads(Path(args.fixtures).read_text(encoding="utf-8"))
        raw = [row["features"] for row in fixtures["cases"]]
    else:
        raw = [[0.0] * INPUT_SIZE, [1.0] * INPUT_SIZE,
               [(-1 if i % 2 else 1) * (i + 1) / INPUT_SIZE for i in range(INPUT_SIZE)]]
    report = parity_report(torch, exported, raw)
    if args.out:
        atomic_json(Path(args.out), report)
    return report


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("check", help="Actually execute a short forward/backward update on the selected device")
    check.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    check.add_argument("--out")
    check.add_argument("--batch-size", type=int, default=4096)
    check.add_argument("--iterations", type=int, default=20)
    check.add_argument("--max-seconds", type=float, default=15)
    train = commands.add_parser("train", help="Train from frozen JS feature JSONL, checkpoint and export a candidate")
    train.add_argument("--data", "--dataset", required=True)
    train.add_argument("--output", required=True, help="Candidate JSON file")
    train.add_argument("--checkpoint", required=True)
    train.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    train.add_argument("--epochs", type=int, default=10)
    train.add_argument("--batch-size", type=int, default=4096)
    train.add_argument("--hidden-size", type=int, default=16)
    train.add_argument("--learning-rate", type=float, default=0.001)
    train.add_argument("--weight-decay", type=float, default=0.0001)
    train.add_argument("--scale", type=float, default=600)
    train.add_argument("--seed", type=int, default=20261007)
    train.add_argument("--max-seconds", type=float, default=60)
    train.add_argument("--checkpoint-every", type=int, default=100)
    train.add_argument("--stop-file")
    train.add_argument("--resume", action="store_true")
    train.add_argument("--init-model")
    train.add_argument("--family-balance", type=float, default=0.0, help="0 preserves sample confidence weights; 1 equalizes total confidence across train/validation families")
    train.add_argument("--early-stop-patience", type=int, default=0, help="Completed validation epochs without meaningful improvement; 0 disables")
    train.add_argument("--early-stop-min-delta", type=float, default=0.0)
    train.add_argument("--min-epochs", type=int, default=1)
    train.add_argument("--diagnostic-samples", type=int, default=512, help="Bounded value-change samples per train/validation split; never final-test")
    verify = commands.add_parser("verify-export", help="Check JSON inference against PyTorch CPU")
    verify.add_argument("--model", required=True)
    verify.add_argument("--fixtures")
    verify.add_argument("--out")
    args = parser.parse_args()
    for key in ("batch_size", "iterations", "epochs", "checkpoint_every"):
        if hasattr(args, key) and getattr(args, key) <= 0:
            parser.error("--" + key.replace("_", "-") + " must be positive")
    if hasattr(args, "max_seconds") and (not math.isfinite(args.max_seconds) or not 0 < args.max_seconds <= 86400):
        parser.error("--max-seconds must be finite and in (0,86400]")
    if args.command == "train":
        if not 1 <= args.hidden_size <= 64 or not 0 < args.scale <= 600:
            parser.error("hidden size or evaluation scale outside supported bounds")
        if not math.isfinite(args.learning_rate) or not 0 < args.learning_rate <= 1 or not math.isfinite(args.weight_decay) or not 0 <= args.weight_decay <= 1:
            parser.error("Invalid optimizer settings")
        if not math.isfinite(args.family_balance) or not 0 <= args.family_balance <= 1:
            parser.error("--family-balance must be finite and in [0,1]")
        if not 0 <= args.early_stop_patience <= 1000 or not math.isfinite(args.early_stop_min_delta) or not 0 <= args.early_stop_min_delta <= 1:
            parser.error("Invalid validation early-stop settings")
        if not 1 <= args.min_epochs <= args.epochs or not 1 <= args.diagnostic_samples <= 4096:
            parser.error("Invalid minimum epochs or diagnostic sample bound")
    return args


def main() -> int:
    args = parse_args()
    try:
        result = {"check": check_command, "train": train_command, "verify-export": verify_export_command}[args.command](args)
        emit(result)
        return 0
    except InterruptedError as error:
        result = {"status": "interrupted", "modelExported": False, "error": str(error)}
        if hasattr(error, "performance"):
            result["performance"] = error.performance
        if args.command == "train":
            atomic_json(Path(str(args.output) + ".training.json"), result)
        emit(result)
        return 0
    except Exception as error:
        result = {"status": "error", "type": type(error).__name__, "error": str(error), "command": args.command}
        if hasattr(error, "performance"):
            result["performance"] = error.performance
        if args.command == "check" and args.out:
            atomic_json(Path(args.out), result)
        elif args.command == "train":
            result["modelExported"] = False
            atomic_json(Path(str(args.output) + ".training.json"), result)
        emit(result)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
