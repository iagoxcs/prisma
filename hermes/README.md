# hermes/

Código e configuração do Hermes (assistente do Prisma no Discord), versionados aqui e instalados na VPS. Fica fora do build do Next e do workflow de deploy (DV6).

## `plugin-prisma/`

Plugin nativo com as ferramentas do Prisma. Cada uma chama o `ai-gateway` (Supabase Edge Function).

- **Onde funciona (DP6, plugin 0.10.0):** na DM com o bot e nos canais e tópicos do Discord em que ele é chamado (@prisma), com os dados que o autor pode ver (RLS). Num canal, a resposta, as prévias e os arquivos gerados ficam visíveis a quem lê o canal; só o ✅ ou o "sim" do autor do pedido confirmam uma prévia (reação ou "sim" de outra pessoa não contam, e a menção `@prisma sim` vale). A transcrição de áudio continua só na DM. Se o Hermes não informar o canal da sessão, a prévia vai para a DM do autor.
- **Leitura:** `prisma_listar_projetos`, `prisma_listar_tarefas`, `prisma_ver_tarefa`, `prisma_buscar_contexto` e `prisma_buscar_conhecimento` (metodologias, modelos e, desde a 0.10.1, conhecimento organizacional; P14). Desde a Onda 7, as tarefas trazem o nome do responsável (`assignee_name`) e o responsável no cliente (`client_owner`), e os projetos vêm com o rótulo "Projeto - Cliente" (`label`), que o bot usa sempre que cita um projeto.
- **Escrita com prévia (Etapa 5, revista em 13/11/2026):** `prisma_criar_tarefa`, `prisma_criar_tarefas_lote` (até 30 tarefas de qualquer lista, como texto colado, planilha, arquivo ou a seção "Saídas e Responsáveis" de uma ata, numa única prévia e um único ✅; se o LLM ainda assim propuser tarefas uma a uma, o plugin junta as propostas de criação abertas do mesmo usuário no mesmo projeto (janela de 5 minutos, até 30 tarefas) numa prévia única e apaga as anteriores da conversa; o responsável vem de `prisma_listar_membros`), `prisma_atualizar_tarefa`, `prisma_comentar_tarefa` (sempre interno), `prisma_registrar_contexto`, `prisma_registrar_transcricao`, `prisma_registrar_arquivo` e `prisma_anexar_arquivo` só propõem. O plugin posta na conversa do pedido (DM ou canal) uma **prévia** com tudo o que será gravado, com as reações ✅ e ❌. O usuário confirma clicando em ✅: como reação no Discord não chega ao Hermes como mensagem, o plugin observa a prévia (uma leitura a cada 2 s, até decidir ou expirar) e grava sozinho, com a sessão dele, editando a prévia com o resultado. Também dá para responder "sim"; aí `prisma_confirmar_acao` confere a resposta na API REST do Discord (`DISCORD_BOT_TOKEN`) antes de gravar. ❌ ou "não" cancela (`prisma_cancelar_acao`). O segredo da proposta fica só na memória do plugin (nunca vai ao LLM), a prévia vale 10 minutos e é de uso único. As prévias abertas sobrevivem a um reinício do container (O3): o plugin informa ao gateway onde postou cada uma (`preview_posted`) e, ao iniciar, o processo `gateway run` pede as abertas (`resume_previews`, com um segredo novo) e volta a observá-las; a linha "prisma: prévias retomadas: N" aparece no log. A exceção são as prévias de anexo: o arquivo local não sobrevive, então elas expiram e o usuário reenvia. Não há exclusão.
- **Arquivos:** `prisma_ler_arquivo` (descrição com palavras-chave em português e inglês, porque o Hermes acha ferramentas por busca lexical) extrai o texto de TXT, MD, CSV, PDF, DOCX, XLSX, HTML e BPMN enviados na conversa (só do cache de documentos do Hermes, `/opt/data/cache/documents`). `prisma_gerar_arquivo` gera TXT, MD, HTML, DOCX, PDF, XLSX e BPMN 2.0 (com diagrama, uma raia por ator) e envia na conversa. `prisma_anexar_arquivo` anexa um desses arquivos a uma tarefa (até 10 MB, com prévia). Código em `files.py`, só com bibliotecas que já vêm na imagem (pypdf, python-docx, openpyxl, reportlab, lxml, markdown).
- **Áudio (Etapa 6):** o plugin registra o provedor de transcrição `prisma_stt` (`stt.provider: prisma_stt` no `config.yaml`). Antes de enviar o áudio, confere que a conversa é DM e que o autor está vinculado (`whoami` no gateway); senão o áudio não sai da VPS. A mensagem de voz (ogg/opus) é convertida para mp3 com ffmpeg e transcrita pela API de transcrição da OpenAI (`gpt-4o-transcribe`, `language=pt`; DP5, plugin 0.9.0), com a chave em `PRISMA_STT_OPENAI_KEY` no `.env` do Docker. O modelo pode ser trocado por `PRISMA_STT_MODEL`. Até a 0.8.0 ia ao Gemini pelo router da Hostinger. A última transcrição de cada usuário fica 30 minutos em memória, e `prisma_registrar_transcricao` grava esse texto literal no contexto do projeto (tipo transcrição), também com código. Só mensagens de voz: arquivos de áudio anexados não são transcritos.
- **Telemetria de uso (O5, plugin 0.8.0):** o plugin conta os tokens (DP3; desde a DP4 o bot usa a API do Claude, e o modelo aparece como `claude-sonnet-5-5`). Os hooks do Hermes `post_api_request` e `post_auxiliary_call` entregam o modelo e o uso (entrada, saída, leitura e escrita de cache) de cada chamada do bot; a transcrição soma o uso da própria resposta. Os números ficam num buffer em memória por dia (Brasília), fonte e modelo e vão ao gateway (`record_usage`) a cada 10 minutos e ao encerrar, só no processo `gateway run`. Nenhum conteúdo de mensagem entra. Se o gateway falhar, os números voltam ao buffer (até 500 combinações e 7 dias); a linha "prisma: telemetria de uso não enviada (código)" aparece no log. Chamadas de outros processos (`hermes chat` na VPS) não são contadas.

