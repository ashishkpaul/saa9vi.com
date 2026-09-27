One scenario file per Phase 8 scenario. Each exports plain data (no assertions
in the scenario itself) and imports only `../auth`, `../graphql-client` and
`../fixture-types` — the contract these files must satisfy is in
`docs/implementation/e2e-fixtures.md`.
