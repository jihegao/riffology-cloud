import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("quality", Path(__file__).resolve().parents[2] / "scripts/research/quality.py")
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


class ResearchQualityTest(unittest.TestCase):
    def test_mesa_double_increment_and_assignment(self):
        for statement in ("self.steps += 1", "self.steps = self.steps + 1"):
            code = "from mesa import Model as Base\nclass Queue(Base):\n def step(self):\n  " + statement
            self.assertEqual(quality.audit_source(code)[0]["code"], "mesa-managed-step-write")

    def test_mesa_alias_and_unrelated_counter(self):
        code = "import mesa as m\nclass Model(m.Model):\n def step(self):\n  self.steps += 1"
        self.assertEqual(len(quality.audit_source(code)), 1)
        self.assertEqual(quality.audit_source("class Counter:\n def step(self):\n  self.steps += 1"), [])
        self.assertEqual(quality.audit_source("from mesa import Model\nclass Q(Model):\n def step(self):\n  self.agents.shuffle_do('step')"), [])

    def test_seed_function_is_not_a_seed_value(self):
        self.assertEqual(quality.audit_source("row = {'seed': self.random.seed}")[0]["code"], "seed-method-value")
        self.assertEqual(quality.audit_source("self.random.seed(7)"), [])
        self.assertEqual(quality.audit_rows([{"seed":"<bound method Random.seed>","steps":50}], [7])[0]["code"], "seed-invalid")

    def test_false_step_counts_and_missing_seeds(self):
        rows = [{"seed":7,"steps":100,"observedUpdates":50}, {"seed":8,"steps":50,"observedUpdates":25}]
        codes = {row["code"] for row in quality.audit_rows(rows, [7,8,9], 50)}
        self.assertEqual(codes, {"step-count-mismatch","step-observation-mismatch","seed-coverage-missing"})
        self.assertEqual(quality.audit_rows([{"seed":7,"steps":50,"observedUpdates":50}], [7], 50), [])

    def test_empty_results_and_boolean_seed_fail(self):
        self.assertEqual(quality.audit_rows([], [7])[0]["code"], "results-empty")
        self.assertEqual(quality.audit_rows([{"seed":True}], [1])[0]["code"], "seed-invalid")

    def test_report_activation_requires_review_even_with_shuffle_call(self):
        for source in ("for a in list(self.agents): a.step()", "self.agents.shuffle_do('step')"):
            result = quality.audit_source(source, "Agents use shuffled activation")
            self.assertEqual(result[-1]["severity"], "review")

    def test_history_is_not_silently_replaced_or_renamed(self):
        before = {"baseline.csv":b"seed,wait\n7,2", "summary.json":b'{"wait":2}'}
        after = {"baseline-renamed.csv":before["baseline.csv"], "summary.json":b'{"wait":0}'}
        self.assertEqual({row["code"] for row in quality.audit_history(before, after)}, {"historical-result-missing","historical-result-overwritten"})
        self.assertEqual(quality.audit_history(before, dict(before, comparison=b"new")), [])

    def test_shell_command_mismatch_does_not_mean_fabricated_numbers(self):
        command = "python -m unittest -v"
        self.assertEqual(quality.command_evidence(command, [command])["status"], "matched")
        for observed in ("cd /workspace\n" + command, "false && " + command, "echo '" + command + "'"):
            result = quality.command_evidence(command, [observed])
            self.assertEqual(result["status"], "review")
            self.assertFalse(result["fabricatedNumericResult"])
        self.assertEqual(quality.command_evidence("python run.py ...", ["python run.py"])["status"], "invalid")


if __name__ == "__main__":
    unittest.main()
