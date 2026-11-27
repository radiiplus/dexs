# Compositional Boundary-and-Value Lens

## Core question

Can a sequence of individually accepted operations produce a combined state or value result that violates an end-to-end expectation?

This lens combines range mapping, low-level execution analysis, systems engineering, backward reasoning, state-machine testing, and value reconciliation. It does not assume a known vulnerability class or treat an unusual result as a finding by itself.

## Analysis steps

1. **Set the outcome and boundary.** State the end-to-end property to examine, such as exact repayment, conservation of pool assets, or consistency between claims and balances. Identify which contracts, programs, external interfaces, and market participants are in scope.
2. **Map accepted and rejected behavior.** For each operation, list accepted input ranges, state preconditions, rejected cases, error paths, caller checks, callback rules, and rollback effects. Include wrappers and alternate entry points, not only the primary function.
3. **Trace execution and representation.** Follow each value through calls and state transitions. Inspect units, signs, widths, endian interpretation, high and low bits, rounding, casts, and the deployed instruction or bytecode behavior where available.
4. **Compose the domains.** Find the intersection of conditions that pass through every layer. Check whether distinct checks validate different projections of the same value or state, leaving a jointly accepted case that violates the end-to-end property. Also enumerate the union of alternate routes that reach or mutate the same state.
5. **Reason backward from consequences.** Start with the proposed invariant violation and derive the minimum conditions required for it. Identify who bears the loss and which real settlement, claim, liquidation, or incentive path would transmit it. If that edge is absent, classify the result as an accounting discrepancy or risk, not an exploit.
6. **Test sequences and combinations.** Model operations as state transitions, vary boundary values and interactions, and check invariants after each step and at transaction completion. Use focused pairwise or higher-way combinations when exhaustive testing is impractical. Compare results against an independent accounting model and, where possible, source-matched deployed behavior.
7. **Try to disprove the candidate.** Test expected guards, rollback, alternate orderings, repeated operations, and the smallest counterexample. Record expected behavior and rejected hypotheses alongside reproduced effects.

## Set view

For each layer `i`, let `A_i` be the inputs and states that its checks accept, and let `T_i` be its state transition. A candidate composed path exists only where the output of one transition lands in the next layer's accepted domain. Analyze the intersection of those accepted conditions, then compare the composed transition `T_n(...T_2(T_1(s)))` with the system-level invariant. The union of paths matters because a wrapper, callback, alternate operation, or different caller may reach the same state through different checks.

## Cetus flash-loan application

For the current positive-active-liquidity screen, trace the selected reserve and exact requested principal through the fee calculation, protocol/LP/partner allocation, receipt, and repayment. Reconcile actual balances with all recorded claims after single and composed operations. Vary token side, amount boundaries, fee rounding, partner mode, active liquidity, and transaction ordering. The question is whether a valid sequence leaves a value or claim mismatch and whether any in-scope settlement path realizes a loss; excess output is not inferred from fee-accounting differences.

## Method sources

- NASA's systems-engineering guidance describes functional analysis in terms of inputs, outputs, failure modes, consequences, interfaces, and end-to-end flows: [NASA Systems Engineering Handbook](https://science.nasa.gov/wp-content/uploads/2023/04/nasa_systems_engineering_handbook_0.pdf).
- NASA's fault-tree method starts from an undesirable outcome and derives the combinations of events that could cause it: [Fault Tree Handbook with Aerospace Applications](https://s3vi.ndc.nasa.gov/ssri-kb/static/resources/Fault%20Tree%20Handbook_NASA.pdf).
- NIST describes combinatorial testing as systematic coverage of interactions among parameter values: [NIST combinatorial testing FAQ](https://csrc.nist.gov/projects/automated-combinatorial-testing-for-software/faqs).
- TRIZ offers a contradiction-based way to generate alternative questions when improving one property makes another harder to preserve: [Minitab TRIZ overview](https://support.minitab.com/en-us/engage/help/how-to/tools/forms/types-of-forms/product-development/triz-technical-contradictions-matrix/).
