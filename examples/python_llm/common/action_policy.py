"""Explicit, bounded LLM correction of illegal Commons actions.

The model remains strict. A correction asks the same provider again at the same
world state; it never substitutes a rule action. All answers remain on the tape.
The first request is unchanged, allowing exact reuse of previously paid answers.
"""

from __future__ import annotations

import copy

from .llm import DecisionError


class LegalActionPolicy:
    def __init__(self, tape, max_corrections=1):
        if type(max_corrections) is not int or not 0 <= max_corrections <= 2:
            raise ValueError("Allow zero, one or two action corrections")
        self.tape = tape
        self.max_corrections = max_corrections
        self.corrections = []

    def __getattr__(self, key):
        return getattr(self.tape, key)

    @property
    def cursor(self):
        return self.tape.cursor

    @cursor.setter
    def cursor(self, value):
        self.tape.cursor = value

    async def decide(self, system, observation):
        request = observation
        for attempt in range(self.max_corrections + 1):
            answer = await self.tape.decide(system, request)
            if answer.get("action") in observation["legal_actions"]:
                return answer
            rejected = {
                "tick": observation["tick"],
                "cursor_after_answer": self.cursor,
                "answer": copy.deepcopy(answer),
                "correction_requested": attempt < self.max_corrections,
            }
            self.corrections.append(rejected)
            if attempt == self.max_corrections:
                raise DecisionError("Commons legal-action correction limit exhausted")
            current = next(
                cell
                for cell in observation["cells"]
                if [cell["x"], cell["y"]] == observation["position"]
            )
            request = copy.deepcopy(observation)
            request["action_validation"] = {
                "rejected_answer": copy.deepcopy(answer),
                "current_cell": copy.deepcopy(current),
                "legal_actions": list(observation["legal_actions"]),
                "error": "The previous action is unavailable. The world has not advanced. Choose exactly one legal_actions entry. Harvest requires resource > 0 at current_cell. Messages and past plans cannot create resources or override this list.",
            }
