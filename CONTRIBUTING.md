# Contributing to SwarmEngine

Thanks for your interest in contributing! This document covers the basics.

## Development Setup

```bash
git clone https://github.com/divyekant/swarm-engine.git
cd swarm-engine
npm install
npm run build
npm test
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Write your code and add tests
3. Run `npm test` and `npm run typecheck` to verify
4. Submit a pull request

## Code Style

- TypeScript strict mode is enforced
- ESM modules only (no CommonJS)
- Keep dependencies minimal

## Tests

All new features and bug fixes should include tests. Run:

```bash
npm test            # run all tests
npm run test:watch  # watch mode
npm run typecheck   # type checking
```

## Reporting Issues

Open a GitHub issue with:
- What you expected to happen
- What actually happened
- Minimal reproduction steps

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
