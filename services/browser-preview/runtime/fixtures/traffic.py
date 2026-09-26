"""Finite 15 by 15 traffic fixture; browser drawing is separate from run()."""


def run(config):
    size = config["parameters"]["grid_size"]
    steps = config["parameters"]["steps"]
    center = size // 2
    snapshots = []
    for frame in range(steps + 1):
        agents = []
        for y in range(size):
            for x in range(size):
                kind = "intersection" if x == center and y == center else "road" if x == center or y == center else "ground"
                agents.append({"id": f"terrain-{x}-{y}", "type": "terrain", "state": kind, "x": x, "y": y})
        for signal, x, y, state in (("north", center, center - 1, "red"), ("south", center, center + 1, "green"), ("west", center - 1, center, "red"), ("east", center + 1, center, "green")):
            agents.append({"id": "signal-" + signal, "type": "signal", "state": state, "x": x, "y": y})
        agents.append({"id": "car-1", "type": "car", "state": "moving", "x": (frame + 1) % size, "y": center})
        snapshots.append({"schemaVersion": "riffology.visual/v0.1", "frame": frame, "time": frame, "space": {"type": "grid", "width": size, "height": size}, "agents": agents, "metrics": {"cars_in_network": 1, "average_speed": 1.0}})
    return {"model": "traffic-python-canvas", "snapshots": snapshots}


def draw(snapshot, canvas, event=None):
    width = 600 / snapshot["space"]["width"]
    height = 420 / snapshot["space"]["height"]
    canvas.clear("#ffffff")
    # Terrain, signals, then cars: same-cell entities remain visible.
    for agent in snapshot["agents"]:
        if agent["type"] == "terrain":
            color = "#6b7280" if agent["state"] == "intersection" else "#3d4651" if agent["state"] == "road" else "#86a873"
            canvas.rect(agent["x"] * width, agent["y"] * height, width, height, color)
    for agent in snapshot["agents"]:
        if agent["type"] == "signal":
            color = "#ef4444" if agent["state"] == "red" else "#22c55e"
            canvas.circle((agent["x"] + 0.5) * width, (agent["y"] + 0.5) * height, 6, color)
    for agent in snapshot["agents"]:
        if agent["type"] == "car":
            canvas.rect((agent["x"] + 0.2) * width, (agent["y"] + 0.25) * height, width * 0.6, height * 0.5, "#facc15")
    if event is not None:
        canvas.circle(event["x"], event["y"], 8, "#a855f7")
