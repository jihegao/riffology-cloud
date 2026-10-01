"""Small seeded forest; the release's draw example is appended by makeFixture."""
import random


def run(config):
    parameters = config["parameters"]
    width, height = parameters["width"], parameters["height"]
    rng = random.Random(config["seed"])
    states = {(1, 0): "healthy", (2, 0): "healthy", (3, 0): "burning"}
    for y in range(1, height):
        for x in range(width):
            if rng.random() < parameters["density"]:
                states[(x, y)] = "healthy"
    snapshots = []
    for frame in range(parameters["steps"] + 1):
        metrics = {state + "_trees": sum(value == state for value in states.values())
                   for state in ("healthy", "burning", "burned")}
        metrics["empty_tiles"] = width * height - len(states)
        agents = [{"id": f"tree-{x}-{y}", "type": "tree", "state": state, "x": x, "y": y}
                  for (x, y), state in sorted(states.items())]
        snapshots.append({"schemaVersion": "riffology.visual/v0.1", "frame": frame,
                          "time": frame, "space": {"type": "grid", "width": width, "height": height},
                          "agents": agents, "metrics": metrics})
        updated = {}
        for (x, y), state in states.items():
            neighbors = ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
            updated[(x, y)] = "burned" if state == "burning" else "burning" if state == "healthy" and any(
                states.get(position) == "burning" for position in neighbors) else state
        states = updated
    return {"model": "forest-fire-python-canvas", "snapshots": snapshots}
