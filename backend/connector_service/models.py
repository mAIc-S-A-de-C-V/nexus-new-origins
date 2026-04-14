from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field
from uuid import uuid4


class ConnectorConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: str
    category: str
    status: str = "idle"
    description: Optional[str] = None
    base_url: Optional[str] = None
    auth_type: str = "None"
    credentials: Optional[dict[str, str]] = None
    headers: Optional[dict[str, str]] = None
    pagination_strategy: Optional[str] = None
    active_pipeline_count: int = 0
    last_sync: Optional[datetime] = None
    last_sync_row_count: Optional[int] = None
    schema_hash: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    tenant_id: str
    tags: list[str] = Field(default_factory=list)
    config: Optional[dict[str, Any]] = None


class ConnectorPublicView(BaseModel):
    """ConnectorConfig without secret credentials — safe for API responses.

    config_metadata contains the non-secret parts of credentials (URLs, field names,
    body templates) so the frontend can populate config forms. Secret values
    (token, keyValue, password, clientSecret) are never returned.
    """
    id: str
    name: str
    type: str
    category: str
    status: str
    description: Optional[str] = None
    base_url: Optional[str] = None
    auth_type: str
    headers: Optional[dict[str, str]] = None
    pagination_strategy: Optional[str] = None
    active_pipeline_count: int
    last_sync: Optional[datetime] = None
    last_sync_row_count: Optional[int] = None
    schema_hash: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    tenant_id: str
    tags: list[str]
    config: Optional[dict] = None
    config_metadata: Optional[dict[str, str]] = None  # non-secret credential config

    @classmethod
    def from_config(cls, c: "ConnectorConfig") -> "ConnectorPublicView":
        data = {k: v for k, v in c.model_dump().items() if k != "credentials"}
        if c.credentials:
            secret_keys = {"token", "keyValue", "password", "clientSecret"}
            data["config_metadata"] = {
                k: v for k, v in c.credentials.items() if k not in secret_keys
            }
        return cls(**data)


class ConnectorCreateRequest(BaseModel):
    name: str
    type: str
    category: str
    description: Optional[str] = None
    base_url: Optional[str] = None
    auth_type: str = "None"
    credentials: Optional[dict[str, str]] = None
    headers: Optional[dict[str, str]] = None
    pagination_strategy: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    config: Optional[dict[str, Any]] = None


class ConnectorUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    base_url: Optional[str] = None
    auth_type: Optional[str] = None
    credentials: Optional[dict[str, str]] = None
    headers: Optional[dict[str, str]] = None
    pagination_strategy: Optional[str] = None
    tags: Optional[list[str]] = None
    config: Optional[dict[str, Any]] = None


class ConnectionTestResult(BaseModel):
    success: bool
    latency_ms: int
    message: str
    error: Optional[str] = None
