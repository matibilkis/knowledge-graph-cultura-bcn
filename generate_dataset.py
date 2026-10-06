"""Reproducible fictional cultural network; no personal or source material is used."""

import argparse
import json
import random
from pathlib import Path


HERE = Path(__file__).resolve().parent
SEED = 20261005
TERRITORIES = ["Puerto Claro", "Ribera Norte", "Centro Abierto", "Ladera Verde"]
CAPABILITIES = [
    ("c_permisos", "Gestión de permisos", ["permisos", "autorizaciones", "trámites"], "Planificar autorizaciones, responsables y plazos para el uso cultural de espacios."),
    ("c_acceso", "Accesibilidad", ["accesibilidad", "acceso", "inclusión"], "Diseñar recorridos, comunicación y atención para públicos diversos."),
    ("c_logistica", "Logística itinerante", ["logística", "montaje", "sedes móviles"], "Coordinar transporte, montaje y operación en sedes temporales."),
    ("c_documenta", "Documentación", ["documentación", "archivo", "memoria"], "Registrar acuerdos, consentimientos y aprendizajes reutilizables."),
    ("c_mediacion", "Mediación comunitaria", ["mediación", "públicos", "comunidad"], "Construir actividades y acuerdos con colectivos del territorio."),
    ("c_sonido", "Sonido y producción técnica", ["sonido", "audio", "técnica"], "Preparar escucha, proyección y sonorización de actividades."),
    ("c_comunica", "Comunicación cultural", ["comunicación", "difusión", "convocatoria"], "Diseñar convocatorias comprensibles y circuitos de comunicación."),
    ("c_sostenible", "Producción sostenible", ["sostenibilidad", "cuidados ambientales", "reparación"], "Reducir residuos, reparar materiales y organizar compras compartidas."),
]
# id, title, year, territory index, format, required capability indices
PROJECTS = [
    ("p_patio", "Cine al Patio", 2023, 0, "cine", [0, 2, 4]),
    ("p_cauce", "Festival Cauce", 2024, 1, "escénicas", [1, 2, 4]),
    ("p_mapa", "Mapa Sonoro", 2024, 2, "archivo sonoro", [3, 4, 5]),
    ("p_ronda", "Ronda de Oficios", 2025, 3, "talleres", [0, 4, 7]),
    ("p_umbrales", "Umbrales en Movimiento", 2025, 1, "escénicas", [1, 2, 5]),
    ("p_semilla", "Semilla de Barrio", 2022, 3, "talleres", [4, 7]),
    ("p_linternas", "Linternas del Puerto", 2022, 0, "cine", [0, 2, 5]),
    ("p_hilos", "Hilos de Memoria", 2023, 2, "archivo", [3, 4]),
    ("p_huerta", "Huerta de Escenas", 2023, 3, "escénicas", [4, 7]),
    ("p_orillas", "Orillas Abiertas", 2024, 1, "encuentro", [0, 4, 6]),
    ("p_talleres", "Talleres en Red", 2025, 2, "talleres", [3, 6, 7]),
    ("p_nocturno", "Laboratorio Nocturno", 2025, 0, "sonido", [2, 5, 6]),
    ("p_mareas", "Mareas Accesibles", 2026, 0, "cine", [0, 1, 2, 5]),
    ("p_tejido", "Tejido de Memorias", 2026, 2, "archivo", [3, 4, 6]),
    ("p_senderos", "Senderos Compartidos", 2026, 3, "talleres", [1, 4, 7]),
    ("p_puente", "Puente de Orillas", 2026, 1, "encuentro", [0, 6, 7]),
]
# id, name, home territory, capability indices
ACTORS = [
    ("a_mesa", "Mesa de Producción", 0, [0, 2]),
    ("a_trama", "Colectivo Trama", 3, [4, 6]),
    ("a_estacion", "Espacio Estación", 2, [2, 5]),
    ("a_horizonte", "Taller Horizonte", 1, [1, 4]),
    ("a_archivo", "Archivo Vivo", 2, [3, 6]),
    ("a_movil", "Red Móvil", 1, [2, 5]),
    ("a_escuela", "Escuela de Mediación", 3, [4]),
    ("a_faro", "Equipo Faro", 0, [0, 6]),
    ("a_papel", "Taller Papel", 2, [3, 4]),
    ("a_brote", "Colectivo Brote", 3, [4, 7]),
    ("a_sonora", "Cooperativa Sonora", 0, [2, 5]),
    ("a_pasos", "Pasos Abiertos", 1, [1, 2]),
    ("a_nido", "Casa Nido", 3, [1, 4]),
    ("a_lente", "Laboratorio Lente", 2, [3, 5]),
    ("a_enlace", "Mesa Enlace", 1, [0, 4, 6]),
    ("a_circular", "Brigada Circular", 3, [2, 7]),
    ("a_ola", "Taller Ola", 0, [1, 5]),
    ("a_huella", "Archivo Huella", 1, [3, 7]),
    ("a_pixel", "Estudio Píxel", 2, [1, 6]),
    ("a_ruta", "Colectivo Ruta", 0, [0, 2, 7]),
    ("a_puerta", "Puerta Común", 2, [0, 4]),
    ("a_telara", "Red Telar", 3, [3, 6]),
    ("a_marco", "Escena Marco", 1, [2, 5, 6]),
    ("a_tierra", "Tierra Taller", 3, [0, 7]),
    ("a_voz", "Laboratorio Voz", 0, [4, 5]),
    ("a_puerto", "Punto Puerto", 0, [0, 1]),
    ("a_mimbre", "Taller Mimbre", 3, [1, 7]),
    ("a_constela", "Equipo Constela", 2, [3, 6, 7]),
]
# id, title, producer project, documented capacities
RESOURCES = [
    ("r_permisos", "Mapa de permisos", "p_patio", [0]),
    ("r_acceso", "Kit de accesibilidad", "p_cauce", [1]),
    ("r_rider", "Rider de sedes móviles", "p_cauce", [2, 5]),
    ("r_bitacora", "Bitácora de entrevistas", "p_mapa", [3]),
    ("r_mediacion", "Guía de mediación", "p_ronda", [4]),
    ("r_senal", "Señalética que acompaña", "p_cauce", [1, 6]),
    ("r_rutas", "Plan de rutas compartidas", "p_semilla", [2, 7]),
    ("r_luces", "Inventario de montaje ligero", "p_linternas", [2]),
    ("r_cuidados", "Protocolo de bienvenida", "p_huerta", [1, 4]),
    ("r_presupuesto", "Tablero de producción", "p_patio", [0, 2]),
    ("r_audio", "Prueba de escucha en exterior", "p_linternas", [5]),
    ("r_archivo", "Manual de archivo compartido", "p_hilos", [3, 6]),
    ("r_convoca", "Cuaderno de convocatorias", "p_orillas", [4, 6]),
    ("r_voluntarios", "Mapa de turnos y cuidados", "p_orillas", [2, 4]),
    ("r_evalua", "Matriz de aprendizajes", "p_talleres", [3, 7]),
    ("r_repara", "Banco de materiales reparables", "p_semilla", [2, 7]),
    ("r_proyecta", "Guía de proyección accesible", "p_umbrales", [1, 5]),
    ("r_licencias", "Plantilla de acuerdos de archivo", "p_hilos", [0, 3]),
]


