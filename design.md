# Milagre — Design direction

> Referência visual extraída de um screenshot de uma aplicação de operações com agentes.
> Os valores de cor são aproximações visuais e devem ser refinados durante a implementação.

## Direção visual

A interface deve parecer um espaço de trabalho vivo, calmo e operacional:

- fundo muito claro, quase branco, com textura pontilhada sutil;
- superfícies brancas com bordas finas e sombras discretas;
- verde como cor de ação, saúde e progresso;
- texto verde-azulado escuro, evitando preto puro;
- densidade alta de informação sem aparência pesada;
- cantos arredondados, mas sem excesso de cartões soltos;
- linguagem visual de ferramenta profissional, não de dashboard genérico.

## Estrutura da tela

### Shell principal

Desktop-first, com três regiões:

1. **Navegação lateral**
   - largura aproximada: `280px`;
   - marca e seletor de workspace no topo;
   - busca e ação primária logo abaixo;
   - grupos de navegação com títulos pequenos;
   - item ativo em superfície cinza-esverdeada clara;
   - rodapé com acesso a contexto, configurações ou registros.

2. **Canvas de trabalho**
   - área principal flexível;
   - largura mínima suficiente para leitura confortável;
   - fundo pontilhado;
   - cabeçalho contextual fixo;
   - conteúdo organizado em timeline, mensagens e ações;
   - composer fixado na parte inferior.

3. **Painel de contexto**
   - largura aproximada: `360px`;
   - painel branco separado por borda vertical;
   - breadcrumb no topo;
   - título e metadados do objeto selecionado;
   - blocos de contexto, plano, bloqueios e atividade;
   - rolagem independente do canvas principal.

## Layout do Milagre

Aplicar a mesma estrutura ao domínio de coordenação:

- lateral: projetos, worktrees, agentes e conexões;
- canvas: mapa de worktrees, eventos, operações e conversas;
- painel direito: contexto compartilhado, evidências, aprovações e conflitos;
- composer inferior: comando ou mensagem para o agente selecionado.

## Grid e espaçamento

Usar uma escala curta e consistente:

```text
xxs  = 4px
xs   = 8px
sm   = 12px
md   = 16px
lg   = 20px
xl   = 24px
xxl  = 32px
```

Regras principais:

- padding interno padrão de cards: `16px`;
- distância entre grupos: `24px`;
- distância entre controles: `8px`;
- composer com altura mínima de `72px`;
- painel direito com padding lateral de `20px`;
- evitar elementos encostados nas bordas da janela.

## Tokens de cor

Os nomes devem ser semânticos, não específicos de componentes.

| Token              | Valor aproximado | Uso                                       |
| ------------------ | ---------------: | ----------------------------------------- |
| `background`       |        `#F8FBF9` | fundo geral                               |
| `surface`          |        `#FFFFFF` | cards e painéis                           |
| `surface-muted`    |        `#F1F4F2` | campos e itens secundários                |
| `foreground`       |        `#123C3A` | texto principal                           |
| `muted-foreground` |        `#71817F` | texto auxiliar                            |
| `border`           |        `#E2E8E5` | divisores e contornos                     |
| `primary`          |        `#0D921C` | ação principal, seleção e status positivo |
| `primary-soft`     |        `#E6F5E8` | fundo de seleção e destaque               |
| `accent-yellow`    |        `#F4F000` | agente, atenção ou inteligência           |
| `danger`           |        `#D85B5B` | bloqueios e erros                         |

O verde deve ser usado com parcimônia. A maior parte da tela permanece neutra; o verde indica ação ou estado, não decoração.

## Tipografia

- usar a fonte de sistema do macOS;
- título de workspace: `16–18px`, peso semibold;
- título de objeto ou worktree: `18–22px`, peso semibold;
- corpo: `14px`, line-height entre `1.45` e `1.6`;
- metadados e labels: `12px`;
- evitar textos totalmente em caixa alta;
- usar peso e cor para hierarquia, não muitos tamanhos diferentes.

## Componentes

### Button

Estados obrigatórios:

- default: superfície neutra e texto escuro;
- hover: superfície um pouco mais escura;
- active: leve redução de opacidade ou escala;
- focus: ring verde visível;
- primary: fundo verde e texto branco;
- disabled: baixa opacidade, sem perder legibilidade.

Botões devem ter altura compacta, padding horizontal generoso e ícone opcional antes do label.

### Input

- superfície branca ou `surface-muted`;
- borda fina;
- foco com borda e ring verdes;
- placeholder em `muted-foreground`;
- altura mínima de `36px` para inputs de uma linha;
- composer com altura maior e botão de envio destacado;
- nunca deixar o input ser esmagado por outros controles: usar largura flexível com largura mínima.

### Badge e status

Usar pills apenas para estados, tipos e metadados curtos:

- status positivo: verde;
- estado neutro: cinza-esverdeado;
- bloqueio: vermelho suave;
- agente ou inteligência: amarelo.

### Card

- fundo branco;
- borda `border`;
- radius médio, entre `10px` e `14px`;
- sombra mínima, usada somente para separar camadas;
- título curto e conteúdo com bastante respiro vertical.

### Connection

Conexões entre worktrees devem ser visualmente leves:

- linha fina;
- verde para conexão ativa;
- amarelo para atenção;
- vermelho para bloqueio;
- seta ou marcador central para direção;
- label curto próximo da linha.

## Canvas

- grid pontilhado com baixo contraste;
- nós brancos com borda e sombra discreta;
- seleção com borda verde e halo suave;
- arraste com cursor explícito;
- conexões devem aparecer atrás dos nós;
- evitar linhas grossas e cores saturadas em excesso.

## Movimento

Movimento deve comunicar mudança de estado:

- hover: `100–140ms`;
- pressionado: `80–120ms`;
- abertura de painel: `180–240ms`;
- conexão criada: animação curta de linha ou pulso;
- agente executando: indicador sutil e contínuo;
- respeitar redução de movimento quando disponível.

## Implementação React/Electron

- manter os tokens em `app/src/styles.css` como variáveis semânticas;
- usar componentes React reutilizáveis para sidebar, composer, mensagens, aprovações e worktrees;
- manter o renderer sem acesso direto ao filesystem ou a processos;
- expor capacidades locais somente por APIs explícitas no preload do Electron;
- centralizar integrações de agentes, projetos e worktrees em `electron/`;
- evitar espalhar valores hexadecimais diretamente pelos componentes.

## Prioridade de implementação

1. shell de três regiões;
2. tokens e tipografia;
3. botão e input;
4. composer inferior;
5. cards de worktree;
6. painel de contexto;
7. canvas e conexões;
8. motion e estados avançados.
