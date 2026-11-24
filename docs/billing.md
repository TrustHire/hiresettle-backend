# Billing guide

Company billing routes use the authenticated company's account (`UserRole.COMPANY`, with `CompanyRole.OWNER` or `CompanyRole.BILLING` where guarded):

- `GET /api/v1/companies/me/billing` — billing summary (supports optional `from`, `to`, and `fiat`)
- `GET /api/v1/companies/me/billing/export.csv` — CSV export for the company's engagements
- `GET /api/v1/companies/me/billing/usage` — trailing 24-hour API usage count
- `GET /api/v1/companies/me/billing/invoices/:id.pdf` — PDF invoice with VAT / reverse-charge calculation
- `GET /api/v1/companies/me/tax-profile` / `PUT /api/v1/companies/me/tax-profile` — company tax country and VAT ID
- `GET /api/v1/companies/me/credits/balance` — current prepaid credit balance
- `GET /api/v1/companies/me/credits/transactions` — paginated prepaid credit ledger history
- `GET /api/v1/billing/export` — billing history CSV export (`COMPANY` sees own records; `ADMIN` sees all)

Optional `from` and `to` query parameters are ISO dates. If neither is given,
the service uses the current calendar month. Engagements are included when
their `createdAt` is within the inclusive date range.

## Calculation

The billing summary is an aggregate of the stored engagement amounts:

```text
totalEscrowed = sum(engagement.totalAmount)
totalReleased = sum(engagement.releasedAmount)
totalEngagements = count(included engagements)
```

Both amount fields are integer token base units (called "stroops" in the code)
and are returned as strings to avoid losing precision. To display a value, use
the engagement token's configured decimal precision from `ALLOWED_TOKENS` and
divide by `10 ** decimals`; do not assume a two-decimal currency or convert the
values to JavaScript `number`.

## Prepaid Credit Ledger

Companies can hold a prepaid credit balance in an append-only ledger (`credit_ledger`). Each entry carries a signed integer `amount` in minor units and a `balanceAfter` snapshot; the current balance is the `balanceAfter` of the company's highest `sequence`.

### Entry types (`CreditLedgerEntryType`)

| Type | Sign | Description |
| --- | --- | --- |
| `PURCHASE` | Positive | Credits purchased by the company. |
| `GRANT` | Positive | Promotional, discount, or goodwill credits issued by an admin. |
| `FEE_DEDUCTION` | Negative | Credits automatically consumed to pay a platform fee (`fee:<reference>`). |
| `REVERSAL` | Positive or negative | Undoes a previous entry (e.g., a refunded fee). |
| `ADJUSTMENT` | Positive or negative | Manual admin correction. |

### Endpoints

- **Company balance**: `GET /api/v1/companies/me/credits/balance`
  ```json
  {
    "companyId": "company-uuid",
    "balance": "5000000"
  }
  ```
- **Company ledger history**: `GET /api/v1/companies/me/credits/transactions?page=1&limit=50&type=PURCHASE`
  ```json
  {
    "data": [
      {
        "id": "entry-uuid",
        "companyId": "company-uuid",
        "sequence": 1,
        "type": "PURCHASE",
        "amount": "5000000",
        "balanceAfter": "5000000",
        "description": "Prepaid credit top-up",
        "reference": "inv-1001",
        "idempotencyKey": "topup-1001",
        "createdAt": "2026-10-19T10:00:00.000Z"
      }
    ],
    "page": 1,
    "limit": 50,
    "total": 1
  }
  ```
- **Admin management**:
  - `GET /api/v1/admin/companies/:companyId/credits` — returns `{ companyId, balance, data, page, limit, total }`
  - `POST /api/v1/admin/companies/:companyId/credits` — records `PURCHASE`, `GRANT`, `REVERSAL`, or `ADJUSTMENT` (negative amounts are restricted to `REVERSAL` and `ADJUSTMENT`; `FEE_DEDUCTION` is system-only). Supports `idempotencyKey`.

### Order of credit and promo/grant application

1. **Promotional / goodwill grants (`GRANT`) and purchased credits (`PURCHASE`)** are both recorded in the company's unified `CreditLedger` before billing settlement.
2. When a platform fee (`Plan.platformFeeBps` on engagement value) is assessed, `CreditLedgerService.applyToFee(companyId, feeAmount, reference)` consumes available credit first, up to `min(balance, feeAmount)`, writing an idempotent `FEE_DEDUCTION` entry keyed by `fee:<reference>`.
3. Only the remaining `amountDue = feeAmount - creditApplied` is left to be charged by the external payment processor. If `balance >= feeAmount`, `amountDue` is `"0"`.

