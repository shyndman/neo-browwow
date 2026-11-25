# Page Image Resolution & Transcription Accuracy Study

Investigation into how PDF page render resolution (`PAGE_RENDER_SCALE` in `packages/pipeline/src/transcribe/index.ts`) and inference settings affect Markdown transcription accuracy — particularly dense equations and lowercase letter subscripts — using `3090_swift_15_qwen38_flash_next-iq3_xxs_16k`.

## Baseline Model & Pipeline Characteristics

- **Model (`Qwen/Qwen3.8-Flash-Next`)**: Native dynamic-resolution vision encoder (`Qwen3VLProcessor` / `Qwen2VLImageProcessorFast`).
  - `patch_size = 16`, `spatial_merge_size = 2` → **32 × 32 px per vision token** (height and width snapped to multiples of 32 px).
  - Native pixel budget from `preprocessor_config.json`: `65,536` px (`256 × 256`, 64 vision tokens) up to `16,777,216` px (`4096 × 4096`, 16,384 vision tokens).
  - Base positional embedding grid is `48 × 48` patches (`768 × 768` px), bilinearly interpolated to the resized image dimensions.
- **Experimental baseline** (`packages/pipeline/src/transcribe/index.ts`, prior to tuning to `PAGE_RENDER_SCALE = 3` and `temperature = 0.4`):
  - `PAGE_RENDER_SCALE = 2` (144 DPI via `unpdf` + `@napi-rs/canvas`, PNG).
  - `providerOptions: { transcriber: { reasoningEffort: 'medium' } }`, structured output via Zod (`transcribedMarkdown`, `notes`), no explicit `temperature` parameter (server default applies).
  - Prompt + structured-output schema text overhead: **212 tokens**.

---

## Experiment 1: Single-Pass Resolution Ladder (`scale = 1.0` to `4.0`)

### Test Set

Four US Letter (`612 × 792` pts) equation-heavy pages from `samples/`:

