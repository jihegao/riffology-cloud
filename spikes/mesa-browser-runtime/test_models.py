"""Run with Python and mesa==3.5.1 installed; no browser fixtures are used."""
import json
from pathlib import Path
import unittest


def load_model():
    namespace = {"riffology_config_json": json.dumps({"seed": 7, "steps": 40})}
    exec((Path(__file__).parent / "models/schelling.py").read_text(), namespace)
    return namespace


class SchellingRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = load_model()

    def test_metrics_match_emitted_positions_across_seeds_and_homophily(self):
        for seed in [1, 7, 19]:
            for homophily in [0.2, 0.5, 0.8]:
                with self.subTest(seed=seed, homophily=homophily):
                    trace = self.model["run"]({"seed": seed, "steps": 12, "parameters": {"homophily": homophily}})
                    for frame in trace["snapshots"]:
                        agents = frame["agents"]
                        occupied = {(a["x"], a["y"]): a["state"] for a in agents}
                        width, height = frame["space"]["width"], frame["space"]["height"]
                        unhappy = 0
                        for agent in agents:
                            neighbors = [occupied[pos] for dx in [-1, 0, 1] for dy in [-1, 0, 1]
                                         if (dx, dy) != (0, 0)
                                         and (pos := ((agent["x"] + dx) % width, (agent["y"] + dy) % height)) in occupied]
                            if neighbors and neighbors.count(agent["state"]) / len(neighbors) < homophily:
                                unhappy += 1
                        self.assertEqual(frame["metrics"]["unhappy"], unhappy)
                        self.assertEqual(frame["metrics"]["population"], len(agents))
                        self.assertAlmostEqual(frame["metrics"]["happy_fraction"], 1 - unhappy / len(agents))
                    if len(trace["snapshots"]) < 13:
                        self.assertEqual(trace["snapshots"][-1]["metrics"]["unhappy"], 0)

    def test_seeded_replay_and_zero_homophily(self):
        config = {"seed": 7, "steps": 40}
        self.assertEqual(self.model["run"](config), self.model["run"](config))
        self.assertNotEqual(self.model["run"](config), self.model["run"]({"seed": 8, "steps": 40}))
        trace = self.model["run"]({"seed": 7, "parameters": {"homophily": 0}})
        self.assertEqual(len(trace["snapshots"]), 2)
        self.assertTrue(all(frame["metrics"]["unhappy"] == 0 for frame in trace["snapshots"]))

    def test_empty_population_is_fully_happy(self):
        empty = self.model["SchellingModel"](width=4, height=4, density=0, seed=7)
        frame = self.model["snapshot"](empty, 0)
        self.assertEqual(frame["metrics"], {"population": 0, "unhappy": 0, "happy_fraction": 1.0})


if __name__ == "__main__":
    unittest.main()
