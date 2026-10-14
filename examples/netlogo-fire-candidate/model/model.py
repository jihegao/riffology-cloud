"""Source-derived local adaptation of Uri Wilensky's NetLogo Fire (1997).

Reviewed upstream NetLogo 7.0.4 model SHA-256:
0a2420e463481fb2cd7791aacdc068735db0d900c14d3fece0a93a085246b171
Copyright 1997 Uri Wilensky. The upstream model and this adaptation are
licensed CC BY-NC-SA 3.0: https://creativecommons.org/licenses/by-nc-sa/3.0/
No commercial permission or per-seed source equivalence is asserted.
"""
import random


WIDTH = 31
HEIGHT = 31
EMBER_START = 15.0
EMBER_FADE = 0.3
EMBER_CUTOFF = 11.5


def _validate(config):
    if type(config) is not dict or set(config) != {"parameters", "seed"}:
        raise ValueError("invalid-config")
    parameters = config["parameters"]
    seed = config["seed"]
    if type(parameters) is not dict or set(parameters) != {"density_percent", "steps"}:
        raise ValueError("invalid-parameters")
    density = parameters["density_percent"]
    steps = parameters["steps"]
    if type(density) is not int or density < 0 or density > 99:
        raise ValueError("invalid-density-percent")
    if type(steps) is not int or steps < 1 or steps > 80:
        raise ValueError("invalid-steps")
    if type(seed) is not int or seed < 0 or seed > 4294967295:
        raise ValueError("invalid-seed")
    return density, steps, seed


def _setup(density_percent, seed, width=WIDTH, height=HEIGHT):
    rng = random.Random(seed)
    green = set()
    for y in range(height):
        for x in range(width):
            if rng.random() * 100.0 < density_percent:
                green.add((x, y))
    fires = {(0, y) for y in range(height)}
    green.difference_update(fires)
    burned = set(fires)
    return green, fires, {}, burned, len(green), 0


def _advance(green, fires, embers, burned, burned_trees, width, height):
    next_fires = set()
    for x, y in sorted(fires):
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and (nx, ny) in green:
                green.remove((nx, ny))
                next_fires.add((nx, ny))
                burned.add((nx, ny))
                burned_trees += 1
    fading = dict(embers)
    for position in fires:
        fading[position] = EMBER_START
    next_embers = {}
    for position, color in fading.items():
        faded = color - EMBER_FADE
        if faded >= EMBER_CUTOFF:
            next_embers[position] = faded
    return next_fires, next_embers, burned_trees


def _snapshot(frame, green, fires, embers, burned, initial_trees, burned_trees, width, height):
    agents = []
    for x, y in sorted(green | burned):
        if (x, y) in fires:
            state = "fire"
        elif (x, y) in embers:
            state = "ember"
        elif (x, y) in green:
            state = "tree"
        else:
            state = "burned"
        agents.append({"id": "cell-%d-%d" % (x, y), "type": "forest-cell", "state": state, "x": x, "y": y})
    burn_fraction = 0.0 if initial_trees == 0 else burned_trees * 100.0 / initial_trees
    return {
        "schemaVersion": "riffology.visual/v0.1",
        "frame": frame,
        "time": float(frame),
        "space": {"type": "grid", "width": width, "height": height},
        "agents": agents,
        "metrics": {
            "initial_trees": initial_trees,
            "burned_trees": burned_trees,
            "active_fires": len(fires),
            "trees_remaining": len(green),
            "burn_fraction_pct": burn_fraction,
        },
    }


def run(config):
    density, steps, seed = _validate(config)
    green, fires, embers, burned, initial_trees, burned_trees = _setup(density, seed)
    snapshots = [_snapshot(0, green, fires, embers, burned, initial_trees, burned_trees, WIDTH, HEIGHT)]
    for frame in range(1, steps + 1):
        if not fires and not embers:
            break
        fires, embers, burned_trees = _advance(green, fires, embers, burned, burned_trees, WIDTH, HEIGHT)
        snapshots.append(_snapshot(frame, green, fires, embers, burned, initial_trees, burned_trees, WIDTH, HEIGHT))
    return {"model": "netlogo-fire-7.0.4-python-adaptation", "snapshots": snapshots}


def draw(snapshot, canvas, event=None):
    canvas.clear("#111111")
    width = snapshot["space"]["width"]
    height = snapshot["space"]["height"]
    cell = min(400.0 / width, 400.0 / height)
    left = (600.0 - cell * width) / 2.0
    top = (420.0 - cell * height) / 2.0
    canvas.rect(left, top, cell * width, cell * height, "#1c1c1c")
    colors = {"tree": "#2e9d45", "fire": "#ff2b20", "ember": "#d96b2b", "burned": "#3b2a20"}
    for agent in snapshot["agents"]:
        canvas.rect(left + agent["x"] * cell, top + (height - agent["y"] - 1) * cell,
                    max(1.0, cell - 0.35), max(1.0, cell - 0.35), colors[agent["state"]])