| ID          | PDF                                                                                | Page | Stress Features                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flash-p5`  | `samples/paper-flashattention-fast-and-memory-efficient-exact-attention.pdf`       |    5 | Algorithm 1, display softmax decomposition, $B_c, B_r, T_r, T_c, \tilde{m}_{ij}, \ell_i^{\text{new}}$, footnote                                                            |
| `flash-p20` | `samples/paper-flashattention-fast-and-memory-efficient-exact-attention.pdf`       |   20 | Algorithms 2 & 3, $p_{\text{drop}}, \sum_l P_{il} dP_{il}, P_{i:}, dP_{i:}, do_i^\top o_i$                                                                                 |
| `lora-p11`  | `samples/paper-lora-low-rank-adaptation-of-large-language-models.pdf`              |   11 | Second-order subscripts $U_{A_{r=8}}^{i\top} U_{A_{r=64}}^j$, $\Delta W_q, \Delta W_v$, heatmap figure, footnote                                                           |
| `thermo-p7` | `samples/paper-thermodynamic-aspects-of-renewable-and-sustainable-development.pdf` |    7 | Non-LaTeX journal serif, italic subscripts $\mu_{io}, \mu_i^e, \mu_{f,o}, \epsilon_f^{\text{CH}}, T_o, P_o, \eta_{\mathrm{C}/\mathrm{H}/\mathrm{O}/\mathrm{N}/\mathrm{S}}$ |

### Finding 1: Server-Side 1,024-Token Image Cap (`896 × 1152` px)

Every page at `scale >= 1.5` reported the exact same `inputTokens: 1220`:

|              Scale | DPI | Rendered PNG  |   MP | Avg PNG | `inputTokens` | Vision Tokens (`−212` text) | Effective Encoder Grid | Avg Output Tokens | Median Latency |
| -----------------: | --: | ------------- | ---: | ------: | ------------: | --------------------------: | ---------------------- | ----------------: | -------------: |
|              `1.0` |  72 | `612 × 792`   | 0.48 |  180 KB |         `687` |           `475` (`19 × 25`) | `608 × 800`            |             2,934 |         14.9 s |
|              `1.5` | 108 | `918 × 1188`  | 1.09 |  313 KB |   **`1,220`** |     **`1,008` (`28 × 36`)** | **`896 × 1152`**       |             2,131 |         12.9 s |
| `2.0` _(baseline)_ | 144 | `1224 × 1584` | 1.94 |  446 KB |   **`1,220`** |     **`1,008` (`28 × 36`)** | **`896 × 1152`**       |             1,879 |         13.9 s |
|              `2.5` | 180 | `1530 × 1980` | 3.03 |  572 KB |   **`1,220`** |     **`1,008` (`28 × 36`)** | **`896 × 1152`**       |             2,481 |         14.8 s |
|              `3.0` | 216 | `1836 × 2376` | 4.36 |  720 KB |   **`1,220`** |     **`1,008` (`28 × 36`)** | **`896 × 1152`**       |             2,564 |         14.9 s |
|              `4.0` | 288 | `2448 × 3168` | 7.75 |  999 KB |   **`1,220`** |     **`1,008` (`28 × 36`)** | **`896 × 1152`**       |             1,999 |         13.8 s |

- On `612 × 792` aspect ratio, `scale = 1.0` maps natively to `19 × 25 = 475` vision tokens (`475 + 212 = 687`).
- Above `scale ≈ 1.46`, the inference server enforces a **1,024-token ceiling per image**: the largest `32 px` grid fitting `612:792` under 1,024 tokens is `28 × 36 = 1,008` tokens (`896 × 1152` px, ~105 DPI; `1,008 + 212 = 1,220`). The next grid step (`29 × 37 = 1,073`) exceeds 1,024.
- **Root cause (runtime, not model):** Qwen3.8-Flash-Next natively supports up to 16,384 vision tokens (`1224 × 1584` at `scale = 2.0` would natively be `38 × 50 = 1,900` vision tokens). The 1,024-token clamp came from Strata `v0.2.15` (`Niko1221/Strata@c7757280`): `setup.py` defaults GPU vision to `"max_tokens": 1024` when `--vision-tokens` is omitted, `serve/server.py` passes `--max-tokens 1024` to `strata-vision`, and `tools/vision/own/image_prep.cpp` resizes any larger image down to fit `1024 × 32 × 32 = 1,048,576` px.
- As a result, rendering above `scale = 1.5` (including the `scale = 2.0` baseline and up to `4.0`) sent larger PNGs only for the server to downscale them back to `896 × 1152` px before vision encoding.

### Finding 2: Accuracy Cliff at `scale = 1.0` (475 Vision Tokens)

At 72 DPI (`608 × 800`), lowercase letter subscripts routinely collapsed into wrong letters or digits across all four pages:

| Page        | Ground Truth                                                                                                                                    | `scale = 1.0` Output                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lora-p11`  | $\Delta W_q$, $\Delta W_v$                                                                                                                      | $\Delta W_5$, $\Delta W_9$, $\Delta W_7$ (lowercase subscripts read as digits across caption and prose)                                                  |
| `lora-p11`  | $\|U_{A_{r=8}}^{i\top} U_{A_{r=64}}^j\|_F^2$                                                                                                    | $\|U_{A_{r=8}}^i (U_{A_{r=64}}^j)^T\|_2^2$ (`F` → `2`, transpose moved); footnote `[^7]` dropped                                                         |
| `flash-p5`  | $B_c = \lceil M/4d \rceil$, $B_r = \min(\lceil M/4d \rceil, d)$, $m_i^{\text{new}}$, $\mathbb{R}^B$                                             | $B_r = \lfloor M/2d \rfloor$, $B_c = \dots$, $m_{ij}^{\text{new}}$, $\mathbb{R}^\delta$; `Tiling` → `Tilelang`; `[10, 34]` → `[16, 34]`; `[33]` → `[23]` |
| `flash-p20` | $B_c, B_r, T_r, T_c$; $\sum_l P_{il} dP_{il}$; $P_{i:}, do_i^\top o_i$                                                                          | $B_\ell, T_\ell, T_r$ throughout Alg 2; $\sum_k P_{ik} dP_{ik}$ (`l` → `k`); $P_i$, $\mathrm{d}\mathbf{O}_i^\top \mathbf{o}_i$                           |
| `thermo-p7` | $\mu_i^e$, $\mu_f^e$, $\eta_{\mathrm{C}}, \eta_{\mathrm{H}}, \eta_{\mathrm{O}}, \eta_{\mathrm{N}}, \eta_{\mathrm{S}}$, $y_{\mathrm{O2}}$, $n_i$ | $\mu_i^0$, $\mu_f^0$, $\eta_c, \eta_1, \eta_9, \eta_7, \eta_5$, $v_{\mathrm{CO2}}$, $\alpha_i$; plain-text math (no `$...$`)                             |

