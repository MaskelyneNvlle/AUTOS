# Relatório do projeto: monitoramento da prensa de grampo (码钉机)

Data: 05/11/2026. Versão enxuta, para orientar as próximas decisões.

## 1. O que está pronto

- **Servidor (Node.js):** broker MQTT embutido, dashboard em tempo real, análise de ritmo (paradas, batidas perdidas e duplas, ritmo fora da faixa, instabilidade), relatório de desempenho e página de cadastro de máquinas e sensores (`/sensores`). Testes automáticos passando.
- **PLC32 (firmware):** lê o sensor de batida (I34) e publica estado e batida no MQTT. Validado na bancada.
- **Firmware de dois sensores e RTU Modbus:** compila, mas ainda **não foi testado na placa**.
- **Firmware de escuta RS485:** **gravado e rodando** na PLC32. Ainda não ouviu o barramento porque a placa não está ligada ao CLP.
- **Bancada:** simulador de batidas, roteiros de teste com o sensor real (`teste_bancada.js`), ladder de simulação da máquina escrito (ainda não gravado).
- **Repositório:** histórico preservado, 4 commits novos enviados ao GitHub (privado).

## 2. O que aprendemos

- A máquina é a **码钉机** (grampo), com CLP **LX3V-40MT** (Wecon) e sensores **NPN** (LEFIRCKO LJ12A3-2Z/BX, 300 mA, 2 mm). As entradas X00 (falta de material) e X07 (molde em posição) são os sinais úteis.
- O **LX3V se programa no WECON PLC Editor**. O PI Studio é só para as IHMs.
- Uma entrada da PLC32 em paralelo com um sensor NPN tem folga de sobra de corrente.
- A PLC32 aceita 12 a 30 V, mas os sensores de 24 V precisam de 24 V de verdade.
- O Windows guarda portas COM antigas. Filtrar pelo status evita escolher um dispositivo que não existe.

## 3. Carências

- **Nenhum dado real do barramento RS485.** Não sabemos se a IHM ou o CLP usa essa porta, nem o formato.
- **Sem acesso ao programa do CLP da máquina.** O fornecedor recusou responder.
- **Modelo e polaridade do sinal de X00 e X07 não confirmados** na máquina.
- **Medições elétricas pendentes:** queda de tensão e corrente de fuga dos sensores J1, J2, J4 e J5.
- **Firmware de dois sensores e RTU sem teste na placa.** A configuração Wecon (D0, D8120, D8121, D8126) vem de documentação da família, não do equipamento.
- **Ladder não gravado.** Ainda falta praticar o WECON PLC Editor.
- **Sem integração com o Orion.** O documento de referência é da coladeira, e o código do Orion não está acessível.
- **Dashboard sem autenticação, broker MQTT anônimo.** Aceitável só em rede privada.
- **Documentos conflitantes:** pinos RX/TX do RS485 (documento de reconstrução vs. exemplo da Crescer) e bateria do RTC (manual vs. documento). Precisam ser resolvidos na bancada.
- **Pasta antiga do OneDrive** ainda existe e está travada. Precisa ser removida manualmente.

## 4. Ideias e aplicações futuras

- **Habilitador de banda:** só contar a batida quando a banda estiver presente (X00). Depende de decidir a regra com você.
- **Fim de curso como cartão na dashboard**, além de sensor de estado.
- **Banco de dados:** SQLite primeiro, em paralelo ao CSV. Depois, a ponte para o banco do Orion.
- **Integração com o Orion:** definir se a PLC32 publica por MQTT (atual) ou expõe uma API HTTP (modelo da especificação). A decisão afeta a arquitetura.
- **Parâmetros de comunicação por máquina:** começar com um firmware por máquina e, mais tarde, configuração remota por MQTT.
- **Atualização de firmware remota (OTA)** depois que a primeira gravação por USB estiver validada.
- **Indicadores de desempenho:** incluir refugo quando houver contagem de peças boas, ordem de produção e lote vindos do Orion.
- **Horário confiável:** sincronizar a PLC32 por NTP, já que o RTC pode não ter bateria.

## 5. Decisões que precisam de você

1. O que a **banda** faz: habilita a contagem, ou só gera alerta?
2. A batida vem do **sensor X07** (imediato, independente do protocolo) ou do **RS485** (quando a porta estiver disponível)?
3. A integração com o Orion será por **MQTT** ou por **HTTP**?
4. A prensa entra no mesmo projeto que a coladeira, ou será um projeto separado?

## 6. Próximos passos sugeridos

1. Medir os sensores (tensão e corrente) e levantar os modelos J1, J2, J4 e J5.
2. Ligar a PLC32 ao RS485 do CLP **somente com autorização** e rodar a escuta por pelo menos 2 minutos.
3. Praticar o WECON PLC Editor com o simulador, e gravar o ladder de bancada.
4. Gravar a versão de dois sensores na PLC32 e validar o RTU com o CLP de teste.
5. Decidir as questões da seção 5 e começar a camada de banco de dados.
