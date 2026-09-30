# pi-corvus

> One of my diet context engineering and workflow extensions. Explore the complete collection: <https://www.npmjs.com/~probabilityengineer>

An experimental Pi extension inspired by the [CORVUS paper](https://arxiv.org/abs/2607.22711) CORVUS: Context Optimization and Reduction Via Underlying Synchronization for LLM Coding Agents by Mingwei Zheng, David OBrien, Siwei Cui, Pardis Pashakhanloo, Rajdeep Mukherjee, Myeongsoo Kim, Sachit Kuhar. This project is an independent implementation; it is not affiliated with or endorsed by the paper's authors.

CORVUS leaves Pi's built-in `read` tool and its behavior unchanged. When the agent successfully reads an eligible whole text file, that file becomes synchronized. An unchanged historical observation stays untouched and supplies current contents, without a duplicate snapshot. Stale or redundant observations become compact paired-result markers; if no eligible current observation remains, CORVUS injects exactly one authoritative current snapshot. Failed refreshes fail open: the historical read body stays visible and no substitute snapshot is injected.

Pi/the model decides which files matter by reading them normally. CORVUS then deterministically checks and refreshes synchronized files on each request; the LLM does not decide whether a file changed. Existing historical content is reused while it remains authoritative. Once the file changes, CORVUS retires stale historical content from model-visible authority and supplies current contents on subsequent requests.

For repeated reads, CORVUS keeps the earliest observation in the trailing run of exact, current, complete reads, preserving the longest stable provider prefix. Once an observation is known stale, branch-local metadata permanently retires it from authority: A→B→A uses a snapshot, not the old A at its original chronological position. A new complete read can establish fresh authority. Hashes authenticate historical bodies; **exact decoded UTF-8 content equality**, including BOM and line endings, determines current authority. Partial reads never establish authority.

Pi's canonical/persisted messages remain unchanged; CORVUS adds branch-local synchronization metadata without rewriting original reads. V1 transforms only request-time model-visible context, so original reads remain in canonical history consumed by compaction; V1 does **not** reduce canonical/compaction history.

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

## 0.1.2 — semantic/correctness correction

Preserve still-current historical file reads as authoritative instead of replacing them with identical request-time snapshots. Retire stale observations only after the underlying file actually changes, reducing unnecessary context transformation and preserving normal prompt-cache reuse for unchanged files. Redundant full copies from repeated reads are represented by compact paired markers, leaving one authoritative copy.

Retirement survives resume and A→B→A; a retired observation is not resurrected just because contents return to the same bytes. A fresh eligible complete read can establish new historical authority. This release adds no snapshot-placement or synchronization policy changes beyond the semantic correction.

## Validation and performance limits

- All **21 tests** and typecheck pass; the synthetic benchmark runs.
- Live `gpt-6-luna` validation confirmed current-content authority and valid provider tool-call/result pairing, including external changes without another model read. Deletion fails open.
- CORVUS reduces duplicated/stale model-visible file observations, **not necessarily provider tokens or cost**. Synthetic serialized bytes are not provider tokens, and Pi heuristic tokens are not provider-billed tokens.
- Prompt caching materially affects economics. In bounded corrected experiments, unchanged historical A preserved cache reuse (**12/12 follow-up hits in both baseline and corrected arms**, effectively equal cost). Stable request-only B snapshots after a stale transition had **0/12 observed hits**: their tail position moved as conversation grew.
- **No provider-token or cost-saving guarantee is made.** The old +160.5% unchanged-file result measured superseded always-replace/always-reinject behavior, not 0.1.2.

Reports: [corrected semantics and measurements](V1-CORRECTION.md), [repeated cache investigation](V1-CACHE.md), and [historical acceptance scope and limitations](V1-ACCEPTANCE.md).

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
```
