# Tecnologias Hacker: Roteiro 4
<u>Autor</u>: Maria Luiza Sevilha Seraphico
___

## Visão Geral

Atualmente, a navegação web moderna é mediada por **mecanismos invisíveis de coleta de dados**. Ao acessar uma página, o navegador não se comunica apenas com o servidor principal, mas também com diversos domínios de terceiros que coletam informações sobre aquela interação. Segundo Englehardt e Narayanan, grande parte dos sites populares incorpora múltiplos trackers simultaneamente, tornando o rastreamento cross-site um fenômeno onipresente na web contemporânea [^1].

Mais recentemente, com a crescente preocupação com segurança dos dados, a indústria de rastreamento migrou para **técnicas mais sofisticadas e menos transparentes**. Esses métodos permitem identificar usuários de forma persistente mesmo após a limpeza de cookies ou o uso de navegação privada, reduzindo a visibilidade e o controle do usuário sobre sua própria privacidade [^8].

Embora existam ferramentas consolidadas (como o Privacy Badger (EFF) e o Ghostery) essas soluções operam principalmente como mecanismos automáticos de mitigação. Em geral, o usuário permanece com **pouca visibilidade** sobre como o rastreamento ocorre, quais vetores estão sendo explorados e qual é o nível real de exposição nas páginas acessadas.

Neste contexto, a extensão desenvolvida nesse projeto propõe uma abordagem complementar: ao invés de apenas bloquear, ela atua como uma **ferramenta de inspeção e análise de privacidade em tempo real,** permitindo observar e compreender os principais mecanismos de coleta de dados utilizados na web. Entre suas principais funções, a extensão monitora e classifica vetores de informação consolidando essas informações em uma métrica unificada (*Privacy Score*).

___

## Sumário

