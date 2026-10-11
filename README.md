# Tramotak

Central de estudos desktop: importe cursos que já estão no seu computador e estude com eles.
Windows, macOS e Linux (Electron + React + TypeScript).

Plano do primeiro objetivo: [docs/PLANO-MVP.md](docs/PLANO-MVP.md).

## Desenvolvimento

Requer Node.js 22.12 ou superior.

```bash
npm install
npm run dev        # abre o app com hot reload
npm run lint
npm run typecheck
npm test
npm run dist:linux # gera instaladores em dist/ (também dist:win e dist:mac)
```

## Estrutura

```
src/main/      processo principal (janela, IPC)
src/preload/   ponte segura main ↔ interface (window.api)
src/shared/    tipos e lógica compartilhados
src/renderer/  interface React
tests/unit/    testes Vitest
```
