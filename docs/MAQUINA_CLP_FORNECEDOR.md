# Máquina (码钉机, "máquina de grampo") — CLP e sinais, segundo o fornecedor

Fontes (em chinês, traduzidas aqui por nós; confirmar com o fornecedor):
- `码钉机操作说明书（伺服送料卸料）2025年8月修订.doc` — manual de operação (rev. ago/2025)
- `码钉机伺服电路图2021(1).pdf` — diagrama elétrico (rev. mar/2021)

## 1. Identificação

- A máquina é a **码钉机** (máquina de grampo / de prender com grampo). É a mesma família da nossa "prensa de grampo". Ela forma o grampo, corta o arame e empurra a peça.
- **CLP no diagrama: LX3V-40MT** (Wecon). É diferente do **LX3V-2416MT-A** que usamos na bancada de teste. Confirme a etiqueta do CLP da máquina.
- Alimentação do painel: 380 V trifásico, 50 Hz. Não ligar nada no painel sem responsável elétrico.

## 2. Sequência do ciclo (manual, item 2)

> Desenrolar → **Alimentar** → **Cortar** (o molde de corte desce e corta, e empurra o pedaço anterior para a posição de formação) → **Formar** (molde de formação) → **Empurrar** (cilindro de empurrar) → Separar (pelo coletor de grampos).

Cada ciclo de corte é **uma batida**. O sinal natural para contar é o **X07 (切模到位, "molde de corte em posição")**, que aciona uma vez por ciclo.

## 3. Entradas do CLP (manual, item 13 + diagrama)

| Entrada | Função (chinês → português) | Sensor no diagrama | Uso para nós |
|---|---|---|---|
| **X00** | 无料检测: **detecção de falta de material** | J1 (proximidade) | **Verificação de banda/material**, o caso que você descreveu |
| X01 | 送料到位: alimentação na posição | J2 (proximidade) | Confirma avanço do material |
| X02 | 退料原位: retorno do descarte à origem | J3 (proximidade) | Estado do descarte |
| X05 | 开模开止: molde aberto (fim de curso) | J4 (proximidade) | Molde aberto |
| **X07** | 切模到位: **molde de corte em posição** | J5 (proximidade) | **Candidato a contar batidas (1 por ciclo)** |
| X10 | 全自动: modo automático | seletor | Estado da máquina |
| X11 | 双手压模: pressão com as duas mãos | botões | Segurança (não mexer) |
| X12 / X26 | 快档 / 慢档: velocidade | seletor | Ritmo programado |
| X13 | 手动 / 半自动: modo manual/semi-auto | seletor | Estado |
| X15, X16, X20 | Comandos manuais (alimentar, abrir, retornar) | botões | Não usar |
| X21 / X22 | Motor ligado / desligado | botões | Estado da bomba |

Os sensores J1–J5 são **de proximidade**. O manual não diz se são NPN ou PNP nem a corrente de saída. Precisamos da etiqueta do sensor.

## 4. Saídas do CLP (manual, item 14)

| Saída | Função |
|---|---|
| Y0, Y10 | Descarte pneumático (卸料) |
| Y2 | Abrir molde (成型开模) |
| Y4 | Fechar molde / prensar (成型合模) |
| Y5 | Alimentar pneumático (气动送料) |
| Y16 | Motor da bomba (via relé de estado sólido GT16 → contator KM1) |

As saídas Y são transistores NPN com comuns por grupo (COM0…COM5). Elas acionam relés de estado sólido (GT2, GT4, GT5, GT10).

## 5. Falhas (manual, item 12)

- Molde não abre após o corte: verificar X07 e pressão do óleo (5–6 MPa).
- Alimentador não alimenta: verificar X05.
- Alimenta mas não corta: verificar X01 e X02.
- A máquina para sozinha em caso de falha (molde danificado, descarte com problema, falta de material).

Esses sintomas batem com o que a PLC32 deve reportar. Seria útil receber o histórico de falhas do CLP.

## 6. Oportunidades para a PLC32

1. **Leitura passiva (sem alterar o CLP):** ler X07 (ciclo) e X00 (falta de material) em paralelo com as entradas do CLP, usando um **isolador/duplicador** de sinal. Assim não mexemos na lógica da máquina.
2. **Leitura via Modbus RTU do próprio CLP:** se o fornecedor ativar Modbus RTU escravo na COM2 do LX3V-40MT (mesma configuração da bancada: D8126 = 20H, D8121 = estação, D8120 = velocidade e formato), a PLC32 lê contadores e estados direto do CLP. Isso exige que o fornecedor altere o programa da máquina.

Recomendo começar pela **opção 1** (passiva) se o fornecedor não puder alterar o programa.

## 7. Cuidados de segurança

- X11 (duas mãos) e a parada de emergência fazem parte da segurança da máquina. Não mexer nessas ligações.
- Qualquer ligação nova deve ser em paralelo e somente de leitura. Nunca cortar fios do circuito da máquina.
- O manual pede que ninguém coloque a mão na área do molde com a máquina ligada.

## 8. Perguntas para o fornecedor

1. Confirmar o modelo do CLP da máquina (LX3V-40MT?) e se a COM2 está livre.
2. Os sensores J1–J5 são NPN ou PNP? Qual o modelo e a corrente de saída?
3. Podem ativar Modbus RTU escravo na COM2 e informar o mapeamento de X/Y/C?
4. Podem enviar o programa do CLP (somente para leitura) para confirmarmos X00 e X07?
5. X00 é ativo quando há falta de material ou quando há material? (A lógica está nomeada como "detecção de falta".)
