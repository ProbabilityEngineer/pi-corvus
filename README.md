# pi-corvus

> One of my diet context engineering and workflow extensions. Explore the complete collection: <https://www.npmjs.com/~probabilityengineer>

An experimental Pi extension inspired by the [CORVUS paper](https://arxiv.org/abs/2607.22711) CORVUS: Context Optimization and Reduction Via Underlying Synchronization for LLM Coding Agents by Mingwei Zheng, David OBrien, Siwei Cui, Pardis Pashakhanloo, Rajdeep Mukherjee, Myeongsoo Kim, Sachit Kuhar. This project is an independent implementation; it is not affiliated with or endorsed by the paper's authors.

CORVUS leaves Pi's built-in `read` tool and its behavior unchanged. When the agent successfully reads an eligible whole text file, that file becomes synchronized: later model requests retain the historical read tool call and its paired result, replace the stale result body with a compact marker, and inject exactly one authoritative current snapshot for synchronized files. Failed refreshes fail open: the historical read body stays visible and no substitute snapshot is injected.

Pi's persisted session history remains unchanged. V1 transforms only request-time model-visible context, so original reads remain in canonical history consumed by compaction; V1 does **not** reduce canonical/compaction history.

V1 has been validated for controlled, supervised use with CORVUS as the **sole context-transforming extension**. General composition is not guaranteed: Pi applies context hooks sequentially, and a later extension can remove CORVUS's authoritative snapshot after stale read bodies have been elided.

## Install

```sh
pi install npm:pi-corvus
```

Review the package source and trust it before enabling it. Pi packages execute extension code with the current user's permissions. To try once without adding a package setting:

```sh
pi -e npm:pi-corvus
```

Remove the installed package with:

```sh
pi remove npm:pi-corvus
```

Commands: `/corvus status`, `/corvus clear`, `/corvus drop <path>`, `/corvus on`, `/corvus off`.

## Validation

- A real `gpt-6-luna` provider control and CORVUS provider path succeeded.
- Three model-issued built-in read/edit cycles were validated. Persisted reads remained intact; captured provider requests contained paired compact read markers and exactly one current snapshot, without synthetic missing-result repair. The model answered from current state without another read.
- External file deletion failed open correctly.
- All 15 automated tests pass. A disposable coding task passed 3/3 tests both with and without CORVUS.
- Synthetic 10-request benchmark: serialized messages **622,410 → 142,200 bytes**; Pi heuristic tokens **134,800 → 19,280**. These are synthetic measures and **not provider-billed token measurements**.
- The first small real coding comparison reported provider input tokens (including cache reads): baseline **8,638**, CORVUS **9,274**. This small run showed overhead, not savings. The crossover point and prompt-cache behavior remain to be characterized; no real-world token reduction is claimed.

See [V1-ACCEPTANCE.md](V1-ACCEPTANCE.md) for the full acceptance scope and limits.

## Citation

This project is an independent implementation inspired by:

> Mingwei Zheng, David OBrien, Siwei Cui, Pardis Pashakhanloo, Rajdeep Mukherjee, Myeongsoo Kim, and Sachit Kuhar.  
> **CORVUS: Context Optimization and Reduction Via Underlying Synchronization for LLM Coding Agents.**  
> *arXiv preprint arXiv:2607.22711*, 2026.  
> https://arxiv.org/abs/2607.22711  
> https://doi.org/10.48550/arXiv.2607.22711

```bibtex
@article{zheng2026corvus,
  title={CORVUS: Context Optimization and Reduction Via Underlying Synchronization for LLM Coding Agents},
  author={Zheng, Mingwei and OBrien, David and Cui, Siwei and Pashakhanloo, Pardis and Mukherjee, Rajdeep and Kim, Myeongsoo and Kuhar, Sachit},
  journal={arXiv preprint arXiv:2607.22711},
  year={2026},
  doi={10.48550/arXiv.2607.22711},
  url={https://arxiv.org/abs/2607.22711}
}