### Finding 3: Behavior at the `1,008`-Token Ceiling (`scale = 1.5`–`4.0`)

Moving from 475 to 1,008 vision tokens eliminated bulk subscript corruption ($\Delta W_q, \Delta W_v, B_c, B_r, T_r, T_c, \sum_l P_{il} dP_{il}, \eta_{\mathrm{C/H/O/N/S}}, \mu^e$). Two error categories persisted across `1.5`–`4.0`:

#### A. Persistent Fine-Detail Failures (All or Nearly All Runs at `896 × 1152`)

- **`flash-p20` — subscript colon `P_{i:}` / `dP_{i:}` (0 / 5 runs exact at `1.5`–`4.0`):** Every run either dropped `:` completely (`P_i`, `dP_i`) or moved it outside math mode as prose punctuation (`$D_i = P_i^\top dP_i$:` at `2.5` and `4.0`; `;` at `3.0`).
- **`flash-p20` — lowercase `o` in `do_i^\top o_i` (0 / 5 runs exact at `1.5`–`4.0`):** Every run misread the first lowercase italic `o` as uppercase `O` (`\mathrm{d}\tilde{O}_i^\top \tilde{o}_i` at `1.5`; `dO_i^T o_i` at `2.0`, `2.5`, `4.0`; `d\mathbf{O}_i^T \mathbf{O}_i` at `3.0`).
- **`thermo-p7` — italic lowercase `o` vs digit `0` (1 / 5 runs exact at `1.5`–`4.0`):** Only `1.5` preserved `\mu_{io}`, `\mu_{f,o}`, and `T_o, P_o` as lowercase `o`. Scales `2.0`–`4.0` turned `o` into `0` in `\mu_{i,0}`/`\mu_{i0}`/`\mu_{f,0}`, and `2.5`/`3.0` also turned `T_o, P_o` into `T_0, P_0`.

#### B. Run-to-Run Sampling & Formatting Variance (Same 1,008-Token Input)

| Page            | `1.5`                                                                    | `2.0`                                                                                  | `2.5`                                                | `3.0`                                        | `4.0`                                                                                                           |
| --------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **`flash-p5`**  | Dropped `\in \mathbb{R}^{N\times d}` (line 2); `&nbsp;`                  | Clean                                                                                  | `M/4d` → `M/d` (line 1); raw `\quad` outside `$`     | Clean (`&nbsp;`)                             | Clean                                                                                                           |
| **`flash-p20`** | `\ell_i^{\text{new}}` → `\ell_{ij}^{\text{new}}`; `P_{i:}`, `do_i` wrong | Switched to HTML `<sup>`/`<sub>`; dropped `\tilde` on `m_{ij}`; `P_{i:}`, `do_i` wrong | Dropped `\tilde` on `m_{ij}`; `P_{i:}`, `do_i` wrong | Alg 2 & 3 clean; `P_{i:}`, `do_i` wrong      | Mixed HTML `<sup>`/`<sub>` & LaTeX; omitted heading `B.4`; dropped `\tilde` on `m_{ij}`; `P_{i:}`, `do_i` wrong |
| **`lora-p11`**  | Footnote `[^7]` → `[^2]`; math clean                                     | Clean                                                                                  | `^[7]` footnote syntax; math clean                   | Clean                                        | Invalid LaTeX `U_{A_{r=8}}^i^T`; hallucinated figure tick labels in alt text                                    |
| **`thermo-p7`** | Extra `\sum_i`; `Ghiamarian`; subscripts exact                           | `o` → `0` in `\mu`; extra `\sum_i`; `Gharmian`                                         | `o` → `0` in `\mu, T, P`; `exergy` → `energy`        | `o` → `0` in `\mu, T, P`; `\epsilon` → `\in` | `o` → `0` in `\mu`; `Gharian`; `106.9881` → `106.98811`                                                         |

