# Ladder de bancada: simulação da máquina (码钉机) no LX3V-2416MT-A

Objetivo: o CLP de teste tem **o mesmo mapa de entradas e saídas da máquina** (X e Y do diagrama e do manual). Assim, o que a PLC32 lê na bancada corresponde ao que ela vai ler na máquina real.

Este programa foi escrito a partir do diagrama `码钉机伺服电路图2021` e do manual de operação. **Ainda não foi gravado nem testado na placa.** Confirme os nomes das instruções no WECON PLC Editor (o software do LX3V), como nos programas anteriores.

## 1. Mapa de entradas (botões na bancada)

| Entrada | Função na máquina (manual) | Na bancada |
|---|---|---|
| X00 | Detecção de falta de material (J1) | Botão: **ON = falta de material** (pausa o ciclo) |
| X01 | Alimentação em posição (J2) | Não usado (simulação interna) |
| X02 | Descarte na origem (J3) | Não usado |
| X05 | Molde aberto (J4) | Não usado (simulação interna) |
| X07 | Molde de corte em posição (J5) | **Simulado** pela saída Y6 do CLP de teste |
| X10 | Modo automático | Chave/botão: **ON = automático** |
| X11 | Duas mãos (segurança) | Não usado nesta simulação |
| X13 | Semi-automático | Não usado |
| X15 | Alimentar manual | Botão |
| X16 | Abrir molde manual | Botão |
| X20 | Descarte manual | Botão |
| X21 | Motor ligado | Botão de partida (pulso) |
| X22 | Motor desligado | Botão de parada |
| X27 | Livre | Botão: **zerar contador** |

## 2. Mapa de saídas

| Saída | Função na máquina (manual) | Na bancada |
|---|---|---|
| Y0 | Descarte pneumático | Indicador (lâmpada) |
| Y2 | Abrir molde | Indicador |
| Y4 | Fechar molde (formação) | Indicador, ativo no pulso de corte |
| Y5 | Alimentar | Indicador |
| Y16 | Bomba (via relé de estado sólido) | Indicador de bomba |
| **Y6** | *Livre na máquina* | **Sensor simulado de batida (X07)**. Liga ao **I34** da PLC32 |
| **Y7** | *Livre na máquina* | **Sensor simulado de banda (X00 invertido)**. Liga ao **I35** da PLC32 |

Y6 e Y7 são reservadas para a simulação. Na máquina real elas não existem: lá, a PLC32 lê direto o sensor.

## 3. Lista de instruções (IL)

```
; ---------- 1. Configuracao da COM2 (Modbus RTU escravo) ----------
LD    M8002
MOV   H81  D8120     ; 9600 8N1
MOV   K1   D8121     ; estacao 1
MOV   H20  D8126     ; Modbus RTU escravo

; ---------- 2. Bomba (motor): liga em X21, desliga em X22 ----------
LD    X21
OR    Y16
ANI   X22
OUT   Y16

; ---------- 3. Ciclo rodando: automatico + bomba + com material ----------
LD    Y16
AND   X10            ; modo automatico
ANI   X00            ; X00 ON = falta de material: pausa
OUT   M0

; ---------- 4. Oscilador de corte (simula X07): 200 ms ligado / 200 ms desligado ----------
LD    M0
ANI   T1
OUT   T0  K2
LD    T0
OUT   T1  K2
LD    T0
OUT   M1             ; M1 = pulso de corte (1 por ciclo, ~150/min)

; ---------- 5. Sensores simulados para a PLC32 ----------
LD    M1
OUT   Y6             ; batida: Y6 -> I34 da PLC32
LDI   X00
OUT   Y7             ; banda presente: Y7 -> I35 da PLC32

; ---------- 6. Indicadores do ciclo ----------
LD    M1
OUT   Y4             ; fechar molde durante o pulso de corte
LD    M0
ANI   M1
OR    X15
OUT   Y5             ; alimentar (ciclo ou manual)
LD    X16
OUT   Y2             ; abrir molde (manual)
LD    X20
OUT   Y0             ; descarte (manual)

; ---------- 7. Contador de golpes (borda de subida do pulso de corte) ----------
LDP   M1
OUT   C0  K9999
LD    X27
RST   C0

; ---------- 8. Contagem disponivel para a PLC32 (Modbus D0) ----------
LD    M8000
MOV   C0   D0
END
```

## 4. Como o programa funciona

1. **Configuração:** na primeira varredura, a COM2 é configurada para Modbus RTU escravo, como nos testes anteriores.
2. **Bomba:** X21 liga e X22 desliga, como no painel da máquina.
3. **Ciclo:** só roda com automático (X10), bomba ligada e material presente.
4. **Oscilador:** gera um pulso de 200 ms a cada 400 ms, o que equivale a 150 golpes por minuto, dentro da faixa 130–150 da máquina.
5. **Sensores simulados:** Y6 repete o pulso de corte (batida). Y7 mostra a banda (ligada quando há material).
6. **Contador:** conta cada pulso de corte. X27 zera. O valor vai para o D0, que a PLC32 lê por Modbus.

## 5. Ligação com a PLC32

| Bancada (LX3V-2416MT-A) | PLC32 |
|---|---|
| Y6 (sensor de batida) | I34 |
| Y7 (sensor de banda) | I35 |
| Comum das saídas Y6 e Y7 | Com da PLC32 (+24 V) |
| 0 V da alimentação das saídas | V− da PLC32 |
| COM2 RS485 (A/B) | A+ / B− da PLC32 |

**Atenção:** as saídas Y6 e Y7 são transistores NPN. A alimentação de 24 V do grupo de saídas precisa estar presente, e os dois pinos devem estar no mesmo grupo COM (confira na etiqueta do CLP de teste).

## 6. Testes sugeridos

1. Grave o programa e confira no monitor: `D8120 = 129`, `D8126 = 32`, `D8121 = 1`.
2. Ligue X21 (bomba), X10 (automático) e confira Y16 ligado.
3. Veja Y6 piscando a cada 400 ms e `C0` subindo.
4. Ligue X00 (falta de material): o ciclo deve parar e Y7 apagar.
5. Com a PLC32 ligada ao I34 e ao I35, rode `node teste_bancada.js contagem --n 10` e confira que o servidor conta a mesma quantidade.

## 7. Pontos a confirmar

- **Nomes das instruções:** `LDP`, `OUT C`, `RST`, `MOV`, `M8000`, `M8002`. Confirme no WECON PLC Editor.
- **Temporizadores:** o oscilador usa `T0` e `T1` em 100 ms por unidade (K2 = 200 ms). Confirme a unidade de tempo dos temporizadores do modelo.
- **Polaridade de X00:** o nome do sinal é "detecção de falta". Na máquina real, confirme se X00 fica ativo com falta ou com material.
- **Velocidade:** a máquina tem seletor lento/médio/rápido (X12 e X26). Aqui fica fixo em 400 ms. Se quiser variar, troque o K2 por outro valor.
- **Segurança:** a simulação não tem parada de emergência nem duas mãos. Não use este programa para acionar nada real.
