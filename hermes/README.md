# hermes/

Código e configuração do Hermes (assistente do Prisma no Discord), versionados aqui e instalados na VPS. Fica fora do build do Next e do workflow de deploy (DV6).

## `plugin-prisma/`

Plugin nativo com as ferramentas do Prisma. Cada uma chama o `ai-gateway` (Supabase Edge Function).

- **Leitura:** `prisma_listar_projetos`, `prisma_listar_tarefas`, `prisma_ver_tarefa`, `prisma_buscar_contexto` e `prisma_buscar_conhecimento`.
- **Escrita com confirmação (Etapa 5):** `prisma_criar_tarefa`, `prisma_atualizar_tarefa`, `prisma_comentar_tarefa` (sempre interno) e `prisma_registrar_contexto` só propõem. O gateway devolve um código de 6 dígitos, que o plugin envia ao usuário numa DM separada (API REST do Discord, `DISCORD_BOT_TOKEN`) e tira da resposta ao LLM (S3). O usuário digita o código na conversa e `prisma_confirmar_acao` executa com a sessão dele. O código vale 10 minutos, é de uso único e três erros cancelam a ação. Não há exclusão.
- **Áudio (Etapa 6):** o plugin registra o provedor de transcrição `prisma_stt` (`stt.provider: prisma_stt` no `config.yaml`). Antes de enviar o áudio, confere que a conversa é DM e que o autor está vinculado (`whoami` no gateway); senão o áudio não sai da VPS. A mensagem de voz (ogg/opus) é convertida para mp3 com ffmpeg e transcrita pelo Gemini 3.5 Flash do router da Hostinger. O Whisper do router não serve: o Cloudflare na frente dele devolve desafio (403) a uploads binários acima de ~1 KB. A última transcrição de cada usuário fica 30 minutos em memória, e `prisma_registrar_transcricao` grava esse texto literal no contexto do projeto (tipo transcrição), também com código. Só mensagens de voz: arquivos de áudio anexados não são transcritos.

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

## `routine/`

Rotina diária da Etapa 4: para cada projeto ativo com **Canal do Discord** preenchido no editor do projeto, lê as mensagens do dia anterior, pede ao Claude Haiku 5.5 (router da Hostinger) um resumo em JSON (resumo, decisões e pendências) e grava no **Contexto** do projeto com o tipo "Discord".

- Script determinístico, não é agente (H9): o canal define o projeto; o LLM só resume, sem ferramentas, e a conversa entra no prompt como dado.
- Credencial própria `ROUTINE_SECRET` (cabeçalho `x-routine-secret`), que no `ai-gateway` só lista canais e grava contexto (N5).
- Idempotente: reexecutar o mesmo dia atualiza a mesma entrada (`source_ref = canal:data`).
- Relatório em `#prisma-operacao` (sucesso ou falha por canal e canais do servidor sem projeto) e auditoria em `ai_actions_log` com `source = 'routine'`. O journald guarda só contagens e códigos.
- Mensagens de bots, inclusive as do próprio assistente, ficam fora do resumo.

### Instalação na VPS

O timer roda às **00:30 (America/Sao_Paulo)** e resume o dia anterior inteiro. Assim nenhuma mensagem da noite fica de fora, o que poderia acontecer com um horário antes da meia-noite. O serviço roda com usuário efêmero (`DynamicUser`), sem acesso ao Hermes nem ao Docker.

```bash
# na máquina local, a partir da raiz do repositório
tar cf - -C hermes/routine prisma_routine.py prisma-routine.service prisma-routine.timer | ssh iago@187.127.8.245 'mkdir -p /tmp/pr && tar xf - -C /tmp/pr && sudo install -D -m 755 /tmp/pr/prisma_routine.py /opt/prisma-routine/prisma_routine.py && sudo install -m 644 /tmp/pr/prisma-routine.service /tmp/pr/prisma-routine.timer /etc/systemd/system/ && sudo systemctl daemon-reload && rm -rf /tmp/pr'
```

As variáveis ficam em `/etc/prisma-routine.env` (root, 600): `ROUTINE_SECRET`, `DISCORD_BOT_TOKEN`, `NEXOS_API_KEY`, `OPS_CHANNEL_ID` (#prisma-operacao), `DISCORD_GUILD_ID` e `ROUTINE_IGNORE_CHANNELS` (IDs que não geram alerta de canal sem projeto, como #prisma-ia). Ao rotacionar o token do bot ou a chave do router, atualize também este arquivo. O `ROUTINE_SECRET` precisa ser o mesmo nos Secrets das Edge Functions.

```bash
sudo systemctl enable --now prisma-routine.timer      # liga o agendamento
sudo systemctl start prisma-routine.service           # executa agora (dia anterior)
journalctl -u prisma-routine.service -n 50            # resultado
# outro dia ou simulação, com as mesmas variáveis:
sudo systemd-run --wait --pipe -p EnvironmentFile=/etc/prisma-routine.env -p DynamicUser=yes \
  /usr/bin/python3 -I /opt/prisma-routine/prisma_routine.py --date 2026-11-12 --dry-run
```