## Tax / VAT Handling

Invoice VAT is computed in `InvoiceTaxService` / `computeInvoiceTax` using integer minor units (`bigint`) and rates in basis points (`1 bp = 0.01%`, half-up rounding).

### Tax profile configuration

Companies configure their establishment country and VAT/tax ID via:
- `GET /api/v1/companies/me/tax-profile`
- `PUT /api/v1/companies/me/tax-profile`
  ```json
  {
    "taxCountry": "DE",
    "taxId": "DE123456789"
  }
  ```
  Send `"taxId": null` to clear the VAT ID.

Seller details and rate overrides are configured via environment variables:
- `INVOICE_SELLER_NAME` (default `"HireSettle"`)
- `INVOICE_SELLER_COUNTRY` (ISO 3166-1 alpha-2, e.g. `"IE"`)
- `INVOICE_SELLER_TAX_ID` (e.g. `"IE1234567T"`)
- `INVOICE_VAT_RATE_OVERRIDES` (JSON map of country code to basis points, e.g. `{"DE":1900}`)

### VAT treatment rules

| Treatment | Condition | Rate | Invoice notice |
| --- | --- | --- | --- |
| `NOT_REGISTERED` | Seller country or tax ID is not configured. | `0%` | None |
| `DOMESTIC` | Customer is in the same country as the seller, or customer country is unknown. | Seller's standard rate | `VAT <rate>% (<country>)` |
| `REVERSE_CHARGE` | Seller and customer are in different EU member states and customer has a structurally valid VAT ID. | `0%` | `Reverse charge: VAT to be accounted for by the recipient (Article 196, Council Directive 2006/112/EC).` |
| `EU_DESTINATION` | Seller and customer are in different EU member states and customer has no valid VAT ID. | Customer's standard rate (OSS) | `VAT charged at the rate of the customer's EU member state (One-Stop Shop).` |
| `OUTSIDE_SCOPE` | Customer is outside the seller's VAT area. | `0%` | `Services outside the scope of VAT in the supplier's country (place of supply: customer's country).` |

### How tax appears on invoices

`GET /api/v1/companies/me/billing/invoices/:id.pdf` renders:
- Seller and customer legal names, countries, and normalized VAT IDs
- Line-item subtotal (`subtotal`)
- Tax breakdown lines (`taxLines`: label, `rateBps`, `base`, `amount`)
- `taxTotal` and final `total = subtotal + taxTotal`
- Applicable statutory notices (`REVERSE_CHARGE`, `EU_DESTINATION`, or `OUTSIDE_SCOPE`)

## CSV export

### Company billing export (`GET /api/v1/companies/me/billing/export.csv`)

The export response is `text/csv` and is downloaded as `billing-export.csv`.
Its first row has these headers:

| Column | Value and unit |
| --- | --- |
| `Engagement ID` | Engagement identifier. |
| `Job Title` | Job title; embedded double quotes are CSV-escaped. |
| `Created At` | Engagement creation timestamp in ISO 8601 UTC format. |
| `Total Escrowed` | `totalAmount` in integer base units/stroops, not display units. |
| `Total Released` | `releasedAmount` in integer base units/stroops, not display units. |
| `Status` | Engagement status enum value. |

Each engagement produces one data row. After a blank row, the exporter adds a
summary row: `Summary,,,<totalEscrowed>,<totalReleased>,<N> engagements`.
The two summary amounts use the same base-unit/stroop representation as the
data rows. Passing the optional `fiat` query parameter (e.g. `?fiat=USD`) includes fiat-equivalent totals where configured.

### Billing history export (`GET /api/v1/billing/export`)

Available to `UserRole.COMPANY` (own engagements) and `UserRole.ADMIN` (all engagements), downloaded as `billing-history-<timestamp>.csv`:

| Column | Value and unit |
| --- | --- |
| `Date` | Engagement creation timestamp in ISO 8601 UTC format. |
| `Engagement Reference` | Engagement identifier. |
| `Amount (stroops)` | `totalAmount` in integer base units/stroops. |
| `Status` | Engagement status enum value. |
