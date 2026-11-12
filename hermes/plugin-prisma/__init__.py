"""Plugin nativo do Hermes para o Prisma (Etapa 3: leitura).

Regras (docs/ARQUITETURA.md):
- S1: o discord_user_id vem do contexto da sessão do gateway do Hermes (HERMES_SESSION_USER_ID), nunca
  de argumento do LLM. Nenhuma ferramenta tem parâmetro de usuário.
- Dados de projeto só por DM: fora de uma DM do Discord a ferramenta recusa sem chamar o ai-gateway.
- O ai-gateway (Supabase Edge Function) autentica pelo x-hermes-secret, abre a sessão do usuário e aplica a RLS.
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


def _secret() -> str:
    value = os.environ.get("HERMES_GATEWAY_SECRET", "").strip()
    if value:
        return value
    home = os.environ.get("HERMES_HOME", "/opt/data")
    try:
        with open(os.path.join(home, ".env"), encoding="utf-8") as f:
            for line in f:
                if line.startswith("HERMES_GATEWAY_SECRET="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def _session() -> tuple[str, str, str]:
    from gateway.session_context import get_session_env as g
    return (
        g("HERMES_SESSION_PLATFORM", "").lower(),
        g("HERMES_SESSION_CHAT_TYPE", "").lower(),
        g("HERMES_SESSION_USER_ID", ""),
    )


def _call(tool: str, args: dict) -> str:
    platform, chat_type, user_id = _session()
    if platform != "discord" or chat_type not in DM_CHAT_TYPES:
        return json.dumps({"ok": False, "code": "dm_only", "error": MSG_ONLY_DM}, ensure_ascii=False)
    if not user_id.isdigit():
        return json.dumps({"ok": False, "code": "no_author", "error": "Não foi possível identificar o autor."})
    secret = _secret()
    if not secret:
        return json.dumps({"ok": False, "code": "not_configured", "error": "Integração com o Prisma não configurada."})

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
            return r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        # Respostas de erro do gateway já vêm em JSON pt-BR (not_linked, rate_limited, invalid_args...).
        try:
            body = e.read().decode("utf-8")
            json.loads(body)
            return body
        except Exception:  # noqa: BLE001
            return json.dumps({"ok": False, "code": f"http_{e.code}", "error": "O Prisma recusou a consulta."})
    except Exception:  # noqa: BLE001
        return json.dumps({"ok": False, "code": "unavailable", "error": "O Prisma não respondeu. Tente de novo."})


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


def register(ctx) -> None:
    for name, handler, emoji, schema in TOOLS:
        ctx.register_tool(name=name, toolset="prisma", schema=schema, handler=handler, emoji=emoji)
