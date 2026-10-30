# PLC32 V2 e Wecon LX3V-2416MT: pinagem e ligações de bancada

Fontes: **Manual PLC 32 v1.0 (Crescer)**, páginas 4–6, 9–12, 14–17, e **catálogo Wecon LX3V 1616M/2416M** (página 3).
O que não consta nesses documentos está marcado como **confirmar**.

## 0. Rótulos impressos na placa (informados pelo usuário) → função

| Rótulo | Função | GPIO / observação |
|---|---|---|
| **V+**, **V−** | Alimentação da placa (12–30 V DC) | — |
| **Com** | Comum das entradas optoacopladas | NPN: no +V; PNP: no GND |
| **I39** | Entrada optoacoplada 1 | GPIO39 |
| **I34** | Entrada optoacoplada 2 (**a do firmware**) | GPIO34 |
| **I35** | Entrada optoacoplada 3 | GPIO35 |
| **O18**, **O15**, **O12**, **O13** | Saídas coletor aberto 1, 2, 3 e 4 (ULN2003, máx. 500 mA) | GPIO18, 15, 12, 13 |
| **A+**, **B−** | RS485 (isolado) | A+ = TX(A) GPIO16, B− = RX(B) GPIO17; DIR = GPIO2 |
| **Vcom**, **Gcom** | Mesmo borne de 4 vias do RS485/CAN: parte isolada (provavelmente alimentação e referência do lado do barramento) | **confirmar** — não ligue em V+/V− |

> A ordem em que você listou as saídas (013, 012, 015, 018) é inversa à do manual (18, 15, 12, 13). Confira na placa qual está mais perto de **I35**: a primeira da fila é a saída 1 (O18).

## 1. PLC32 V2 — GPIOs do ESP32

### Entradas e saídas (borneiras)
| Função | Borne | GPIO | Observação |
|---|---|---|---|
| Entrada optoacoplada 1 | 1 | **39** | EL814 bidirecional (NPN ou PNP); LED de status Dp1 |
| Entrada optoacoplada 2 | 2 | **34** | **É a entrada usada pelo firmware** (`pinoSensor = 34`); LED Dp2 |
| Entrada optoacoplada 3 | 3 | **35** | LED Dp3 |
| Comum das entradas | Com | — | NPN → comum no **+V**; PNP → comum no **GND** |
| Saída 1 (coletor aberto, ULN2003) | 1 | 18 | máx. 500 mA por canal |
| Saída 2 | 2 | 15 | idem |
| Saída 3 | 3 | 12 | idem |
| Saída 4 | 4 | 13 | idem |

### Comunicação
| Função | GPIO |
|---|---|
| RS485 TX (A) | **16** |
| RS485 RX (B) | **17** |
| RS485 DIR (direção) | **2** |
| I2C SCL (expansões, RJ45 isolado) | 5 |
| I2C SDA | 33 |
| Entrada SCT-013 (corrente) | 36 |

### Ethernet (LAN8720) — ocupa estes pinos, não use para outra coisa
| Sinal | GPIO | | Sinal | GPIO |
|---|---|---|---|---|
| nINT | 0 | | TX1 | 22 |
| MDIO | 4 | | RX0 | 25 |
| MDC | 14 | | RX1 (o manual escreve "TX1") | 26 |
| PHY (alimentação) | 32 | | CRS | 27 |
| TX0 | 19 | | RST | 23 |
| TXEN | 21 | | | |

Coerente com o firmware: `ETH.begin(1, 32, 14, 4, ETH_PHY_LAN8720)` = endereço PHY 1, power GPIO32, MDC GPIO14, MDIO GPIO4.

### Alimentação
- Recomendado **12 a 30 V contínuos**; consumo normal **85 mA** (≈100 mA a 24 V). A serigrafia indica "7 a 30 V".
- O manual diz que inverter a polaridade não danifica a placa.

### Cuidados da própria placa
- **Dois RJ45**: um é Ethernet, o outro é **I2C isolado**. Ligar o cabo do roteador no I2C pode queimar o isolador ADuM1250.
- GPIO 0, 2, 12 e 15 são pinos de *boot* do ESP32 e aqui são usados por nINT, DIR e saídas 3 e 2: não force nível neles durante a partida.

## 2. Wecon LX3V-2416MT (dados do catálogo)
- 24 entradas / 16 saídas (X0–X27 e Y0–Y17 pela numeração octal da série), saída **transistor NPN** (*sink*), circuito de saída **DC 5–30 V**, até **0,5 A por ponto** e 0,8 A por grupo COM, carga mínima 5 V / 2 mA.
- Alimentação: modelos **-A** = AC 85–265 V; modelos **-D** = DC 24 V ±10 %. **Veja a etiqueta da sua unidade.**
- Nos modelos AC há **saída de serviço 24 V DC, 700 mA** (terminais 24V+ e COM, conforme a wiki da Wecon), que serve para alimentar sensores — e a PLC32.
- Portas seriais: COM1 = RS422 ou RS485, **COM2 = RS485**.
- Entradas: 24 V DC, ≈7 mA. No circuito de entrada, **S/S no +24 V = entrada NPN; S/S no negativo = PNP** (manual de programação da Wecon, lido por resumo; **confirmar na serigrafia da sua unidade**).
- Nunca injete tensão nos terminais 24V de serviço (advertência dos manuais da Wecon).

