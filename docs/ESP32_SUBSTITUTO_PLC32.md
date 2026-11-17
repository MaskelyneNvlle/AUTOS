# Substituir a PLC32 por um ESP32 com Ethernet

Objetivo: ler os sensores NPN (LJ12A3-2Z/BX) direto no ESP32, falar Modbus RTU com a Wecon e ter **RJ45**, para no futuro enviar os dados para a API da empresa (monitoramento da máquina).

## 1. Ideia central

A PLC32 já é um ESP32 com LAN8720 (Ethernet), entradas optoacopladas de 24 V e RS485. Para trocar, é preciso recriar essas três partes:

| Parte da PLC32 | Substituto |
|---|---|
| ESP32 + Ethernet (LAN8720 + RJ45) | **WT32-ETH01** (ESP32 com LAN8720 e RJ45 na mesma placa) |
| Entradas optoacopladas 24 V | Módulo optoacoplador (ou PC817 + resistor), um canal por sensor |
| RS485 | Módulo TTL↔RS485 com **MAX3485/SP3485** (3,3 V) |
| Fonte | Conversor 24 V → 5 V (buck LM2596 ou DC-DC) |

Por que a WT32-ETH01 e não um ESP32 DevKit com módulo de rede separado: o firmware atual já usa `ETH.h` com LAN8720 e núcleo 2.x. Com a WT32-ETH01 só muda a linha do `ETH.begin(...)`. Um módulo W5500 exigiria outra biblioteca de rede e núcleo 3.x.

## 2. Lista de materiais (preços estimados, não cotados)

| Item | Qtd | R$ aprox. |
|---|---|---|
| WT32-ETH01 | 1 | 80–110 |
| Adaptador USB-TTL 3,3 V (CP2102/FT232), só para gravar | 1 por bancada | 20–30 |
| Módulo optoacoplador PC817 2 canais, entrada 5–24 V (ou 2× PC817 + 2× 3,3 kΩ 0,5 W + 2× 1N4148) | 1 | 10–20 |
| Resistor 10 kΩ (pull-up do GPIO) | 2 | 1 |
| Módulo RS485 com MAX3485/SP3485 | 1 | 10–15 |
| Buck LM2596 ajustado em 5 V (entrada 24 V) | 1 | 15–20 |
| Fusível 1 A + porta-fusível, diodo TVS SMBJ33A ou varistor 33 V | 1 | 10–15 |
| Caixa DIN ou plástica, borneiras, cabo blindado para o RS485 | 1 | 50–80 |
| **Total por unidade** | | **≈ 200–300** |

Adaptador USB-TTL: um serve para todas as placas, só é preciso na gravação.

## 3. Ligação

### 3.1 Pinos escolhidos na WT32-ETH01

Entradas exclusivas de entrada (IO35, IO36, IO39) servem para os sensores. Evite IO0, IO2, IO12 e IO15 (pinos de boot).

| Função | Pino WT32-ETH01 | Observação |
|---|---|---|
| Sensor 1 (batida) | IO35 | Sem pull-up interno: use o 10 kΩ externo para 3,3 V |
| Sensor 2 (fim de curso) | IO39 | Idem |
| RS485 TX (DI) | IO33 | UART2 |
| RS485 RX (RO) | IO32 | UART2 |
| RS485 DE/RE | IO4 | Se o módulo RS485 tiver direção automática, não precisa |
| Alimentação | 5V e GND | Saída do buck |

A WT32-ETH01 não tem USB. Para gravar: ligue TXD/RXD ao adaptador USB-TTL, ponha **IO0 em GND**, dê reset, grave, retire o jumper e dê reset de novo.

### 3.2 Entrada do sensor NPN (um canal)

Sensor NPN de 3 fios: marrom = +24 V, azul = 0 V, **preto = sinal** (puxa para 0 V quando acionado).

```
 +24V ──┬────────────── Sensor marrom (+)
        │
       [3,3k]  (0,5 W)
        │
        ├──► anodo   PC817  coletor ──┬── GPIO (IO35)
        │                             │
 Sensor preto ◄── catodo  PC817  emissor ──┐   [10k] ── 3,3V
                                        │    GND ESP
 0V ── Sensor azul                      
```

