# Multi-currency configuration

`ALLOWED_TOKENS` is an environment variable containing a JSON array. It is
loaded when `StellarService` starts and defines the token contract addresses
the backend accepts for new engagements.

## Schema

Each item has an `address`, display `symbol`, and token `decimals` value:

```env
ALLOWED_TOKENS=[{"address":"CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA","symbol":"USDC","decimals":7}]
```

```json
[
  {
    "address": "<Stellar/Soroban token contract address>",
    "symbol": "USDC",
    "decimals": 7
  }
]
```

| Field | Type | Meaning |
| --- | --- | --- |
| `address` | string | The token contract address sent as `tokenAddress`. Matching is exact and case-sensitive. |
| `symbol` | string | Display label for the token. |
| `decimals` | number | Number of base-unit decimal places used when converting for display. |

Invalid JSON is logged during startup and treated as an empty allowlist. Use a
valid JSON array in the deployed environment and restart the service after a
change.

## Engagement validation

`POST /api/v1/engagements` requires a `tokenAddress`. Before an on-chain
transaction is submitted, the service checks whether any configured token has
an exactly equal `address`. An address not present in `ALLOWED_TOKENS` causes a
`400 Bad Request` with `Token <address> is not allowed`; no engagement is
created and no contract call is submitted.

`symbol` and `decimals` do not decide whether a token is permitted: only the
configured address does. The configuration is therefore the allowlist for each
environment.

## Amounts and display

Stored and API amount fields such as `totalAmount` and `releasedAmount` are
integer base units (historically called "stroops" in this project) and are
serialized as strings to preserve precision. To display an amount, look up the
engagement's `tokenAddress`, use that token's `decimals`, and divide by
`10 ** decimals`. For example, with `decimals: 7`, `5000000000` displays as
`500.0000000`.

The backend conversion helpers perform the inverse conversion for input and
format output to the configured decimal precision. Clients should use decimal
or big-integer arithmetic rather than JavaScript floating-point arithmetic for
money calculations.
