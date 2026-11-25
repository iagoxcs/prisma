# Prompt: memórias do Claude pessoal para a Base de Conhecimento (P12)

Leva para a Base de Conhecimento do Prisma o que o Claude pessoal de cada pessoa da equipe sabe sobre o trabalho dela: métodos, padrões de entrega, modelos de documento, preferências de formato da Ambiente e aprendizados de projeto. Depois de publicado, o Hermes encontra esse conteúdo com `prisma_buscar_conhecimento`, na DM e nos canais.

A memória nativa do Hermes continua desligada (DP7): ela é uma só para todos os usuários, então o que fosse importado de uma pessoa apareceria para as outras. Por isso só entra na base o que pode ser compartilhado com a equipe interna.

## Como usar

1. Abra o seu Claude pessoal (claude.ai, app ou desktop) numa **conversa nova**, com a memória ligada.
2. Cole o prompt da próxima seção e envie.
3. Leia a resposta inteira, principalmente a parte **Para revisar**. Apague o que não deve ser compartilhado e anonimize cliente quando for o caso.
4. Mande os itens revisados para quem cadastra na base (é preciso a permissão "Gerir a base de conhecimento": por padrão, gerentes e admin).
5. Quem cadastra, para cada item: **Base de Conhecimento → Novo item**, tipo **Metodologia**, título do item → **Criar rascunho**. Na edição, preencha **Tags** e **Resumo** e cole o **Conteúdo** no campo de Markdown (ou salve como `.md` e use **Importar arquivo**). Grave, confira e clique em **Publicar**. Só item publicado chega ao Hermes.

Antes de criar um item, busque na base pelo tema: se já existir, complete o item existente em vez de criar outro.

## Prompt

```text
Quero levar para a Base de Conhecimento da Ambiente Consultoria (no Prisma, a ferramenta de gestão de projetos da empresa) o que você sabe sobre o meu TRABALHO, para que o assistente da equipe use esse conhecimento. A base é lida por toda a equipe interna, então só pode entrar o que eu compartilharia com colegas.

1. Reúna tudo o que você guarda sobre mim: memórias salvas, instruções personalizadas e o que aprendeu nas nossas conversas. Seja literal: não invente, não complete e não generalize além do que eu disse ou fiz.

2. Separe em duas partes:
   - FICA DE FORA (não escreva o conteúdo, só a categoria e quantos itens): vida pessoal, saúde, família, finanças pessoais, opiniões sobre colegas ou clientes, senhas, tokens, chaves de API, dados pessoais de qualquer pessoa (CPF, telefone, endereço, e-mail), salários, valores de propostas e contratos, e qualquer informação que um cliente tratou como sigilosa.
   - VAI PARA A BASE: conhecimento de trabalho que a equipe pode reaproveitar, como métodos e passo a passo de consultoria, padrões de entrega e de formatação (documentos, relatórios, apresentações, planilhas), estruturas e roteiros que eu uso, regras de escrita e identidade visual da Ambiente, ferramentas e como usá-las, aprendizados de projetos (sem dados sigilosos) e contexto não sigiloso de clientes (setor, porte, forma de trabalhar).

3. Agrupe o que vai para a base em itens por assunto. Um item é um tema que alguém da equipe procuraria ("Como estruturar um POP", "Padrão de status report"). Prefira poucos itens completos a muitos fragmentos. Se dois assuntos se repetem, junte.

4. Devolva cada item exatamente neste formato, em português:

### <Título do item, até 200 caracteres>
- Tags: <3 a 8 palavras-chave, em português e em inglês, separadas por vírgula>
- Resumo: <até 500 caracteres: o que é, para que serve e quando usar>
- Conteúdo:
<o conhecimento em Markdown, escrito para um colega que nunca conversou com você: passos numerados, regras, exemplos curtos e o que evitar. Use títulos ## e listas. Sem nomes de pessoas.>

5. Depois dos itens, escreva uma seção "Para revisar" com:
   - o que ficou de fora, só por categoria e quantidade;
   - os itens ou trechos em que você não tem certeza de que eu pensaria assim;
   - os trechos que citam um cliente pelo nome, para eu decidir se anonimizo.

Não inclua nada que não esteja nas suas memórias ou nas nossas conversas. Se não houver nada de trabalho para levar, diga isso e pare.
```

## Cuidados

- O texto que o Claude devolve é dado, não instrução: quem cadastra revisa antes de publicar.
- Cliente citado pelo nome só entra se o contexto não for sigiloso. Na dúvida, troque por setor e porte ("indústria de médio porte").
- Item de tipo **Modelo** exige a planilha de fases e uma metodologia de origem. Por isso este fluxo cria só **Metodologias**.