Notable prompt-adherence drift observed across `1.5`–`4.0` (despite the system prompt forbidding HTML):

- `flash-p20` emitted raw `<sup>`/`<sub>` HTML tags at `2.0` and `4.0` and dropped section heading `B.4` at `4.0`.
- `flash-p5` and `flash-p20` frequently emitted `&nbsp;` entities to approximate algorithm indentation.

---

## Experiment 2: Uncapped Resolution Ladder (`--vision-tokens 8192`, `temperature = 1.0`)

After raising Strata's GPU vision cap to `--vision-tokens 8192` in `../homelab-infra`, we re-ran the full 6-rung ladder across the same 4 pages (24 sequential calls, `temperature = 1.0`).

### Token Scaling & Latency

Every rung reached the vision encoder at its true rendered resolution (exact match to 32 × 32 px grid math):

| Scale              | DPI | Rendered PNG  | `inputTokens` | Vision Tokens (`−212` text) | Avg Output Tokens | Median Latency |
| ------------------ | --- | ------------- | ------------- | --------------------------- | ----------------- | -------------- |
| `1.0`              | 72  | `612 × 792`   | `687`         | `475` (`19 × 25`)           | 2,159             | 13.4 s         |
| `1.5`              | 108 | `918 × 1188`  | `1,285`       | `1,073` (`29 × 37`)         | 2,120             | 12.0 s         |
| `2.0` _(baseline)_ | 144 | `1224 × 1584` | `2,112`       | `1,900` (`38 × 50`)         | 2,021             | 15.8 s         |
| `2.5`              | 180 | `1530 × 1980` | `3,188`       | `2,976` (`48 × 62`)         | 2,386             | 16.3 s         |
| `3.0`              | 216 | `1836 × 2376` | `4,430`       | `4,218` (`57 × 74`)         | 1,888             | 16.9 s         |
| `4.0`              | 288 | `2448 × 3168` | `7,835`       | `7,623` (`77 × 99`)         | 1,923             | 31.2 s         |

Latency stayed nearly flat from `2.0` through `3.0` (~15.8–16.9 s median) and roughly doubled at `4.0` (31.2 s median, consuming ~48% of the `_16k` context window).

### Resolution Thresholds Observed (Single-Pass `n = 1` per Scale; See Multi-Run Failure Counts Below)

| Target Detail                                                                                | Capped (`1,008` tok, `n=5`) | `1.0` (`475`)  | `1.5` (`1,073`) | `2.0` (`1,900`) | `2.5` (`2,976`)      | `3.0` (`4,218`)      | `4.0` (`7,623`)    |
| -------------------------------------------------------------------------------------------- | --------------------------- | -------------- | --------------- | --------------- | -------------------- | -------------------- | ------------------ |
| Bulk lowercase subscripts ($\Delta W_q, \Delta W_v, B_c, B_r, \sum_l, \eta_{\mathrm{C..S}}$) | 5 / 5                       | 0 / 1          | 1 / 1           | 1 / 1           | 1 / 1                | 1 / 1                | 1 / 1              |
| `flash-p20` lowercase $do_i^\top o_i$                                                        | 0 / 5                       | 0 / 1 ($dO_i$) | 1 / 1           | 1 / 1           | 1 / 1                | 1 / 1                | 1 / 1              |
| `thermo-p7` italic $o$ vs `0` ($\mu_{io}, \mu_{f,o}, T_o, P_o$)                              | 1 / 5                       | 0 / 1          | 0 / 1 (`0`)     | 1 / 1           | 1 / 1                | 1 / 1                | 0 / 1 (`\mu_{i0}`) |
| `flash-p20` subscript colon $P_{i:}, dP_{i:}$                                                | 0 / 5                       | 0 / 1          | 0 / 1           | 0 / 1           | 1 / 1 _(3/13 total)_ | 1 / 1 _(2/10 total)_ | 1 / 1              |
| `flash-p5`/`p20` literal PDF typo $\mathbf{O}_i, \ell_i$ (vs prior $\mathbf{O}_1, \ell_1$)   | 0 / 12                      | Partial        | Partial         | 1 / 2 (`p5`)    | 1 / 2 (`p20`)        | 2 / 2                | 2 / 2              |

