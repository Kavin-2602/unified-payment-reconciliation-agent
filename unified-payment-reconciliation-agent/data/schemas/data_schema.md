# Sample Data Schema Reference

## CSV Column Definitions

All settlement CSV files share the same column schema:

| Column | Required | Type | Description |
|--------|----------|------|-------------|
| `transaction_id` | ✅ | string | Primary match key — must map to Dodo `payment_id` |
| `merchant_order_id` | optional | string | Your internal order ID |
| `amount` | ✅ | decimal | Settlement amount in major units (e.g., 1500.00 for ₹1500) |
| `currency` | optional | string | Default: `INR` |
| `payment_method` | optional | string | `upi` \| `card` \| `cash` \| `bank` |
| `status` | optional | string | Default: `settled` |
| `settlement_date` | optional | date (YYYY-MM-DD) | Date settlement was processed |

## Accepted Column Aliases

The backend's CSV parser accepts these alternative column names:

| Canonical Name | Accepted Aliases |
|---------------|------------------|
| `transaction_id` | `txn_id`, `id` |
| `merchant_order_id` | `order_id` |
| `settlement_date` | `date` |

## Sample Files and Intended Scenarios

| File | Source | Scenarios Demonstrated |
|------|--------|----------------------|
| `upi_settlement.csv` | UPI | MATCHED ×3, MISMATCHED ×2, DUPLICATE ×1, extra settlement ×1 |
| `card_settlement.csv` | Card | MATCHED ×4, MISMATCHED ×1, MISSING ×1 (pay_card_004 absent) |
| `cash_settlement.csv` | Cash | MATCHED ×3, MISSING ×1 (pay_cash_004 absent) |
| `bank_settlement.csv` | Bank transfer | MATCHED ×3, MISMATCHED ×1, MISSING ×1 (pay_bank_005 absent) |

## Dodo Payments Webhook Data (simulated)

The webhook data that the backend stores in `dodo_payments` table:

| Field | Maps to |
|-------|---------|
| `payment_id` | CSV `transaction_id` — the join key |
| `total_amount` | The authoritative amount from Dodo |
| `status` | `succeeded` / `failed` / `refunded` |
| `payment_method.type` | `upi` / `card` / `bank_transfer` |

## Reconciliation Logic (Phase 2)

The engine will join `dodo_payments` ↔ `settlement_transactions` on `payment_id = transaction_id` and classify each row:

```
MATCHED     → found in both, amounts equal (within ₹0.50 tolerance)
MISMATCHED  → found in both, amounts differ by > ₹0.50
MISSING     → found in webhook only OR settlement only
DUPLICATE   → transaction_id appears > 1 time in settlement_transactions for same source
```

**Amount tolerance**: ₹0.50 to account for rounding differences in payment gateways.
