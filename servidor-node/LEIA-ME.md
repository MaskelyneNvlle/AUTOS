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
8. [Teste na bancada com a PLC e o sensor reais](#8-teste-na-bancada-com-a-plc-e-o-sensor-reais)
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
| `public/index.html` | A dashboard (a mesma página do servidor Python). |
| `simular_batidas.js` | **Simulador da PLC**: publica cenários prontos (normal, batida perdida, ruído, parada…) no broker. Ver [seção 7](#7-testes-sem-a-plc-simulando-batidas-passo-a-passo). |
| `teste_analise.js` | Teste automático da lógica de análise (12 cenários, sem rede). |
| `teste_mqtt_local.js` | Teste automático da separação de tópicos (estado, heartbeat e batida) contra um servidor de teste. |
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

**Gráficos:** o primeiro mostra batidas/min nos últimos 5 minutos, com a faixa verde do ritmo programado. O segundo mostra cada batida nos últimos 60 s como uma barra vertical; **barra vermelha = batida com problema** (perdida ou dupla).

**Ritmo programado desta máquina (formulário):** altere e clique *Salvar*; vale na hora e fica gravado em `maquinas.json`.

| Campo | Padrão | Significado |
|---|---|---|
| Batidas/min programadas | 155 | Ritmo esperado (manual da formadora: 150–160). |
| Tolerância (%) | 10 | Faixa aceita: 155 ± 10% = 140 a 170/min. |
| Parada após (s) | 3,0 | Segundos sem batida para declarar a máquina parada. |
| Perdidas p/ FALHA (60 s) | 3 | Quantidade de batidas perdidas em 60 s que vira FALHA. |
| Variação p/ instável (%) | 25 | Variação entre intervalos que vira "ritmo instável". |

**Alertas:** lista abaixo; amarelo = atenção, vermelho = falha/parada, verde = informação (retomada, normalizou). Todo alerta também é gravado em `alarmes.csv`.

**Zerar contadores:** zera total, perdidas, duplas e histórico em memória da máquina (os CSV já gravados não são apagados).

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

> Estes testes **não** comprovam o cabeamento do sensor, a Ethernet nem o firmware da PLC. Isso é a [seção 8](#8-teste-na-bancada-com-a-plc-e-o-sensor-reais).

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

## 8. Teste na bancada com a PLC e o sensor reais

Pré-requisitos: servidor rodando (seção 4) e firewall liberado (3.4).

1. **Conferir a ligação da PLC:** ligue a PLC32 na mesma rede. No monitor serial (115200) devem aparecer a conexão Ethernet, o IP recebido e `Conectado ao broker MQTT.` No servidor: `[MQTT] cliente conectado: PLC32-Prensa-…`.
   - Se aparecer `Falha MQTT. Estado PubSubClient: -2`, o TCP não chegou ao servidor (rede/firewall/IP). Ver [seção 11](#11-solução-de-problemas).
2. **Conferir o painel:** `http://10.0.1.202:8085/api/health` deve ter `"placaOnline": true`. Na dashboard, a etiqueta fica `placa ativa (MQTT (prensa/heartbeat))` e o *Estado do sensor* mostra ACIONADO ou REPOUSO.
3. **Teste de contagem:** clique em *Zerar contadores*. Acione e solte o sensor **exatamente 10 vezes**, devagar (uma por segundo). O total deve ficar em **10**. Repita com 30. Se o total diferir, anote quanto e como (pulsos extras = duplas?).
4. **Teste de estado × evento:** mantenha o sensor acionado e solto sem pulsar: o *Estado do sensor* muda e **o total não aumenta**. Só a transição LOW → HIGH conta.
5. **Teste de ritmo real:** com a prensa funcionando, confira o *Batidas por minuto* com uma contagem manual de 15 s (× 4) ou com o contador da máquina.
6. **Teste de parada:** pare a prensa: em ~3 s o banner deve virar MÁQUINA PARADA e um alerta vermelho deve ser gravado.
7. **Teste de comunicação:** desligue o cabo de rede da PLC: em ~10 s o banner deve virar SEM COMUNICAÇÃO. Religue: ele volta sozinho.
8. **Teste de queda do servidor:** feche o servidor e abra de novo: a PLC deve reconectar sozinha em poucos segundos.
9. **Teste de ruído elétrico:** com a prensa em operação, observe *Batidas duplas*. Muitas duplas indicam ruído ou repique no sinal (blindagem, aterramento, filtro) e devem ser tratadas na instalação.

> Os dados de bancada servem para validar o sistema; **não** o tratam como contagem industrial certificada (QoS 0, sem persistência na PLC).

## 9. Firmware da PLC32

Está em `../firmware/main.cpp` e `../firmware/config.h` (projeto PlatformIO, ambiente `plc32`).

- `config.h`: `mqtt_server = "10.0.1.202"`, `mqtt_port = 1883`, `pinoSensor = 34`.
- **Confirme o GPIO do sensor** no manual/esquema da PLC32 antes de gravar. **Não aplique 24 V direto no GPIO do ESP32**; o GPIO34 não tem pull-up/pull-down interno.
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
Colunas: `data_hora;maquina;nivel;tipo;mensagem`. Níveis: `info`, `atencao`, `falha`. Tipos: `batida_perdida`, `batida_dupla`, `falhas_seguidas`, `parada`, `retomada`, `ritmo_baixo`, `ritmo_alto`, `instavel` e as versões `*_ok` (normalizou).

### Rotas HTTP

| Rota | Método | Uso |
|---|---|---|
| `/` | GET | Dashboard. |
| `/api/health` | GET | Diagnóstico: `mqtt`, `broker`, `placaOnline`, `ultimo_erro`. |
| `/api/state` | GET | Estado atual da(s) máquina(s) em JSON. |
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