- **Raw `<sup>`/`<sub>` HTML violations dropped to 0 / 24** across the uncapped ladder (down from 2 / 20 when capped).
- **`scale = 1.0` remained unusable** across all four pages (e.g., `lora-p11` collapsed every $\Delta W_q$ and $\Delta W_v$ into $\Delta W_r$; `thermo-p7` corrupted all five $\eta$ subscripts into $\eta_c, \eta_r, \eta_g, \eta_{ps}, \eta_{rs}$).
- **`scale = 2.5`–`3.0` was the accuracy/latency sweet spot:** `2.0` still missed `P_{i:}` on `flash-p20`, while `4.0` doubled latency with no accuracy gain over `3.0` (and dropped LaTeX delimiters on `thermo-p7`).

---

## Experiment 3: Temperature & Repeat Consistency Matrix (`scale = 2.5`)

Tested `temperature ∈ {1.0, 0.6, 0.2}` × 3 repeats × 4 pages = 36 sequential calls at `scale = 2.5` (`1530 × 1980`, `3,188` input tokens).

| Temperature                           | Runs | Avg Output Tokens | Median / Avg Latency | LaTeX `$...$` Consistency | Pairwise Repeat Similarity | Repeat Loops |
| ------------------------------------- | ---- | ----------------- | -------------------- | ------------------------- | -------------------------- | ------------ |
| `1.0` _(model-card thinking default)_ | 12   | 2,185             | 10.9 s / 13.2 s      | 10 / 12                   | `0.798`                    | 0            |
| `0.6`                                 | 12   | 2,545             | 11.9 s / 14.5 s      | **12 / 12**               | **`0.903`**                | 0            |
| `0.2`                                 | 12   | 2,420             | 12.1 s / 13.4 s      | 10 / 12                   | `0.823`                    | 0            |

### Per-Page Consistency Findings at `scale = 2.5`

- **`thermo-p7` (9 / 9 runs exact on subscripts & prose):** Every run across `1.0`, `0.6`, and `0.2` got $\mu_{io}, \mu_{f,o}, T_o, P_o$, all five $\eta_{\mathrm{C/H/O/N/S}}$ subscripts, all 9 numeric coefficients, and `Ghamarian` right. (`0.2` r2 dropped `$...$` delimiters for plain Unicode math; `0.6` r3 and `0.2` r1 rendered $\epsilon$ as `\in`.)
- **`lora-p11` (9 / 9 runs exact on equations & subscripts):** Every run got Eq. (4), all $\Delta W_q$ and $\Delta W_v$ subscripts, and footnote 7 text right. Only formatting drift: escaped `\[^7\]` in 4/9 runs (`1.0`: 1×, `0.6`: 1×, `0.2`: 2×).
- **`flash-p5` (8 / 9 runs clean on math):** All 9 runs got `B_c, B_r, T_r, T_c, M/4d, m_i^{\text{new}}, \ell_i^{\text{new}}` right; 1 run (`0.6` r3) added an extra tilde on `\tilde{\mathbf{S}}_{ij}` in line 10, and 1 run (`1.0` r3) dropped `$...$` delimiters for plain Unicode math.
- **`flash-p20` (stress page):**
  - `do_i^\top o_i` lowercase `o`: **8 / 9 exact** (only 1 miss: `temp = 1.0` r1 wrote `dO_i^\top O_i`).
  - `M/4d` → `M/4B_c` prior slip in Alg 2 line 2: occurred once at `1.0` (r3) and once at `0.6` (r2); 0 times at `0.2`.
  - Subscript colon `P_{i:}` / `dP_{i:}`: right on the pixel-resolution edge at `scale = 2.5` — exact (`4/4`) in only **2 / 9** runs (`0.6` r2 and `0.2` r2) plus `3/4` in `1.0` r3, while 6 / 9 dropped the colon to `P_i`.
- **No `<sup>`/`<sub>` HTML tags in any of the 36 runs (0 / 36)**, and **no repetition loops even at `temperature = 0.2` (0 / 12)**.
- **`temperature = 0.6` was the most consistent overall** (`12/12` LaTeX formatting and `0.903` mean pairwise similarity across repeats, vs `0.798` at `1.0` and `0.823` at `0.2`).

---

## Experiment 4: Concurrency-4 Batching Benchmark (`scale = 2.5`, `temperature = 0.6`)

