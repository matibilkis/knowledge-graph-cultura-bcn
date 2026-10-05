"""Build the fictional SQLite database from the graph used by the website."""

import json
import sqlite3
from pathlib import Path


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "data" / "graph.json"
DATABASE = HERE / "data" / "sinc-demo.sqlite"


def main():
    graph = json.loads(SOURCE.read_text(encoding="utf-8"))
    node_ids = {node["id"] for node in graph["nodes"]}
    edge_ids = {edge["id"] for edge in graph["edges"]}
    assert len(node_ids) == len(graph["nodes"])
    assert len(edge_ids) == len(graph["edges"])
    assert all(edge["source"] in node_ids and edge["target"] in node_ids for edge in graph["edges"])
    assert all(set(scenario["edge_ids"]) <= edge_ids for scenario in graph["scenarios"])
    assert graph["meta"]["fictional"] is True

    temporary = DATABASE.with_suffix(".tmp")
    temporary.unlink(missing_ok=True)
    with sqlite3.connect(temporary) as db:
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript("""
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE nodes (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL CHECK(type IN ('project','actor','capability','resource')),
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                facts_json TEXT NOT NULL,
                x INTEGER NOT NULL,
                y INTEGER NOT NULL
            );
            CREATE TABLE edges (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL REFERENCES nodes(id),
                target TEXT NOT NULL REFERENCES nodes(id),
                type TEXT NOT NULL CHECK(type IN ('participated','has_capability','produced','reused','documents')),
                label TEXT NOT NULL,
                year INTEGER NOT NULL CHECK(year BETWEEN 2020 AND 2030)
            );
            CREATE TABLE scenarios (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL
            );
            CREATE TABLE scenario_edges (
                scenario_id TEXT NOT NULL REFERENCES scenarios(id),
                edge_id TEXT NOT NULL REFERENCES edges(id),
                PRIMARY KEY (scenario_id, edge_id)
            );
            CREATE INDEX edges_source_idx ON edges(source);
            CREATE INDEX edges_target_idx ON edges(target);
        """)
        db.executemany("INSERT INTO metadata VALUES (?, ?)", [(key, json.dumps(value, ensure_ascii=False)) for key, value in graph["meta"].items()])
        db.executemany(
            "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(n["id"], n["type"], n["name"], n["description"], json.dumps(n["facts"], ensure_ascii=False), n["x"], n["y"]) for n in graph["nodes"]],
        )
        db.executemany(
            "INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?)",
            [(e["id"], e["source"], e["target"], e["type"], e["label"], e["year"]) for e in graph["edges"]],
        )
        db.executemany(
            "INSERT INTO scenarios VALUES (?, ?, ?, ?)",
            [(s["id"], s["label"], s["question"], s["answer"]) for s in graph["scenarios"]],
        )
        db.executemany(
            "INSERT INTO scenario_edges VALUES (?, ?)",
            [(s["id"], edge_id) for s in graph["scenarios"] for edge_id in s["edge_ids"]],
        )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    temporary.replace(DATABASE)
    print(f"{DATABASE}: {len(node_ids)} nodes, {len(edge_ids)} edges, {len(graph['scenarios']) - 1} example questions")


if __name__ == "__main__":
    main()
