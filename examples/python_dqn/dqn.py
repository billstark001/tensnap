# Reference:
# - PyTorch DQN tutorial: https://docs.pytorch.org/tutorials/intermediate/reinforcement_q_learning.html

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import random
from typing import Deque, NamedTuple

import torch
from torch import nn

from .config import DQNConfig


class Transition(NamedTuple):
    state: torch.Tensor
    action: int
    reward: float
    next_state: torch.Tensor
    done: bool


class ReplayBuffer:
    def __init__(self, capacity: int) -> None:
        self._buffer: Deque[Transition] = deque(maxlen=capacity)

    def add(self, transition: Transition) -> None:
        self._buffer.append(transition)

    def sample(self, batch_size: int) -> list[Transition]:
        return random.sample(self._buffer, batch_size)

    def __len__(self) -> int:
        return len(self._buffer)


class QNetwork(nn.Module):
    def __init__(self, state_dim: int, action_dim: int, hidden_dim: int) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, action_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


@dataclass(slots=True)
class OptimizationStats:
    loss: float
    epsilon: float


class DQNAgent:
    def __init__(
        self, state_dim: int, action_dim: int, config: DQNConfig, device: torch.device
    ) -> None:
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.config = config
        self.device = device
        self.policy_net = QNetwork(state_dim, action_dim, config.hidden_dim).to(device)
        self.target_net = QNetwork(state_dim, action_dim, config.hidden_dim).to(device)
        self.target_net.load_state_dict(self.policy_net.state_dict())
        self.target_net.eval()
        self.optimizer = torch.optim.Adam(self.policy_net.parameters(), lr=config.lr)
        self.buffer = ReplayBuffer(config.buffer_size)
        self.total_steps = 0

    def select_action(self, state: torch.Tensor, greedy: bool = False) -> int:
        epsilon = 0.0 if greedy else self.current_epsilon()
        self.total_steps += 1
        if random.random() < epsilon:
            return random.randrange(self.action_dim)
        with torch.no_grad():
            q_values = self.policy_net(state.to(self.device).unsqueeze(0))
            return int(q_values.argmax(dim=1).item())

    def current_epsilon(self) -> float:
        progress = min(1.0, self.total_steps / max(1, self.config.epsilon_decay_steps))
        return self.config.epsilon_start + progress * (
            self.config.epsilon_end - self.config.epsilon_start
        )

    def store(
        self,
        state: torch.Tensor,
        action: int,
        reward: float,
        next_state: torch.Tensor,
        done: bool,
    ) -> None:
        self.buffer.add(Transition(state, action, reward, next_state, done))

    def optimize(self) -> OptimizationStats | None:
        if len(self.buffer) < max(self.config.batch_size, self.config.warmup_steps):
            return None
        batch = self.buffer.sample(self.config.batch_size)
        states = torch.stack([t.state for t in batch]).to(self.device)
        actions = torch.tensor(
            [t.action for t in batch], dtype=torch.long, device=self.device
        ).unsqueeze(1)
        rewards = torch.tensor(
            [t.reward for t in batch], dtype=torch.float32, device=self.device
        ).unsqueeze(1)
        next_states = torch.stack([t.next_state for t in batch]).to(self.device)
        dones = torch.tensor(
            [t.done for t in batch], dtype=torch.float32, device=self.device
        ).unsqueeze(1)

        current_q = self.policy_net(states).gather(1, actions)
        with torch.no_grad():
            next_q = self.target_net(next_states).max(dim=1, keepdim=True).values
            target_q = rewards + self.config.gamma * next_q * (1.0 - dones)

        loss = nn.functional.smooth_l1_loss(current_q, target_q)
        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(
            self.policy_net.parameters(), self.config.gradient_clip_norm
        )
        self.optimizer.step()

        if self.total_steps % self.config.target_sync_interval == 0:
            self.target_net.load_state_dict(self.policy_net.state_dict())

        return OptimizationStats(
            loss=float(loss.item()), epsilon=self.current_epsilon()
        )

    def save(self, path: str) -> None:
        payload = {
            "policy": self.policy_net.state_dict(),
            "target": self.target_net.state_dict(),
            "optimizer": self.optimizer.state_dict(),
            "total_steps": self.total_steps,
            "config": self.config.__dict__,
        }
        torch.save(payload, path)

    def load(self, path: str) -> None:
        payload = torch.load(path, map_location=self.device)
        self.policy_net.load_state_dict(payload["policy"])
        self.target_net.load_state_dict(payload["target"])
        self.optimizer.load_state_dict(payload["optimizer"])
        self.total_steps = int(payload.get("total_steps", 0))
