"""Domain enums. Stored as VARCHAR + CHECK constraints (portable, migration-friendly)."""

from app.database.base import StrEnum


class UserRole(StrEnum):
    USER = "user"
    ADMIN = "admin"  # assigned only directly in the database, never via the API


class AgentKind(StrEnum):
    DEMO = "demo"          # platform-operated demonstration provider
    EXTERNAL = "external"  # independently deployed / owner-operated provider


class AgentStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"  # admin action


class ServiceCategory(StrEnum):
    CRYPTO_RESEARCH = "crypto_research"
    MARKET_DATA = "market_data"
    AI_ANALYTICS = "ai_analytics"
    OTHER = "other"


class ProcurementStatus(StrEnum):
    CREATED = "created"
    QUOTING = "quoting"
    QUOTED = "quoted"
    SELECTED = "selected"
    PAYMENT_PENDING = "payment_pending"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class QuotationStatus(StrEnum):
    SUBMITTED = "submitted"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    EXPIRED = "expired"


class PaymentStatus(StrEnum):
    DRAFT = "DRAFT"
    VALIDATED = "VALIDATED"
    AWAITING_SIGNATURE = "AWAITING_SIGNATURE"
    SIGNED = "SIGNED"
    SUBMITTED = "SUBMITTED"
    PENDING = "PENDING"
    SETTLED = "SETTLED"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class DeliveryStatus(StrEnum):
    NOT_STARTED = "not_started"
    DELIVERED = "delivered"
    FAILED = "failed"


class AgentRole(StrEnum):
    USER = "user"
    BUYER_AGENT = "buyer_agent"
    PROVIDER_AGENT = "provider_agent"
    PAYMENT_AGENT = "payment_agent"
    SYSTEM = "system"


class MessageType(StrEnum):
    TASK_PARSED = "task_parsed"
    SERVICE_REQUEST = "service_request"
    QUOTATION = "quotation"
    RECOMMENDATION = "recommendation"
    SELECTION = "selection"
    PAYMENT_CONDITIONS = "payment_conditions"
    DELIVERY = "delivery"
    NOTE = "note"


# Payment states that "occupy" a quotation / count toward the daily limit.
ACTIVE_PAYMENT_STATES = (
    PaymentStatus.DRAFT,
    PaymentStatus.VALIDATED,
    PaymentStatus.AWAITING_SIGNATURE,
    PaymentStatus.SIGNED,
    PaymentStatus.SUBMITTED,
    PaymentStatus.PENDING,
    PaymentStatus.SETTLED,
)
