"""
Genuine validation that QBADS's actual champion VQC fraud model - the same
feature map, ansatz, and FITTED weights the live quantum-pipeline service
trains at startup - runs correctly on real IBM Quantum hardware, and
produces a comparable measured probability to the local simulator for the
identical input.

This does NOT change how the live service scores transactions -
execution_manager.py / BACKEND_MODE are untouched (see
app/providers/base.py's module docstring for why real IBM hardware is kept
out of the live per-transaction path). This is a one-off, opt-in proof that
VQC's real circuit + real trained weights are IBM-hardware-compatible.

Opt-in, manual, costs real IBM Cloud quota - gated by LIVE_IBM_TEST=1,
never picked up by pytest, never run automatically.

Usage:
    LIVE_IBM_TEST=1 IBM_QUANTUM_API_KEY=... IBM_QUANTUM_CRN=... \
      ./.venv/Scripts/python scripts/live_ibm_vqc_validation.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.bootstrap_data import generate_bootstrap_dataset  # noqa: E402
from app.config import settings  # noqa: E402
from app.models.vqc import VQCModel  # noqa: E402


def parity_class(bitstring: str) -> int:
    """
    qiskit-machine-learning's VQC defaults to a parity interpret function
    for binary classification (popcount mod 2) - the standard mapping used
    throughout Qiskit's own VQC documentation/examples - so measured
    bitstrings are bucketed into class 0/1 the same way VQC.predict_proba
    does internally.
    """
    return bin(int(bitstring, 2)).count("1") % 2


def main() -> None:
    if os.environ.get("LIVE_IBM_TEST") != "1":
        print("Refusing to run: set LIVE_IBM_TEST=1 to confirm you want to use real IBM Cloud quota.")
        sys.exit(1)

    api_key = os.environ.get("IBM_QUANTUM_API_KEY")
    crn = os.environ.get("IBM_QUANTUM_CRN")
    if not api_key or not crn:
        print("IBM_QUANTUM_API_KEY and IBM_QUANTUM_CRN must both be set.")
        sys.exit(1)

    # Imported lazily so the rest of quantum-pipeline never needs this
    # dependency - qiskit-ibm-runtime is only required to run this script.
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

    print("=== Step 1: reproducing the live champion VQC model locally ===")
    print(f"(same bootstrap data/training code path as registry.train_all(), BOOTSTRAP_SEED={settings.bootstrap_seed})")
    x, y = generate_bootstrap_dataset()
    model = VQCModel()
    model.fit(x, y)
    print(f"trained VQC model_version={model.model_version}, circuit_depth={model.circuit_depth()}, qubits={settings.feature_dimension}")

    test_vector = x[0]  # a real bootstrap sample, not a synthetic placeholder
    local_proba = model.predict_proba(test_vector)
    print(f"local simulator predict_proba(test_vector) = {local_proba:.4f}")

    print("\n=== Step 2: building the exact same bound circuit for real hardware ===")
    feature_map = model._feature_map
    ansatz = model._ansatz
    weights = model._vqc.weights
    circuit = feature_map.compose(ansatz)
    # Bind by Parameter object, not position - a composed circuit's
    # .parameters is sorted by name, NOT "feature params then weight
    # params", so a plain assign_parameters(list) would silently bind the
    # wrong values to the wrong parameters.
    param_values = dict(zip(feature_map.parameters, test_vector))
    param_values.update(dict(zip(ansatz.parameters, weights)))
    bound = circuit.assign_parameters(param_values)
    bound.measure_all()

    print("\n!!! Connecting to real IBM Quantum Cloud - this will use real quota !!!")
    service = QiskitRuntimeService(channel="ibm_quantum_platform", token=api_key, instance=crn)
    backend = service.least_busy(operational=True, simulator=False)
    print(f"selected backend: {backend.name} (pending_jobs={backend.status().pending_jobs})")

    print("\n=== Step 3: transpiling to the backend's real instruction set (ISA) ===")
    pm = generate_preset_pass_manager(optimization_level=1, backend=backend)
    isa_circuit = pm.run(bound)
    print(f"transpiled depth={isa_circuit.depth()}, ops={dict(isa_circuit.count_ops())}")

    print("\n=== Step 4: submitting the real job (never auto-retried - one attempt) ===")
    sampler = SamplerV2(mode=backend)
    job = sampler.run([isa_circuit], shots=settings.shots)
    print(f"job id: {job.job_id()}  status: {job.status()}")
    print("waiting for completion (queue time varies from seconds to hours)...")
    result = job.result()

    counts = result[0].data.meas.get_counts()
    total = sum(counts.values())
    class1 = sum(c for bits, c in counts.items() if parity_class(bits) == 1)
    hardware_proba = class1 / total

    print("\n=== RESULT ===")
    print(f"backend:                       {backend.name}")
    print(f"shots:                         {total}")
    print(f"local simulator probability:  {local_proba:.4f}")
    print(f"real IBM hardware probability: {hardware_proba:.4f}")
    print(f"difference:                    {abs(local_proba - hardware_proba):.4f}  (nonzero is expected - real hardware has gate/readout noise the noiseless simulator doesn't)")


if __name__ == "__main__":
    main()
