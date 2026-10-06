"""Train two real CPU GraphSAGE rankers on disjoint fictional network worlds.

The synthetic label rules below are assumptions, not cultural success ground truth.
Only observed history and known requirements enter message passing. No candidate
actor/resource -> planned-project target edge is present in any adjacency matrix.
"""

import argparse
import copy
import hashlib
import json
import math
import platform
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from generate_dataset import CAPABILITIES, TERRITORIES


HERE = Path(__file__).resolve().parent
N_CAP, N_HIST, N_PLAN, N_ACTOR, N_RESOURCE = 8, 12, 4, 28, 18
N_NODE = N_CAP + N_HIST + N_PLAN + N_ACTOR + N_RESOURCE
TYPE_ORDER = ["capability", "project", "actor", "resource"]
FORMATS = ["cine", "escénicas", "archivo sonoro", "talleres", "archivo", "encuentro", "sonido"]
FEATURE_DIM = 4 + N_CAP + len(TERRITORIES) + len(FORMATS) + 7
SCALAR_START = FEATURE_DIM - 7
MODEL_SEEDS = [7, 19, 31]


def encode_graph(graph):
    """Identity-free observable features and symmetrized observed adjacency."""
    ordered = []
    for kind in TYPE_ORDER:
        candidates = [n for n in graph["nodes"] if n["type"] == kind]
        if kind == "project":
            candidates = [n for n in candidates if n["status"] != "planned"] + [n for n in candidates if n["status"] == "planned"]
        ordered.extend(candidates)
    assert len(ordered) == N_NODE
    index = {n["id"]: i for i, n in enumerate(ordered)}
    cap_indices = {n["id"]: i for i, n in enumerate(ordered[:N_CAP])}
    features = np.zeros((N_NODE, FEATURE_DIM), dtype=np.float32)
    adjacency = np.zeros((N_NODE, N_NODE), dtype=np.float32)
    direct_caps = {}
    for e in graph["edges"]:
        if e["type"] in ("has_capability", "documents", "requires"):
            direct_caps.setdefault(e["source"], set()).add(cap_indices[e["target"]])
        source, target = index[e["source"]], index[e["target"]]
        target_node, source_node = ordered[target], ordered[source]
        # Known planned-project requirements are covariates, not prediction labels.
        if ((source_node.get("status") == "planned" or target_node.get("status") == "planned") and e["type"] != "requires"):
            raise ValueError("A target edge to a planned project leaked into adjacency")
        adjacency[source, target] = adjacency[target, source] = 1.0
    for i, node in enumerate(ordered):
        features[i, TYPE_ORDER.index(node["type"])] = 1.0
        caps = direct_caps.get(node["id"], set())
        if node["type"] == "capability":
            caps = {i}
        for c in caps:
            features[i, 4 + c] = 1.0
        if node.get("territory") in TERRITORIES:
            features[i, 4 + N_CAP + TERRITORIES.index(node["territory"])] = 1.0
        if node.get("format") in FORMATS:
            features[i, 4 + N_CAP + len(TERRITORIES) + FORMATS.index(node["format"])] = 1.0
        # None signifies unknown outcome on a planned project; flag explicitly.
        features[i, SCALAR_START:] = [node.get("availability", 0), node.get("quality", 0), node.get("scale", 0), node.get("outcome") or 0,
                                          (node.get("year", 2022) - 2022) / 4, float(node.get("status") == "planned"), float(node.get("status") == "completed")]
    degree = adjacency.sum(1, keepdims=True)
    adjacency = adjacency / np.maximum(degree, 1)
    return features, adjacency, ordered, index


