# Referência: BPMN 2.0 XML para Camunda (apoio)

Padrão Ambiente para XML escrito à mão. Neste ambiente a entrega é feita por `prisma_gerar_arquivo`
(formato `bpmn`), que monta o XML e o diagrama sozinho. Use este arquivo para revisar um `.bpmn` recebido, para
orientar ajustes no Camunda Modeler ou se surgir uma ferramenta de escrita de arquivos.

## Estrutura

- Cabeçalho `<definitions>` com namespaces `bpmn` (MODEL), `bpmndi`, `dc`, `di`, `modeler`, `camunda`;
  `targetNamespace="http://[sigla-cliente].[dominio]/bpmn"`; `exporter="Ambiente Consultoria"`;
  `exporterVersion="2.0"`; `modeler:executionPlatform="Camunda Cloud"`; `executionPlatformVersion="8.9.0"`.
- Comentário logo após `<definitions>` com: PROCESSO, CÓDIGO (`TIPO.ÁREA.NN`), TIPO (AS IS | TO BE),
  CLIENTE, VERSÃO e DATA, SISTEMAS, ELABORADO (Ambiente Consultoria, gerente).
- Ordem dentro de `<definitions>`: 1) `<collaboration>` 2) `<process>` 3) `<bpmndi:BPMNDiagram>`.
- `<collaboration>`: **um** `<participant isHorizontal>` com `processRef`; `textAnnotation` e `association`
  ficam aqui; `messageFlow` só com pool externa confirmada.
- `<process isExecutable="false">`: `<laneSet>` no topo, com uma `<lane>` por ator e um `<flowNodeRef>` por
  elemento (cada elemento em exatamente uma lane); depois os elementos; os `sequenceFlow` por último.
  `sequenceFlow` fica no `<process>`, nunca na `<collaboration>`; `messageFlow` fica na `<collaboration>`,
  nunca no `<process>`.

## Mapa de elementos

- Início com ciclo temporal: `startEvent` + `timerEventDefinition` (`R/P1D` diário, `R/P7D` semanal,
  `R/P1M` mensal, `R/PT8H` a cada 8h, `R/P2D` a cada 2 dias).
- Início por mensagem / espera por mensagem: `startEvent`+`messageEventDefinition` / `receiveTask` (só com
  pool externa).
- Execução interna: `task`. Subprocesso colapsado: `subProcess` (DI `isExpanded="false"`, 160x80).
- Decisão: `exclusiveGateway`; cada saída do split com `<conditionExpression>`. Join: sem condição, `name=""`.
- `parallelGateway`: só com paralelismo confirmado; nunca como join de caminhos exclusivos.
- Erro em tarefa: `boundaryEvent` + `errorEventDefinition` (DI em x_task+120, y_task+60, 36x36).
- Nota (riscos, ausência de SLA, passivos): `textAnnotation` + `association`.
- Fim com várias entradas exclusivas: um `endEvent` com vários `<incoming>`.

## Layout (DI)

- O `BPMNDiagram` é obrigatório: sem ele o Camunda Modeler não renderiza.
- Tamanhos: task 160x80; eventos 36x36; gateways 50x50; anotação 150–200 x 40–90; lane com altura
  160–260 conforme a densidade.
- Espaçamento: tasks consecutivas a 200px centro a centro; subfluxos verticais com ≥160px de separação
  em Y; fluxo principal no mesmo Y central.
- Um `BPMNShape` para a pool (altura = soma das lanes) e um por lane, empilhados sem gap nem overlap; pool
  e lanes com o mesmo `x` e a mesma `width` (X do último elemento + 100px).
- Etapas lógicas na mesma coluna X; o Y central do elemento cai dentro da faixa da sua lane.
- Todo elemento tem `BPMNShape`; todo `sequenceFlow` e toda `association` tem `BPMNEdge`.
- Waypoints: reto = 2; mudança de faixa ou dobra = 3 (ponto de inflexão); join divergente = L.

## IDs

`collab_`, `pool_`, `proc_`, `laneset_`, `lane_`, `start_`, `end_`, `task_`, `gw_`, `gw_par_`, `be_`, `sub_`,
`sf_[origem]_to_[destino]`, `mf_`, `ann_`, `assoc_`, `shape_`, `edge_`. IDs nunca se repetem no documento.

## Checklist de XML

Pool única; laneSet completo; elemento em exatamente uma lane; sequenceFlow só no process; sem messageFlow
entre lanes; condição em toda saída de split; IDs únicos; shape/edge para tudo; comentário de cabeçalho
presente; `targetNamespace` no padrão do cliente.
