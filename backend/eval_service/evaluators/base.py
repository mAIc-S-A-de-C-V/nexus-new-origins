from dataclasses import dataclass, field
from typing import Any


@dataclass
class EvalResult:
    score: float          # 0.0 – 1.0
    passed: bool
    details: dict = field(default_factory=dict)