def generate(seed=SEED):
    rng = random.Random(seed)
    nodes, edges = [], []
    cap_ids = [c[0] for c in CAPABILITIES]
    project_by_id = {p[0]: p for p in PROJECTS}

    def edge(source, target, kind, label, year):
        if not any(e["source"] == source and e["target"] == target and e["type"] == kind for e in edges):
            edges.append({"id": f"e{len(edges) + 1:03}", "source": source, "target": target, "type": kind, "label": label, "year": year})

    for ident, name, aliases, description in CAPABILITIES:
        nodes.append({"id": ident, "type": "capability", "name": name, "description": description,
                      "aliases": aliases, "facts": ["Capacidad definida para esta red ficticia", "Conecta necesidades, equipos y recursos"]})
    for ident, name, year, territory, fmt, caps in PROJECTS:
        planned = year == 2026
        nodes.append({"id": ident, "type": "project", "name": name, "year": year, "status": "planned" if planned else "completed",
                      "territory": TERRITORIES[territory], "format": fmt, "aliases": [name.lower(), fmt],
                      "requiredCapabilities": [cap_ids[c] for c in caps],
                      "description": f"{'Proyecto en preparación' if planned else 'Proyecto realizado'} de {fmt} en {TERRITORIES[territory]}. Datos completamente ficticios.",
                      "facts": [f"{'Planificado' if planned else 'Realizado'}: {year}", f"Territorio: {TERRITORIES[territory]}",
                                f"Necesita: {', '.join(CAPABILITIES[c][1].lower() for c in caps)}", "Vínculos propuestos sujetos a acuerdos entre equipos"] if planned else
                               [f"Realizado: {year}", f"Territorio: {TERRITORIES[territory]}", f"Formato: {fmt}", "Memoria de proyecto disponible para reutilización"],
                      "scale": rng.choice([0.35, 0.55, 0.75, 0.95]), "outcome": round(rng.uniform(0.62, 0.97), 2) if not planned else None})
        for c in caps:
            edge(ident, cap_ids[c], "requires", "requiere", year)
    for ident, name, territory, caps in ACTORS:
        availability = round(rng.uniform(0.25, 0.95), 2)
        nodes.append({"id": ident, "type": "actor", "name": name, "territory": TERRITORIES[territory], "status": "active",
                      "availability": availability, "reach": rng.choice(["local", "regional"]), "aliases": [name.lower(), name.split()[-1].lower()],
                      "description": f"Equipo ficticio de {TERRITORIES[territory]} con experiencia en {', '.join(CAPABILITIES[c][1].lower() for c in caps)}.",
                      "facts": [f"Base territorial: {TERRITORIES[territory]}", f"Capacidades: {', '.join(CAPABILITIES[c][1] for c in caps)}",
                                f"Disponibilidad simulada para 2026: {round(availability * 100)} / 100", "Contacto simulado: sin datos personales"]})
        for c in caps:
            edge(ident, cap_ids[c], "has_capability", "aporta", 2022)

    # Preserve the original example routes while adding coherent historical collaboration.
    original = [("a_mesa", "p_patio"), ("a_mesa", "p_ronda"), ("a_trama", "p_cauce"), ("a_trama", "p_ronda"),
                ("a_estacion", "p_patio"), ("a_estacion", "p_mapa"), ("a_horizonte", "p_cauce"), ("a_horizonte", "p_umbrales"),
                ("a_archivo", "p_mapa"), ("a_archivo", "p_ronda"), ("a_movil", "p_cauce"), ("a_movil", "p_umbrales"),
                ("a_escuela", "p_mapa"), ("a_escuela", "p_ronda")]
    for actor, project in original:
        edge(actor, project, "participated", "participó", project_by_id[project][2])
    for pid, _, year, territory, _, caps in PROJECTS:
        if year == 2026:
            continue
        ranked = sorted(ACTORS, key=lambda a: len(set(a[3]) & set(caps)) + 0.65 * (a[2] == territory) + rng.random() * 0.8, reverse=True)
        for actor in ranked[:rng.randint(5, 8)]:
            edge(actor[0], pid, "participated", "colaboró", year)

    for ident, name, producer, caps in RESOURCES:
        project = project_by_id[producer]
        quality = round(rng.uniform(0.65, 0.98), 2)
        nodes.append({"id": ident, "type": "resource", "name": name, "year": project[2], "territory": TERRITORIES[project[3]],
                      "status": "available", "quality": quality, "version": "1.0", "aliases": [name.lower(), name.split()[0].lower()],
                      "description": f"Recurso ficticio producido en {project[1]}; documenta {', '.join(CAPABILITIES[c][1].lower() for c in caps)}.",
                      "facts": [f"Producido en: {project[1]} ({project[2]})", f"Documenta: {', '.join(CAPABILITIES[c][1] for c in caps)}",
                                "Licencia de demostración: reutilización simulada", f"Completitud simulada: {round(quality * 100)} / 100"]})
        edge(producer, ident, "produced", "produjo", project[2])
        for c in caps:
            edge(ident, cap_ids[c], "documents", "documenta", project[2])
        for candidate in PROJECTS:
            if project[2] < candidate[2] < 2026 and set(caps) & set(candidate[5]) and rng.random() < 0.52:
                edge(candidate[0], ident, "reused", "reutilizó", candidate[2])
    for project, resource in [("p_ronda", "r_permisos"), ("p_ronda", "r_bitacora"), ("p_umbrales", "r_acceso"), ("p_umbrales", "r_rider")]:
        edge(project, resource, "reused", "reutilizó", project_by_id[project][2])

    # Fact strings reflect generated links; they never claim the ML suggestions already happened.
    by_id = {n["id"]: n for n in nodes}
    for n in nodes:
        if n["type"] == "actor":
            past = [by_id[e["target"]]["name"] for e in edges if e["source"] == n["id"] and e["type"] == "participated"]
            n["facts"].insert(2, f"Colaboraciones registradas: {', '.join(past) if past else 'aún sin proyecto registrado'}")
        elif n["type"] == "resource":
            reused = [by_id[e["source"]]["name"] for e in edges if e["target"] == n["id"] and e["type"] == "reused"]
            n["facts"].append(f"Reutilizado en: {', '.join(reused) if reused else 'aún sin reutilización registrada'}")

    def route(*triples):
        return [e["id"] for e in edges if (e["source"], e["target"], e["type"]) in triples]

    scenarios = [
        {"id": "all", "label": "Toda la red", "question": "¿Cómo circulan capacidades y aprendizajes entre proyectos?", "answer": "La red reúne proyectos realizados entre 2022 y 2025 y cuatro propuestas para 2026. Explorá sus necesidades y la experiencia registrada.", "edge_ids": []},
        {"id": "access", "label": "Accesibilidad", "question": "¿Quién puede ayudar con accesibilidad en una sede nueva?", "answer": "Taller Horizonte aportó accesibilidad a Festival Cauce. Ese proyecto produjo un kit que después reutilizó Umbrales en Movimiento.", "edge_ids": route(("a_horizonte", "p_cauce", "participated"), ("a_horizonte", "c_acceso", "has_capability"), ("p_cauce", "r_acceso", "produced"), ("p_umbrales", "r_acceso", "reused"), ("r_acceso", "c_acceso", "documents"))},
        {"id": "permits", "label": "Permisos", "question": "¿Cómo resolvemos permisos para otro encuentro?", "answer": "Mesa de Producción trabajó en Cine al Patio y aporta gestión de permisos. El mapa creado allí se reutilizó en Ronda de Oficios.", "edge_ids": route(("a_mesa", "p_patio", "participated"), ("a_mesa", "c_permisos", "has_capability"), ("p_patio", "r_permisos", "produced"), ("p_ronda", "r_permisos", "reused"), ("r_permisos", "c_permisos", "documents"))},
        {"id": "memory", "label": "Memoria transferible", "question": "¿Qué aprendizaje pasó de un proyecto a otro?", "answer": "Archivo Vivo documentó Mapa Sonoro. Su bitácora de entrevistas se reutilizó en Ronda de Oficios para registrar decisiones.", "edge_ids": route(("a_archivo", "p_mapa", "participated"), ("a_archivo", "c_documenta", "has_capability"), ("p_mapa", "r_bitacora", "produced"), ("p_ronda", "r_bitacora", "reused"), ("r_bitacora", "c_documenta", "documents"))},
        {"id": "mobile", "label": "Montaje móvil", "question": "¿Qué sirve para montar programación itinerante?", "answer": "Red Móvil participó en Festival Cauce y Umbrales en Movimiento. El rider técnico producido en el primero se reutilizó en el segundo.", "edge_ids": route(("a_movil", "p_cauce", "participated"), ("a_movil", "p_umbrales", "participated"), ("a_movil", "c_logistica", "has_capability"), ("p_cauce", "r_rider", "produced"), ("p_umbrales", "r_rider", "reused"), ("r_rider", "c_logistica", "documents"))},
    ]
    return {"meta": {"title": "Red cultural ficticia SINC", "fictional": True, "seed": seed, "version": "2.0", "territories": TERRITORIES,
                     "years": [2022, 2023, 2024, 2025, 2026], "description": "Todos los proyectos, equipos, vínculos, métricas y territorios son inventados para esta demostración.",
                     "counts": {"projects": len(PROJECTS), "actors": len(ACTORS), "capabilities": len(CAPABILITIES), "resources": len(RESOURCES)}},
            "nodes": nodes, "edges": edges, "scenarios": scenarios}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--output", type=Path, default=HERE / "data" / "graph.json")
    args = parser.parse_args()
    graph = generate(args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{args.output}: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges; seed={args.seed}")


if __name__ == "__main__":
    main()