Sent all 4 pages concurrently (`Promise.all`) for 3 rounds (12 calls total) with pre-rendered PNGs, compared against the 3 sequential rounds from Experiment 3 at the exact same `scale = 2.5`, `temperature = 0.6`:

| Mode                           | Round | 4-Page Wall Time | Effective Sec / Page | Total Output Tokens | Aggregate Out Tok/s |
| ------------------------------ | ----- | ---------------- | -------------------- | ------------------- | ------------------- |
| Sequential (`concurrency = 1`) | r1    | 61.2 s           | 15.3 s               | 10,422              | 170.3               |
| Sequential (`concurrency = 1`) | r2    | 57.8 s           | 14.4 s               | 10,207              | 176.6               |
| Sequential (`concurrency = 1`) | r3    | 55.0 s           | 13.7 s               | 9,906               | 180.3               |
| **Sequential Mean**            | —     | **58.0 s**       | **14.5 s**           | **10,178**          | **175.7**           |
| Batched (`concurrency = 4`)    | b1    | 48.7 s           | 12.2 s               | 8,952               | 183.9               |
| Batched (`concurrency = 4`)    | b2    | 50.2 s           | 12.6 s               | 8,330               | 165.8               |
| Batched (`concurrency = 4`)    | b3    | 46.7 s           | 11.7 s               | 9,196               | 197.0               |
| **Batched Mean**               | —     | **48.5 s**       | **12.1 s**           | **8,826**           | **182.2**           |

- **Concurrent decoding is active** — per-page finish times scaled cleanly with output token count within each batch (e.g., Batch 1: `thermo-p7` 25.7 s / 1,545 tok → `lora-p11` 35.0 s / 2,074 tok → `flash-p20` 40.6 s / 2,424 tok → `flash-p5` 48.7 s / 2,909 tok).
- **Throughput gain was minimal (`+3.7%` aggregate tok/s):** `182.2 tok/s` batched vs `175.7 tok/s` sequential (`1.04×`). Most of the `1.19×` wall-clock drop (`58.0 s` → `48.5 s`) came from emitting ~13% fewer total output/thinking tokens across the 3 batched rounds (`8,826` vs `10,178`).
- **Quality remained consistent with Experiment 3:** `thermo-p7` (3/3 italic `o` & `Ghamarian` exact), `lora-p11` (3/3 all $\Delta W_q/\Delta W_v$ exact), `flash-p5` (3/3 clean), `flash-p20` (0/3 `M/4B_c` slips, 1/3 partial `P_{i:}` `3/4`), 0/12 HTML tags, 10/12 LaTeX `$...$` formatting (2 plain-Unicode fallbacks: `b1__thermo-p7` and `b3__flash-p20`).

---

## Experiment 5: Temperature & Repeat Consistency Matrix at `scale = 3.0`

Repeated the 3-repeat × 4-page × 3-temperature matrix (`temperature ∈ {1.0, 0.6, 0.2}`, 36 sequential calls) at `scale = 3.0` (`1836 × 2376`, `4,430` input tokens / `4,218` vision tokens).

| Temperature | Runs | Avg Out Tokens | Median / Avg Latency | Non-$P_{i:}$ Math/Prose Failures | $P_{i:}$ Failures (of 3) | LaTeX `$...$` | Escaped `\[^n\]` | Pairwise Sim | Loops |
| ----------- | ---- | -------------- | -------------------- | -------------------------------- | ------------------------ | ------------- | ---------------- | ------------ | ----- |
| `1.0`       | 12   | 2,218          | 10.4 s / 13.0 s      | 1 / 12 (`thermo-p7` `o→0`)       | 3 / 3                    | 11 / 12       | 1 / 12           | `0.819`      | 0     |
| `0.6`       | 12   | 2,211          | 12.6 s / 12.3 s      | 1 / 12 (`Gharmian` typo)         | 3 / 3                    | **12 / 12**   | 1 / 12           | **`0.881`**  | 0     |
| `0.2`       | 12   | 2,225          | 9.9 s / 12.3 s       | **0 / 12**                       | **2 / 3**                | 11 / 12       | 2 / 12           | `0.879`      | 0     |

### Failure Counts: `scale = 2.5` (`N = 13`/page) vs `scale = 3.0` (`N = 10`/page)