def synthetic_world(seed):
    """Create a new independent synthetic world. Node IDs carry no model features."""
    rng = np.random.default_rng(seed)
    nodes, edges = [], []
    cap_ids = [c[0] for c in CAPABILITIES]

    def edge(a, b, kind, year):
        edges.append({"source": a, "target": b, "type": kind, "year": year})

    for i, cap in enumerate(cap_ids):
        nodes.append({"id": cap, "type": "capability"})
    projects = []
    for i in range(N_HIST + N_PLAN):
        year = 2022 + min(i // 3, 3) if i < N_HIST else 2026
        caps = sorted(rng.choice(N_CAP, size=int(rng.integers(2, 5)), replace=False).tolist())
        territory = int(rng.integers(len(TERRITORIES)))
        p = {"id": f"p_{i}", "type": "project", "year": year, "territory": TERRITORIES[territory], "format": FORMATS[int(rng.integers(len(FORMATS)))],
             "status": "completed" if i < N_HIST else "planned", "requiredCapabilities": [cap_ids[c] for c in caps],
             "scale": float(rng.uniform(0.3, 0.95)), "outcome": float(rng.uniform(0.55, 0.98)) if i < N_HIST else None}
        projects.append((p, caps))
        nodes.append(p)
        for cap in caps:
            edge(p["id"], cap_ids[cap], "requires", year)
    actors = []
    for i in range(N_ACTOR):
        caps = sorted(rng.choice(N_CAP, size=int(rng.integers(1, 4)), replace=False).tolist())
        actor = {"id": f"a_{i}", "type": "actor", "status": "active", "territory": TERRITORIES[int(rng.integers(len(TERRITORIES)))],
                 "availability": float(rng.uniform(0.25, 0.95))}
        actors.append((actor, caps))
        nodes.append(actor)
        for cap in caps:
            edge(actor["id"], cap_ids[cap], "has_capability", 2022)
    # Participation depends on skills and territory plus randomness; individual
    # histories vary even when direct feature vectors are almost identical.
    for project, caps in projects[:N_HIST]:
        ranks = [(len(set(ac) & set(caps)) / len(caps) + 0.35 * (a["territory"] == project["territory"]) + rng.uniform(0, 0.6), a) for a, ac in actors]
        for _, actor in sorted(ranks, key=lambda pair: pair[0], reverse=True)[:int(rng.integers(4, 9))]:
            edge(actor["id"], project["id"], "participated", project["year"])
    for i in range(N_RESOURCE):
        source, source_caps = projects[int(rng.integers(N_HIST))]
        caps = sorted(rng.choice(source_caps, size=min(len(source_caps), int(rng.integers(1, 3))), replace=False).tolist())
        resource = {"id": f"r_{i}", "type": "resource", "year": source["year"], "territory": source["territory"],
                    "quality": float(rng.uniform(0.65, 0.98)), "status": "available"}
        nodes.append(resource)
        edge(source["id"], resource["id"], "produced", source["year"])
        for cap in caps:
            edge(resource["id"], cap_ids[cap], "documents", source["year"])
        for other, other_caps in projects[:N_HIST]:
            if source["year"] < other["year"] and set(caps) & set(other_caps) and rng.uniform() < 0.48:
                edge(other["id"], resource["id"], "reused", other["year"])
    return {"nodes": nodes, "edges": edges}


def candidates_for(graph, task):
    """Explicit rule baseline plus disclosed synthetic training ground truth."""
    features, adjacency, nodes, index = encode_graph(graph)
    capsets = {n["id"]: set() for n in nodes}
    history = {n["id"]: [] for n in nodes}
    for e in graph["edges"]:
        if e["type"] in ("has_capability", "documents", "requires"):
            capsets[e["source"]].add(e["target"])
        if e["type"] == "participated":
            history[e["source"]].append(nodes[index[e["target"]]])
        if e["type"] in ("produced", "reused"):
            history[e["target"]].append(nodes[index[e["source"]]])
    kind = "actor" if task == "actor" else "resource"
    planned = [n for n in nodes if n.get("status") == "planned"]
    candidates = [n for n in nodes if n["type"] == kind]
    pairs, targets, baseline, evidence = [], [], [], []
    positives = 4 if task == "actor" else 3
    for project in planned:
        required = capsets[project["id"]]
        latent, raw_baseline = [], []
        for candidate in candidates:
            overlap = len(capsets[candidate["id"]] & required) / len(required)
            territory = float(candidate["territory"] == project["territory"])
            prior = history[candidate["id"]]
            # Similarity and outcome are obtained from historical graph neighbors.
            experiences = [len(capsets[p["id"]] & required) / len(required) * p["outcome"] for p in prior]
            context = max(experiences, default=0)
            format_history = float(any(p.get("format") == project.get("format") for p in prior))
            if task == "actor":
                available = candidate["availability"]
                heuristic = 0.72 * overlap + 0.18 * territory + 0.10 * available
                utility = 0.46 * overlap + 0.12 * territory + 0.16 * available + 0.20 * context + 0.06 * format_history
            else:
                quality = candidate["quality"]
                recency = (candidate["year"] - 2022) / 4
                heuristic = 0.72 * overlap + 0.12 * territory + 0.12 * quality + 0.04 * recency
                utility = 0.44 * overlap + 0.08 * territory + 0.16 * quality + 0.06 * recency + 0.20 * context + 0.06 * format_history
            pairs.append([index[candidate["id"]], index[project["id"]]])
            latent.append(utility)
            raw_baseline.append(heuristic)
            evidence.append({"candidateId": candidate["id"], "projectId": project["id"], "sharedCapabilities": sorted(capsets[candidate["id"]] & required),
                             "history": [p["id"] for p in prior], "sameTerritory": bool(territory)})
        order = np.argsort(np.asarray(latent), kind="stable")[::-1]
        labels = np.zeros(len(candidates), dtype=np.float32)
        labels[order[:positives]] = 1
        targets.extend(labels.tolist())
        baseline.extend(raw_baseline)
    return features, adjacency, np.asarray(pairs), np.asarray(targets, dtype=np.float32), np.asarray(baseline, dtype=np.float32), evidence


def make_split(seeds, task):
    samples = [candidates_for(synthetic_world(int(seed)), task) for seed in seeds]
    return {"x": torch.tensor(np.stack([s[0] for s in samples])), "adj": torch.tensor(np.stack([s[1] for s in samples])),
            "pairs": torch.tensor(np.stack([s[2] for s in samples]), dtype=torch.long), "y": torch.tensor(np.stack([s[3] for s in samples])),
            "baseline": np.stack([s[4] for s in samples])}


class Ranker(nn.Module):
    """Two-layer mean GraphSAGE; MLP ablation has no neighbor aggregation."""

    def __init__(self, graph=True, hidden=32):
        super().__init__()
        self.graph = graph
        multiplier = 2 if graph else 1
        self.layer1 = nn.Linear(FEATURE_DIM * multiplier, hidden)
        self.layer2 = nn.Linear(hidden * multiplier, hidden)
        self.decoder = nn.Sequential(nn.Linear(hidden * 4, hidden * 2), nn.ReLU(), nn.Linear(hidden * 2, 1))

    def forward(self, x, adjacency, pairs):
        h = torch.cat([x, torch.bmm(adjacency, x)], dim=-1) if self.graph else x
        h = torch.relu(self.layer1(h))
        h = torch.cat([h, torch.bmm(adjacency, h)], dim=-1) if self.graph else h
        h = torch.relu(self.layer2(h))
        batches = torch.arange(h.shape[0])[:, None]
        first, second = h[batches, pairs[:, :, 0]], h[batches, pairs[:, :, 1]]
        return self.decoder(torch.cat([first, second, first * second, torch.abs(first - second)], dim=-1)).squeeze(-1)


def metrics(labels, scores, candidate_count):
    y, s = labels.ravel(), np.asarray(scores).ravel()
    sort = np.argsort(-s, kind="stable")
    positives = y.sum()
    ap = float((np.cumsum(y[sort]) / np.arange(1, len(y) + 1) * y[sort]).sum() / positives)
    # Mann-Whitney AUC with average ranks for tied scores.
    order = np.argsort(s, kind="stable")
    sorted_scores = s[order]
    ranks = np.empty(len(s), dtype=float)
    starts = np.r_[0, np.flatnonzero(np.diff(sorted_scores)) + 1]
    ends = np.r_[starts[1:], len(s)]
    for start, end in zip(starts, ends):
        ranks[order[start:end]] = (start + 1 + end) / 2
    auc = float((ranks[y == 1].sum() - positives * (positives + 1) / 2) / (positives * (len(y) - positives)))
    grouped_labels = y.reshape(-1, candidate_count)
    grouped_scores = s.reshape(-1, candidate_count)
    top = np.argsort(-grouped_scores, axis=1, kind="stable")[:, :3]
    top_labels = np.take_along_axis(grouped_labels, top, axis=1)
    discount = 1 / np.log2(np.arange(2, 5))
    ideal = np.sort(grouped_labels, axis=1)[:, ::-1][:, :3]
    ndcg = float(np.mean((top_labels * discount).sum(1) / (ideal * discount).sum(1)))
    return {"ap": round(ap, 4), "rocAuc": round(auc, 4), "ndcgAt3": round(ndcg, 4),
            "recallAt3": round(float(np.mean(top_labels.sum(1) / grouped_labels.sum(1))), 4),
            "precisionAt3": round(float(top_labels.mean()), 4)}


def fit(train, val, task, model_seed, graph, epochs):
    torch.manual_seed(model_seed)
    model = Ranker(graph=graph)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.006, weight_decay=0.0003)
    positive_weight = (train["y"].numel() - train["y"].sum()) / train["y"].sum()
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=positive_weight)
    best, best_state, best_epoch, stale = -math.inf, None, 0, 0
    for epoch in range(1, epochs + 1):
        model.train()
        optimizer.zero_grad()
        logits = model(train["x"], train["adj"], train["pairs"])
        loss = loss_fn(logits, train["y"])
        loss.backward()
        optimizer.step()
        if epoch % 5:
            continue
        model.eval()
        with torch.no_grad():
            scores = torch.sigmoid(model(val["x"], val["adj"], val["pairs"])).numpy()
        quality = metrics(val["y"].numpy(), scores, N_ACTOR if task == "actor" else N_RESOURCE)["ndcgAt3"]
        if quality > best + 0.0001:
            best, best_state, best_epoch, stale = quality, copy.deepcopy(model.state_dict()), epoch, 0
        else:
            stale += 1
        if stale >= 20:
            break
    model.load_state_dict(best_state)
    model.eval()
    return model, {"seed": model_seed, "bestEpoch": best_epoch, "epochsRun": epoch, "validationNdcgAt3": round(best, 4), "finalTrainLoss": round(float(loss.detach()), 5)}


