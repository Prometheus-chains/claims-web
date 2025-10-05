# claims-web — Prometheus Chains

Web console for **claims** on Base: an **Admin Console** for ops + a **Provider Portal** to submit claims and view history.

![License](https://img.shields.io/badge/license-Apache--2.0-blue)

> **Status:** Experimental, not audited. Use at your own risk.

---

## ✨ Features

**Admin Console**
- View vault balance (USDC) via `Bank.vaultBalance()`.
- Pause / unpause engine (`ClaimEngine.setPaused`).
- Manage **Rules** (enable/disable, price, `maxPerYear`, label).
- Manage **Providers** (whitelist + active-year windows).
- Manage **Coverage** (pseudonymous `patientId` bytes32 + active-year windows).

**Provider Portal**
- Submit claim: `patientId (bytes32)`, `code (uint16)`, `year (YYYY)`.
- Live price preview from `Rules.getRule(code)`.
- Result banner from on-chain events: **Paid** (amount, visit #) or **Rejected** (reason).
- “My Claims” history (provider-scoped) with **chunked log scanning** to stay under common ~10k block RPC limits.

---

## 🧑‍💻 Quickstart

> Requires **Node 20+** and **pnpm 9+**.  
> If the app lives in a subfolder (e.g., `claims-web-` or `claims-web/`), `cd` into it first.

```bash
pnpm i
pnpm dev



# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      ...tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      ...tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      ...tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
