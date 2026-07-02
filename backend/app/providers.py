"""Multi-provider LLM relay. The browser stores API keys + per-task model choice
(Settings → AI) and sends them per request; this backend just relays the call so
keys never sit in the browser's network calls to third parties and CORS is avoided.

Supported: Anthropic (SDK) + OpenAI-compatible chat APIs (OpenAI, DeepSeek,
Moonshot, Mistral) + Gemini. The backend does not store keys.
"""
from __future__ import annotations

import httpx
from anthropic import Anthropic

# provider → OpenAI-compatible base URL (POST {base}/chat/completions)
OPENAI_COMPAT = {
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "moonshot": "https://api.moonshot.cn/v1",
    "mistral": "https://api.mistral.ai/v1",
}

DEFAULT_MODEL = {
    "anthropic": "claude-opus-4-8",
    "openai": "gpt-4o-mini",
    "deepseek": "deepseek-chat",
    "moonshot": "moonshot-v1-8k",
    "mistral": "mistral-small-latest",
    "gemini": "gemini-2.0-flash",
}

PROVIDERS = ["anthropic", "openai", "deepseek", "moonshot", "mistral", "gemini"]


def chat(provider: str, model: str, api_key: str, system: str, user: str, max_tokens: int = 1024) -> str:
    """One-shot chat: system + single user message → assistant text."""
    if not api_key:
        raise ValueError(f"No API key configured for provider '{provider}'")
    model = model or DEFAULT_MODEL.get(provider, "")

    if provider == "anthropic":
        client = Anthropic(api_key=api_key)
        resp = client.messages.create(
            model=model or "claude-opus-4-8",
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(b.text for b in resp.content if b.type == "text").strip()

    if provider in OPENAI_COMPAT:
        r = httpx.post(
            f"{OPENAI_COMPAT[provider]}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
            timeout=60,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()

    if provider == "gemini":
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            params={"key": api_key},
            json={
                "system_instruction": {"parts": [{"text": system}]},
                "contents": [{"parts": [{"text": user}]}],
                "generationConfig": {"maxOutputTokens": max_tokens},
            },
            timeout=60,
        )
        r.raise_for_status()
        return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()

    raise ValueError(f"Unknown provider '{provider}'")
