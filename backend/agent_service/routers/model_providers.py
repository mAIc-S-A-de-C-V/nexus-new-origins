"""
Model provider CRUD + connection test.
"""
import os
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx

from database import ModelProviderRow, get_session

router = APIRouter()


class ModelEntry(BaseModel):
    id: str
    label: str
    context_window: Optional[int] = None


class ProviderCreate(BaseModel):
    name: str
    provider_type: str  # anthropic, openai, google, azure_openai, local
    api_key_encrypted: Optional[str] = None
    base_url: Optional[str] = None
    models: list[dict] = []
    is_default: bool = False
    enabled: bool = True


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    provider_type: Optional[str] = None
    api_key_encrypted: Optional[str] = None
    base_url: Optional[str] = None
    models: Optional[list[dict]] = None
    is_default: Optional[bool] = None
    enabled: Optional[bool] = None


def _mask_key(key: Optional[str]) -> Optional[str]:
    if not key:
        return None
    if len(key) <= 8:
        return "•" * len(key)
    return f"{key[:4]}{'•' * 8}{key[-4:]}"


def _to_dict(row: ModelProviderRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "provider_type": row.provider_type,
        "api_key_encrypted": _mask_key(row.api_key_encrypted),
        "has_api_key": bool(row.api_key_encrypted),
        "base_url": row.base_url,
        "models": row.models or [],
        "is_default": row.is_default,
        "enabled": row.enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("")
async def list_providers(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ModelProviderRow)
        .where(ModelProviderRow.tenant_id == tenant_id)
        .order_by(ModelProviderRow.created_at.desc())
    )
    return [_to_dict(r) for r in result.scalars().all()]


@router.post("", status_code=201)
async def create_provider(
    body: ProviderCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = ModelProviderRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=body.name,
        provider_type=body.provider_type,
        api_key_encrypted=body.api_key_encrypted,
        base_url=body.base_url,
        models=body.models,
        is_default=body.is_default,
        enabled=body.enabled,
    )
    db.add(row)
    await db.commit()
    return _to_dict(row)


@router.put("/{provider_id}")
async def update_provider(
    provider_id: str,
    body: ProviderUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ModelProviderRow).where(
            ModelProviderRow.id == provider_id,
            ModelProviderRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Model provider not found")

    if body.name is not None:
        row.name = body.name
    if body.provider_type is not None:
        row.provider_type = body.provider_type
    if body.api_key_encrypted is not None and "•" not in body.api_key_encrypted:
        row.api_key_encrypted = body.api_key_encrypted
    if body.base_url is not None:
        row.base_url = body.base_url
    if body.models is not None:
        row.models = body.models
    if body.is_default is not None:
        row.is_default = body.is_default
    if body.enabled is not None:
        row.enabled = body.enabled

    await db.commit()
    await db.refresh(row)
    return _to_dict(row)


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ModelProviderRow).where(
            ModelProviderRow.id == provider_id,
            ModelProviderRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Model provider not found")
    await db.delete(row)
    await db.commit()


# ── Provider connection test ─────────────────────────────────────────────────

_PROVIDER_TEST_URLS = {
    "anthropic": "https://api.anthropic.com/v1/messages",
    "openai": "https://api.openai.com/v1/models",
    "google": "https://generativelanguage.googleapis.com/v1beta/models",
}


@router.post("/{provider_id}/test")
async def test_provider(
    provider_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Test connection to a model provider by making a lightweight API call."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ModelProviderRow).where(
            ModelProviderRow.id == provider_id,
            ModelProviderRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Model provider not found")

    api_key = row.api_key_encrypted or ""
    provider = row.provider_type
    base_url = row.base_url

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if provider == "anthropic":
                url = base_url or "https://api.anthropic.com/v1/messages"
                resp = await client.post(
                    url,
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": "claude-haiku-4-5-20251001",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
            elif provider == "openai" or provider == "azure_openai":
                # Test via a tiny chat completion. Works for OpenAI, Azure
                # OpenAI, Hugging Face Router, Together, Fireworks, vLLM,
                # LM Studio, and anything else that speaks the OpenAI API.
                # /v1/models doesn't exist on every provider (HF in particular).
                base = (base_url or "https://api.openai.com/v1").rstrip("/")
                url = base if base.endswith("/chat/completions") else base + "/chat/completions"
                # Pick any model the user has registered; default to a tiny one.
                models = row.models or []
                first_model = (
                    (models[0].get("id") if isinstance(models[0], dict) else models[0])
                    if models else "gpt-4o-mini"
                )
                resp = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": first_model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
            elif provider == "google":
                url = base_url or "https://generativelanguage.googleapis.com/v1beta/models"
                resp = await client.get(f"{url}?key={api_key}")
            elif provider == "local":
                url = base_url or "http://localhost:11434/api/tags"
                resp = await client.get(url)
            else:
                return {"success": False, "error": f"Unknown provider type: {provider}"}

            if resp.status_code < 400:
                return {"success": True, "status_code": resp.status_code}
            else:
                return {
                    "success": False,
                    "status_code": resp.status_code,
                    "error": resp.text[:500],
                }
    except Exception as exc:
        return {"success": False, "error": str(exc)}
