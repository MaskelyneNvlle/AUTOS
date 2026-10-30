# Máquinas e sensores: como cadastrar e ligar mais sensores

Este guia substitui o antigo "adicionar sensor". A correção principal: **um segundo sensor pode ser da mesma máquina**. Quem decide de qual máquina é cada sensor é o **cadastro** (página `/sensores`), e não o nome do tópico MQTT.

## 1. O modelo, em uma figura

```
PLC32 ──MQTT──► servidor ──► MÁQUINA "prensa1"
  sensor1 (I34)  ───────────►   ├─ sensor1  papel: BATIDA   (conta produção)
  sensor2 (I35)  ───────────►   └─ sensor2  papel: ESTADO   (só informa o nível)

                              MÁQUINA "prensa2"
  sensor3 (I39)  ───────────►   └─ sensor3  papel: BATIDA
```

- **Sensor** = uma entrada da PLC32 (I39, I34 ou I35) com seu tópico MQTT. O id do sensor é o nome do tópico: `prensa/<sensor>/...`.
- **Máquina** = o que você quer medir (produção, ritmo, paradas, relatório). Uma máquina pode ter **vários sensores**.
- **Papel** do sensor na máquina:
  - **batida**: cada pulso LOW → ACIONADO conta uma batida. **Só um por máquina.**
  - **estado**: só informa o nível do sinal (ACIONADO/REPOUSO). Não entra na produção.

> **Por que só um sensor de batida por máquina?** Se dois sensores de batida vissem o mesmo evento, a produção seria contada em dobro. Se você quiser que dois sensores **confirmem** a mesma batida, isso exige uma regra de deduplicação (ver seção 7). Para outras informações (fim de curso, presença de peça), use papel **estado**.

## 2. Cadastrar pela dashboard (`/sensores`)

1. Com o servidor no ar, abra **http://localhost:8085/sensores** (ou clique em **Máquinas** na dashboard).
2. **Nova máquina:** preencha nome, batidas/min e tolerância e clique em **Criar máquina**. O id (`prensa2`, `prensa3`...) é automático.
3. **Adicionar sensor:** no cartão da máquina, escolha o id do sensor (aparece no campo *Sensor (entrada)* como sugestão, se a PLC já o enviou), o papel e um nome, e clique em **Adicionar sensor**.
   - Se o sensor já está em outra máquina, o servidor responde com erro: remova-o de lá antes.
   - Se a máquina já tem um sensor de batida, o novo sensor precisa ser **estado**.
4. **Remover sensor:** botão *Remover* na linha dele.
5. **Ritmo e parâmetros:** abra *Ritmo e parâmetros* no cartão para ajustar batidas/min, tolerância, tempo de parada etc.
6. **Excluir máquina:** libera os sensores dela (eles voltam a aparecer como não atribuídos).

A tabela **Sensores recebidos pelo MQTT** mostra todos os sensores que já falaram com o servidor, mesmo sem cadastro, com a última mensagem e o nível. É o jeito mais fácil de confirmar que o sensor novo chegou.

> Os dados do cadastro ficam em `maquinas.json`. Sem cadastro, a PLC continua funcionando como antes: o `sensor1` vira a batida da `prensa1`.

## 3. Pela API (para testes e automações)

Todos os comandos abaixo podem ser colados no PowerShell (com o servidor no ar):

```powershell
# criar uma maquina
Invoke-RestMethod -Method Post http://localhost:8085/api/maquinas -ContentType 'application/json' -Body '{"nome":"Prensa 2","spm":155,"tol":10}'

# atribuir sensor2 como estado a prensa1
Invoke-RestMethod -Method Post http://localhost:8085/api/maquinas/sensores -ContentType 'application/json' -Body '{"maquina":"prensa1","sensor":"sensor2","papel":"estado","nome":"Fim de curso"}'

# ver os sensores recebidos e a quem cada um esta atribuido
Invoke-RestMethod http://localhost:8085/api/sensores | Format-Table id,maquina,papel,estado,ultimo_ha

# remover o sensor2 da prensa1
Invoke-RestMethod -Method Delete "http://localhost:8085/api/maquinas/sensores?maquina=prensa1&sensor=sensor2"

# excluir uma maquina
Invoke-RestMethod -Method Delete "http://localhost:8085/api/maquinas?id=prensa2"
```

