import importlib.util
import json
import pathlib
import sys
import types
import unittest
from collections import deque

ROOT = pathlib.Path(__file__).resolve().parents[2]

class Return:
    def __init__(self, value): self.calldata = value

class MandateTests(unittest.TestCase):
    def setUp(self):
        self.answers = deque()
        def prompt(*args, **kwargs): return self.answers.popleft()
        def consensus(leader, validator):
            result = leader()
            if not validator(Return(result)): raise RuntimeError("Independent validators disagreed")
            return result
        sdk = types.ModuleType("genlayer")
        sdk.gl = types.SimpleNamespace(Contract=object, message=types.SimpleNamespace(sender_address="operator"),
            public=types.SimpleNamespace(view=lambda f:f, write=lambda f:f),
            nondet=types.SimpleNamespace(exec_prompt=prompt),
            vm=types.SimpleNamespace(Return=Return, run_nondet_unsafe=consensus), UserError=ValueError)
        sdk.TreeMap = dict
        sdk.Address = str
        sdk.u256 = int
        sdk.__all__ = ["gl", "TreeMap", "Address", "u256"]
        sys.modules["genlayer"] = sdk
        spec = importlib.util.spec_from_file_location("mandate", ROOT / "governance/AgentMandate.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.contract = self.module.AgentMandate()
        self.contract.policies = {}
        self.contract.versions = {}
        self.contract.decisions = {}
        self.hash = "0x" + "a" * 64
        self.rid = "0x" + "b" * 64
        self.contract.register_policy("vault", "agent", 1, self.hash, "Only research APIs.")
        self.key = "vault:agent:1"
        self.payload = json.dumps({"service":"Dataset API", "purpose":"Research a market", "evidence":"Invoice includes research data"})

    def evaluate(self):
        return self.contract.evaluate(self.rid, self.key, self.hash, self.payload)

    def test_approved_record_is_bound_to_policy_and_request(self):
        self.answers.extend([{"status":"approved","reason":"The research data API serves the research mandate."}] * 2 + [{"grounded":True}])
        self.evaluate()
        decision = json.loads(self.contract.get_decision(self.rid))
        self.assertEqual(decision["status"], "approved")
        self.assertEqual(decision["request_hash"], self.hash)
        self.assertEqual(decision["mandate_hash"], self.hash)
        self.assertEqual(decision["policy_version"], 1)

    def test_independent_disagreement_cannot_create_approval(self):
        self.answers.extend([{"status":"approved","reason":"Research"},{"status":"rejected","reason":"Unrelated"}])
        with self.assertRaises(RuntimeError): self.evaluate()
        self.assertNotIn(self.rid, self.contract.decisions)

    def test_malformed_model_result_fails_closed(self):
        self.answers.append({"approved": "yes"})
        with self.assertRaises(ValueError): self.evaluate()
        self.assertNotIn(self.rid, self.contract.decisions)

    def test_needs_information_is_preserved(self):
        self.answers.extend([{"status":"needs_information","reason":"No invoice evidence supports service relevance."}] * 2 + [{"grounded":True}])
        self.evaluate()
        self.assertEqual(json.loads(self.contract.get_decision(self.rid))["status"], "needs_information")

    def test_duplicate_decision_rejected(self):
        self.answers.extend([{"status":"rejected","reason":"Unrelated subscription."}] * 2 + [{"grounded":True}])
        self.evaluate()
        with self.assertRaises(ValueError): self.evaluate()

    def test_versions_are_immutable_and_monotonic(self):
        self.contract.register_policy("vault", "agent", 2, self.hash, "Research datasets only.")
        self.assertEqual(json.loads(self.contract.get_policy(self.key))["text"], "Only research APIs.")
        with self.assertRaises(ValueError):
            self.contract.register_policy("vault", "agent", 1, self.hash, "Overwrite")

    def test_operator_only(self):
        self.module.gl.message.sender_address = "attacker"
        with self.assertRaises(ValueError): self.evaluate()
        with self.assertRaises(ValueError):
            self.contract.register_policy("vault", "agent", 2, self.hash, "Research")

    def test_fabricated_explanation_fails_independent_grounding(self):
        self.answers.extend([{"status":"approved","reason":"Vendor was externally audited and verified."},
                             {"status":"approved","reason":"The research service matches the mandate."},
                             {"grounded":False}])
        with self.assertRaises(RuntimeError): self.evaluate()
        self.assertNotIn(self.rid, self.contract.decisions)

    def test_invalid_request_is_not_sent_to_model(self):
        self.payload = json.dumps({"service":"API", "purpose":"", "evidence":""})
        with self.assertRaises(ValueError): self.evaluate()
        self.assertEqual(len(self.answers), 0)

if __name__ == "__main__": unittest.main()
