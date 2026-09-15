import json

from mesa import Agent, Model
from mesa.space import SingleGrid


class Resident(Agent):
    def __init__(self, model, group):
        super().__init__(model)
        self.group = group


class SchellingModel(Model):
    def __init__(self, width=20, height=14, density=0.82, minority_fraction=0.35, homophily=0.5, seed=1):
        super().__init__(seed=seed)
        self.grid = SingleGrid(width, height, torus=True)
        self.homophily = float(homophily)
        for cell in self.grid.coord_iter():
            _, pos = cell
            if self.random.random() >= density:
                continue
            group = 1 if self.random.random() < minority_fraction else 0
            agent = Resident(self, group)
            self.grid.place_agent(agent, pos)

    def is_happy(self, agent):
        neighbors = self.grid.get_neighbors(agent.pos, moore=True, include_center=False)
        if not neighbors:
            return True
        similar = sum(1 for other in neighbors if other.group == agent.group)
        return similar / len(neighbors) >= self.homophily

    def step(self):
        unhappy = [agent for agent in list(self.agents) if not self.is_happy(agent)]
        self.random.shuffle(unhappy)
        for agent in unhappy:
            # Stable ordering keeps seeded choices independent of set hashing
            # on native Python versus Pyodide's wasm runtime.
            empties = sorted(self.grid.empties)
            if not empties:
                break
            self.grid.move_agent(agent, self.random.choice(empties))


def snapshot(model, frame):
    unhappy = sum(1 for agent in model.agents if not model.is_happy(agent))
    agents = []
    for agent in model.agents:
        x, y = agent.pos
        agents.append({
            "id": str(agent.unique_id),
            "type": "resident",
            "state": "group-b" if agent.group else "group-a",
            "x": x,
            "y": y,
        })
    count = max(1, len(agents))
    return {
        "schemaVersion": "riffology.visual/v0.1",
        "frame": frame,
        "time": float(frame),
        "space": {
            "type": "grid",
            "width": model.grid.width,
            "height": model.grid.height,
        },
        "agents": agents,
        "metrics": {
            "population": len(agents),
            "unhappy": unhappy,
            "happy_fraction": (len(agents) - unhappy) / count if agents else 1.0,
        },
    }


def run(config):
    params = config.get("parameters", {})
    steps = params["steps"]
    model = SchellingModel(
        width=max(4, min(int(params.get("width", 20)), 60)),
        height=max(4, min(int(params.get("height", 14)), 60)),
        density=max(0.05, min(float(params.get("density", 0.82)), 0.98)),
        minority_fraction=max(0.0, min(float(params.get("minority_fraction", 0.35)), 1.0)),
        homophily=max(0.0, min(float(params.get("homophily", 0.5)), 1.0)),
        seed=int(config.get("seed", 1)),
    )
    snapshots = [snapshot(model, 0)]
    for frame in range(1, steps + 1):
        model.step()
        snapshots.append(snapshot(model, frame))
        if snapshots[-1]["metrics"]["unhappy"] == 0:
            break
    return {"model": "mesa-schelling", "snapshots": snapshots}

