# hermes/

Código e configuração do Hermes (assistente do Prisma no Discord), versionados aqui e instalados na VPS. Fica fora do build do Next e do workflow de deploy (DV6).

## `plugin-prisma/`

Plugin nativo com as ferramentas de leitura do Prisma: `prisma_listar_projetos`, `prisma_listar_tarefas`, `prisma_ver_tarefa`, `prisma_buscar_contexto` e `prisma_buscar_conhecimento`. Cada uma chama o `ai-gateway` (Supabase Edge Function).

- O autor vem do contexto da sessão do Hermes (`HERMES_SESSION_USER_ID`), nunca de argumento do LLM (spike S1).
- Fora de uma DM do Discord, a ferramenta recusa sem chamar o gateway, porque dados de projeto só circulam por DM.
- O segredo `HERMES_GATEWAY_SECRET` fica no `.env` do Hermes na VPS e nos Secrets das Edge Functions; nunca no repositório.

### Instalação na VPS

```bash
# na máquina local, a partir da raiz do repositório
tar cf - -C hermes plugin-prisma | ssh iago@187.127.8.245 'mkdir -p /tmp/pp && tar xf - -C /tmp/pp && sudo rm -rf /docker/hermes-agent-iipr/data/plugins/prisma && sudo cp -r /tmp/pp/plugin-prisma /docker/hermes-agent-iipr/data/plugins/prisma && sudo chown -R 10000:10000 /docker/hermes-agent-iipr/data/plugins/prisma && rm -rf /tmp/pp'
```

Na primeira instalação, habilite o plugin e o toolset **só no Discord**. O `hermes plugins enable` adiciona o toolset a todas as plataformas, então ele precisa ser removido das outras logo em seguida:

```bash
hermes plugins enable prisma
hermes tools enable --platform discord prisma
for p in cli api_server cron webhook; do hermes tools disable --platform $p prisma; done
```

Depois, reinicie o container (`docker compose restart` em `/docker/hermes-agent-iipr`).

No `config.yaml`, `discord.dm_role_auth_guild` aponta para o servidor do Prisma. Assim quem tem o papel **Prisma IA** consegue falar com o bot por DM; sem essa opção, DMs aceitam só os IDs de `DISCORD_ALLOWED_USERS`.
