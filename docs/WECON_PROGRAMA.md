# Programa da Wecon LX3V-2416MT-A (teste): simula a prensa e publica o contador para a PLC32

Objetivo:
- **X0** (botão) simula um golpe: Y0 liga enquanto o botão está apertado, e cada aperto soma 1 no contador.
- **Y0** ligada ao borne **I34** da PLC32 é o "sensor" de batida.
- **D0** guarda o contador. A PLC32 lê o D0 via Modbus RTU na COM2 (estação 1, 9600 8N1).
- **X1** zera o contador.

## 1. Programa (lista de instruções)

```
; --- primeira varredura: configura a COM2 como Modbus RTU escravo ---
LD    M8002
MOV   H81  D8120     ; 9600 bps, 8 bits, sem paridade, 1 stop
MOV   K1   D8121     ; estacao 1
MOV   H20  D8126     ; protocolo: Modbus RTU escravo
; --- simulacao do sensor ---
LD    X0
OUT   Y0             ; Y0 ligada enquanto o botao X0 estiver apertado
; --- contador: cada aperto do botao (borda de subida) soma 1 ---
LDP   X0
OUT   C0  K9999
; --- zerar ---
LD    X1
RST   C0
; --- contador disponivel no D0 (lido pela PLC32) ---
LD    M8000
MOV   C0   D0
END
```

Como ler:
- `LD`, `LDP`: contato normal e contato de borda de subida (dispara uma vez por aperto).
- `OUT`: bobina (liga a saída ou o contador).
- `RST`: zera o contador.
- `MOV`: copia um valor. `H81` e `H20` são valores em hexadecimal; `K1` é decimal.
- `M8002`: pulso só na primeira varredura, para configurar a COM2 ao ligar.
- `M8000`: ligado todo o tempo em RUN, para copiar o contador para D0 continuamente.

## 2. Ladder equivalente (para conferir)

```
M8002 ──┤ ├──────────[MOV H81 D8120]──[MOV K1 D8121]──[MOV H20 D8126]──
X0    ──┤ ├──────────────────────────────────────────────────────────( Y0 )
X0    ──┤↑├──────────────────────────────────────────────────( C0 K9999 )
X1    ──┤ ├──────────────────────────────────────────────────────( RST C0 )
M8000 ──┤ ├──────────────────────────────────────────[MOV C0 D0]────────
```

## 3. Passo a passo no PI Studio

1. **Novo projeto:** escolha o modelo **LX3V-2416MT-A** (saída transistor, NPN).
2. **Editor:** abra o editor de **Lista de instruções** (Instruction List) e digite as linhas da seção 1. Se preferir ladder, use a seção 2.
3. **Compilar:** compile e corrija os erros que aparecerem. Erro de instrução desconhecida quase sempre é diferença de nome; me avise qual linha.
4. **Conexão:** conecte o cabo mini-USB no PC e na Wecon. Em *Online*, procure ou conecte à PLC.
5. **Gravar:** envie o programa para a PLC.
6. **Colocar em RUN:** coloque a PLC em RUN pelo PI Studio ou pela chave da própria PLC.
7. **Monitorar:** no monitor online, confira que:
   - `D8120` = `129` (81H) e `D8126` = `32` (20H), depois da primeira varredura;
   - `D8121` = `1`;
   - ao apertar X0, `Y0` liga e `C0` sobe 1 a cada aperto;
   - `D0` acompanha `C0`.

## 4. Testar a Wecon antes da PLC32

Com um conversor USB-RS485 no barramento da COM2 (A/B e GND):
```bash
mbpoll -m rtu -a 1 -b 9600 -P none -d 8 -s 1 -t 4 -r 0 -c 1 COM7
```
Aperte X0 e rode de novo: o valor deve subir a cada aperto. Se der timeout, veja:
- A e B trocados (inverta);
- estação diferente de 1;
- velocidade ou formato diferentes de 9600 8N1;
- COM7 errada (confira no Gerenciador de Dispositivos).

## 5. Ligação com a PLC32 (lembrete)

- Y0 da Wecon → borne **I34** da PLC32. O comum (Com) da PLC32 vai ao +24 V, e o 0 V da Wecon vai ao 0 V da PLC32.
- A+ e B− da PLC32 → RS485+ e RS485− da COM2 da Wecon.

## 6. Pontos a confirmar

- **Polaridade do sinal:** com Y0 ligada, o I34 vai para o nível que o firmware chama de ACIONADO? Confira com o roteiro `sinal` (`node teste_bancada.js sinal`). Se estiver invertido, ajustamos o `ativoAlto` no `config.h`.
- **Contador em 9999:** para na contagem máxima. Para teste está ok; para produção, a contagem vai para o banco e a Wecon zera periodicamente.
- **Se algum nome de instrução ou registro não existir** no seu PI Studio, me manda o erro e a versão do software, que eu corrijo.
