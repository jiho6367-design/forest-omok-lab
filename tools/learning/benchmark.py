#!/usr/bin/env python3
"""Finite synthetic CPU/GPU trainer throughput comparison, not game strength."""
import argparse
import importlib.util
import math
from pathlib import Path
import time

spec = importlib.util.spec_from_file_location("omok_train", Path(__file__).with_name("train.py"))
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--batches", default="256,4096,16384")
    parser.add_argument("--warmup", type=int, default=20)
    parser.add_argument("--steps", type=int, default=100)
    parser.add_argument("--max-seconds", type=float, default=60)
    args = parser.parse_args()
    batches = [int(x) for x in args.batches.split(",")]
    if not batches or any(x < 1 or x > 1048576 for x in batches) or args.warmup < 1 or args.steps < 1 or not math.isfinite(args.max_seconds) or not 0 < args.max_seconds <= 300:
        parser.error("Invalid bounded benchmark configuration")
    torch = trainer.torch_runtime()
    torch.set_num_threads(2)
    hardware = trainer.device_info(torch, "cuda")
    started, rows = time.monotonic(), []
    for size in batches:
        for device in ("cpu", "cuda"):
            if time.monotonic() - started >= args.max_seconds:
                break
            torch.manual_seed(1700 + size)
            model = trainer.network(torch, 16).to(device)
            features = torch.randn(size, 32).to(device)
            targets = torch.tanh(features[:, 0] - features[:, 12])
            mean, scale = torch.zeros(32, device=device), torch.ones(32, device=device)
            optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=0.0001)
            initial = model[0].weight.detach().clone()

            def step():
                optimizer.zero_grad(set_to_none=True)
                values = trainer.effective_prediction(torch, model, features, mean, scale)
                loss = torch.nn.functional.mse_loss(values, targets)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0, error_if_nonfinite=True)
                optimizer.step()
                return loss

            for _ in range(args.warmup):
                if time.monotonic() - started >= args.max_seconds:
                    break
                last = step()
            if device == "cuda":
                torch.cuda.synchronize()
                torch.cuda.reset_peak_memory_stats()
            measured, completed = time.monotonic(), 0
            for _ in range(args.steps):
                if time.monotonic() - started >= args.max_seconds:
                    break
                last = step()
                completed += 1
            if device == "cuda":
                torch.cuda.synchronize()
            elapsed = time.monotonic() - measured
            finite = bool(torch.isfinite(last).item()) and all(bool(torch.isfinite(parameter).all().item()) for parameter in model.parameters())
            changed = bool(torch.any(initial != model[0].weight.detach()).item())
            row = {"device": device, "batchSize": size, "warmupSteps": args.warmup, "measuredSteps": completed,
                   "elapsedSeconds": elapsed, "millisecondsPerStep": 1000 * elapsed / max(1, completed),
                   "samplesPerSecond": size * completed / max(1e-6, elapsed), "finite": finite,
                   "weightChanged": changed, "finalLoss": last.item(),
                   "peakAllocatedBytes": torch.cuda.max_memory_allocated() if device == "cuda" else None,
                   "peakReservedBytes": torch.cuda.max_memory_reserved() if device == "cuda" else None}
            if not finite or not changed or not completed:
                raise RuntimeError("Benchmark did not complete finite learning updates")
            rows.append(row)
            trainer.emit({"event": "benchmark", **row})
    comparisons = []
    for size in batches:
        pair = {row["device"]: row for row in rows if row["batchSize"] == size}
        if len(pair) == 2:
            comparisons.append({"batchSize": size,
                                "gpuThroughputVsCpu": pair["cuda"]["samplesPerSecond"] / pair["cpu"]["samplesPerSecond"]})
    hardware.update(trainedOnCuda=any(row["device"] == "cuda" for row in rows),
                    actualForwardBackward=True, finite=True, weightChanged=True)
    report = {"schemaVersion": 1, "status": "completed" if len(rows) == len(batches) * 2 else "time-limit",
              "hardware": hardware, "cpuTorchThreads": torch.get_num_threads(),
              "network": "32 -> 16 ReLU -> 1 tanh; antisymmetric two-perspective value",
              "optimizer": "AdamW + gradient norm clipping", "rows": rows, "comparisons": comparisons,
              "totalElapsedSeconds": time.monotonic() - started,
              "scope": "Synthetic warmed trainer compute only. Excludes JS game generation, data loading, and full engine search. No playing-strength claim."}
    trainer.atomic_json(Path(args.out), report)
    trainer.emit(report)


if __name__ == "__main__":
    main()
