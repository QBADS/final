from abc import ABC, abstractmethod

import numpy as np


class QuantumFraudModel(ABC):
    """
    Common interface for the three swappable model families
    (Quantum_Engine_Base_Architecture.pdf, Section 05, box "4A. MODEL
    OPTIONS (SWAPPABLE)"). Each wraps a different circuit/training regime
    but presents the same predict_proba surface to the rest of the engine.
    """

    model_type: str
    model_version: str

    @abstractmethod
    def fit(self, x: np.ndarray, y: np.ndarray) -> None: ...

    @abstractmethod
    def predict_proba(self, x: np.ndarray) -> float:
        """Probability (0.0-1.0) that a single feature vector is fraudulent."""

    @abstractmethod
    def circuit_depth(self) -> int: ...
