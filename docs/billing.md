# Billing guide

Company billing routes use the authenticated company's Stellar address and are
available only to `UserRole.COMPANY`:

- `GET /api/v1/companies/me/billing`
- `GET /api/v1/companies/me/billing/export.csv`

Optional `from` and `to` query parameters are ISO dates. If neither is given,
the service uses the current calendar month. Engagements are included when
their `createdAt` is within the inclusive date range.

## Calculation

The billing summary is an aggregate of the stored engagement amounts; it does
not apply a separate percentage, rate, tax, or platform-fee multiplier. In
other words, the currently implemented additional fee is zero; the reported
values are the escrowed and released amounts themselves.

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

## CSV export

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
data rows.
