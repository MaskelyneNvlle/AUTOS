# Monitoramento da prensa Airfix — Servidor Node.js (PLC32 + MQTT)

Servidor que recebe as batidas da prensa enviadas pela PLC32 por MQTT, analisa o ritmo, grava o histórico em CSV e mostra tudo numa dashboard web.
É o porte para Node.js do servidor Python que existia em `C:\prensa_mqtt_vscode` (a análise, a dashboard, os CSVs e os tópicos são os mesmos), com uma diferença importante: **o broker MQTT já vem embutido (biblioteca `aedes`)**. Nesta fase de bancada **não é preciso instalar nem rodar Mosquitto nem Python**.

> Decisão de projeto: bancada = Node + aedes. Se mais tarde houver várias máquinas, o broker passa para o Mosquitto e o servidor continua o mesmo (ver [seção 12](#12-migrar-para-o-mosquitto-no-futuro)).

## Sumário
1. [Como tudo se encaixa](#1-como-tudo-se-encaixa)
2. [Arquivos da pasta](#2-arquivos-da-pasta)
3. [Instalação (uma vez)](#3-instalação-uma-vez)
4. [Iniciar, parar e usar no dia a dia](#4-iniciar-parar-e-usar-no-dia-a-dia)
5. [A dashboard: o que cada coisa significa](#5-a-dashboard-o-que-cada-coisa-significa)
6. [Como a análise decide (regras e números)](#6-como-a-análise-decide-regras-e-números)
7. [Testes sem a PLC: simulando batidas (passo a passo)](#7-testes-sem-a-plc-simulando-batidas-passo-a-passo)
8. [Testes de bancada com a PLC32 e os sensores reais](#8-testes-de-bancada-com-a-plc32-e-os-sensores-reais)
9. [Firmware da PLC32](#9-firmware-da-plc32)
10. [Arquivos de dados e API HTTP](#10-arquivos-de-dados-e-api-http)
11. [Solução de problemas](#11-solução-de-problemas)
12. [Migrar para o Mosquitto no futuro](#12-migrar-para-o-mosquitto-no-futuro)
13. [Limitações e segurança](#13-limitações-e-segurança)

---

## 1. Como tudo se encaixa

```
 sensor ──► PLC32 (ESP32 + Ethernet)
              │  MQTT, TCP 1883, rede 10.0.1.x
              ▼
   ┌─────────────────────────────────────────┐   computador servidor 10.0.1.202
   │ node server.js                          │
   │  ├─ broker MQTT embutido (aedes) :1883  │ ◄── a PLC32 conecta aqui
   │  ├─ análise de ritmo (analise.js)       │
   │  ├─ CSV: producao.csv / alarmes.csv     │
   │  └─ dashboard HTTP :8085                │ ──► navegador (http://10.0.1.202:8085)
   └─────────────────────────────────────────┘
```

Fluxo de uma batida: o sensor muda de LOW para HIGH → a PLC publica `1` em `prensa/sensor1/batida` → o servidor conta, calcula intervalo e ritmo, compara com o ritmo programado e atualiza a dashboard em tempo real (1 atualização por segundo, mais um evento a cada batida).

## 2. Arquivos da pasta

| Arquivo | Para que serve |
|---|---|
| `server.js` | Servidor: broker MQTT (aedes), HTTP, dashboard em tempo real (SSE), gravação de CSV. |
| `analise.js` | Análise de ritmo de uma máquina (parada, batida perdida, dupla, ritmo, instabilidade). Porte de `analise.py`. |
| `maquinas.json` | Ritmo programado: batidas/min, tolerância, tempo de parada etc. Também editável pela dashboard. |
| `public/index.html` | A dashboard (estrutura HTML e JavaScript dos gráficos e do tempo real). |
| `public/estilo-moderno.css`, `public/estilo-classico.css` | Os dois visuais da dashboard (botão **Tema**). `estilo-comum.css` tem os componentes novos (medidores, faixa de teste, legendas). |
| `public/relatorio.html` | Página do **relatório parcial** (`/relatorio`). Ver [seção 5.1](#51-relatório-parcial-de-desempenho). |
| `public/sensores.html` | Página **Máquinas e sensores** (`/sensores`): cria máquinas e atribui sensores a elas. Guia: [`../docs/MAQUINAS_E_SENSORES.md`](../docs/MAQUINAS_E_SENSORES.md). |
| `relatorio.js` | Cálculo do relatório (disponibilidade, desempenho, paradas...) a partir de `producao.csv`, `alarmes.csv` e do minuto em andamento. |
| `teste_relatorio.js` | Teste automático do cálculo do relatório com dados sintéticos. |
| `simular_batidas.js` | **Simulador da PLC**: publica cenários prontos (normal, batida perdida, ruído, parada…) no broker. Ver [seção 7](#7-testes-sem-a-plc-simulando-batidas-passo-a-passo). |
| `teste_analise.js` | Teste automático da lógica de análise (12 cenários, sem rede). |
| `teste_mqtt_local.js` | Teste automático da separação de tópicos (estado, heartbeat e batida) contra um servidor de teste. |
| `teste_bancada.js` | **Roteiros guiados do Teste A de bancada** (sensor NPN real na PLC32): polaridade, contagem, ritmo e repique, com o resultado na dashboard. Ver [seção 8.3](#83-comandos-dos-roteiros). |
| `producao.csv`, `alarmes.csv` | Histórico (criados na primeira gravação; ver [seção 10](#10-arquivos-de-dados-e-api-http)). |
| `package.json` | Dependências: `aedes` (broker) e `mqtt` (cliente, usado no modo externo e nos testes). |
| `dados_teste/` | Criada nos testes de simulação; pode ser apagada a qualquer momento. |

## 3. Instalação (uma vez)

Tudo isto é feito no **computador servidor (10.0.1.202)**.

### 3.1 Node.js
1. Instale o Node.js LTS em <https://nodejs.org> (versão 18 ou superior; foi testado com a 24).
2. Feche e reabra o terminal. Confirme:
   ```powershell
   node -v
   ```

### 3.2 Dependências do projeto
Dentro da pasta `servidor-node`:
```powershell
npm install
```
> Se aparecer *"a execução de scripts foi desabilitada neste sistema"* (erro do `npm.ps1`), use o `npm.cmd`:
> ```powershell
> npm.cmd install
> ```
> O servidor em si inicia com `node server.js`, que não é afetado por essa política.

### 3.3 Mosquitto fora do caminho
O broker embutido usa a porta **1883**, a mesma do Mosquitto. Se o Mosquitto estiver rodando, o servidor Node mostra erro de porta ocupada. No **PowerShell como administrador**:
```powershell
Stop-Service mosquitto
```
```powershell
Set-Service mosquitto -StartupType Disabled
```
(o segundo comando impede o Mosquitto de voltar a iniciar com o Windows).

### 3.4 Firewall do Windows
Para a PLC e outros computadores alcançarem o servidor, libere as portas (PowerShell **como administrador**, uma vez):
```powershell
New-NetFirewallRule -DisplayName "MQTT 1883" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow -Profile Private,Domain
```
```powershell
New-NetFirewallRule -DisplayName "Dashboard 8085" -Direction Inbound -Protocol TCP -LocalPort 8085 -Action Allow -Profile Private,Domain
```
A regra só vale se a rede estiver classificada como **Privada** (ou Domínio). Em rede "Pública" o Windows bloqueia mesmo com a regra.

### 3.5 Conferir se a rede está pronta
Em **outro** computador da mesma rede (com o servidor Node rodando):
```powershell
Test-NetConnection 10.0.1.202 -Port 1883
```
`TcpTestSucceeded : True` indica que a PLC consegue conectar. Confirme também que `10.0.1.202` ainda é o IP do servidor (`ipconfig` no servidor); se o IP mudar, a PLC precisa ser regravada com o novo IP em `firmware/config.h`.

## 4. Iniciar, parar e usar no dia a dia

**Iniciar** (dentro de `servidor-node`):
```powershell
node server.js
```
A janela deve mostrar:
```
[MQTT] broker embutido ouvindo em 0.0.0.0:1883
Dashboard: http://localhost:8085
Acesso pela rede: http://10.0.1.202:8085
```
e, quando a PLC conectar, `[MQTT] cliente conectado: PLC32-Prensa-xxxxxxxx`.

- **A janela precisa ficar aberta.** Se fechá-la, o servidor e o broker param e a PLC perde a conexão (as batidas desse período não são contadas).
- **Parar:** `Ctrl+C` na janela.
- **Dashboard:** `http://localhost:8085` no próprio servidor, ou `http://10.0.1.202:8085` de qualquer computador da rede.
- **Conferir a saúde:** `http://localhost:8085/api/health` deve mostrar `"placaOnline": true` enquanto a PLC estiver comunicando.
- **Opções** (todas opcionais): `--port 8085` (dashboard), `--board-port 4000` (HTTP extra para o firmware antigo), `--mqtt-port 1883`, `--mqtt-host <endereço>` (usa um Mosquitto externo em vez do embutido), `--dados <pasta>` (guarda `maquinas.json` e CSV noutra pasta).
- **Não rode o servidor Python ao mesmo tempo:** os dois disputam a porta 8085.

## 5. A dashboard: o que cada coisa significa

**Etiqueta no topo (ao lado de "Zerar contadores")**: `placa ativa (MQTT (...))` quando chegou mensagem há menos de 6 s; `placa sem sinal há N s` depois disso; `aguardando a placa` se nunca chegou nada.

**Banner grande (estado da máquina):**

| Banner | Cor | Quando aparece |
|---|---|---|
| AGUARDANDO BATIDAS | cinza | Ainda não chegou nenhuma batida, ou a máquina está parada há pouco tempo. |
| MEDINDO O RITMO… | azul | Máquina começou a bater, mas ainda há menos de 8 intervalos medidos. O ritmo ainda não é julgado. |
| OPERANDO NORMAL | verde | Ritmo dentro da faixa programada, sem alertas ativos. |
| ATENÇÃO | amarelo | Há um alerta de ritmo ativo (ritmo baixo, alto ou instável). |
| FALHA | vermelho | Muitas batidas perdidas em 60 s. |
| MÁQUINA PARADA | vermelho | Parou de bater depois de estar rodando (mais de 10 batidas na rodada). |
| SEM COMUNICAÇÃO | vermelho | **Nenhuma mensagem** da PLC há mais de 10 s. Não é o mesmo que máquina parada: aqui o problema é a placa/rede/cabo. |

**Cartões:** *Batidas por minuto* (ritmo atual, mediana dos últimos 20 intervalos) com a faixa programada; *Batidas (total)* e quantas no último minuto; *Estado do sensor* (ACIONADO/REPOUSO, último estado recebido; não conta produção); *Batidas perdidas*; *Batidas duplas* (pulsos extras filtrados); *Variação do ritmo* (desvio entre intervalos, em %) e o tempo do último ciclo.

**Gráficos** (passe o mouse sobre os marcadores para ver detalhes; cada gráfico tem sua legenda):
1. *Batidas por minuto — últimos 5 min*: linha laranja do ritmo, faixa verde do ritmo programado, **faixa vermelha** nos períodos de máquina parada e um **triângulo no topo com linha tracejada** em cada alerta (amarelo = atenção, vermelho = falha, verde = informação). Ao passar o mouse no triângulo aparece o horário e a mensagem do alerta.
2. *Intervalo entre batidas — últimos 60 s*: cada ponto é o tempo entre duas batidas. Verde = no ritmo; amarelo = fora da tolerância; **vermelho = perdida** (acima de 1,6× o normal); **magenta = pulso duplo** (abaixo de 0,5×). As linhas tracejadas mostram esses limites. É o gráfico que mais ajuda a ver *por que* um alerta disparou.
3. *Sinal do sensor — últimos 60 s*: uma barra por batida. Vermelha = batida que veio depois de uma perdida; magenta = pulso extra; **contorno tracejado com “?” = onde a batida que faltou deveria estar** (posição estimada).

**Faixa de TESTE (simulação):** quando o simulador está rodando, aparece uma faixa azul no topo com o nome do cenário, a barra de progresso, o resultado esperado e a lista de alertas esperados, que vão ficando verdes (✓) conforme chegam. Ao final mostra **APROVADO**, **APROVADO, com alertas extras** (amarelo) ou **REPROVADO — faltou: …**. Nos gráficos, o período do teste aparece com um fundo azul. A faixa avisa que os números são da simulação. Ver [seção 7.3](#73-simulação-visual-de-batidas-o-teste-que-mostra-os-resultados).

**Ritmo programado desta máquina (formulário com medidores ao vivo):** altere e clique *Salvar*; vale na hora e fica gravado em `maquinas.json`. Abaixo de cada campo há um **medidor** que mostra o valor medido agora contra o parâmetro, e a caixa fica com borda vermelha pulsando quando o limite é passado:

| Campo | Medidor mostra |
|---|---|
| Batidas/min programadas | Marcador branco = ritmo atual; faixa verde = tolerância. |
| Tolerância (%) | Marcador = desvio atual do ritmo (centro = exatamente o programado); faixa verde = ± tolerância. |
| Parada após (s) | Barra enchendo = tempo desde a última batida; chega a 100% (vermelho) quando a máquina é considerada parada. |
| Perdidas p/ FALHA (60 s) | Barra = batidas perdidas na janela de 60 s ÷ limite. |
| Variação p/ instável (%) | Barra = variação atual do ritmo ÷ limite. |

Valores de cada campo:

| Campo | Padrão | Significado |
|---|---|---|
| Batidas/min programadas | 155 | Ritmo esperado (manual da formadora: 150–160). |
| Tolerância (%) | 10 | Faixa aceita: 155 ± 10% = 140 a 170/min. |
| Parada após (s) | 3,0 | Segundos sem batida para declarar a máquina parada. |
| Perdidas p/ FALHA (60 s) | 3 | Quantidade de batidas perdidas em 60 s que vira FALHA. |
| Variação p/ instável (%) | 25 | Variação entre intervalos que vira "ritmo instável". |

**Alertas:** lista abaixo; amarelo = atenção, vermelho = falha/parada, verde = informação (retomada, normalizou). Todo alerta também é gravado em `alarmes.csv`.

**Zerar contadores:** zera total, perdidas, duplas e histórico em memória da máquina (os CSV já gravados não são apagados).

**Botões do topo:** *Relatório* (abre o relatório parcial), *Tema* (moderno ⇄ clássico; a escolha fica gravada no navegador), *Tela cheia* (para deixar numa TV na linha) e *Zerar contadores*.

### 5.1 Relatório parcial de desempenho

Abra pelo botão **Relatório** da dashboard ou direto em `http://localhost:8085/relatorio`. Ele resume como a prensa se comportou num período e atualiza sozinho a cada 10 s.

**Período:** últimos 15 min, 1 h, 4 h, 8 h (turno), hoje (desde 00:00) ou últimas 24 h.

**O que mostra:**

| Indicador | Como é calculado |
|---|---|
| **Disponibilidade** | Tempo operando ÷ tempo observado. Tempo parado = períodos entre o alerta “Máquina PAROU” e a retomada. |
| **Desempenho** | Batidas feitas ÷ batidas que seriam feitas no ritmo programado durante o tempo operando (acima de 100% = mais rápida que o programado). |
| **Eficiência de ritmo** | Disponibilidade × desempenho (desempenho limitado a 100%). **BOM** ≥ 85%, **ATENÇÃO** ≥ 65%, **BAIXO** abaixo disso. Exibida no anel grande. |
| Batidas, ritmo médio operando, pico por minuto | Soma e médias do período, contra o esperado no ritmo programado. |
| Paradas | Quantidade, tempo total, maior e média; lista das mais recentes com início, fim e duração (parada em andamento aparece como “em andamento”). |
| Tempo médio entre paradas | Tempo operando ÷ número de paradas. |
| Perdidas e pulsos duplos | Quantidade e percentual (duplas altas indicam ruído no sinal do sensor). |
| Alertas no período | Contagem por tipo. |
| Gráfico por minuto | Uma barra por minuto: verde = dentro da faixa programada; amarelo = abaixo/acima (inclui minutos parciais, como o de início e fim de uma rodada); marca vermelha = nenhuma batida. |

**Botões:** *Atualizar*, *Baixar resumo (CSV)* (`/api/relatorio?formato=csv`, abre no Excel) e *Imprimir / PDF* (o navegador gera um PDF; o layout de impressão é claro e sem botões).

**Limites que você precisa conhecer:**
- É um índice de **ritmo e paradas**. Não mede refugo/qualidade das peças, então não é um OEE completo.
- Os dados vêm do que o servidor grava (`producao.csv`, `alarmes.csv`). O servidor registra `servidor_iniciado` no `alarmes.csv` a cada partida; se ficou desligado mais de 90 s, esse intervalo é **descontado** do tempo observado (e mostrado no relatório), em vez de virar parada.
- O tempo observado começa no primeiro minuto com batidas do período. Uma parada só é registrada depois de a máquina ter feito pelo menos 10 batidas na rodada.
- Perdidas e duplas são estimativas feitas a partir dos intervalos entre batidas.
- Em simulações o relatório calcula normalmente; nos testes ele lê os arquivos de `dados_teste`, não os da produção.

## 6. Como a análise decide (regras e números)

Todas as regras estão em `analise.js` e são idênticas às do Python. Com 155/min, o intervalo normal é 60/155 ≈ **0,387 s**.

| Situação | Regra | Alerta |
|---|---|---|
| **Batida dupla / ruído** | Intervalo menor que a metade do normal (referência = mediana recente, ou o programado enquanto há poucas amostras). O pulso **não conta** na produção. Alertas agrupados: no máximo 1 a cada 10 s. | `batida_dupla` (amarelo) |
| **Batida perdida** | Intervalo maior que 1,6× a mediana. Perdidas = `round(intervalo / mediana) − 1` (no mínimo 1). Só depois de 8 intervalos medidos. | `batida_perdida` (amarelo) |
| **Falhas seguidas** | 3 ou mais batidas perdidas dentro de 60 s. | `falhas_seguidas` (vermelho, banner FALHA) |
| **Parada** | Sem batida há mais de 3 s, depois de pelo menos 10 batidas na rodada. | `parada` (vermelho) |
| **Retomada** | Voltou a bater depois de parada. | `retomada` (verde) |
| **Ritmo baixo / alto** | Batidas/min fora de 155 ± 10%. Só é julgado depois de 8 intervalos **e** 8 s de rodada, e precisa se manter por 3 s seguidos (evita alarme por oscilação). | `ritmo_baixo` / `ritmo_alto` (amarelo) |
| **Ritmo instável** | Desvio-padrão dos intervalos acima de 25% da média. | `instavel` (amarelo) |
| **Sem comunicação** | Nenhuma mensagem MQTT (batida, estado ou heartbeat) há mais de 10 s. Sobrepõe o banner. | (só o banner) |

Pontos que costumam surpreender:
- **Toda vez que a máquina para de mandar batidas, ~3 s depois o banner vira MÁQUINA PARADA.** Isso é o comportamento certo, inclusive no fim de cada simulação.
- Estado do sensor (`/estado`) e heartbeat **não contam produção**, só `/batida`.
- Um intervalo muito longo (parada) não é "batida perdida": acima de `parada_s` começa uma nova rodada e a estatística recomeça (MEDINDO O RITMO…).

## 7. Testes sem a PLC: simulando batidas (passo a passo)

Há três níveis de teste. Faça na ordem; os dois primeiros são automáticos, o terceiro é visual e é o que mostra "como a dashboard reage".

> Estes testes **não** comprovam o cabeamento do sensor, a Ethernet nem o firmware da PLC. Isso é a [seção 8](#8-testes-de-bancada-com-a-plc32-e-os-sensores-reais).

### 7.1 Teste da lógica de análise (automático, ~1 s)

Não usa rede. Roda 12 cenários (normal, perdida, dupla, ritmo baixo/alto, instável, falhas, parada, ruído…) contra `analise.js` e confirma que cada alerta esperado aparece.
```powershell
node teste_analise.js
```
**Resultado esperado:** o último texto é `Tudo certo: todos os cenarios foram detectados.` Qualquer cenário que falhe interrompe com um erro `AssertionError` indicando qual.

### 7.2 Teste da separação de tópicos (automático, ~5 s)

Verifica que estado, heartbeat e tópico de teste **não** contam batidas e que `/batida` e o tópico legado contam. Precisa de um servidor de teste, em portas diferentes das reais para não interferir.

1. **Terminal 1** — servidor de teste (deixe aberto):
   ```powershell
   node server.js --mqtt-port 1884 --port 8086 --board-port 8087 --dados dados_teste
   ```
2. **Terminal 2** — o teste:
   ```powershell
   node teste_mqtt_local.js
   ```
**Resultado esperado:**
```
ok: estado, heartbeat e teste nao contam; sensor_estado = 1
ok: 5 batidas + 1 legada = total 6 | status: medindo
ok: health {... "placaOnline":true}
Tudo certo.
```
3. `Ctrl+C` no Terminal 1.

### 7.3 Simulação visual de batidas (o teste que mostra os resultados)

O `simular_batidas.js` faz o papel da PLC: publica, **em tempo real**, `prensa/sensor1/batida`, `prensa/sensor1/estado` e `prensa/heartbeat` no broker, seguindo um cenário. Você assiste à dashboard reagir.

**Por que usar um servidor de teste separado:** o servidor real (portas 1883/8085) grava a produção real nos CSV. Os comandos abaixo usam portas 1884/8086 e a pasta `dados_teste`, então **nada do teste suja os dados reais**.

#### Passo a passo

**Passo 1 — Subir o servidor de teste (Terminal 1, deixar aberto):**
```powershell
node server.js --mqtt-port 1884 --port 8086 --board-port 8087 --dados dados_teste
```
Deve aparecer `broker embutido ouvindo em 0.0.0.0:1884`.

**Passo 2 — Abrir a dashboard de teste no navegador:** <http://localhost:8086>
No começo ela mostra `aguardando a placa` e `SEM COMUNICAÇÃO` (ainda não chegou nada).

**Passo 3 — Ver a lista de cenários (Terminal 2):**
```powershell
node simular_batidas.js lista
```

**Passo 4 — Rodar um cenário e olhar a dashboard enquanto ele roda:**
```powershell
node simular_batidas.js normal
```
O terminal mostra o que é o cenário e o resultado esperado, e termina com `Concluido: N batidas publicadas.`

**O que a dashboard mostra durante a simulação (a parte visual do teste):**
- **Faixa azul “SIMULAÇÃO”** no topo: nome do cenário, descrição, tempo decorrido (`15 / 26 s`), barra de progresso e o texto do resultado esperado. Os alertas esperados aparecem como etiquetas (`batida_perdida`…) que passam de cinza para **✓ verde** quando o alerta realmente chega. ~5 s depois do fim, o resultado: **APROVADO**, **APROVADO, com alertas extras** (algo além do esperado) ou **REPROVADO — faltou: …**.
- **Nos três gráficos**, o período do teste fica sombreado em azul com o rótulo `teste: <cenário>`; as batidas perdidas aparecem como pontos vermelhos altos no gráfico de intervalos e como “?” tracejado no gráfico do sensor; paradas viram faixas vermelhas e cada alerta ganha um triângulo no gráfico de ritmo.
- **Nas caixas de parâmetros**, os medidores reagem em tempo real: por exemplo, em `perdida` a barra *Perdidas p/ FALHA* sobe para 1/3; em `ritmo_baixo` o marcador do ritmo sai da faixa verde e a caixa pisca em vermelho; em `parada` a barra *Parada após* enche até 100%; em `instavel` a barra de variação passa do limite.
- Os cartões piscam a cada batida (e o de perdidas/duplas quando for o caso).
- Depois dos testes abra o **Relatório** (`http://localhost:8086/relatorio`) para ver o resumo do que foi simulado.

> Cenários rodados em sequência (por exemplo `perdida; parada`) começam logo depois do anterior; a checagem ignora os 2 primeiros segundos de cada cenário para não confundir com o que sobrou do anterior. Para um resultado limpo, espere o anterior terminar e a faixa sumir (~30 s após o fim), ou use `tudo`, que deixa pausas de 12 s.
>
> Se o simulador for apontado para o servidor **real** (`--porta 1883`) a faixa avisa que são números de simulação, mas **os registros entram nos CSV da produção**. Evite.

**Passo 5 — Zerar entre um cenário e outro** (botão **Zerar contadores** na dashboard, ou):
```powershell
Invoke-RestMethod -Method Post http://localhost:8086/reset -Body '{}'
```
Sem zerar, os totais e as perdidas dos cenários se acumulam (não atrapalha a lógica, só mistura os números).

**Passo 6 — Ao terminar:** `Ctrl+C` no Terminal 1 e, se quiser, apague os dados de teste:
```powershell
Remove-Item -Recurse -Force dados_teste
```

**Opções do simulador:** `--porta 1884` (porta MQTT do servidor de teste; é o padrão), `--host localhost`, `--spm 155` (ritmo "normal" simulado; precisa ser igual ao *Batidas/min programadas* da dashboard, senão a máquina "normal" simulada vai aparecer como ritmo baixo/alto).

#### Cenários e o que você deve ver

Os tempos são aproximados (1 s de preparação no início e 3 s de silêncio no fim). Os resultados abaixo foram **conferidos executando** o simulador contra o servidor de teste.

| Comando | Duração | O que simula | O que deve aparecer |
|---|---|---|---|
| `normal` | ~29 s | 65 batidas no ritmo programado | Banner MEDINDO O RITMO… e depois OPERANDO NORMAL. Total 65, perdidas 0, duplas 0, **nenhum alerta**. ~3 s depois do fim: MÁQUINA PARADA (é esperado). |
| `perdida` | ~26 s | Uma batida some no meio (intervalo de 2×) | Alerta amarelo `1 batida(s) perdida(s): intervalo 0.78 s (normal 0.39 s)`. Perdidas = 1, total 56. |
| `dupla` | ~26 s | Um pulso extra 80 ms depois de uma batida (repique do sensor) | Alerta amarelo `pulso(s) fora de ritmo (ex.: ~73 ms após a anterior)`. Duplas = 1; **o total não conta o pulso extra** (56). Barra vermelha no gráfico do sensor. |
| `ruido` | ~20 s | Rajada de 4 pulsos após cada batida (40 a 180 ms) | Total = 40 (só as batidas reais), duplas = 160. Só **2 alertas** de ruído (agrupamento de 10 s), o segundo somando ~100 pulsos. |
| `ritmo_baixo` | ~49 s | 25 batidas normais e depois ~120/min | Após ~10 s no ritmo novo: alerta `Ritmo baixo: 121/min (programado 155/min)` e banner ATENÇÃO (amarelo). |
| `ritmo_alto` | ~36 s | ~190/min o tempo todo | Alerta `Ritmo alto: 192/min (programado 155/min)` e banner ATENÇÃO. |
| `instavel` | ~43 s | Intervalos em ciclo curto/normal/longo (0,65×, 1×, 1,35×), média igual à programada | Alerta `Ritmo instável: variação 29% entre batidas`. Card *Variação do ritmo* ≈ 29%. Banner ATENÇÃO. Ritmo médio ~157/min (dentro da faixa). |
| `falhas` | ~35 s | Cinco batidas perdidas seguidas | Alertas de batida perdida e, ao chegar na terceira em 60 s, alerta vermelho `4 batidas perdidas em 60 s` e banner FALHA. |
| `parada` | ~44 s | Roda 15 s, para por 9 s e volta | Após 3 s de silêncio: alerta vermelho `Máquina PAROU: sem batida há 4 s` e banner MÁQUINA PARADA. Ao voltar: alerta verde `Máquina voltou a bater após 9 s parada`. |
| `sem_comunicacao` | ~25 s | Roda ~10 s e a placa **some** (nenhuma mensagem por 14 s) | Primeiro MÁQUINA PARADA (a partir de 3 s); depois de 10 s sem **nenhuma** mensagem o banner passa para **SEM COMUNICAÇÃO** e a etiqueta mostra `placa sem sinal há N s`. Mostra a diferença entre parada e falha de comunicação. |
| `tudo` | ~7 min | Todos acima em sequência (12 s de pausa entre eles) | Bom para uma demonstração; os alertas se acumulam na lista. |

#### Exemplo completo: simulando uma batida perdida

1. Terminal 1: `node server.js --mqtt-port 1884 --port 8086 --board-port 8087 --dados dados_teste`
2. Navegador: <http://localhost:8086>
3. Terminal 2: `node simular_batidas.js perdida`
4. Observe:
   - nos primeiros ~4 s (8 intervalos), banner azul **MEDINDO O RITMO…**;
   - depois, verde **OPERANDO NORMAL**, ritmo ≈ 155/min e a faixa verde do gráfico;
   - na metade (~13 s) aparece, na lista de alertas, a linha amarela `1 batida(s) perdida(s)`, o cartão *Batidas perdidas* vira **1** e uma barra vermelha surge no gráfico do sensor;
   - o banner volta a OPERANDO NORMAL (uma perdida só não dispara FALHA; são necessárias 3 em 60 s);
   - ao fim (~3 s sem batidas): MÁQUINA PARADA.
5. Confira o registro: abra `dados_teste\alarmes.csv` (a linha `batida_perdida` está lá) e, na virada do minuto, `dados_teste\producao.csv` ganha uma linha com `batidas`, `perdidas`, `duplas` e `spm_programado` daquele minuto.

#### Experimentos úteis

- **Mudar a regra e ver o efeito:** na dashboard de teste, ponha *Tolerância* em 3% e rode `normal`: pequenas oscilações passam a disparar `ritmo_baixo`/`ritmo_alto`. Ponha *Parada após* em 1 s e rode `perdida`: a pausa passa a ser vista como parada.
- **Testar outro ritmo programado:** na dashboard ponha 100 em *Batidas/min programadas*, salve, e rode `node simular_batidas.js normal --spm 100`. O ritmo simulado volta a ser "normal" para esse programado.
- **Ver só a lógica, sem rede:** `node teste_analise.js` (seção 7.1).
- **Conferir o que o servidor sabe, em texto:** `http://localhost:8086/api/state` (JSON com status, total, ritmo, alertas ativos) e `http://localhost:8086/api/health`.

#### Se o simulador não funcionar

| Sintoma | Causa e solução |
|---|---|
| `ERRO ao conectar em localhost:1884` | O servidor de teste não está rodando, ou usa outra porta. Reveja o Passo 1. |
| Dashboard fica em `aguardando a placa` | Você abriu a porta errada (use 8086 no teste, 8085 no real) ou o simulador usou outra `--porta`. |
| Banner mostra OPERANDO NORMAL mas ritmo "baixo" ou "alto" | `--spm` do simulador diferente do *Batidas/min programadas* da dashboard. |
| `EADDRINUSE` ao subir o servidor de teste | Já existe outro servidor de teste aberto, ou outra coisa usa essas portas. Feche o anterior ou troque as portas. |

## 8. Testes de bancada com a PLC32 e os sensores reais

Esta seção valida o que as simulações da seção 7 **não** conseguem provar: o cabeamento do sensor, a polaridade do sinal na PLC32, a Ethernet e o firmware de verdade. Há três níveis de teste:

| Nível | O que gera as batidas | Para que serve |
|---|---|---|
| **Teste A** | Você, passando um alvo na frente do **sensor NPN** ligado na PLC32 | Provar ligação, polaridade, contagem exata e ausência de repique |
| **Teste B** | A **Wecon LX3V-2416MT** (saída a transistor NPN em oscilador) ligada na entrada da PLC32 | Provar o ritmo, as falhas e as paradas de forma repetível |
| **Teste C** | A **prensa real** | Validação final, com os dados de produção |

Os roteiros automáticos (`teste_bancada.js`) cobrem os testes A e B. Ligações elétricas, pinagem e desenhos: [`../docs/BANCADA.md`](../docs/BANCADA.md).

### 8.1 Antes de começar (checklist)

| Item | Como conferir |
|---|---|
| Sensor NPN de 3 fios | Marrom = +, azul = −, **preto = sinal** |
| Fonte de 24 V (ou a saída de 24 V da Wecon, modelos AC) | Mesma fonte para a PLC32 e o sensor, **0 V comum** |
| Ligação na PLC32 | `+24 V` em **V+**, **Com** e fio marrom; `0 V` em **V−** e fio azul; fio **preto em I34** (GPIO34). Se estiver em I39 ou I35, o firmware **não** lê |
| Cabo de rede | No RJ45 **Ethernet** da PLC32 (o outro é I2C isolado: ligar a rede nele pode danificar o isolador) até a rede do servidor |
| PLC32 gravada | `config.h` com `mqtt_server = "10.0.1.202"` e `pinoSensor = 34` (seção 9) |
| Servidor | Computador `10.0.1.202` ligado, Node instalado, firewall liberado (seções 3.4 e 3.5) |
| Alvo metálico | Para o sensor indutivo; tenha-o **na mão** antes de iniciar um roteiro |

> A PLC32 só conversa com a porta **1883** do `10.0.1.202`. Por isso, para testar com ela sem sujar a produção, o servidor **normal** é trocado pelo servidor em **modo teste** (próxima seção).

### 8.2 Preparar o ambiente em modo teste

Use **dois terminais** (PowerShell) abertos na pasta `servidor-node`.

**Terminal 1 — servidor em modo teste**

1. Se o servidor normal estiver rodando, pare-o com `Ctrl+C` (senão a porta 1883 fica ocupada).
2. Inicie o servidor de teste:
   ```powershell
   node server.js --teste
   ```
3. Confira as linhas abaixo e **deixe a janela aberta**:
   ```
   Dashboard: http://localhost:8085
   Broker MQTT: embutido (aedes) na porta 1883
   *** MODO TESTE: os dados ficam isolados em ...\servidor-node\dados_teste (nao vao para a producao) ***
   [MQTT] broker embutido ouvindo em 0.0.0.0:1883
   [MQTT] cliente conectado: PLC32-Prensa-xxxxxxxx      <- aparece quando a PLC32 conecta
   ```
4. Se a PLC32 não aparecer em ~30 s, veja a [seção 8.9](#89-problemas-comuns-nos-testes-de-bancada).

**Navegador**

5. Abra `http://localhost:8085`. Devem aparecer: a etiqueta azul **MODO TESTE · dados isolados** e, em verde, **placa ativa (MQTT (prensa/heartbeat))**.

**Terminal 2 — conferir a conexão antes de testar (opcional, mas recomendado)**

```powershell
Invoke-RestMethod http://localhost:8085/api/health
```
Deve mostrar `"placaOnline": true`. E para ver o estado do sensor agora:
```powershell
$m = (Invoke-RestMethod http://localhost:8085/api/state).maquinas.prensa1; "sensor=$($m.sensor_estado)  total=$($m.total)  duplas=$($m.duplas)"
```
`sensor=0` ou `sensor=1` indica que a PLC já mandou o estado. `desconhecido` quer dizer que o estado ainda não chegou (a PLC só publica o estado ao conectar e quando ele muda).

> No Windows deste computador a execução de scripts `.ps1` é bloqueada. Todos os comandos desta seção usam `node ...` e não são afetados.

### 8.3 Comandos dos roteiros

Formato geral (no **Terminal 2**):
```powershell
node teste_bancada.js <roteiro> [opções]
```

| Comando | Duração | O que você faz |
|---|---|---|
| `node teste_bancada.js lista` | — | Só lista os roteiros |
| `node teste_bancada.js sinal` | 20 s | Afasta o alvo (6 s) → aproxima e segura (8 s) → afasta (6 s) |
| `node teste_bancada.js contagem` | até ~50 s | Passa o alvo **10 vezes**, devagar |
| `node teste_bancada.js contagem --n 30` | até ~150 s | Passa o alvo 30 vezes |
| `node teste_bancada.js ritmo` | 60 s | Deixa a Wecon (Teste B) ou a prensa gerar batidas |
| `node teste_bancada.js ritmo --tempo 120` | 120 s | Idem, por 2 minutos |
| `node teste_bancada.js repique` | 30 s | Segura o alvo **parado** na borda da zona de detecção |
| `node teste_bancada.js repique --tempo 60` | 60 s | Idem, por 60 s |
| `node teste_bancada.js tudo` | até ~2 min | `sinal` + `contagem` + `repique`, com pausa de 8 s entre eles |

**Opções**

| Opção | Padrão | Significado |
|---|---|---|
| `--n <número>` | 10 | Quantas passagens do alvo no roteiro `contagem` |
| `--tempo <segundos>` | 60 no `ritmo`, 30 nos demais | Duração do `ritmo` e do `repique` |
| `--porta <porta>` | 8085 | Porta HTTP do servidor |
| `--host <endereço>` | localhost | Computador do servidor |
| `--dados <pasta>` | `dados_teste` | Onde gravar `resultados_bancada.csv` |
| `--forcar` | — | Permite rodar **fora do modo teste** (os dados vão para a produção). Não use |

**Código de saída** (útil para automatizar): `0` = tudo aprovado, `1` = algum reprovado, `2` = erro (servidor fora do ar, não está em modo teste ou PLC sem comunicação).

**Proteções**: o roteiro **não roda** se o servidor não estiver em modo teste ou se a PLC32 estiver sem comunicação (mostra a mensagem e sai com código 2).

### 8.4 Passo a passo de cada roteiro

#### `sinal` — polaridade e ciclo (rode este primeiro)

Linha do tempo (as instruções aparecem na dashboard e no terminal):

| Passo | Tempo | Você faz | O roteiro anota |
|---|---|---|---|
| 1/3 | 0–6 s | **Alvo longe** do sensor, parado | Nível do sinal em repouso |
| 2/3 | 6–14 s | **Aproxima o alvo** (LED do sensor acende) e **mantém parado** | Nível acionado e batidas contadas |
| 3/3 | 14–20 s | **Afasta** o alvo e deixa parado | Batidas contadas e pulsos duplos |

Critérios (cada um vira uma etiqueta ✓ ou ✗ na dashboard):
1. **O estado muda** ao aproximar o alvo (repouso ≠ acionado).
2. **Polaridade**: normal quando repouso = nível 0 e acionado = nível 1 (como o firmware espera). Se vier o contrário, é *polaridade invertida*.
3. **1 batida por ciclo** (aproximar + afastar). A batida conta na *subida* do sinal; com polaridade invertida ela passa a contar na saída do alvo, mas continua 1 por ciclo.
4. **Sem pulsos duplos** (repique).

Exemplo de **APROVADO**:
```
--- RESULTADO: APROVADO ---
  [OK] Estado muda ao aproximar o alvo (nível 0 (LOW) → nível 1 (HIGH))
  [OK] Polaridade normal: acionado = nível 1, como o firmware espera
  [OK] 1 batida por ciclo (na aproximação)
  [OK] Sem pulsos duplos
```
Exemplo de **REPROVADO** (resultado real de uma bancada em que o sinal não chegou à PLC):
```
--- RESULTADO: REPROVADO ---
  [FALHA] O estado NÃO mudou ao aproximar o alvo: confira a ligação (Com no +24 V, sinal no I34) e o LED Dp2
  [FALHA] Polaridade não avaliada (sem mudança de estado)
  [FALHA] Esperada 1 batida por ciclo, contou 0
  [OK] Sem pulsos duplos
```

#### `contagem` — contagem exata

1. Rode `node teste_bancada.js contagem --n 10`.
2. Passe o alvo na frente do sensor **10 vezes, devagar** (~1 por segundo). A dashboard mostra **Contagem: 3 / 10**, etc.
3. Ao chegar em 10, o roteiro entra em **4 s de conferência**: afaste o alvo e **não mexa**. Se aparecer contagem extra, é repique.
4. Critérios: contagem **exatamente igual** a `--n`; **sem batidas extras** depois de parar; **sem pulsos duplos**.

Tempo máximo para completar as passagens: `max(40 s, n × 5 s)`. Se o tempo acabar antes, o resultado é REPROVADO com "Faltaram X batida(s)".

#### `ritmo` — com a Wecon (Teste B) ou a prensa

1. Deixe quem gera as batidas **já funcionando** no ritmo desejado (na Wecon, por exemplo, o oscilador K2 liga + K2 desliga com temporizadores de 100 ms = 150 batidas/min; ver [`../docs/BANCADA.md`](../docs/BANCADA.md)).
2. Rode `node teste_bancada.js ritmo --tempo 60`.
3. Não precisa mexer em nada: o roteiro mede por 60 s. A dashboard mostra ritmo e batidas contadas.
4. Critérios: **ritmo médio dentro da faixa programada** (`spm ± tolerância`, ex.: 140–171/min para 155 ±10 %); **sem batidas perdidas**; **sem pulsos duplos**; **variação** abaixo do limite (25 % por padrão).
5. Para testar falhas de propósito, mude o programa da Wecon (intervalo maior = batida perdida; saída parada = parada; pulso curto extra = duplo disparo) e rode de novo.

> O ritmo programado vem da dashboard (card *Ritmo programado*). Se a Wecon gera 150/min e o programado é 155, está dentro da tolerância; se gera 100/min, o teste reprova (como esperado).

#### `repique` — o sensor não pode gerar pulsos sozinho

1. Rode `node teste_bancada.js repique --tempo 30`.
2. Segure o alvo **parado** na **borda da distância de detecção** (onde o LED do sensor "fica na dúvida"), sem encostar e sem balançar, durante os 30 s.
3. Critérios: **nenhuma batida** e **nenhum pulso duplo** no período. Qualquer contagem aqui indica sinal instável (sensor, cabo, aterramento, fonte).

#### `tudo`

`node teste_bancada.js tudo` roda `sinal`, `contagem` e `repique` em sequência (pausa de 8 s entre eles) e termina com um resumo:
```
=== RESUMO ===
  sinal      APROVADO
  contagem   APROVADO
  repique    APROVADO
```

### 8.5 O que a dashboard mostra durante o teste

- Etiqueta **MODO TESTE · dados isolados** no topo (confirma que nada vai para a produção).
- Faixa azul **TESTE DE BANCADA** com: nome do roteiro e descrição; `passo 2/3 · 5 s` (andamento e tempo restante); **instrução do passo em letras grandes**; barra de progresso; **contagem ao vivo** (`Contagem: 7 / 10`); **critérios** (cinza = aguardando, ✓ verde = ok, ✗ vermelho = falhou); texto "Esperado"; e, no fim, **APROVADO** ou **REPROVADO**.
- O resultado **fica na tela por 3 minutos** depois do fim.
- Nos gráficos, o período do teste fica sombreado em azul (`teste: sinal`), e cada batida real do sensor aparece nos gráficos de intervalo e de sinal.
- Cartões: *Estado do sensor* (ACIONADO/REPOUSO) acompanha o sinal real; *Batidas (total)* pisca a cada batida.
- Cada resultado é salvo em `dados_teste/resultados_bancada.csv` (colunas `data_hora;teste;resultado;criterios`).

### 8.6 Interpretar o resultado e corrigir

| Resultado | Causa provável | O que fazer |
|---|---|---|
| **O estado NÃO mudou** | O alvo não foi movido a tempo; sinal no terminal errado; sem 24 V no Com; 0 V não comum; sensor sem alimentação | Repita com o alvo na mão. Observe o **LED do sensor** e o **LED Dp2** da PLC32 (entrada 2). Dp2 acende e o estado não muda → problema de nível/firmware; Dp2 não acende → ligação (fio em **I34**, Com no +24 V, 0 V comum) |
| **Polaridade INVERTIDA** | O GPIO34 lê nível 0 com o sensor acionado (comum com o optoacoplador) | A contagem funciona, mas ACIONADO/REPOUSO ficam trocados. Hoje o firmware não tem opção para inverter: peça a alteração em `main.cpp`/`config.h` e rode `sinal` de novo |
| **Esperada 1 batida por ciclo, contou 0** | Só o estado mudou mas a batida não foi contada, ou o estado nunca mudou | Reveja o resultado acima; confira no monitor serial se aparece `Evento de batida pendente` |
| **Contagem: faltaram X** | Passagens rápidas demais ou fora da zona de detecção | Passe mais devagar e mais perto; confira a distância de detecção do sensor |
| **Contagem: sobraram X** | Repique ou ruído no sinal | Veja os pulsos duplos; confira cabo, blindagem, aterramento, distância |
| **Pulsos duplos > 0** | Repique do sensor, cabo longo/sem blindagem, fonte ruidosa | Cabo blindado, 0 V comum, afastar de cabos de potência, ajustar a distância de detecção |
| **Ritmo fora da faixa** | O gerador (Wecon/prensa) não está no ritmo programado | Ajuste o gerador ou o ritmo programado na dashboard (e salve) |
| **Batidas perdidas** (no `ritmo`) | Falha real do gerador ou do sensor | Reveja a distância de detecção e a velocidade |

### 8.7 Diagnóstico manual (sem os roteiros)

**Monitor serial da PLC32** (115200 baud): no VS Code, ícone de tomada do PlatformIO ("Serial Monitor") ou:
```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" device monitor -b 115200
```
(com a PLC ligada por USB-serial). Mensagens esperadas:
```
Estado inicial do sensor: REPOUSO
Conectado ao broker MQTT.
Mudanca do sensor: ACIONADO          <- ao aproximar o alvo
Evento de batida pendente: 1
Estado publicado em prensa/sensor1/estado: 1
Batida publicada. Pendentes: 0
```
Se `Mudanca do sensor` **nunca** aparece ao mover o alvo, o sinal não chega ao GPIO34 (ligação/terminal). Se aparece `REPOUSO` quando o alvo está perto, a polaridade está invertida.

**Ler a serial pelo PowerShell** (sem abrir o VS Code; a PLC32 aparece como `USB-SERIAL CH340`, ex.: COM6 — descubra com `[System.IO.Ports.SerialPort]::GetPortNames()`):
```powershell
$p = New-Object System.IO.Ports.SerialPort 'COM6',115200,'None',8,'One'
$p.DtrEnable = $false; $p.RtsEnable = $false
$p.Open()
$t0 = Get-Date
while (((Get-Date) - $t0).TotalSeconds -lt 30) { $txt = $p.ReadExisting(); if ($txt) { $txt }; Start-Sleep -Milliseconds 200 }
$p.Close()
```
> **Abrir a serial reinicia a PLC32** (o conversor CH340 aciona o reset da placa). Ela reconecta sozinha em ~10 s. Feche o monitor do VS Code antes: duas janelas não abrem a mesma porta.

**Teste da entrada sem o sensor (jumper):** separa "problema na PLC" de "problema no sensor". Com o **Com no +24 V** e a PLC alimentada, ligue um fio **curto do I34 ao V− (0 V)** por 2 segundos, como se o sensor NPN estivesse conduzindo, e solte:
- O **LED Dp2** acende enquanto o fio está ligado e o painel/serial mostram `Mudanca do sensor` → **a PLC32 está ok**; o problema é o sensor (alimentação, tipo, distância/alvo, ligação do fio preto).
- Nada acontece → problema na PLC32/ligação do comum (Com sem +24 V, 0 V não comum, terminal errado).

Acompanhe sem reiniciar a placa com o painel abaixo.

**Painel em texto, atualizando a cada segundo** (Terminal 2; `Ctrl+C` para sair):
```powershell
while ($true) { $m=(Invoke-RestMethod http://localhost:8085/api/state).maquinas.prensa1; "{0}  sensor={1}  total={2}  duplas={3}  spm={4}  placa_ha={5}" -f (Get-Date -Format T),$m.sensor_estado,$m.total,$m.duplas,$m.spm,$m.placa_ha; Start-Sleep 1 }
```
Aproxime e afaste o alvo e veja `sensor` e `total` mudando.

**Zerar contadores** (botão da dashboard, ou):
```powershell
Invoke-RestMethod -Method Post http://localhost:8085/reset -Body '{}'
```

### 8.8 Outros testes de bancada (manuais)

Faça com o servidor em modo teste e o sensor ligado:

| Teste | Como | Resultado esperado |
|---|---|---|
| **Estado × evento** | Mantenha o alvo **parado** perto do sensor | *Estado do sensor* muda; o total **não** aumenta além de 1 por ciclo |
| **Parada** | Com batidas acontecendo, pare de mover o alvo | Em ~3 s: banner **MÁQUINA PARADA** e alerta vermelho (precisa de ≥10 batidas antes) |
| **Comunicação** | Desligue o cabo de rede da PLC32 | Em ~10 s: banner **SEM COMUNICAÇÃO**; ao religar, volta sozinho |
| **Queda do servidor** | `Ctrl+C` no servidor e inicie de novo (`node server.js --teste`) | A PLC32 reconecta sozinha em poucos segundos |
| **Ruído elétrico** | Com a prensa/motor funcionando perto, rode `repique` | Zero pulsos duplos |

### 8.9 Problemas comuns nos testes de bancada

| Sintoma | Causa | Solução |
|---|---|---|
| `A PLC32 não está comunicando com o servidor` | PLC sem alimentação, cabo no RJ45 errado (I2C), IP/rede incorretos | LED ON da PLC32 aceso? Cabo no RJ45 **Ethernet**? `Test-Connection <IP da PLC>`; aguarde ~30 s e confira `placaOnline` |
| Falha `fetch failed` / `O servidor de teste está rodando em ...?` | Servidor de teste não iniciado | Rode `node server.js --teste` no Terminal 1 |
| `O servidor NÃO está em MODO TESTE` | Está rodando o servidor normal | `Ctrl+C` nele e inicie com `--teste` |
| `EADDRINUSE` na porta 1883 ou 8085 | Servidor normal (ou outro) ainda ativo | Feche-o. Veja quem usa: `netstat -ano \| findstr ":1883"` |
| PLC32 mostra `Falha MQTT. Estado PubSubClient: -2` | O TCP não chega ao servidor | Servidor no ar? Firewall? IP `10.0.1.202` correto no `config.h`? |
| Dashboard não mostra a faixa de teste | Página aberta de antes das atualizações | `Ctrl+F5` no navegador |
| O resultado do roteiro some | Ficam 3 min na tela depois do fim | Veja `dados_teste/resultados_bancada.csv` |

### 8.10 Voltar à produção e limpar

1. No Terminal 1: `Ctrl+C` (para o modo teste).
2. Inicie o servidor normal: `node server.js`.
3. Para apagar os dados do teste (opcional): `Remove-Item -Recurse -Force dados_teste`.
4. Guarde `dados_teste/resultados_bancada.csv` se quiser o registro do teste de bancada (ele é apagado junto com a pasta).

> Os dados de bancada validam o sistema; **não** são contagem industrial certificada (QoS 0, sem persistência na PLC).

## 9. Firmware da PLC32

Está em `../firmware/main.cpp` e `../firmware/config.h` (projeto PlatformIO, ambiente `plc32`).

- `config.h`: `mqtt_server = "10.0.1.202"`, `mqtt_port = 1883`, `pinoSensor = 34`.
- **GPIO do sensor (confirmado no manual da PLC32 V2):** `GPIO34` é a **entrada optoacoplada 2**, borne **I34**. As outras entradas são I39 (GPIO39) e I35 (GPIO35). **Não aplique 24 V direto no GPIO do ESP32**; use sempre o borne optoacoplado. Pinagem completa em [`../docs/BANCADA.md`](../docs/BANCADA.md).
- **Polaridade:** o manual não diz se o GPIO lê nível 1 ou 0 com o sensor acionado. O firmware assume **nível 1 = ACIONADO**. O roteiro `sinal` ([seção 8.4](#84-passo-a-passo-de-cada-roteiro)) mede isso na bancada.
- A Ethernet usa `ETH.begin(1, 32, 14, 4, ETH_PHY_LAN8720)` (pinagem do exemplo CRESCER).
- O firmware publica o estado atual ao (re)conectar **sem contá-lo como batida**; só a transição LOW → HIGH publica em `/batida`. A fila de batidas pendentes é de 1000 e se perde se a PLC reiniciar.

**Compilar no Windows (caminhos longos):** o compilador do ESP32 falha com `CreateProcess: No such file or directory` quando os caminhos são longos (OneDrive, usuário com nome comprido). A solução aplicada neste projeto:
- `build_dir = C:/pio_build/auto` no `platformio.ini` (saída do build em caminho curto);
- atalho (junction) `C:\pio` apontando para `C:\Users\<usuário>\.platformio` e a variável de ambiente de usuário `PLATFORMIO_CORE_DIR=C:\pio` (depois de defini-la, **feche e reabra o VS Code**).

**Gravar (upload):** exige a porta USB-serial da PLC visível no Windows (Gerenciador de Dispositivos → Portas COM, algo como CH340/CP210x/FTDI). Se só aparecem portas Bluetooth, falta o driver, o cabo de dados ou um adaptador USB-TTL. Fixe a porta com `upload_port = COMx` no `platformio.ini`; se o upload reclamar de *Wrong boot mode*, segure o botão BOOT durante o "Connecting…".

## 10. Arquivos de dados e API HTTP

### `producao.csv` (uma linha por minuto com atividade)
Separador `;`, UTF-8 com BOM (abre direto no Excel):

| Coluna | Significado |
|---|---|
| `data_hora` | Minuto (AAAA-MM-DD HH:MM). |
| `maquina` | `prensa1`. |
| `batidas` | Batidas contadas no minuto. |
| `perdidas` | Batidas perdidas estimadas. |
| `duplas` | Pulsos extras filtrados. |
| `spm_programado` | Ritmo programado na época. |

A linha de um minuto só é gravada quando o minuto seguinte começa.

### `alarmes.csv` (um registro por alerta, na hora)
Colunas: `data_hora;maquina;nivel;tipo;mensagem`. Níveis: `info`, `atencao`, `falha`. Tipos: `batida_perdida`, `batida_dupla`, `falhas_seguidas`, `parada`, `retomada`, `ritmo_baixo`, `ritmo_alto`, `instavel` e as versões `*_ok` (normalizou). Também há um registro `servidor_iniciado` a cada vez que o servidor liga; ele serve ao relatório para descontar o tempo em que o servidor ficou desligado (não é um alerta da máquina).

### Rotas HTTP

| Rota | Método | Uso |
|---|---|---|
| `/` | GET | Dashboard. |
| `/api/health` | GET | Diagnóstico: `mqtt`, `broker`, `placaOnline`, `ultimo_erro`. |
| `/api/state` | GET | Estado atual da(s) máquina(s) em JSON. |
| `/relatorio` | GET | Página do relatório parcial de desempenho. |
| `/sensores` | GET | Página de cadastro de máquinas e sensores (ver [`../docs/MAQUINAS_E_SENSORES.md`](../docs/MAQUINAS_E_SENSORES.md)). |
| `/api/maquinas` | GET | Lista as máquinas, com ritmo, sensores atribuídos e status. |
| `/api/maquinas` | POST | Cria (sem `id`) ou atualiza uma máquina (`{"nome":"...","spm":155,...}`; com `id` atualiza). |
| `/api/maquinas?id=prensa2` | DELETE | Exclui a máquina e libera os sensores dela. |
| `/api/maquinas/sensores` | POST | Atribui um sensor a uma máquina (`{"maquina","sensor","papel":"batida"\|"estado","nome"}`). |
| `/api/maquinas/sensores?maquina=prensa1&sensor=sensor2` | DELETE | Remove o sensor da máquina. |
| `/api/sensores` | GET | Sensores que já enviaram mensagem, com nível, última mensagem e máquina atribuída. |
| `/api/relatorio?periodo=hoje` | GET | Relatório em JSON. `periodo`: `15m`, `1h`, `4h`, `8h`, `24h` ou `hoje`; `maquina=prensa1`. Com `&formato=csv` baixa o resumo em CSV. |
| `/estilo-<nome>.css` | GET | Folhas de estilo da pasta `public` (temas). |
| `/events` | GET | Fluxo em tempo real (SSE) usado pela dashboard. |
| `/api/config` | POST | Altera o ritmo programado (`{"maquina":"prensa1","spm":155,...}`). |
| `/reset` | POST | Zera os contadores (`{"maquina":"prensa1"}`). |
| `/api/batida` | POST | Compatibilidade com o firmware HTTP antigo (portas 8085 e 4000). |

## 11. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `npm : ... execução de scripts foi desabilitada` | Política de execução do PowerShell bloqueia `npm.ps1`. | Use `npm.cmd install` e `node server.js` (não precisam de `npm.ps1`). |
| `[MQTT] ERRO ao abrir 0.0.0.0:1883 ... EADDRINUSE` | Outro programa usa a 1883 (Mosquitto ligado ou outro servidor). | `Stop-Service mosquitto` (admin) e feche outros `node server.js`. Veja quem usa: `netstat -ano \| findstr ":1883"`. |
| `[HTTP] ERRO na porta 8085 ... EADDRINUSE` e o servidor encerra | O servidor Python antigo ou outro Node está rodando. | Feche-o (`Get-NetTCPConnection -LocalPort 8085` mostra o PID). Não rode Python e Node juntos. |
| Python mostra `WinError 10013` na porta 8085 | O Node já está usando a 8085. | Não use mais o Python; o Node o substitui. |
| PLC mostra `Falha MQTT. Estado PubSubClient: -2` | A PLC não alcança o broker por TCP. | Servidor Node rodando? `Test-NetConnection 10.0.1.202 -Port 1883` de outro PC; firewall (3.4); rede Privada; IP certo em `config.h`; PLC na mesma faixa de rede. |
| Dashboard abre mas fica em `aguardando a placa` | A PLC não está publicando ou não conectou. | Veja a janela do servidor (`cliente conectado`) e o monitor serial. |
| `SEM COMUNICAÇÃO` com a PLC ligada | Mais de 10 s sem mensagem (rede, cabo, PLC travada). | Cabo/switch, monitor serial, reinicie a PLC. O heartbeat é enviado de tempos em tempos; confira `ultimoHeartbeat` em `/api/health`. |
| `[MQTT] cliente conectado` / `cliente saiu` repetindo | Conexão instável ou dois dispositivos com o mesmo ID. | Verifique cabo/switch e se há outra PLC ou outro programa usando o mesmo `clientId`. |
| Dashboard do Python abre onde deveria ser o Node | Processo antigo ainda ativo. | Encerre-o e reinicie o Node. |
| Contagem maior que as batidas reais | Pulsos de ruído no sensor (veja *Batidas duplas*), ou duas fontes publicando o mesmo evento. | Tratar o sinal na instalação; **nunca** publique o mesmo evento em `prensa/sensor1` e em `prensa/sensor1/batida`. |
| CSV abre com acentos errados | Aberto como ANSI. | Abra pelo Excel (Dados → De Texto/CSV → UTF-8) ou direto, pois o arquivo tem BOM. |
| `CreateProcess: No such file or directory` ao compilar | Caminho longo no Windows. | Ver [seção 9](#9-firmware-da-plc32). |

## 12. Migrar para o Mosquitto no futuro

Quando houver mais máquinas ou exigência de senha/TLS/persistência:
1. Instale o Mosquitto e configure `listener 1883 0.0.0.0` (com autenticação e ACL, não anônimo).
2. Inicie o servidor sem o broker embutido: `node server.js --mqtt-host localhost`.
3. Se ativar usuário e senha, o firmware precisará enviar as credenciais (hoje ele não envia).
4. Novas máquinas: o servidor já suporta várias (`maquinas.json` aceita vários ids); falta o firmware publicar com tópicos por máquina e o `server.js` mapear tópico → id (hoje tudo vai para `prensa1`).

## 13. Limitações e segurança

- O broker embutido **aceita conexões anônimas**. Use só em rede privada/controlada, restrinja por firewall/VLAN e não exponha as portas 1883 e 8085 à internet.
- A dashboard permite alterar o ritmo e zerar contadores **sem autenticação**.
- A PLC publica com QoS 0 e a fila de batidas pendentes não sobrevive a reinício: pode haver perda. Se o servidor Node estiver fora do ar, as batidas desse período não são contadas.
- Os dados em memória (contadores, histórico dos gráficos) **não sobrevivem** a um reinício do servidor; apenas os CSV e o `maquinas.json` ficam gravados.
- Valide em bancada antes de usar números de produção.
