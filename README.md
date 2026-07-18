# clean-architecture-template

TypeScript monorepo template for Clean Architecture projects.

## Workspaces

- `domain`: framework-independent domain model, result contracts, use cases, and ports.
- `apps/api`: Node HTTP adapter that composes domain use cases.
- `apps/web`: React/Vite adapter that consumes the domain package.

## Rules

- Dependencies point inward: apps may depend on `app-domain`; `domain` must not depend on apps.
- Domain results use the discriminated `Result` contract.
- Tests must exist; `passWithNoTests` is disabled.

## Commands

- `yarn test`
- `yarn build`
- `yarn workspace api dev`
- `yarn workspace web dev`
