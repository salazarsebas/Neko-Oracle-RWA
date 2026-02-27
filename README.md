# 📌 Stellar Stock Price Oracle

An open-source **off-chain oracle system** that provides **real-world stock price data** to the **Stellar network** in a secure, modular, SEP-compliant way.

## 🎯 What this Project Does

This project fetches stock prices from multiple external financial APIs, normalizes and aggregates them, cryptographically signs the results, exposes them via a backend API, and supports on-chain submission to a Stellar oracle contract, so smart contracts can depend on real stock prices.

The goal is to make this **reliable, testable, and extensible**, with each part implemented as a separate app or package in this monorepo.

## 🏗️ High-Level Architecture

The system consists of the following stages:

1. **Ingestor** - Connects to external stock price APIs
2. **Aggregator** - Normalizes, filters, and aggregates data
3. **Signer** - Produces signed proofs of aggregated prices
4. **API Publisher** - Exposes a REST/WebSocket endpoint
5. **Transactor** - Submits signed data on-chain
6. **Smart Contracts** - SEP-compliant Oracle on Stellar
7. **Frontend Demo** - UI for visualizing feeds

Data flows from raw external sources → ingestor → aggregator → signer → API → on-chain oracle.

## 🗂️ Monorepo Layout

```
/oracle-stocks-monorepo
├── apps/
│   ├── ingestor/        # Connects to external stock price APIs
│   ├── aggregator/      # Normalizes, filters, and aggregates data
│   ├── api/             # REST/WebSocket API endpoint
│   ├── transactor/      # Submits signed data on-chain
│   ├── frontend/        # UI for visualizing feeds
│   └── smart-contracts/ # SEP-compliant Oracle on Stellar
├── packages/
│   ├── shared/          # Shared utilities, types, and constants
│   └── signer/          # Cryptographic signing of price data
├── tests/               # Integration and E2E tests
├── docs/                # Documentation
├── infra/               # Infrastructure as code
├── .github/             # GitHub workflows and templates
├── turbo.json           # Turborepo configuration
└── README.md
```

## 📌 How We Work

Each app will be developed **one by one using issue prompts** that include:

- Context and goals
- Expected inputs and outputs
- Tech stack and conventions
- Acceptance criteria
- Minimal scaffolding (just enough to get started)

We will **not build everything at once** — each issue will introduce the next piece.

## 🧑‍💻 Contributions

Contributors should:

1. Read the contextual issue
2. Understand how their module fits into the architecture
3. Implement the minimum viable feature first
4. Add tests and documentation
5. Submit PRs with clear description

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9

### Installation

```bash
npm install
```

### Development

```bash
# Run all apps in development mode
npm run dev

# Run a specific app
npm run dev --filter=@oracle-stocks/ingestor

# Build all apps and packages
npm run build

# Lint all code
npm run lint

# Type check
npm run check-types
```

## 📚 Documentation

See the [docs/](./docs/) directory for detailed documentation.

## 🧪 Testing

Integration and end-to-end tests are located in the [tests/](./tests/) directory.

```bash
# Run all tests
npm test

# Run tests for a specific package
npm test --filter=@oracle-stocks/shared
```

## 🏥 CI / Repo Health

Before pushing, verify that the full CI pipeline passes locally:

```bash
npm ci && npm run lint && npm run check-types && npm run build && npm test
```

| Command              | What it does                                      |
|----------------------|---------------------------------------------------|
| `npm run lint`       | Runs ESLint across all workspaces via Turborepo   |
| `npm run check-types`| Runs `tsc --noEmit` in all TypeScript workspaces  |
| `npm run build`      | Builds all apps and packages via Turborepo        |
| `npm test`           | Runs Jest tests in all workspaces                 |

CI runs these same steps automatically on every push and PR to `main` and `develop`.

## 📄 License

MIT License
