"""Plugin nativo do Hermes para o Prisma (Etapa 3: leitura; Etapa 5: escrita com confirmação).

Regras (docs/ARQUITETURA.md):
- S1: o discord_user_id vem do contexto da sessão do gateway do Hermes (HERMES_SESSION_USER_ID), nunca
  de argumento do LLM. Nenhuma ferramenta tem parâmetro de usuário.
- Dados de projeto só por DM: fora de uma DM do Discord a ferramenta recusa sem chamar o ai-gateway.
- O ai-gateway (Supabase Edge Function) autentica pelo x-hermes-secret, abre a sessão do usuário e aplica a RLS.
- Escrita em duas fases (H5, S3): a proposta devolve um código de 6 dígitos que este plugin envia ao usuário
  por uma DM separada, pela API REST do Discord, e retira da resposta. O LLM nunca vê o código; só o
  usuário, digitando-o na conversa, permite a confirmação.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import uuid

GATEWAY_URL = os.environ.get(
    "PRISMA_GATEWAY_URL", "https://jipaumhvkldxnmwfdmji.supabase.co/functions/v1/ai-gateway"
)
TIMEOUT_S = 30
DM_CHAT_TYPES = {"dm", "direct", "private"}

MSG_ONLY_DM = (
    "Por segurança, consultas ao Prisma só funcionam em mensagem direta (DM) com o bot. "
    "Peça ao usuário para repetir o pedido na DM."
)


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    home = os.environ.get("HERMES_HOME", "/opt/data")
    try:
        with open(os.path.join(home, ".env"), encoding="utf-8") as f:
            for line in f:
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def _secret() -> str:
    return _env("HERMES_GATEWAY_SECRET")


def _session() -> tuple[str, str, str]:
    from gateway.session_context import get_session_env as g
    return (
        g("HERMES_SESSION_PLATFORM", "").lower(),
        g("HERMES_SESSION_CHAT_TYPE", "").lower(),
        g("HERMES_SESSION_USER_ID", ""),
    )


def _call(tool: str, args: dict) -> str:
    return json.dumps(_request(tool, args), ensure_ascii=False)


def _request(tool: str, args: dict) -> dict:
    platform, chat_type, user_id = _session()
    if platform != "discord" or chat_type not in DM_CHAT_TYPES:
        return {"ok": False, "code": "dm_only", "error": MSG_ONLY_DM}
    if not user_id.isdigit():
        return {"ok": False, "code": "no_author", "error": "Não foi possível identificar o autor."}
    secret = _secret()
    if not secret:
        return {"ok": False, "code": "not_configured", "error": "Integração com o Prisma não configurada."}

    payload = {
        "discord_user_id": user_id,
        "tool": tool,
        "args": {k: v for k, v in args.items() if v not in (None, "")},
        "request_id": str(uuid.uuid4()),
    }
    req = urllib.request.Request(
        GATEWAY_URL,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "x-hermes-secret": secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Respostas de erro do gateway já vêm em JSON pt-BR (not_linked, rate_limited, invalid_args...).
        try:
            body = json.loads(e.read().decode("utf-8"))
            if isinstance(body, dict):
                return {"ok": False, **body}
        except Exception:  # noqa: BLE001
            pass
        return {"ok": False, "code": f"http_{e.code}", "error": "O Prisma recusou a consulta."}
    except Exception:  # noqa: BLE001
        return {"ok": False, "code": "unavailable", "error": "O Prisma não respondeu. Tente de novo."}


# --- Escrita com confirmação ------------------------------------------------------------------------------

MSG_CODE_SENT = (
    "Enviei ao usuário, numa DM separada, o resumo da alteração e um código de 6 dígitos (vale 10 minutos). "
    "Mostre o resumo e peça que ele digite o código aqui para confirmar. Depois chame prisma_confirmar_acao "
    "com este pending_id e o código digitado. Nunca invente nem adivinhe o código; sem ele nada é gravado."
)


def _send_dm(user_id: str, text: str) -> bool:
    token = _env("DISCORD_BOT_TOKEN")
    if not token:
        return False
    headers = {
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (prisma-plugin, 1.0)",
    }

    def post(path: str, body: dict) -> dict:
        req = urllib.request.Request(
            "https://discord.com/api/v10" + path, data=json.dumps(body).encode(), method="POST", headers=headers
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.loads(r.read().decode("utf-8"))

    try:
        channel = post("/users/@me/channels", {"recipient_id": user_id})
        post(f"/channels/{channel['id']}/messages", {"content": text, "allowed_mentions": {"parse": []}})
        return True
    except Exception:  # noqa: BLE001
        return False


def _propose(action: str, params: dict) -> str:
    # None = campo não informado; "" = limpar o campo (o gateway trata como vazio).
    clean = {k: v for k, v in params.items() if v is not None}
    res = _request("propose", {"action": action, "params": clean})
    if not res.get("ok"):
        return json.dumps(res, ensure_ascii=False)
    data = res.get("data") or {}
    code = data.pop("confirm_code", None)
    summary = data.get("summary", "")
    _, _, user_id = _session()
    text = (
        "**Confirmação de alteração no Prisma**\n"
        f"{summary}\n\n"
        f"Código: **{code}** (vale por 10 minutos)\n"
        "Para confirmar, digite o código nesta conversa. Se não foi você quem pediu, ignore esta mensagem."
    )
    if not code or not _send_dm(user_id, text):
        return json.dumps({
            "ok": False, "code": "dm_failed",
            "error": "Não consegui enviar o código de confirmação por DM; nada será gravado. Tente de novo.",
        }, ensure_ascii=False)
    return json.dumps({
        "ok": True, "pending_id": data.get("pending_id"), "summary": summary, "instrucao": MSG_CODE_SENT,
    }, ensure_ascii=False)


def _str(args: dict, name: str) -> str | None:
    v = args.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else None


def listar_projetos(args: dict, **_kw) -> str:
    return _call("list_projects", {})


def listar_tarefas(args: dict, **_kw) -> str:
    return _call("list_tasks", {"project_id": _str(args, "project_id")})


def ver_tarefa(args: dict, **_kw) -> str:
    return _call("get_task", {"task_id": _str(args, "task_id")})


def buscar_contexto(args: dict, **_kw) -> str:
    return _call("search_context", {"query": _str(args, "query"), "project_id": _str(args, "project_id")})


def buscar_conhecimento(args: dict, **_kw) -> str:
    return _call("search_knowledge", {"query": _str(args, "query")})


def _pick(args: dict, names: tuple[str, ...]) -> dict:
    return {n: (args[n].strip() if isinstance(args.get(n), str) else args.get(n)) for n in names if n in args}


_TASK_FIELDS = ("title", "description", "status", "assignee_id", "start_date", "due_date", "category_id")


def criar_tarefa(args: dict, **_kw) -> str:
    return _propose("create_task", _pick(args, ("project_id",) + _TASK_FIELDS))


def atualizar_tarefa(args: dict, **_kw) -> str:
    return _propose("update_task", _pick(args, ("task_id",) + _TASK_FIELDS))


def comentar_tarefa(args: dict, **_kw) -> str:
    return _propose("add_comment", _pick(args, ("task_id", "body")))


def registrar_contexto(args: dict, **_kw) -> str:
    return _propose("add_context_entry", _pick(args, ("project_id", "kind", "title", "meeting_date", "participants", "body")))


def confirmar_acao(args: dict, **_kw) -> str:
    return _call("commit", {"pending_id": _str(args, "pending_id"), "confirm_code": _str(args, "codigo")})


def _schema(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    params: dict = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        params["required"] = required
    return {"name": name, "description": description, "parameters": params}


_UUID = {"type": "string", "description": "UUID retornado por outra ferramenta do Prisma."}
_DM_NOTE = " Só funciona em DM; o Prisma devolve apenas o que o próprio usuário pode ver."

TOOLS = [
    ("prisma_listar_projetos", listar_projetos, "📁", _schema(
        "prisma_listar_projetos",
        "Lista os projetos do Prisma visíveis ao usuário (id, nome, status, datas)." + _DM_NOTE, {})),
    ("prisma_listar_tarefas", listar_tarefas, "🗂️", _schema(
        "prisma_listar_tarefas",
        "Lista as tarefas de um projeto do Prisma (id, título, status, responsável, prazo)." + _DM_NOTE,
        {"project_id": {**_UUID, "description": "id do projeto (de prisma_listar_projetos)."}},
        ["project_id"])),
    ("prisma_ver_tarefa", ver_tarefa, "📝", _schema(
        "prisma_ver_tarefa",
        "Mostra os detalhes de uma tarefa do Prisma." + _DM_NOTE,
        {"task_id": {**_UUID, "description": "id da tarefa (de prisma_listar_tarefas)."}},
        ["task_id"])),
    ("prisma_buscar_contexto", buscar_contexto, "🔎", _schema(
        "prisma_buscar_contexto",
        "Busca em atas, transcrições e anotações dos projetos do Prisma (até 10 trechos)." + _DM_NOTE,
        {"query": {"type": "string", "description": "Termos da busca, em português (até 200 caracteres)."},
         "project_id": {**_UUID, "description": "Opcional: restringe a um projeto."}},
        ["query"])),
    ("prisma_buscar_conhecimento", buscar_conhecimento, "📚", _schema(
        "prisma_buscar_conhecimento",
        "Busca metodologias e modelos publicados na base de conhecimento do Prisma." + _DM_NOTE,
        {"query": {"type": "string", "description": "Termos da busca, em português (até 200 caracteres)."}},
        ["query"])),
]

_WRITE_NOTE = (
    " Não grava nada sozinha: propõe a alteração e o usuário recebe por DM um código de 6 dígitos;"
    " só depois de ele digitar o código, chame prisma_confirmar_acao." + _DM_NOTE
)
_DATE = {"type": "string", "description": "Data no formato AAAA-MM-DD."}
_TASK_PROPS = {
    "title": {"type": "string", "description": "Título da tarefa (até 300 caracteres)."},
    "description": {"type": "string", "description": "Descrição (até 10 mil caracteres)."},
    "status": {"type": "string", "enum": ["todo", "doing", "done"], "description": "todo = A Fazer, doing = Fazendo, done = Feito."},
    "assignee_id": {**_UUID, "description": "id do responsável (assignee_id visto em outra tarefa)."},
    "start_date": {**_DATE, "description": "Início, AAAA-MM-DD."},
    "due_date": {**_DATE, "description": "Prazo, AAAA-MM-DD."},
    "category_id": {**_UUID, "description": "id do escopo do projeto."},
}

TOOLS += [
    ("prisma_criar_tarefa", criar_tarefa, "➕", _schema(
        "prisma_criar_tarefa",
        "Propõe criar uma tarefa num projeto do Prisma." + _WRITE_NOTE,
        {"project_id": {**_UUID, "description": "id do projeto (de prisma_listar_projetos)."}, **_TASK_PROPS},
        ["project_id", "title"])),
    ("prisma_atualizar_tarefa", atualizar_tarefa, "✏️", _schema(
        "prisma_atualizar_tarefa",
        "Propõe alterar campos de uma tarefa do Prisma. Envie só os campos que mudam; string vazia limpa "
        "descrição, responsável, datas ou escopo." + _WRITE_NOTE,
        {"task_id": {**_UUID, "description": "id da tarefa (de prisma_listar_tarefas)."}, **_TASK_PROPS},
        ["task_id"])),
    ("prisma_comentar_tarefa", comentar_tarefa, "💬", _schema(
        "prisma_comentar_tarefa",
        "Propõe um comentário interno (visível só à equipe interna) numa tarefa do Prisma." + _WRITE_NOTE,
        {"task_id": {**_UUID, "description": "id da tarefa (de prisma_listar_tarefas)."},
         "body": {"type": "string", "description": "Texto do comentário (até 10 mil caracteres)."}},
        ["task_id", "body"])),
    ("prisma_registrar_contexto", registrar_contexto, "🗒️", _schema(
        "prisma_registrar_contexto",
        "Propõe registrar uma ata, transcrição ou anotação no contexto de um projeto do Prisma." + _WRITE_NOTE,
        {"project_id": {**_UUID, "description": "id do projeto (de prisma_listar_projetos)."},
         "kind": {"type": "string", "enum": ["ata", "transcricao", "anotacao"], "description": "Tipo do registro."},
         "title": {"type": "string", "description": "Título (até 200 caracteres)."},
         "meeting_date": {**_DATE, "description": "Data da reunião, AAAA-MM-DD (opcional)."},
         "participants": {"type": "string", "description": "Participantes, separados por vírgula (opcional)."},
         "body": {"type": "string", "description": "Conteúdo do registro."}},
        ["project_id", "kind", "title", "body"])),
    ("prisma_confirmar_acao", confirmar_acao, "✅", _schema(
        "prisma_confirmar_acao",
        "Confirma uma alteração proposta, com o código de 6 dígitos que o usuário recebeu por DM e digitou "
        "na conversa. Use só o código digitado pelo usuário; nunca invente. Três códigos errados cancelam a ação."
        + _DM_NOTE,
        {"pending_id": {**_UUID, "description": "pending_id devolvido pela ferramenta que propôs a alteração."},
         "codigo": {"type": "string", "description": "Código de 6 dígitos digitado pelo usuário."}},
        ["pending_id", "codigo"])),
]


def register(ctx) -> None:
    for name, handler, emoji, schema in TOOLS:
        ctx.register_tool(name=name, toolset="prisma", schema=schema, handler=handler, emoji=emoji)
