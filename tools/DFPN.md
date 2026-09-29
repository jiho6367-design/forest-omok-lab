# Independent DFPN verifier

Run unit checks with `node test/dfpn.cjs`. The module exports a synchronous
single-thread session with `run({ms, maxNodes, signal})`. Calls retain the private
transposition table; reports alone cannot restore it after process exit.

The proposition is **the fixed attacker has a forced exact-five win**. Thus
`PROVEN_NONWIN` means the attacker cannot force a win (a defender win or draw);
it does not prove the defender wins. Both bounds must be nonzero on interruption.

All rules are supplied by `src/node-engine.cjs` (`inspect`, `win`, `winning`).
No local three/four/overline implementation or VCF proof oracle is included.
Input board arrays must describe a valid existing position. Prefixes are checked
move by move, including terminal and forbidden placements.

Candidate-region moves are ordered first, along with existing immediate threats.
All other empty cells remain in a lazy aggregate until individually inspected.
An OR win needs one proven child; an AND win needs every legal child. The dual
conditions apply to disproof. A deferred aggregate cannot resolve either way.
Its finite initial OR proof estimate prioritizes the first tactical branch;
this is a search-order heuristic, not a legality filter or proof fact.

Keys reuse the existing proof-session's full board-string representation plus
side-to-move. Each session isolates attacker/rules. The board is restored in
finally blocks on timeout/cancellation. Full-board draws disprove attacker win;
a non-full position with no legal move remains unknown because the imported
rule functions do not specify a no-legal-move game outcome.

Optional `orderingCertificate` prioritizes prescribed attack moves. No results
from that certificate are trusted. Each resulting branch must still be searched.
Reported nodes count unique transposition-table entries, not old-engine nodes.
Infinity is serialized as 1000000000000; finite proof numbers are estimates,
not win probabilities. Node/time limits never create a solved result.

Regression outcomes are in `reports/dfpn-regression.json`. Reproducing two
certificates does not imply that the longer I7 proof has been reproduced.
The first implementation's uniform deferred estimate was too broad; the final
finite estimate preserves the same legal move universe. No UI/runtime engine
or historical analysis mode was modified.
