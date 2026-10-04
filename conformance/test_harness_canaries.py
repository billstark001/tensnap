"""Intentional corruptions prove that probe assertions fail closed."""

import copy
import unittest

from run_matrix import (
    apply_agent_frames,
    population_counts,
    require_agent_projection,
    require_action_order,
    require_full_digest,
    require_future_replay,
    require_identity,
    require_one_transition,
    require_parameter_correction,
    require_population_observations,
)


class HarnessCanaries(unittest.TestCase):
    def test_wrong_handshake_model_is_detected(self):
        info = {
            "protocol_version": "0.3",
            "model": {"id": "wrong.model", "state_schema_version": "1"},
            "binding": {"name": "tensnap-python", "version": "0.3.1"},
            "instance_id": "one",
            "capabilities": ["monitor", "scene.restore.projected", "scene.restore.checkpoint"],
        }
        with self.assertRaises(AssertionError):
            require_identity(info, "python")

    def test_double_transition_is_detected(self):
        before = {"steps": 1, "rng": 7, "queue": [1, 2, 3]}
        after = {"steps": 3, "rng": 8, "queue": [2, 3, 4]}
        with self.assertRaises(AssertionError):
            require_one_transition(before, after)

    def test_result_before_state_is_detected(self):
        messages = [
            {"type": "action_result", "payload": {"id": "step", "request_id": "one"}},
            {"type": "metadata_update", "payload": {"time": 1}},
        ]
        with self.assertRaises(AssertionError):
            require_action_order(messages, "one", accepted=True)

    def test_private_rng_mismatch_is_detected(self):
        before = {"x": 1, "steps": 1, "rng": 7, "queue": [1, 2], "speed": 1}
        after = {**before, "rng": 8}
        with self.assertRaises(AssertionError):
            require_full_digest(before, after)

    def test_wrong_parameter_correction_is_detected(self):
        with self.assertRaises(AssertionError):
            require_parameter_correction({"type": "param_sync", "payload": {"id": "speed", "value": 9}}, 5)

    def test_future_private_queue_divergence_is_detected(self):
        first = [{"host": {"x": 1, "queue": [2, 3]}, "observed": {"position": [1]}}]
        second = copy.deepcopy(first)
        second[0]["host"]["queue"] = [2, 4]
        with self.assertRaises(AssertionError):
            require_future_replay(first, second)

    def test_duplicate_agent_identity_is_detected(self):
        state = {"agents": [
            {"id": 7, "x": 0, "y": 0, "health": "S"},
            {"id": 7, "x": 1, "y": 0, "health": "I"},
        ], "base_population": 2, "births": 0, "deaths": 0}
        with self.assertRaises(AssertionError):
            population_counts(state)

    def test_out_of_order_population_delta_is_detected(self):
        messages = [{"type": "item_update", "payload": {
            "env_id": "study", "layer_id": "agents", "items": [{"id": 8, "x": 2}]}}]
        with self.assertRaises(AssertionError):
            apply_agent_frames({}, messages)

    def test_incorrect_spatial_projection_is_detected(self):
        state = {"agents": [{"id": 8, "x": 2, "y": 3, "health": "I"}]}
        projected = {8: {"id": 8, "x": 2, "y": 4, "color": "#e74c3c", "data": {"health": "I"}}}
        with self.assertRaises(AssertionError):
            require_agent_projection(projected, state)

    def test_incorrect_grouped_chart_count_is_detected(self):
        state = {"agents": [{"id": 8, "x": 2, "y": 3, "health": "I"}],
                 "base_population": 1, "births": 0, "deaths": 0}
        messages = [
            {"type": "chart_update", "payload": {"updates": [
                {"id": "susceptible", "value": 0}, {"id": "infected", "value": 0},
                {"id": "recovered", "value": 0}]}},
            {"type": "monitor_update", "payload": {"id": "population", "value": 1}},
        ]
        with self.assertRaises(AssertionError):
            require_population_observations(messages, state)


if __name__ == "__main__":
    unittest.main()