- O autor vem do contexto da sessão do Hermes (`HERMES_SESSION_USER_ID`), nunca de argumento do LLM (spike S1).
- Fora do Discord, a ferramenta recusa sem chamar o gateway. Até a 0.9.0 as ferramentas recusavam também fora da DM ("dados de projeto só por DM", 11/11/2026); a DP6 (24/11/2026) liberou os canais.
- O segredo `HERMES_GATEWAY_SECRET` fica no `.env` do Hermes na VPS e nos Secrets das Edge Functions; nunca no repositório.

### Instalação na VPS

```bash
# na máquina local, a partir da raiz do repositório
tar cf - --exclude='test_*.py' --exclude=__pycache__ -C hermes plugin-prisma | ssh iago@187.127.8.245 'mkdir -p /tmp/pp && tar xf - -C /tmp/pp && sudo rm -rf /docker/hermes-agent-iipr/data/plugins/prisma && sudo cp -r /tmp/pp/plugin-prisma /docker/hermes-agent-iipr/data/plugins/prisma && sudo chown -R 10000:10000 /docker/hermes-agent-iipr/data/plugins/prisma && rm -rf /tmp/pp'
```

Testes offline (sem rede), a partir da raiz do repositório: `python -m unittest discover -s hermes/plugin-prisma -p "test_*.py"`. O arquivo de teste não vai para a VPS.

Na primeira instalação, habilite o plugin e o toolset **só no Discord**. O `hermes plugins enable` adiciona o toolset a todas as plataformas, então ele precisa ser removido das outras logo em seguida:

```bash
hermes plugins enable prisma
hermes tools enable --platform discord prisma
for p in cli api_server cron webhook; do hermes tools disable --platform $p prisma; done
```

Depois, reinicie o container (`docker compose restart` em `/docker/hermes-agent-iipr`).

No `config.yaml`, `discord.dm_role_auth_guild` aponta para o servidor do Prisma. Assim quem tem o papel **Prisma IA** consegue falar com o bot por DM; sem essa opção, DMs aceitam só os IDs de `DISCORD_ALLOWED_USERS`.

Canais (DP6, 25/11/2026): no `data/.env` do Hermes, `DISCORD_REQUIRE_MENTION=true` continua e a linha `DISCORD_ALLOWED_CHANNELS` fica comentada. Assim o bot responde em qualquer canal do servidor quando chamado com @menção (até então, só no canal `1570163994159751409`). Para voltar a restringir, descomente a linha com os IDs dos canais (separados por vírgula) e reinicie o container. Backup da configuração anterior e do plugin 0.9.0 em `/docker/hermes-agent-iipr-backup-20261125/`.

## `skills/`

Skills do Hermes: instruções em Markdown (`SKILL.md` com frontmatter `name`, `description`, `metadata.hermes.tags`) que o agente lista e abre com `skills_list` e `skill_view`. Cada skill fica em `skills/<categoria>/<nome>/SKILL.md`; as do Prisma usam a categoria `prisma`.

- `prisma/ata-de-reuniao`: recebe uma ata (arquivo ou texto), registra no Contexto do projeto e propõe as tarefas de "Saídas e Responsáveis" numa prévia só.

Como escrever uma skill nova:

- O Hermes acha skills por busca de palavras: ponha na `description` e nas `tags` os termos em português **e** em inglês que o consultor usaria.
- A skill só orienta; quem lê e grava são as ferramentas `prisma_*`, com as mesmas travas (só Discord, autor pela sessão, prévia com ✅ do autor). Uma skill nunca deve pedir terminal, arquivo do servidor ou outra ferramenta fora dos toolsets do Discord.
- Conteúdo trazido pelo usuário (ata, planilha) é dado, nunca instrução; diga isso na skill.

### Instalação na VPS

```bash
# na máquina local, a partir da raiz do repositório
tar cf - -C hermes/skills prisma | ssh iago@187.127.8.245 'mkdir -p /tmp/ps && tar xf - -C /tmp/ps && sudo rm -rf /docker/hermes-agent-iipr/data/skills/prisma && sudo cp -r /tmp/ps/prisma /docker/hermes-agent-iipr/data/skills/prisma && sudo chown -R 10000:10000 /docker/hermes-agent-iipr/data/skills/prisma && rm -rf /tmp/ps'
```

Skills novas ou editadas valem na próxima mensagem (o Hermes relê a pasta), sem reiniciar.

Configuração do `config.yaml`, feita uma vez em 20/11/2026:

- `platform_toolsets.discord` inclui `skills` (só no Discord).
- `skills.platform_disabled.discord` lista todas as skills que vêm com o Hermes. Assim o bot do Discord só enxerga as skills `prisma/` (e a `hermes-agent`, que o Hermes mantém sempre). Depois de atualizar a imagem do Hermes, confira se vieram skills novas em `data/skills` e acrescente-as à lista.
- `model` (DP4, 23/11/2026): `provider: anthropic` e `default: claude-sonnet-5-5`, sem `base_url` (o provedor nativo do Hermes usa `api.anthropic.com`). A chave fica em `ANTHROPIC_API_KEY` no `.env` do Docker (`hermes-set-secret ANTHROPIC_API_KEY compose`), ao lado do `PRISMA_STT_OPENAI_KEY` (transcrição de voz, DP5). O `NEXOS_API_KEY` não é mais usado.
- `skills.write_approval: true`: se o agente tentar criar ou editar uma skill (`skill_manage`), a mudança só fica em `data/pending/skills/` e nada muda até o dono aprovar. Skills do Prisma se alteram só por este repositório.