Aggregating every uncapped run at each scale (`2.5`: 1 ladder + 9 temp + 3 batch-4 = 13/page; `3.0`: 1 ladder + 9 temp = 10/page):

| Page & Check                                                       | `scale = 2.5` Failures (`N = 13`) | `scale = 3.0` Failures (`N = 10`) |
| ------------------------------------------------------------------ | --------------------------------- | --------------------------------- |
| **`flash-p5`** — math errors (extra `\tilde{\mathbf{S}}_{ij}`)     | 2 / 13                            | **0 / 10**                        |
| **`flash-p5`** — escaped footnote `\[^2\]`                         | 2 / 13                            | **0 / 10**                        |
| **`flash-p20`** — `M/4d → M/4B_c` hallucination                    | 3 / 13                            | **0 / 10**                        |
| **`flash-p20`** — `do_i → dO_i` capitalization slip                | 1 / 13                            | **0 / 10**                        |
| **`flash-p20`** — subscript colon `P_{i:}` missed (`<4/4`)         | 10 / 13 (`8×` 0/4, `2×` 3/4)      | 8 / 10 (`8×` 0/4)                 |
| **`flash-p20`** — dropped `$...$` (plain Unicode)                  | 4 / 13                            | **2 / 10**                        |
| **`lora-p11`** — Eq. (4) / $\Delta W_q, \Delta W_v$ math errors    | **0 / 13**                        | **0 / 10**                        |
| **`lora-p11`** — escaped footnote `\[^7\]`                         | 5 / 13                            | 4 / 10                            |
| **`thermo-p7`** — italic `o → 0` (`\mu_{io}, \mu_{f,o}, T_o, P_o`) | **0 / 13**                        | 1 / 10 (`temp=1.0`)               |
| **`thermo-p7`** — author typo (`Ghamarian`)                        | **0 / 13**                        | 1 / 10 (`temp=0.6`)               |
| **`thermo-p7`** — `\epsilon → \in` glyph choice                    | 3 / 13                            | 6 / 10                            |
| **`thermo-p7`** — dropped `$...$` (plain Unicode)                  | 2 / 13                            | **0 / 10**                        |

### Combined Temperature Summary Across `scale = 2.5` + `3.0` (`N = 24` runs per temp)

| Temperature | Non-$P_{i:}$ Math/Prose Failures                        | $P_{i:}$ Exact (of 6) | LaTeX `$...$` | Escaped `\[^n\]` | HTML `<sub>/<sup>` | Repeat Loops |
| ----------- | ------------------------------------------------------- | --------------------- | ------------- | ---------------- | ------------------ | ------------ |
| `1.0`       | 4 / 24 (`M/4B_c`, `do_i→dO_i`, `o→0`, `flash-p5` plain) | 0 / 6 (`1×` 3/4)      | 21 / 24       | 2 / 24           | 0 / 24             | 0 / 24       |
| `0.6`       | 3 / 24 (`M/4B_c`, extra tilde, `Gharmian`)              | 1 / 6                 | **24 / 24**   | 2 / 24           | 0 / 24             | 0 / 24       |
| `0.2`       | **0 / 24**                                              | **2 / 6**             | 21 / 24       | 5 / 24           | 0 / 24             | 0 / 24       |

Key takeaways:

- **Moving from `2.5` to `3.0` eliminated every `flash-p5` math error (2/13 → 0/10), every `flash-p20` `M/4B_c` slip (3/13 → 0/10), every `do_i → dO_i` slip (1/13 → 0/10), and `thermo-p7` plain-Unicode fallbacks (2/13 → 0/10)** at roughly the same latency (~12.5 s avg at `3.0` vs ~13.7 s at `2.5`).
- **`P_{i:}` remained ~80% failure rate even at `3.0` (8/10 vs 10/13 at `2.5`)**, showing that this specific colon-in-subscript drop is driven more by the model's strong $P_i$ math prior than by pixel resolution above 180 DPI.
- **`temperature = 0.2` had zero non-$P\_{i:}$ math/prose failures across all 24 runs (0/24)** and zero repeat loops, while **`temperature = 0.6` had 100% LaTeX formatting adherence (24/24)** and the highest overall repeat similarity (`0.88–0.90`).
