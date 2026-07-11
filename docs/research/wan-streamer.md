# Wan-Streamer Research Note

Date: 2026-07-11

Branch: `research/streaming-voice-models`

## Identification

The model name appears to be **Wan-Streamer**, not just "Wan Streamer".

Primary references:

- Wan-Streamer v0.1 paper: https://arxiv.org/abs/2606.25041
- Wan-Streamer v0.2 paper: https://arxiv.org/abs/2607.04443
- Project page: https://wan-streamer.com/
- Wan-AI Hugging Face organization: https://huggingface.co/Wan-AI

## What It Is

Wan-Streamer is an end-to-end real-time audio-visual interaction model from the Wan/Alibaba ecosystem.

It is not just a TTS model and not just an avatar animation model. The paper frames it as a unified streaming foundation model that handles:

- language input/output
- audio input/output
- video input/output
- response timing
- turn management
- audio-video synchronization

The important architectural claim is that it avoids the usual cascade:

```text
VAD -> ASR -> LLM -> TTS -> avatar animation/video generation
```

Instead, it models text, audio, and video together in one streaming Transformer-style timeline.

## Reported Capabilities

### v0.1

- Full-duplex real-time audio-visual interaction.
- Inputs and outputs include text, audio, and video.
- Streaming units as short as 160 ms at 25 FPS.
- Around 200 ms model-side response latency.
- Around 550 ms total interaction latency when assuming 350 ms bidirectional network latency.
- Output resolution reported as 192 x 336.

### v0.2

- Keeps roughly the same latency target.
- Raises interactive video output to 640 x 368 at 25 FPS.
- Supports more legible mid-shot agents, including posture, gaze, hands, nearby objects, and scene layout.
- Uses a split serving topology:
  - `thinker`: single-GPU low-latency path for perception, state update, cache construction, and decoding.
  - `performer`: multi-GPU path for expensive high-resolution latent video generation.

## Current Boundary

Based on current public information, Wan-Streamer should be treated as a research/demo-level direction, not an immediately usable open-source dependency.

Important boundaries:

- I did not find a public GitHub repository with runnable Wan-Streamer inference code.
- I did not find public Wan-Streamer model weights on the Wan-AI Hugging Face organization.
- The public Hugging Face signal is mainly paper listings/collections, while Wan2.1/Wan2.2 models are available separately.
- The papers describe system architecture and latency, but this does not mean we can deploy it today.
- The model is about real-time audio-visual interaction, not specifically low-shot personal voice cloning.

## Fit For AI Twin

Wan-Streamer is highly relevant to the long-term vision:

```text
digital twin text persona
-> voice conversation
-> full-duplex audio interaction
-> video digital human
```

But it is probably not the right first implementation target.

For our product, the nearer-term need is:

```text
user voice input
-> ASR
-> existing API/RAG persona reply
-> TTS
-> optional target voice cloning
```

Wan-Streamer is closer to a future all-in-one replacement for this pipeline, especially when we want real-time video digital humans.

## Server Implication

Text-only API persona does not require our own GPU server.

Voice and video break down into three tiers:

1. Voice input + normal TTS
   - Can be API-only.
   - No self-hosted GPU server required.

2. Target-person voice cloning TTS
   - May require a GPU server if self-hosted.
   - Can also be tested through a third-party or company-approved voice API first.

3. Full-duplex audio-video digital human
   - Requires serious GPU infrastructure.
   - Wan-Streamer v0.2 explicitly describes a single-GPU thinker plus multi-GPU performer topology for higher-resolution video.

Given the current server baseline of only 32 GB VRAM, Wan-Streamer-style real-time video deployment is not a realistic near-term self-hosted target.

## Recommendation

Do not build the current product around Wan-Streamer yet.

Recommended roadmap:

1. Keep the current text persona pipeline:

```text
local knowledge base -> retrieval -> Qwen API -> persona reply
```

2. Add basic voice interaction:

```text
record audio -> ASR API -> text persona reply -> normal TTS API
```

3. Evaluate voice cloning separately:

```text
target voice samples -> voice cloning TTS -> audio reply
```

4. Track Wan-Streamer for later:

```text
if code/weights/API become available -> prototype full-duplex avatar branch
```

## Open Questions

- Will Wan-Streamer release public inference code?
- Will model weights be released, or only API/demo access?
- Does it support user-provided identity/face/voice personalization?
- If personalization is supported, how much source material is required?
- What GPU memory and GPU count are needed for v0.1 and v0.2 inference?
- Can it be used in a privacy-sensitive grief/loss product without creating unacceptable impersonation risk?

## Product Risk

For AI Twin, high-realism voice/video is commercially powerful but also the highest-risk feature.

Risk categories:

- consent and authorization
- impersonation
- emotional dependency
- grief exploitation concerns
- user belief that the real person has returned
- voice/face data leakage
- regulatory and platform policy constraints

Therefore, even if Wan-Streamer becomes usable, the default product should still start with controlled voice interaction before attempting realistic target-person video.