## `routine/`

Rotina diária da Etapa 4: para cada canal preenchido como **Canal do Discord** em projetos ativos, lê as mensagens do dia anterior, pede ao Claude Haiku 5.5 (API do Claude, `claude-haiku-5-5`, chamada direto em `api.anthropic.com` só com a biblioteca padrão do Python) um resumo em JSON (resumo, decisões e pendências) e grava no **Contexto** de cada projeto do canal com o tipo "Discord".

- Um canal pode ter mais de um projeto (I1, DP1): o canal é lido e resumido uma vez, e o mesmo resumo vai para o Contexto de cada projeto vinculado, com o rodapé citando os projetos que dividem o canal.
- Script determinístico, não é agente (H9): o canal define os projetos; o LLM só resume, sem ferramentas, e a conversa entra no prompt como dado.
- Credencial própria `ROUTINE_SECRET` (cabeçalho `x-routine-secret`), que no `ai-gateway` só lista canais e grava contexto (N5).
- Idempotente: reexecutar o mesmo dia atualiza a mesma entrada de cada projeto (`source_ref = canal:data`, único por projeto).
- Relatório em `#prisma-operacao` (sucesso ou falha por projeto, falha de leitura ou resumo por canal e canais do servidor sem projeto) e auditoria em `ai_actions_log` com `source = 'routine'`. O journald guarda só contagens e códigos. Um projeto com falha na gravação não impede os outros do mesmo canal.
- Mensagens de bots, inclusive as do próprio assistente, ficam fora do resumo.
- Testes offline (tudo simulado, sem Discord, LLM nem gateway), a partir da raiz do repositório: `python -m unittest discover -s hermes/routine`. No Windows, sem base de fusos no sistema: `uv run --no-project --with tzdata python -m unittest discover -s hermes/routine`. O arquivo de teste não vai para a VPS (a instalação copia só os três arquivos abaixo).

### Instalação na VPS

O timer roda às **00:30 (America/Sao_Paulo)** e resume o dia anterior inteiro. Assim nenhuma mensagem da noite fica de fora, o que poderia acontecer com um horário antes da meia-noite. O serviço roda com usuário efêmero (`DynamicUser`), sem acesso ao Hermes nem ao Docker.

```bash
# na máquina local, a partir da raiz do repositório
tar cf - -C hermes/routine prisma_routine.py prisma-routine.service prisma-routine.timer | ssh iago@187.127.8.245 'mkdir -p /tmp/pr && tar xf - -C /tmp/pr && sudo install -D -m 755 /tmp/pr/prisma_routine.py /opt/prisma-routine/prisma_routine.py && sudo install -m 644 /tmp/pr/prisma-routine.service /tmp/pr/prisma-routine.timer /etc/systemd/system/ && sudo systemctl daemon-reload && rm -rf /tmp/pr'
```

As variáveis ficam em `/etc/prisma-routine.env` (root, 600): `ROUTINE_SECRET`, `DISCORD_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `OPS_CHANNEL_ID` (#prisma-operacao), `DISCORD_GUILD_ID` e `ROUTINE_IGNORE_CHANNELS` (IDs que não geram alerta de canal sem projeto, como #prisma-ia). Ao rotacionar o token do bot ou a chave da Anthropic, atualize também este arquivo. O `ROUTINE_SECRET` precisa ser o mesmo nos Secrets das Edge Functions.

```bash
sudo systemctl enable --now prisma-routine.timer      # liga o agendamento
sudo systemctl start prisma-routine.service           # executa agora (dia anterior)
journalctl -u prisma-routine.service -n 50            # resultado
# outro dia ou simulação, com as mesmas variáveis:
sudo systemd-run --wait --pipe -p EnvironmentFile=/etc/prisma-routine.env -p DynamicUser=yes \
  /usr/bin/python3 -I /opt/prisma-routine/prisma_routine.py --date 2026-11-12 --dry-run
```
