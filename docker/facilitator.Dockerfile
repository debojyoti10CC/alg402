# Builds and runs GoPlausible's real x402-avm facilitator example.
#
# Upstream (github.com/GoPlausible/x402-avm, branch-v2-algorand-publish) ships
# the facilitator as a pnpm-workspace-internal package (@x402-avm/core-facilitator-typescript,
# depending on @x402-avm/* via `workspace:*`) with no Dockerfile of its own — it's
# meant to be run from within the monorepo, not installed standalone. This image
# clones the repo at build time and runs the real, unmodified facilitator package
# straight out of that workspace. See DECISIONS.md D1.
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10 --activate

ARG X402_AVM_REPO=https://github.com/GoPlausible/x402-avm.git
ARG X402_AVM_REF=branch-v2-algorand-publish

WORKDIR /src
RUN git clone --depth 1 --branch "${X402_AVM_REF}" "${X402_AVM_REPO}" repo

WORKDIR /src/repo/examples/typescript
RUN pnpm install --frozen-lockfile=false
# Plain `pnpm build` (turbo run build) builds every example in the monorepo,
# including unrelated apps like @x402-avm/next-example that fail without
# app-specific env vars (e.g. FACILITATOR_URL) never needed by Ward. Filter to
# just the facilitator and its actual workspace dependencies.
RUN pnpm --filter "@x402-avm/core-facilitator-typescript..." run build

FROM node:20-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10 --activate
# node_modules/@x402-avm/* are pnpm workspace symlinks with relative targets
# like ../../../../../typescript/packages/mechanisms/avm, which reach outside
# examples/typescript into the sibling typescript/packages/ tree. Copying only
# examples/typescript (flattened to /app) breaks those symlinks, so preserve
# the full repo path structure instead.
COPY --from=builder /src/repo /src/repo

WORKDIR /src/repo/examples/typescript/facilitator
EXPOSE 4022
CMD ["pnpm", "start"]