def explain(graph, detail, task):
    by_id = {n["id"]: n for n in graph["nodes"]}
    candidate, project = detail["candidateId"], detail["projectId"]
    shared = set(detail["sharedCapabilities"])
    edge_ids, node_ids = [], {candidate, project}
    for edge in graph["edges"]:
        if edge["source"] in (candidate, project) and edge["target"] in shared and edge["type"] in ("requires", "has_capability", "documents"):
            edge_ids.append(edge["id"])
            node_ids.add(edge["target"])
    # Attach at most two strongest historical contexts. These are supporting
    # facts, not a causal attribution of the neural network's numerical score.
    required = set(by_id[project]["requiredCapabilities"])
    history = sorted(set(detail["history"]), key=lambda pid: len(set(by_id[pid]["requiredCapabilities"]) & required), reverse=True)[:2]
    for edge in graph["edges"]:
        if (edge["type"] == "participated" and edge["source"] == candidate and edge["target"] in history) or (
                edge["type"] in ("produced", "reused") and edge["source"] in history and edge["target"] == candidate):
            edge_ids.append(edge["id"])
            node_ids.add(edge["target"])
            node_ids.add(edge["source"])
    names = [by_id[cap]["name"].lower() for cap in sorted(shared)]
    reason = f"{'Aporta' if task == 'actor' else 'Documenta'} {', '.join(names)}." if names else "Aporta experiencia de proyectos relacionados; no coincide directamente con las capacidades requeridas."
    if detail["sameTerritory"]:
        reason += " Comparte territorio con la propuesta."
    if history:
        reason += f" Experiencia registrada en {', '.join(by_id[pid]['name'] for pid in history)}."
    return sorted(node_ids), edge_ids, reason


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--threads", type=int, default=3)
    parser.add_argument("--train-worlds", type=int, default=120)
    parser.add_argument("--validation-worlds", type=int, default=24)
    parser.add_argument("--test-worlds", type=int, default=40)
    parser.add_argument("--output", type=Path, default=HERE / "data" / "gnn-results.json")
    args = parser.parse_args()
    torch.set_num_threads(args.threads)
    torch.use_deterministic_algorithms(True)
    started = time.monotonic()
    public_bytes = (HERE / "data" / "graph.json").read_bytes()
    public_graph = json.loads(public_bytes)
    public_features, public_adjacency, public_nodes, _ = encode_graph(public_graph)
    feature_names = ([f"type:{kind}" for kind in TYPE_ORDER] + [f"capability:{c[0]}" for c in CAPABILITIES] +
                     [f"territory:{t}" for t in TERRITORIES] + [f"format:{f}" for f in FORMATS] +
                     ["availability", "quality", "scale", "historicalOutcome", "year:(year-2022)/4", "plannedFlag", "completedFlag"])
    inference_input = {"meta": {"synthetic": True, "featureDim": FEATURE_DIM, "featureNames": feature_names,
                                "aggregation": "mean of symmetric observed neighbors; self excluded; zero degree -> zero vector",
                                "graphSha256": hashlib.sha256(public_bytes).hexdigest(), "noFutureTargetEdges": True},
                       "nodeIds": [n["id"] for n in public_nodes], "features": public_features.tolist(),
                       "neighbors": [np.flatnonzero(public_adjacency[i]).tolist() for i in range(N_NODE)]}
    model_export = {"meta": {"model": "two-layer mean GraphSAGE", "synthetic": True, "featureDim": FEATURE_DIM, "hiddenDim": 32,
                              "weightLayout": "out_features x in_features", "aggregation": "mean symmetric neighbors; exclude self; zero degree -> zeros",
                              "encoder": ["concat(node features, mean neighbor features) -> layer1 -> ReLU", "concat(h1, mean neighbor h1) -> layer2 -> ReLU"],
                              "head": ["concat(candidate h2, project h2, elementwise product, absolute difference)", "decoder1 -> ReLU -> decoder2 -> sigmoid"],
                              "scoreMeaning": "Uncalibrated model score, not a probability of real-world success", "graphSha256": hashlib.sha256(public_bytes).hexdigest()}, "models": {}}
    splits = {"train": list(range(10000, 10000 + args.train_worlds)), "validation": list(range(20000, 20000 + args.validation_worlds)), "test": list(range(30000, 30000 + args.test_worlds))}
    assert not (set(splits["train"]) & set(splits["validation"]) or set(splits["train"]) & set(splits["test"]) or set(splits["validation"]) & set(splits["test"]))
    result = {"meta": {"model": "GraphSAGE de dos capas con agregación media", "synthetic": True, "seed": MODEL_SEEDS,
                       "split": {"unit": "independent synthetic world", "worlds": {k: len(v) for k, v in splits.items()}, "seeds": splits,
                                 "noFutureTargetEdges": True, "identityFeatures": False, "selection": "early stopping on validation NDCG@3; test worlds are only evaluated after model selection"},
                       "limitations": ["Las etiquetas representan supuestos del generador; no resultados de comunidades reales.",
                                       "El test mide transferencia a mundos nuevos del mismo generador; no a redes culturales reales.",
                                       "El score es una salida del modelo entrenado, no una probabilidad calibrada ni un hecho del grafo.",
                                       "La disponibilidad y la calidad son atributos ficticios; cualquier propuesta requiere acuerdo entre participantes.",
                                       "Las rutas de evidencia son hechos que apoyan la propuesta; no una explicación causal de las activaciones de la GNN.",
                                       "No se imponen mejoras sobre reglas o MLP; se informan las métricas observadas."],
                       "labelAssumptions": {"actor": "Top 4 por proyecto según 46% coincidencia de capacidades + 12% territorio + 16% disponibilidad + 20% experiencia histórica similar ponderada por resultado + 6% experiencia del mismo formato.",
                                            "resource": "Top 3 por proyecto según 44% capacidades + 8% territorio + 16% completitud + 6% recencia + 20% contexto histórico similar ponderado por resultado + 6% mismo formato."},
                       "baseline": {"actor": "72% coincidencia de capacidades + 18% territorio + 10% disponibilidad", "resource": "72% coincidencia de capacidades + 12% territorio + 12% completitud + 4% recencia"},
                       "references": [{"title": "GraphSAGE: Inductive Representation Learning on Large Graphs", "url": "https://arxiv.org/abs/1706.02216"}],
                       "training": {"device": "cpu", "python": platform.python_version(), "torch": torch.__version__, "numpy": np.__version__,
                                    "threads": args.threads, "maxEpochs": args.epochs, "hidden": 32, "layers": 2, "optimizer": "AdamW", "learningRate": 0.006,
                                    "loss": "binary cross entropy with positive-class weighting", "initializations": len(MODEL_SEEDS), "graphSha256": hashlib.sha256(public_bytes).hexdigest(),
                                    "reproduce": "python generate_dataset.py && python build_database.py && python train_gnn.py"}}, "tasks": {}}
    for task in ("actor", "resource"):
        print(f"Preparing {task} worlds...", flush=True)
        datasets = {k: make_split(v, task) for k, v in splits.items()}
        train, val, test = datasets["train"], datasets["validation"], datasets["test"]
        candidate_count = N_ACTOR if task == "actor" else N_RESOURCE
        all_metrics, runs, best_model, best_val = {}, [], None, -1
        for model_name in ("gnn", "mlp"):
            observed = []
            for seed in MODEL_SEEDS:
                model, run = fit(train, val, task, seed, model_name == "gnn", args.epochs)
                with torch.no_grad():
                    scores = torch.sigmoid(model(test["x"], test["adj"], test["pairs"])).numpy()
                run_metrics = metrics(test["y"].numpy(), scores, candidate_count)
                observed.append(run_metrics)
                runs.append({"model": model_name, **run, "test": run_metrics})
                print(f"{task}/{model_name} seed={seed}: {run_metrics}; val={run['validationNdcgAt3']}, epoch={run['bestEpoch']}", flush=True)
                if model_name == "gnn" and run["validationNdcgAt3"] > best_val:
                    best_model, best_val = model, run["validationNdcgAt3"]
            all_metrics[model_name] = {metric: round(float(np.mean([r[metric] for r in observed])), 4) for metric in observed[0]}
            all_metrics[model_name]["std"] = {metric: round(float(np.std([r[metric] for r in observed])), 4) for metric in observed[0]}
        all_metrics["baseline"] = metrics(test["y"].numpy(), test["baseline"], candidate_count)
        selected_run = max((r for r in runs if r["model"] == "gnn"), key=lambda r: r["validationNdcgAt3"])
        sample = candidates_for(public_graph, task)
        with torch.no_grad():
            scores = torch.sigmoid(best_model(torch.tensor(sample[0])[None], torch.tensor(sample[1])[None], torch.tensor(sample[2])[None])).numpy().ravel()
        predictions = []
        for i, detail in enumerate(sample[5]):
            evidence_nodes, evidence_edges, reason = explain(public_graph, detail, task)
            predictions.append({"projectId": detail["projectId"], "candidateId": detail["candidateId"], "score": round(float(scores[i]), 5),
                                "baselineScore": round(float(sample[4][i]), 5), "evidenceNodeIds": evidence_nodes, "evidenceEdgeIds": evidence_edges, "reason": reason})
        # Include all candidates per planned project so the UI can compare and
        # display a top five without hiding low-scoring or rule-preferred options.
        predictions.sort(key=lambda p: (p["projectId"], -p["score"]))
        result["tasks"][task] = {"title": "Equipos para una nueva propuesta" if task == "actor" else "Recursos para reutilizar",
                                  "description": "Ordena equipos candidatos según necesidades y experiencia conectada." if task == "actor" else "Ordena recursos candidatos según necesidades y sus contextos de producción y reutilización.",
                                  "metrics": all_metrics, "runs": runs, "predictions": predictions, "selectedModel": selected_run,
                                  "evaluation": {"queries": args.test_worlds * N_PLAN, "candidatesPerQuery": candidate_count, "positivesPerQuery": 4 if task == "actor" else 3,
                                                 "pairs": int(test["y"].numel()), "metricAggregation": "AP y AUC sobre todos los pares; NDCG, Recall y Precision@3 promediados por consulta. GNN/MLP: media de tres inicializaciones."}}
        checkpoint = HERE / "data" / f"gnn-{task}.pt"
        torch.save({"state_dict": best_model.state_dict(), "featureDim": FEATURE_DIM, "hidden": 32, "task": task, "synthetic": True, "validationNdcgAt3": best_val, "selectedSeed": selected_run["seed"]}, checkpoint)
        state = best_model.state_dict()
        model_export["models"][task] = {"validationNdcgAt3": best_val, "selectedSeed": selected_run["seed"],
                                        **{key: {"weight": state[f"{torch_name}.weight"].tolist(), "bias": state[f"{torch_name}.bias"].tolist()}
                                           for key, torch_name in [("sage1", "layer1"), ("sage2", "layer2"), ("decoder1", "decoder.0"), ("decoder2", "decoder.2")]}}
    result["meta"]["training"]["elapsedSeconds"] = round(time.monotonic() - started, 2)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (HERE / "data" / "gnn-model.json").write_text(json.dumps(model_export, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (HERE / "data" / "gnn-input.json").write_text(json.dumps(inference_input, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Saved {args.output}; CPU seconds={result['meta']['training']['elapsedSeconds']}", flush=True)


if __name__ == "__main__":
    main()
