# Ladder de bancada com 2 sensores (LX3V-2416MT-A)

Para a bancada com a CLP e os dois sensores NPN, sem botões. Os nomes das entradas seguem o diagrama da máquina.

## 1. Ligação na bancada

| Sensor | Entrada da CLP | Entrada da PLC32 | Papel |
|---|---|---|---|
| Sensor 1 (batida, cópia do X07 da máquina) | **X007** | **I34** | Conta 1 batida por acionamento |
| Sensor 2 (banda, cópia do X00 da máquina) | **X000** | **I35** | Indica falta de banda |

- Cada sensor vai em **paralelo**: o fio de sinal liga na entrada da CLP e na da PLC32 ao mesmo tempo.
- O comum (S/S) da CLP e o Com da PLC32 vão ao **+24 V**, a mesma alimentação dos sensores.
- O 0 V dos sensores e o V− da PLC32 ficam no mesmo ponto.

## 2. Premissas (confirme no teste)

- **X000 ativo = sem banda.** É o mesmo sentido do X00 da máquina ("detecção de falta de material"). Se na bancada for o contrário, inverta a lógica trocando `ANI` por `AND` nas linhas de sem banda.
- A contagem de batidas conta **todo** acionamento de X007, com ou sem banda. A separação fica em dois contadores, para não decidir a regra de habilitação agora.

## 3. Lista de instruções (IL)

```
; ---------- 1. Modbus RTU escravo na COM2 (padrao Wecon) ----------
LD    M8002
MOV   H81  D8120     ; 9600 8N1
MOV   K1   D8121     ; estacao 1
MOV   H20  D8126     ; Modbus RTU escravo

; ---------- 2. Contador de batidas (com banda) ----------
LDP   X007           ; borda de subida do sensor 1
ANI   X000           ; so conta com banda presente
OUT   C0  K9999

; ---------- 3. Contador de batidas sem banda ----------
LDP   X007
AND   X000           ; batida com falta de banda
OUT   C1  K9999

; ---------- 4. Estado dos sensores em registros (lido pela PLC32) ----------
LD    X007
MOV   K1   D2        ; D2 = 1 quando o sensor 1 esta acionado
LDI   X007
MOV   K0   D2
LD    X000
MOV   K1   D3        ; D3 = 1 quando o sensor 2 esta acionado (sem banda)
LDI   X000
MOV   K0   D3

; ---------- 5. Contagens para a PLC32 ----------
LD    M8000
MOV   C0   D0        ; D0 = batidas com banda
MOV   C1   D1        ; D1 = batidas sem banda
END
```

## 4. Como o programa funciona

1. **Partida:** a primeira varredura configura a COM2 para Modbus RTU escravo.
2. **Contagem:** cada vez que o sensor 1 passa a acionado, `C0` soma 1 se houver banda, ou `C1` se não houver.
3. **Estados:** `D2` e `D3` espelham os sensores, para o servidor poder conferir a leitura.
4. **Registros:** `D0` e `D1` ficam disponíveis por Modbus. Na PLC32, o contador de `D0` já é lido pelo firmware atual.

## 5. Como zerar o contador

Não há botão nesta bancada. Opções:
- zerar pelo monitor do PLC Editor, no modo online;
- desligar e ligar a CLP (confirme se o contador é retentivo no modelo).

Quando tivermos a escrita Modbus, o zeramento pode vir do servidor.

## 6. Roteiro de teste na bancada

1. Grave o programa e coloque a CLP em RUN.
2. No monitor, confira `D8120 = 129`, `D8126 = 32`, `D8121 = 1`.
3. Passe o alvo do sensor 1: `C0` deve subir 1 por acionamento, e `D2` deve ir a 1 enquanto estiver acionado.
4. Acione o sensor 2 e passe o alvo do sensor 1: deve subir `C1`, e não `C0`.
5. Com a PLC32 ligada, rode `node teste_bancada.js contagem --n 10` e confira que o servidor conta a mesma quantidade que `C0`.

## 7. Confirmar no PLC Editor

- Nomes e unidades das instruções: `LDP`, `OUT C`, `RST`, `MOV`, `M8000`, `M8002`.
- Se o contador é retentivo (mantém o valor ao desligar).
- Se a entrada X007 e a X000 aceitam a polaridade do sensor NPN.
