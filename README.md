# Prisma

Gerenciador de Projetos Ambtech (Ambiente Consultoria) — ferramenta interna, single-tenant.

Next.js (export estático) + Supabase, publicado na KingHost.

## Começando
```bash
cp .env.example .env.local   # preencha com URL e anon key do Supabase (dev)
npm install
npm run dev                  # http://localhost:3000
```

## Documentação
- [Requisitos e arquitetura (levantamento)](docs/REQUISITOS.md)
- [Decisões de implementação e modelo de acesso](docs/ARQUITETURA.md)
- [Roadmap / progresso](docs/ROADMAP.md)
- [Deploy na KingHost](docs/DEPLOY-KINGHOST.md)
- Regras para o Claude Code: [CLAUDE.md](CLAUDE.md)