Respostas de erro (HTTP 400, 404 ou 409) trazem uma mensagem em `erro`, por exemplo:
- `sensor2 ja esta atribuido a prensa1` (409)
- `prensa1 ja tem um sensor de batida` (409)
- `id invalido: use letras minusculas...` (400)

## 4. Testar com o simulador (sem a PLC)

O simulador agora aceita `--sensor`, para simular qualquer sensor. Exemplo com um servidor de teste em outra porta (`node server.js --mqtt-port 1884 --port 8086 --board-port 8087 --dados dados_mapa`):

```powershell
node simular_batidas.js normal --porta 1884                    # sensor1 (batida da prensa1): conta 65
node simular_batidas.js normal --porta 1884 --sensor sensor2   # sensor2 (estado): NAO conta, so muda o nivel
```

Roteiro de validação usado para esta versão:
1. Criar `prensa2` e atribuir `sensor3` como batida.
2. Atribuir `sensor2` como estado à `prensa1`.
3. Tentar atribuir um segundo sensor de batida à `prensa1` → deve dar **409**.
4. Tentar atribuir `sensor2` à `prensa2` → deve dar **409** (já está na prensa1).
5. Simular `sensor2` → contagem da `prensa1` **não muda**; o nível do `sensor2` muda.
6. Simular `sensor3` → só a `prensa2` conta.

## 5. Firmware: o segundo sensor na PLC32

O servidor já aceita quantos sensores vierem. O que falta é a **PLC32 publicar** o segundo sensor. Use o exemplo `docs/exemplos/main_multisensor.cpp` e `config_multisensor.h` como referência (ele compila; ainda não foi gravado na placa):

- `config.h`: uma lista `SENSORES[]` com uma linha por sensor: pino (39, 34 ou 35), polaridade e os tópicos `prensa/sensor2/estado` e `prensa/sensor2/batida`.
- `main.cpp`: um `for` por sensor para detectar a mudança e publicar.

Gravação (com a PLC ligada por USB, na COM6): feche o monitor serial e rode, na pasta do projeto:
```powershell
$env:PLATFORMIO_CORE_DIR = "C:\pio"
& "C:\pio\penv\Scripts\platformio.exe" run -e plc32 -t upload --upload-port COM6
```
Se aparecer "Connecting......", segure o botão **BOOT** até começar a gravar.

**Por que ler o firmware é necessário mesmo com o cadastro?** O cadastro só decide para qual máquina vai cada tópico. Se a PLC não publicar `prensa/sensor2/...`, o servidor não tem o que receber.

## 6. Roteiro de bancada com dois sensores

1. Suba o servidor real em modo teste: `node server.js --teste`.
2. Cadastre o `sensor2` na `prensa1` como **estado** (pelo `/sensores`).
3. Grave o firmware com dois sensores e verifique no monitor serial: `Sensor 2 (GPIO35): ACIONADO` ao aproximar o alvo.
4. Na página `/sensores`, o `sensor2` aparece em *Sensores recebidos* com o nível. Na `prensa1`, a contagem **não** muda com o `sensor2`.
5. Para o roteiro guiado do sensor de batida, use `teste_bancada.js`. Ele aceita a máquina: `node teste_bancada.js sinal --maquina prensa1`.

## 7. Decisões em aberto (me diga)

- **O que o segundo sensor mede?** Se for um evento diferente (fim de curso, peça presente), ele fica como **estado** e a lógica é outra. Se for para **contar** o mesmo evento como redundância, precisamos de uma regra de deduplicação: por exemplo, ignorar uma segunda batida de outro sensor dentro de N milissegundos. Diga qual dos dois é o caso.
- **Persistência:** os sensores vistos ficam só na memória até chegarem mensagens. O cadastro (máquinas e sensores atribuídos) fica em `maquinas.json`.
