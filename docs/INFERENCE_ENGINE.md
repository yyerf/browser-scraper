# Record inference

The engine walks ancestors of the user's selected field examples and considers ancestors that contain each example from the same training group. It finds structurally similar siblings and evaluates whether every selected field resolves relative to each candidate record. Its score combines repetition, structural similarity, field coverage, and compactness, and returns ranked candidates with explanations.

Traversal is bounded by ancestor depth, at most 100 sibling peers, and selector search limits. The UI permits a manual record-container choice when confidence is low. Multiple field examples improve coverage and reduce accidental selection of a grid wrapper. A selected field such as `article:nth-child(1) .price` is generalized to a locator against each inferred article, typically `[itemprop="price"]` or `.price`.

The current structural signature tolerates optional children through histogram overlap. It does not yet use a trained model or an LLM. Difficult mixed layouts and virtualized lists need additional fixtures and confidence calibration.