## 3. Ligações de bancada

### Teste A (recomendado primeiro): sensor NPN direto na PLC32
Valida sensor → PLC32 → MQTT → dashboard. A Wecon entra só como fonte de 24 V (ou use uma fonte 24 V qualquer).

```
 +24V ─────────┬──────────── PLC32 borne V+ (alimentação)
               ├──────────── PLC32 borne Com (comum das entradas)   <- NPN: comum no +V
               └──────────── Sensor NPN fio MARROM (+)
 0V  ──────────┬──────────── PLC32 borne V−
               └──────────── Sensor NPN fio AZUL (−)
                             Sensor NPN fio PRETO (sinal) ──── PLC32 borne I34 (GPIO34)
```
1. Desligue tudo, monte, confira os fios, ligue a fonte.
2. O LED **Dp2** da PLC32 deve acender quando o sensor atuar.
3. Cabo de rede da PLC32 no RJ45 **Ethernet** (não no I2C) até o switch do servidor 10.0.1.202.
4. Abra o monitor serial (115200). Passe um alvo metálico na frente do sensor e veja `Mudanca do sensor: ...`.

**Como rodar o teste com os roteiros guiados** (resultado na dashboard):
1. Pare o servidor normal e inicie o de teste: `node server.js --teste` (na pasta `servidor-node`).
2. Abra `http://localhost:8085`: deve aparecer "MODO TESTE" e a placa ativa.
3. Rode `node teste_bancada.js sinal` e siga as instruções na faixa azul da dashboard. Depois `contagem`, `repique` (ou `tudo`).
4. Passo a passo detalhado, critérios e solução de problemas: `servidor-node/LEIA-ME.md`, seção 8 (comandos na 8.3).

### Teste B: Wecon simulando a prensa (gera as batidas)
A saída a transistor NPN da Wecon se comporta como um sensor NPN: puxa a entrada da PLC32 para o 0 V.

```
 +24V ─────────┬──────────── PLC32 V+            ┌── Wecon COM1 (comum do grupo da saída)
               └──────────── PLC32 Com           │
 0V  ──────────┬──────────── PLC32 V−            │
               └─────────────────────────────────┘
 Wecon Y?  (saída escolhida) ───────── PLC32 borne I34 (GPIO34)
 (a Wecon precisa estar alimentada; o 0 V da Wecon, o COM da saída e o 0 V da PLC32 ficam interligados)
```
- Programa na Wecon: um oscilador de dois temporizadores (liga/desliga) na saída. Com timers de 100 ms: **K2 ligado + K2 desligado = 400 ms = 150 batidas/min** (dentro da tolerância de 155 ±10 %). Para testar falhas: aumente um intervalo (batida perdida), pare a saída por alguns segundos (parada), gere um pulso curto extra (duplo disparo).
- Use uma saída comum (não as de pulso rápido); confira os rótulos na etiqueta (**confirmar**).
- A linguagem da LX3V é do tipo Mitsubishi FX; ajuste endereços de timer ao manual de programação.

### RS485 (fase 2, não é necessária para o Teste A/B)
- A **PLC32 já tem RS485 isolado** no borne de 4 vias (TX(A) GPIO16, RX(B) GPIO17, DIR GPIO2). A **plaquinha externa de RS485 não é necessária na PLC32**. Ela serve para um PC (adaptador USB-RS485) conversar com a Wecon ou para outra placa sem RS485.
- Ligação PLC32 ⇄ Wecon COM2: **A com A, B com B**, referência (GND) comum e **resistor de 120 Ω** nas pontas do barramento. Se não houver comunicação, inverta A e B (as marcações A/B variam entre fabricantes).
- O firmware atual **não usa RS485**. Ler dados da Wecon por Modbus seria uma etapa nova (parâmetros de comunicação são definidos no programa da Wecon).

## 4. Polaridade: confira antes de confiar nos números
O manual não diz se o GPIO34 lê **HIGH ou LOW** quando o sensor está acionado. Com o optoacoplador, o mais comum é o pino ir a **LOW** quando o opto conduz. O firmware assume **HIGH = ACIONADO** e conta a batida na subida (LOW → HIGH).
- Se o monitor serial mostrar `ACIONADO` quando o alvo **está longe**, a lógica está invertida.
- Isso mudaria o estado exibido e o instante da contagem (a contagem de ciclos continua igual, só desloca para o fim do pulso). A correção é simples (inverter a leitura em `config.h`/`main.cpp`).

## 5. Checklist de segurança
- Nunca ligue 24 V direto em GPIO: use sempre os bornes optoacoplados.
- Modelo AC da Wecon: tensão de rede nos terminais L/N — trabalhe desenergizado e com pessoa qualificada.
- Interligue os 0 V das fontes que se comunicam por sinal.
- Cabo de rede no RJ45 certo da PLC32 (Ethernet, não I2C).