1. [Como funciona](#como-funciona)
2. [Instalação](#instalação)
3. [Uso](#uso)
4. [Módulos de detecção](#módulos-de-detecção)
  4.1 [Domínios de terceira parte](#1-domínios-de-terceira-parte)
  4.2 [*Cookies*](#2-cookies)
  4.3 [*Web Storage* e *IndexedDB*](#3-web-storage-e-indexeddb)
  4.4 [*Browser Fingerprinting*](#4-browser-fingerprinting)
  4.5 [*Cookie Syncing*](#5-cookie-syncing)
  4.6 [*Browser Hijacking*](#6-browser-hijacking)
  4.7 [*Privacy Score*](#7-privacy-score)
5. [Arquitetura](#arquitetura)
6. [Estrutura do repositório](#estrutura-do-repositório)
7. [Referências](#referências)

___

## 1. Como funciona

Em geral, a arquitetura de extensões do Firefox é baseada em **contextos de execução isolados** com diferentes níveis de privilégio, definidos pelo modelo de segurança das *WebExtensions* [^15]. Cada componente da extensão opera em um ambiente separado, com acesso restrito a recursos específicos do navegador, reduzindo a superfície de ataque e evitando o compartilhamento direto de dados sensíveis entre o código da extensão e as páginas web.

Neste modelo, a extensão Privacy Monitor é estruturada em três componentes principais:

**Background script** (`privacy_monitor.js`): roda em segundo plano, persistente durante toda a sessão do navegador. Tem acesso às APIs privilegiadas: intercepta requisições de rede via [`webRequest`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest), lê headers de resposta, acessa a API de cookies e mantém o estado de cada aba em memória. É o núcleo da extensão. [^13]

**Content script** (`content_script.js`): é injetado em cada página carregada, rodando no contexto do documento, mas em um *sandbox* isolado. Sua função é alcançar o que o background não consegue ver: o uso das APIs JavaScript pela própria página. Ele injeta hooks diretamente no `window` da página para interceptar chamadas de *fingerprinting*, monitora sobrescritas de funções nativas (*hooking*) e lê o conteúdo do *Web Storage* e *IndexedDB* em profundidade [5] [^14].

**Popup** (`popup/`): interface HTML/JS que abre ao clicar no ícone da extensão. Consulta o background via `browser.runtime.sendMessage` e renderiza os dados coletados para aquela aba, incluindo o breakdown visual por categoria do *Privacy Score*.

A comunicação entre esses componentes ocorre por troca de mensagens, e não há compartilhamento direto de contexto ou memória entre eles. Essa separação é uma propriedade fundamental do modelo de segurança das *WebExtensions* e garante que código com privilégios elevados não interaja diretamente com o conteúdo das páginas.

___

## Instalação

**Requisitos:** Firefox 109 ou superior. Sem dependências externas.

### Modo temporário (desenvolvimento)

1. Clone o repositório:
   ```bash
   git clone https://github.com/MaluSevilha/techacker-plugin.git
   ```

2. No Firefox, acesse `about:debugging`, depois **Este Firefox** e, por fim, **Carregar extensão temporária**

3. Selecione o arquivo `manifest.json` na pasta do projeto

A extensão deve aparece na barra de ferramentas. Extensões temporárias são removidas ao fechar o Firefox: para uso permanente é necessário assinar via [addons.mozilla.org](https://addons.mozilla.org) (não implementado para essa atividade).

### Verificar instalação

Acesse qualquer site com publicidade (com a https://www.uol.com.br/) e clique no ícone (talvez ele esteja escondido dentro do ícone de extensões). O popup deve exibir dezenas de domínios de terceira parte e cookies (isso indica que a interceptação de rede está funcionando).
___

## Uso

A extensão monitora automaticamente todas as abas. Não é necessária nenhuma configuração, esse é o funcionamento padrão.

Ao clicar no ícone, o popup exibe o *Privacy Score* da página atual no topo e cinco abas com os dados detalhados:

|      Aba      |                            O que mostra                                        |
|---------------|--------------------------------------------------------------------------------|
| **Terceiros** | Domínios externos e tipos de recurso                                           |
| **Cookies**   | Cookies organizados por categoria (incluindo supercookies)                     |
| **Storage**   | Conteúdo de *localStorage*, *sessionStorage* e bancos *IndexedDB*              |
| **Fingerpr.** | Chamadas de fingerprinting interceptadas e pares de cookie syncing             |
| **Hijack**    | Scripts suspeitos, hooking de funções nativas e tentativas de redirecionamento |

Os dados são resetados a cada navegação para uma nova página.

___

## Módulos de detecção

### 1. Domínios de terceira parte

**O que é:** toda vez que um browser carrega uma página, ele também dispara dezenas de requisições para domínios que não são o site que o usuário acessou. Esses são os domínios de "terceira parte". Cada um deles recebe o endereço IP do usuário, o header `Referer` com a página visitada e, frequentemente, um cookie de rastreamento. Esse é o mecanismo básico de rastreamento *cross-site*.[^1]

**Como está sendo detectado:** o listener `browser.webRequest.onBeforeRequest` intercepta todas as requisições de rede antes de serem enviadas. Para cada requisição, compara-se o domínio de base do destino com o domínio da página atual. Se forem diferentes, é terceira parte. O tipo de recurso (`type` no objeto de detalhes) é registrado junto.

**Por que importa:** pesquisas mostram que os 10.000 sites mais visitados da web contactam em média 9 domínios de terceira parte por página carregada [^1]. Essa complexidade escala drasticamente em setores específicos: enquanto um site institucional é tradicionalmente mais limpo, portais de notícias e entretenimento podem realizar entre 50 e 100 requisições externas. Essas práticas expõem os dados de navegação do usuário a uma rede de intermediários em segundos e de forma invisível.

___

### 2. Cookies

**O que é:** cookies são fragmentos de texto armazenados pelo browser e enviados automaticamente em toda requisição ao domínio que os criou. Podem ser classificados conforme o seu tempo de vida (expiração) ou conforme o seu emissor.

`Classificação conforme o emissor`
- <u>Cookies de primeira parte</u>: criados pelo próprio site visitado
- <u>Cookies de terceira parte</u>: criados por domínios externos presentes na página (terceiros). Esse era o mecanismo clássico de rastreamento cross-site, agora bloqueado por padrão no Firefox.[^3]

`Classificação conforme o tempo de vida`
- <u>Cookies de sessão</u>: expiram ao fechar o browser. 
- <u>Cookies persistentes</u>: têm data de expiração explícita e sobrevivem entre sessões.

Por fim, ainda existem os **supercookies**. Esses são identificadores que persistem mesmo após o usuário limpar os cookies convencionais. Para fins dessa aplicação, existem dois que são de interesse:
- <u>HSTS supercookies</u>: o header `Strict-Transport-Security` com `includeSubDomains` pode ser usado para codificar um identificador no estado HSTS do browser, que não é apagado pela limpeza de dados. [^4]
- <u>ETags</u>: servidores retornam um `ETag` para cache de recursos. Se um tracker usa ETags com valores únicos por usuário, o browser os reenvia automaticamente (funcionando como cookie mesmo após limpeza).[^5]

**Como está sendo detectado:** o listener `browser.webRequest.onHeadersReceived` inspeciona os headers de resposta em busca de `Set-Cookie`, `Strict-Transport-Security` e `ETag`. Para os cookies captados, verifica-se a presença de `expires` ou `max-age` para classificá-los entre cookies de sessão ou persistentes.

___

### 3. Web Storage e IndexedDB

**O que é:** além de cookies, browsers oferecem outras APIs de armazenamento local:
- `localStorage`: armazenamento chave-valor persistente, sem data de expiração, até 5MB por origem. Sobrevive ao fechamento do browser.[^6]
- `sessionStorage`: igual ao `localStorage` mas limitado à aba atual, ou seja, ele é apagado ao fechar a aba.
- `IndexedDB`: banco de dados orientado a objetos, com suporte a transações, índices e armazenamento de dados estruturados. Possui uma capacidade muito maior que o Web Storage. Frequentemente usado por Progressive Web Apps para cache offline, mas também por trackers para armazenar perfis de usuário.[^7]

Qualquer *script* de terceira parte rodando na página tem acesso ao storage da origem daquela página, que não é do seu próprio domínio. Isso significa que um script de analytics pode escrever em `localStorage` sob o domínio do site que o incluiu.

**Como está sendo detectado:** o *content script* lê `localStorage` e `sessionStorage` diretamente após o carregamento da página. Para o IndexedDB, a inspeção vai além da simples listagem de bancos: o script abre cada banco via `indexedDB.open()`, percorre todos os *object stores* disponíveis e itera os registros via cursor, calculando o tamanho estimado de cada entrada. O resultado exibido no popup inclui nome do banco, nome dos *object stores*, número de registros e tamanho total estimado em bytes (tudo agrupado por origem).

**Limitação técnica: atribuição de domínio no Web Storage**
A API do Web Storage não registra qual script escreveu cada entrada: toda chave em `localStorage` ou sessionStorage pertence à origem da página, independentemente de ter sido criada pelo site principal ou por um script de terceira parte carregado nele. Isso é uma restrição estrutural do modelo de segurança da web: a same-origin policy garante que apenas scripts rodando sob aquela origem acessem aquele storage, mas não mantém proveniência por entrada.[^9]
Na prática, isso significa que um script de analytics carregado de `tracker.com` que escreve em `localStorage` sob `uol.com.br` (por exemplo) deixa sua entrada registrada como sendo de `uol.com.br`, sem rastro de autoria. A extensão exibe o domínio da origem, que é a única informação disponível via API, e não o domínio do script responsável pela escrita. Para rastrear autoria com mais granularidade, seria necessário interceptar as chamadas `localStorage.setItem()` no content script e correlacioná-las com o script em execução no momento, o que exigiria instrumentação adicional do call stack via `Error().stack`, com precisão limitada.

---

### 4. Browser Fingerprinting

**O que é:** com a morte dos cookies de terceira parte, a indústria de rastreamento migrou para *fingerprinting*. Essa técnica consiste na criação de um identificador único a partir de características do browser e hardware, sem armazenar nada no dispositivo do usuário. Como cada combinação de GPU, fonte, sistema operacional e configuração de browser é levemente diferente, é possível identificar usuários com precisão de 80 a 99% (sem usar nenhum cookie).[^8]

As três APIs mais exploradas são:
- **Canvas fingerprinting:** a API Canvas renderiza texto e formas com antialiasing e subpixel rendering que variam por GPU e driver. `toDataURL()` exporta o resultado como imagem: o hash desses pixels funciona como impressão digital. Detectado em mais de 14.000 dos top 100.000 sites.[^9]
- **WebGL fingerprinting:** a extensão `WEBGL_debug_renderer_info` expõe o modelo exato da GPU do usuário (`UNMASKED_RENDERER_WEBGL`, `UNMASKED_VENDOR_WEBGL`), sendo essa uma informação que raramente muda e é extremamente discriminante.
- **AudioContext fingerprinting:** o processamento de sinal de áudio varia em precisão de ponto flutuante entre hardware e sistemas operacionais. Criar um oscilador e processar com `createDynamicsCompressor` produz um hash sonoro único.[^10]

**Como está sendo detectado:** o *content script* injeta um script inline no `window` da página (sendo necessário para acessar o mesmo contexto *JavaScript* que a página usa) que sobrescreve os métodos das APIs com *wrappers*. Assim, quando a página chama `canvas.toDataURL()`, o *wrapper* emite um evento customizado antes de chamar a função original. O *content script*, por fim, escuta esse evento e notifica o *background*. A função original é continua sendo chamada: a extensão não a bloqueia, apenas a observa.

___

### 5. Cookie Syncing

**O que é:** em geral, redes de publicidade precisam unificar seus identificadores de usuário entre diferentes domínios. Assim, se a rede A e a rede B querem saber que o mesmo usuário visitou dois sites diferentes, uma precisa comunicar seu ID para a outra. Isso é feito via redirecionamentos: o browser é mandado de `ad-network-a.com?uid=123&redirect=ad-network-b.com?uid_from_a=123`. Cada rede registra a equivalência e constrói um grafo de identidade *cross-site*.[^11]

**Como está sendo detectado:** a detecção combina duas heurísticas complementares. A primeira monitora requisições onde o domínio de destino é um tracker conhecido e a URL contém parâmetros típicos de sincronismo (`uid`, `uuid`, `user_id`, `sync`, `match`, entre outros). Quando o referer também é um tracker diferente, o par é registrado como sincronismo. Já a segunda heurística detecta *pixels de rastreamento* (requisições para domínios de terceira parte que retornam imagens de 1×1 pixel carregando parâmetros de ID), uma técnica usada por redes de publicidade para confirmar a entrega de um identificador sem depender de redirecionamento explícito. Por fim, eventos duplicados são deduplicados para reduzir o ruído na interface.
___

### 6. Browser Hijacking

**O que é:** o sequestro de browser é a modificação não autorizada do comportamento do navegador. Ela pode ocorrer via extensões maliciosas, *scripts* injetados por XSS, ou código de terceira parte que sobrescreve funções nativas do browser para interceptar dados ou redirecionar tráfego.[^12]

**Como está sendo detectado:** a detecção aplicada foca em três vetores:
1. ***Scripts* suspeitos:** *scripts* carregados de domínios que são *ad networks* ou *data brokers* conhecidos têm capacidade de executar código arbitrário na página. Mantêm-se uma lista de domínios de redes conhecidas e sinalizamos scripts carregados dessas origens.
2. ***Hooking* de funções nativas:** o *content script* monitora ativamente a sobrescrita de funções críticas do browser: `document.write`, `window.open`, `history.pushState` e o *setter* de `document.cookie`. O monitoramento é feito via `Object.defineProperty` no contexto da página, assim, quando qualquer dessas funções é substituída por uma versão customizada, o evento `HOOKING_ATTEMPT` é disparado para o background com o nome da função afetada. Essa técnica é usada tanto por *malware* quanto por *scripts* de analytics agressivos para interceptar a navegação do usuário.
3. **Redirecionamentos não autorizados:** detecta-se quando uma requisição de `main_frame` muda de domínio de base sem interação do usuário.

___

### 7. Privacy Score

É a pontuação de 0 a 100 que resume o nível de exposição à privacidade na página atual. A ideia é começar em 100 e ir decrementando conforme os vetores detectados. No popup, cada categoria contribuinte é exibida com uma **barra proporcional** indicando sua penalização relativa, permitindo identificar visualmente quais fatores mais impactaram o score daquela página.

**Tabela de penalidades:**

| Fator | Penalidade | Teto |
|-------|-----------|------|
| Domínio de terceira parte | −3 por domínio | −30 |
| Script suspeito (tracker conhecido) | −5 por script | −20 |
| Cookie de terceira parte | −4 por cookie | −20 |
| Cookie persistente de terceira parte | −2 extra por cookie | −10 |
| Supercookie (HSTS ou ETag) | −5 por ocorrência | −15 |
| Item em localStorage | −3 por item | −15 |
| Banco IndexedDB | −2 por banco | −10 |
| Canvas fingerprinting | −5 (evento binário) | −15 |
| WebGL fingerprinting | −5 (evento binário) | −10 |
| AudioContext fingerprinting | −5 (evento binário) | −10 |
| Par de cookie syncing | −10 por par | −20 |
| Redirecionamento suspeito | −10 por ocorrência | −20 |

Aqui, *fingerprinting* é tratado como binário por API (presença ou ausência) porque uma única leitura já expõe o identificador completo. Assim, penalizar por número de chamadas não adicionaria informação relevante. 

Os tetos por categoria evitam que um único fator (como cookies) domine o score de um site com problemas distribuídos, gerando um score que capta melhor o panorama de privacidade do site visitado.

Com base no score calculado, gera-se a classificação da privacidade mantida por ele, seguindo a tabela abaixo.

| Score | Classificação |
|-------|--------------|
| 80–100 | 🟢 Boa privacidade |
| 60–79 | 🟡 Privacidade moderada |
| 40–59 | 🟠 Privacidade baixa |
| 0–39 | 🔴 Privacidade muito baixa |

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    Firefox Browser                   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           Background Script                   │   │
│  │           privacy_monitor.js                  │   │
│  │                                               │   │
│  │  webRequest.onBeforeRequest ──► terceiros     │   │
│  │  webRequest.onHeadersReceived ► cookies       │   │
│  │  tabData{} ──────────────────► estado/aba     │   │
│  │  computePrivacyScore() ───────► score         │   │
│  └──────────┬───────────────────────┬────────────┘   │
│             │ sendMessage           │ sendMessage     │
│             ▼                       ▼                 │
│  ┌──────────────────┐   ┌──────────────────────┐    │
│  │  Content Script  │   │       Popup           │    │
│  │content_script.js │   │  popup/popup.js       │    │
│  │                  │   │  popup/popup.html     │    │
│  │ hooks de FP      │   │                       │    │
│  │ hooking nativo   │   │  renderiza tabData    │    │
│  │ localStorage     │   │  breakdown do score   │    │
│  │ sessionStorage   │   │                       │    │
│  │ IndexedDB (deep) │   │                       │    │
│  └──────────────────┘   └──────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

## Estrutura do repositório

```
privacy-monitor/
├── icons/
│   └── icon-extension.png # Ícone da extensão
├── popup/
│   ├── popup.html         # Interface do popup
│   └── popup.js           # Renderização e comunicação com o background
├── content_script.js      # Injetado em cada página (hooks de FP e leitura de storage)
├── json_schemas.py        # Schemas de validação dos dados trocados entre componentes
├── manifest.json          # Manifesto Manifest V2, permissões e declaração de data_collection
├── privacy_monitor.js     # Background script (interceptação de rede, cookies, estado global)
└── README.md              # Este arquivo
```

---

## Referências
[^1]: Englehardt, S. & Narayanan, A. (2016). *Online Tracking: A 1-million-site Measurement and Analysis*. ACM CCS. https://dl.acm.org/doi/10.1145/2976749.2978313

[^2]: Mozilla. *WebExtensions — webRequest API*. MDN Web Docs. https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest

[^3]: Mozilla. *Firefox Total Cookie Protection*. https://blog.mozilla.org/products/firefox/firefox-rolls-out-total-cookie-protection-by-default-to-all-users-worldwide/

[^4]: Kranch, M. & Bonneau, J. (2015). *Upgrading HTTPS in Mid-Air: An Empirical Study of Strict Transport Security and Key Pinning*. NDSS. https://www.ndss-symposium.org/ndss2015/upgrading-https-mid-air

[^5]: Ayenson, M. et al. (2011). *Flash Cookies and Privacy II: Now with HTML5 and ETag Respawning*. SSRN. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1898390

[^6]: MDN Web Docs. *Window.localStorage*. https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage

[^7]: MDN Web Docs. *IndexedDB API*. https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API

[^8]: Laperdrix, P. et al. (2020). *Browser Fingerprinting: A Survey*. ACM TWEB. https://dl.acm.org/doi/10.1145/3386040

[^9]: Acar, G. et al. (2014). *The Web Never Forgets: Persistent Tracking Mechanisms in the Wild*. ACM CCS. https://dl.acm.org/doi/10.1145/2660267.2660347

[^10]: Englehardt, S. & Narayanan, A. (2016). Op. cit.

[^11]: Papadopoulos, P. et al. (2019). *Cookie Synchronization: Everything You Always Wanted to Know But Were Afraid to Ask*. The Web Conference. https://dl.acm.org/doi/10.1145/3308558.3313542

[^12]: OWASP. *Browser Security Handbook*. https://code.google.com/archive/p/browsersec/

[^13]: MOZILLA. *Content scripts*. MDN Web Docs. Disponível em: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts
. Acesso em: 7 maio 2026.

[^14]: MOZILLA. *Anatomy of a WebExtension*. MDN Web Docs. Disponível em: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Anatomy_of_a_WebExtension
. Acesso em: 7 maio 2026.

[^15]: MOZILLA. *Background scripts*. MDN Web Docs. Disponível em: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts
. Acesso em: 7 maio 2026.

[^16]: WHOTRACK ME. *Explorer: insights into the online tracking ecosystem*. [S. l.]: Ghostery; Cliqz, 2024. Disponível em: https://whotracks.me/. Acesso em: 10 maio 2024.

[^17]: GLOBYTĖ, Ema. *NordVPN research: which countries’ websites have the most trackers?* [S. l.]: NordVPN, 31 out. 2022. Disponível em: https://nordvpn.com/pt-br/blog/nordvpn-research-website-trackers/. Acesso em: 10 maio 2026.