- Sensor acionado → conduz para 0 V → LED do optoacoplador acende (≈ 6 mA) → transistor conduz → **GPIO = LOW**.
- Sensor em repouso → GPIO = HIGH (pelo pull-up de 10 kΩ).
- Coloque um **1N4148 em antiparalelo** com o LED (catodo no lado do anodo) para proteger contra tensão reversa.
- Lado do 24 V e lado do ESP ficam **isolados** pelo optoacoplador. Não una o 0 V do sensor com o GND do ESP.
- Se o seu módulo optoacoplador pronto já tem esses resistores, só confirme que a entrada aceita 24 V e ligue o preto no pino de entrada, com o + do módulo em +24 V.

### 3.3 RS485 com a Wecon

- Alimente o módulo RS485 em 3,3 V (MAX3485/SP3485). Não use MAX485 de 5 V: o RX dele entrega 5 V ao GPIO.
- A↔A e B↔B com a Wecon (COM2), cabo blindado, terminação de 120 Ω só se o cabo for longo.
- Parâmetros: 9600 bps, 8N1, estação 1, registro D0 (já em `config.h`).

### 3.4 Alimentação

24 V do painel → fusível 1 A → TVS/varistor → buck ajustado em 5,0 V (meça com multímetro antes de ligar na placa) → 5V da WT32-ETH01 e módulo RS485 (pelo regulador de 3,3 V da placa).

## 4. Mudanças no firmware

Em `firmware/config.h`:

```cpp
// Sensores: o optoacoplador inverte, então ACIONADO = LOW (ativoAlto = false)
const SensorCfg SENSORES[] = {
  {35, false, "prensa/sensor1/estado", true,  "prensa/sensor1/batida"},
  {39, false, "prensa/sensor2/estado", false, nullptr},
};

// RS485 na WT32-ETH01
const int RTU_RX  = 32;
const int RTU_TX  = 33;
const int RTU_DIR = 4;
```

Em `firmware/main.cpp`, `setup_ethernet()`:

```cpp
// WT32-ETH01: endereco PHY 1, power 16, MDC 23, MDIO 18, LAN8720, clock em GPIO0
ETH.begin(1, 16, 23, 18, ETH_PHY_LAN8720, ETH_CLOCK_GPIO0_IN);
```

No `platformio.ini`, para a nova placa: `board = esp32dev` continua servindo. Crie um ambiente `[env:wt32]` copiando o `[env:plc32]` se quiser manter os dois.

## 5. Caminho para a API da empresa

Com o RJ45, o ESP32 já fica na rede da fábrica. Recomendação:

1. Manter **ESP32 → MQTT → servidor-node** como está (o ESP32 continua simples e não depende da API).
2. O `servidor-node` encaminha os dados para a API da empresa (HTTP POST ou o que ela exigir). Se a API mudar, só o servidor muda, não os ESP32.
3. Só mande direto do ESP32 para a API se o servidor deixar de existir. Nesse caso, avalie TLS e autenticação, que pesam no ESP32.

Pergunte à TI da empresa: formato da API (REST/JSON?), autenticação, e se a rede das máquinas pode alcançar o servidor/API (VLAN, firewall, IP fixo ou DHCP reservado).

## 6. Validação na bancada (antes de instalar)

1. Grave o firmware e confira no monitor serial: `IP recebido pela Ethernet`.
2. Teste o jumper: ligue o catodo do optoacoplador ao 0 V por 2 s e veja o estado mudar no servidor.
3. Passe o alvo metálico no sensor real e rode o `teste_bancada.js` (polaridade, contagem, repique).
4. Ligue o RS485 na Wecon e confira o valor de D0 em `prensa/plc/contador`.
5. Deixe rodando 24 h na bancada com a prensa/oscilador, observando reconexões de rede.

## 7. Riscos e limites

- Sem certificação industrial: proteja bem a entrada (TVS, fusível, caixa fechada) e use cabo blindado perto de motores e contatores.
- Poucas unidades: o tempo de montagem e teste pode custar mais que a diferença de preço. Compensa com várias máquinas ou com PCB própria depois do protótipo.
- WT32-ETH01 sem USB: gravação mais trabalhosa em campo (use OTA depois do primeiro upload, se quiser).
- Confirme os pinos no datasheet da sua versão da WT32-ETH01 antes de soldar: há variações de oscilador/pinagem entre lotes.
