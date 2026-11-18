# Contributing

## Local setup

1. Install the supported Node.js runtime and npm.
2. Run `npm ci` and `npm run dev` from the repository root.
3. Before submitting changes, run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.

## Engineering conventions

- Preserve strict TypeScript and the existing App Router structure.
- Reuse components in `components/ui/`; these are based on Base UI. Check installed APIs before adapting shadcn examples built for other primitives.
- Keep tenant and permission decisions on the server once backend work begins; use shared schemas and permission helpers.
- Label preview-only data and avoid claiming an operation is durable or collaborative before it is verified end-to-end.
- Respect keyboard access, reduced motion, responsive layouts, and visible loading/error/empty states.
- Add focused tests when implementing backend behavior. Document commands and results accurately.
